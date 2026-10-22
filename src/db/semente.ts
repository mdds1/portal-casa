import type Database from "better-sqlite3";

type LinhaMaquina = [tipo: "vm" | "ct", vmid: number, nome: string, descricao: string, ip: string | null, onboot: 0 | 1, papel: string, acionavel: 0 | 1];

// Os IPs de LAN abaixo sao so exibicao (coluna "IP" da tela de infraestrutura).
// Quem faz checagem e `host_checagem` nos SERVICOS, e la usamos nome de
// MagicDNS, nao IP -- ver a nota sobre a renumeracao logo abaixo.
//
// RENUMERACAO DE 19/09/2026: a casa mudou de endereco, o roteador e outro e a
// LAN inteira trocou de numero. A faixa .2-.199 e DHCP; .200-.202 sao fixos de
// infra. Conferido maquina por maquina contra ARP/MAC em 19/09/2026 -- nao
// deduzido do documento antigo, que estava errado em quase toda linha.
const MAQUINAS: LinhaMaquina[] = [
  // A bancada, o Home Assistant e o proprio portal NUNCA sao acionaveis.
  ["vm", 110, "tfs-server", "Bancada de desenvolvimento", "192.168.15.7", 1, "admin", 0],
  ["vm", 111, "home-assistant", "Automacao da casa", "192.168.15.10", 1, "casa", 0],
  ["vm", 120, "gamebox-batocera", "Emulador na TV", null, 0, "casa", 1],
  ["vm", 301, "floripaot", "Servidor de Tibia e site, producao", "192.168.15.11", 1, "admin", 1],
  ["ct", 100, "drive", "Drive de midias por SMB", null, 0, "admin", 1],
  ["ct", 102, "Docker", "Containers avulsos", "192.168.15.201", 1, "admin", 1],
  ["ct", 103, "portal", "Porteiro da casa: nginx, tunel e este portal", "192.168.15.14", 1, "admin", 0],
  ["ct", 104, "starloco", "Servidor de Dofus Retro", "192.168.15.13", 1, "admin", 1],
  ["ct", 201, "jellyfin", "Midia da casa, nao-privilegiado", "192.168.15.202", 1, "casa", 1],
];

type LinhaServico = [vmid: number, nome: string, descricao: string, porta: number | null, host: string | null, url: string | null, categoria: string, grupo: string, ordem: number, papel: string];

