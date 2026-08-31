import type Database from "better-sqlite3";

type LinhaMaquina = [tipo: "vm" | "ct", vmid: number, nome: string, descricao: string, ip: string | null, onboot: 0 | 1, papel: string, acionavel: 0 | 1];

const MAQUINAS: LinhaMaquina[] = [
  // A bancada, o Home Assistant e o proprio portal NUNCA sao acionaveis.
  ["vm", 110, "tfs-server", "Bancada de desenvolvimento", "192.168.15.10", 0, "admin", 0],
  ["vm", 111, "home-assistant", "Automacao da casa", "192.168.15.8", 1, "casa", 0],
  ["vm", 120, "gamebox-batocera", "Emulador na TV", null, 0, "casa", 1],
  ["vm", 301, "floripaot", "Servidor de Tibia e site, producao", "192.168.15.11", 1, "admin", 1],
  ["ct", 100, "drive", "Drive de midias por SMB", null, 0, "admin", 1],
  ["ct", 101, "Jellyfin", "Jellyfin antigo, privilegiado, a remover", null, 0, "admin", 0],
  ["ct", 102, "Docker", "Containers avulsos", null, 0, "admin", 1],
  ["ct", 103, "portal", "Porteiro da casa: nginx, tunel e este portal", "192.168.15.14", 1, "admin", 0],
  ["ct", 104, "starloco", "Servidor de Dofus Retro", "192.168.15.16", 0, "admin", 1],
  ["ct", 201, "jellyfin", "Midia da casa, nao-privilegiado", "192.168.15.15", 0, "casa", 1],
];

type LinhaServico = [vmid: number, nome: string, descricao: string, porta: number | null, host: string | null, url: string | null, categoria: string, grupo: string, ordem: number, papel: string];

const SERVICOS: LinhaServico[] = [
  // Jogos
  [301, "Site FloripaOT", "Site publico, conta e highscores", 80, "192.168.15.11", "https://floripaot.dinizismo.com.br", "Jogos", "Tibia", 1, "admin"],
  [301, "Jogo FloripaOT", "Porta de login do cliente", 7171, "192.168.15.11", null, "Jogos", "Tibia", 2, "admin"],
  [104, "Dofus login", "StarLoco, servidor de login", 450, "192.168.15.16", null, "Jogos", "Dofus", 1, "admin"],
  [104, "Dofus jogo", "StarLoco, servidor de jogo", 5555, "192.168.15.16", null, "Jogos", "Dofus", 2, "admin"],
  [120, "Batocera", "Console de emulacao da sala", null, null, null, "Jogos", "Emulacao", 1, "casa"],
  [102, "RomM", "Biblioteca de ROMs e saves", 7070, "192.168.15.102", "http://192.168.15.102:7070", "Jogos", "Emulacao", 2, "casa"],
  [102, "RomM (banco)", "MariaDB do RomM, sem porta exposta", null, null, null, "Jogos", "Emulacao", 3, "admin"],

  // Midia
  [201, "Jellyfin", "Filmes, series, animes e musicas", 8096, "192.168.15.15", "http://192.168.15.15:8096", "Midia", "Assistir", 1, "casa"],
  [102, "Seerr", "Pedidos de filme e serie", 5055, "192.168.15.102", "http://192.168.15.102:5055", "Midia", "Assistir", 2, "casa"],
  [102, "Radarr", "Filmes: procura e organiza", 7878, "192.168.15.102", "http://192.168.15.102:7878", "Midia", "Aquisicao", 1, "admin"],
  [102, "Sonarr", "Series: procura e organiza", 8989, "192.168.15.102", "http://192.168.15.102:8989", "Midia", "Aquisicao", 2, "admin"],
  [102, "Prowlarr", "Indexadores, alimenta Radarr e Sonarr", 9696, "192.168.15.102", "http://192.168.15.102:9696", "Midia", "Aquisicao", 3, "admin"],
  [102, "Bazarr", "Legendas", 6767, "192.168.15.102", "http://192.168.15.102:6767", "Midia", "Aquisicao", 4, "admin"],
  [102, "qBittorrent", "Cliente de torrent", 8080, "192.168.15.102", "http://192.168.15.102:8080", "Midia", "Aquisicao", 5, "admin"],
  [102, "FlareSolverr", "Resolve desafio de Cloudflare para o Prowlarr", 8191, "192.168.15.102", null, "Midia", "Aquisicao", 6, "admin"],
  [100, "Drive", "Arquivos compartilhados por SMB", null, null, null, "Midia", "Arquivos", 1, "casa"],

  // Casa
  [111, "Home Assistant", "Automacao, so pela Tailscale", 80, "192.168.15.8", "https://ha.dinizismo.com.br", "Casa", "Automacao", 1, "casa"],

  // Infraestrutura
  [110, "Proxmox", "Interface do hipervisor", 8006, "192.168.15.200", null, "Infraestrutura", "Plataforma", 1, "admin"],
  [103, "nginx do portal", "TLS e proxy reverso", 443, "192.168.15.14", null, "Infraestrutura", "Plataforma", 2, "admin"],
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
