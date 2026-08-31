import type Database from "better-sqlite3";

type LinhaMaquina = [tipo: "vm" | "ct", vmid: number, nome: string, descricao: string, ip: string | null, onboot: 0 | 1, papel: string];

const MAQUINAS: LinhaMaquina[] = [
  ["vm", 110, "tfs-server", "Bancada de desenvolvimento", "192.168.15.10", 0, "admin"],
  ["vm", 111, "home-assistant", "Automacao da casa", "192.168.15.8", 1, "casa"],
  ["vm", 120, "gamebox-batocera", "Emulador na TV", null, 0, "casa"],
  ["vm", 301, "floripaot", "Servidor de Tibia e site, producao", "192.168.15.11", 1, "admin"],
  ["ct", 100, "drive", "Drive de midias por SMB", null, 0, "admin"],
  ["ct", 101, "Jellyfin", "Jellyfin antigo, privilegiado, a remover", null, 0, "admin"],
  ["ct", 102, "Docker", "Containers avulsos", null, 0, "admin"],
  ["ct", 103, "portal", "Porteiro da casa: nginx, tunel e este portal", "192.168.15.14", 1, "admin"],
  ["ct", 104, "starloco", "Servidor de Dofus Retro", "192.168.15.16", 0, "admin"],
  ["ct", 201, "jellyfin", "Midia da casa, nao-privilegiado", "192.168.15.15", 0, "casa"],
];

type LinhaServico = [vmid: number, nome: string, descricao: string, porta: number | null, host: string | null, url: string | null, papel: string];

const SERVICOS: LinhaServico[] = [
  [301, "Site FloripaOT", "Site publico, conta e highscores", 80, "192.168.15.11", "https://floripaot.dinizismo.com.br", "admin"],
  [301, "Jogo FloripaOT", "Porta de login do cliente", 7171, "192.168.15.11", null, "admin"],
  [111, "Home Assistant", "Automacao, so pela Tailscale", 80, "192.168.15.8", "https://ha.dinizismo.com.br", "casa"],
  [201, "Jellyfin", "Filmes e series", 8096, "192.168.15.15", null, "casa"],
  [104, "Dofus login", "StarLoco, servidor de login", 450, "192.168.15.16", null, "admin"],
  [104, "Dofus jogo", "StarLoco, servidor de jogo", 5555, "192.168.15.16", null, "admin"],
  [103, "nginx do portal", "TLS e proxy reverso", 443, "192.168.15.14", null, "admin"],
  [110, "Proxmox", "Interface do hipervisor", 8006, "192.168.15.200", null, "admin"],
];

export function semear(db: Database.Database): void {
  const m = db.prepare(`
    INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(vmid) DO UPDATE SET
      tipo=excluded.tipo, nome=excluded.nome, descricao=excluded.descricao,
      ip=excluded.ip, onboot=excluded.onboot, papel_minimo=excluded.papel_minimo`);

  const s = db.prepare(`
    INSERT INTO servicos (maquina_vmid,nome,descricao,porta,host_checagem,url,papel_minimo)
    SELECT ?,?,?,?,?,?,?
    WHERE NOT EXISTS (SELECT 1 FROM servicos WHERE maquina_vmid=? AND nome=?)`);

  db.transaction(() => {
    for (const l of MAQUINAS) m.run(...l);
    for (const l of SERVICOS) s.run(...l, l[0], l[1]);
  })();
}