// `host_checagem` usa NOME de MagicDNS, nao IP de LAN. Foi IP ate 19/09/2026, e
// a renumeracao da casa quebrou a checagem de 15 dos 18 servicos de uma vez --
// o painel ficou todo vermelho sem nada estar fora do ar. O nome acompanha a
// maquina; o IP de LAN e do roteador, e o roteador muda.
//
// Isto nao acrescenta dependencia: o /etc/resolv.conf do CT 103 ja aponta so
// para 100.100.100.100 (Tailscale), e o portal so e alcancavel pela tailnet.
// Se o tailscaled cair, ninguem chega ao portal de qualquer jeito.
//
// Excecao: o starloco (CT 104) NAO esta na tailnet, entao continua por IP.
// O .13 e reserva de DHCP pelo MAC BC:24:11:41:06:83 no roteador novo.
const SERVICOS: LinhaServico[] = [
  // Jogos
  [301, "Site FloripaOT", "Site publico, conta e highscores", 80, "floripaot", "https://floripaot.dinizismo.com.br", "Jogos", "Tibia", 1, "admin"],
  [301, "Jogo FloripaOT", "Porta de login do cliente", 7171, "floripaot", null, "Jogos", "Tibia", 2, "admin"],
  [104, "Dofus login", "StarLoco, servidor de login", 450, "192.168.15.13", null, "Jogos", "Dofus", 1, "admin"],
  [104, "Dofus jogo", "StarLoco, servidor de jogo", 5555, "192.168.15.13", null, "Jogos", "Dofus", 2, "admin"],
  [120, "Batocera", "Console de emulacao da sala", null, null, null, "Jogos", "Emulacao", 1, "casa"],
  [102, "RomM", "Biblioteca de ROMs e saves", 7070, "docker-media-pve", "http://docker-media-pve:7070", "Jogos", "Emulacao", 2, "casa"],
  [102, "RomM (banco)", "MariaDB do RomM, sem porta exposta", null, null, null, "Jogos", "Emulacao", 3, "admin"],

  // Midia
  [201, "Jellyfin", "Filmes, series, animes e musicas", 8096, "jellyfin-pve", "http://jellyfin-pve:8096", "Midia", "Assistir", 1, "casa"],
  [102, "Seerr", "Pedidos de filme e serie", 5055, "docker-media-pve", "http://docker-media-pve:5055", "Midia", "Assistir", 2, "casa"],
  [102, "Radarr", "Filmes: procura e organiza", 7878, "docker-media-pve", "http://docker-media-pve:7878", "Midia", "Aquisicao", 1, "admin"],
  [102, "Sonarr", "Series: procura e organiza", 8989, "docker-media-pve", "http://docker-media-pve:8989", "Midia", "Aquisicao", 2, "admin"],
  [102, "Prowlarr", "Indexadores, alimenta Radarr e Sonarr", 9696, "docker-media-pve", "http://docker-media-pve:9696", "Midia", "Aquisicao", 3, "admin"],
  [102, "Bazarr", "Legendas", 6767, "docker-media-pve", "http://docker-media-pve:6767", "Midia", "Aquisicao", 4, "admin"],
  [102, "qBittorrent", "Cliente de torrent", 8080, "docker-media-pve", "http://docker-media-pve:8080", "Midia", "Aquisicao", 5, "admin"],
  [102, "FlareSolverr", "Resolve desafio de Cloudflare para o Prowlarr", 8191, "docker-media-pve", null, "Midia", "Aquisicao", 6, "admin"],
  [100, "Drive", "Arquivos compartilhados por SMB", null, null, null, "Midia", "Arquivos", 1, "casa"],

  // Casa
  [111, "Home Assistant", "Automacao, so pela Tailscale", 80, "homeassistant", "https://ha.dinizismo.com.br", "Casa", "Automacao", 1, "casa"],

  // Infraestrutura
  // O Proxmox fica por IP de proposito: o certificado dele tem
  // `IP Address:192.168.15.200` como unico SAN, entao abrir por nome daria
  // aviso de certificado. Ver infra/portal/implantacao.md.
  [110, "Proxmox", "Interface do hipervisor", 8006, "192.168.15.200", "https://192.168.15.200:8006", "Infraestrutura", "Plataforma", 1, "admin"],
  [103, "nginx do portal", "TLS e proxy reverso", 443, "portal", null, "Infraestrutura", "Plataforma", 2, "admin"],
];

export function semear(db: Database.Database): void {
  const m = db.prepare(`
    INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo,acionavel)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(vmid) DO UPDATE SET
      tipo=excluded.tipo, nome=excluded.nome, descricao=excluded.descricao,
      ip=excluded.ip, onboot=excluded.onboot, papel_minimo=excluded.papel_minimo,
      acionavel=excluded.acionavel`);

  const s = db.prepare(`
    INSERT INTO servicos (maquina_vmid,nome,descricao,porta,host_checagem,url,categoria,grupo,ordem,papel_minimo)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(maquina_vmid,nome) DO UPDATE SET
      descricao=excluded.descricao, porta=excluded.porta,
      host_checagem=excluded.host_checagem, url=excluded.url,
      categoria=excluded.categoria, grupo=excluded.grupo, ordem=excluded.ordem,
      papel_minimo=excluded.papel_minimo`);

  db.transaction(() => {
    for (const l of MAQUINAS) m.run(...l);
    for (const l of SERVICOS) s.run(...l);
  })();
}
