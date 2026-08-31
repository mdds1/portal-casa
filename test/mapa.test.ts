import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash } from "../src/auth/senha.js";
import { criarApp } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { bom } from "../src/fontes/tipos.js";
import type { RecursoPve } from "../src/fontes/proxmox.js";

const RECURSOS: RecursoPve[] = [
  { tipo: "lxc", vmid: 102, nome: "Docker", estado: "running", cpu: 0, memoria: 0, memoriaMax: 4e9 },
  { tipo: "lxc", vmid: 201, nome: "jellyfin", estado: "running", cpu: 0, memoria: 0, memoriaMax: 2e9 },
  { tipo: "qemu", vmid: 120, nome: "gamebox-batocera", estado: "stopped", cpu: 0, memoria: 0, memoriaMax: 4e9 },
];

async function servidor() {
  const db = abrirBanco(":memory:");
  semear(db);
  const inserir = db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)");
  inserir.run("matheus", "Matheus", gerarHash("s1"), "admin");
  inserir.run("marcella", "Marcella", gerarHash("s2"), "casa");
  const app = criarApp({
    db, segredoSessao: "teste",
    exec: async () => bom("running"),
    caches: { pve: new Cache(async () => bom(RECURSOS)) },
  });
  const s = app.listen(0);
  const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  const entrar = async (login: string, senha: string) => {
    const r = await fetch(`${base}/entrar`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ login, senha }).toString(),
      redirect: "manual",
    });
    return (r.headers.get("set-cookie") ?? "").split(";")[0]!;
  };
  return { db, s, base, entrar };
}

// Recorta o bloco de uma categoria inteira, para afirmar CONTENCAO — que um
// item esta DENTRO do galho certo — em vez de so perguntar se ele aparece em
// algum lugar da pagina, que passaria com a arvore toda embaralhada.
function categoria(html: string, nome: string): string {
  const m = html.match(
    new RegExp(`<section class="tronco">\\s*<h2>${nome}</h2>[\\s\\S]*?</section>`)
  );
  assert.ok(m, `categoria ${nome} nao encontrada`);
  return m![0];
}

test("cada servico aparece dentro da sua categoria, nao so em algum lugar da pagina", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();

    assert.match(categoria(html, "Jogos"), /Dofus login/);
    assert.match(categoria(html, "Jogos"), /Jogo FloripaOT/);
    assert.match(categoria(html, "Midia"), /Jellyfin/);
    assert.match(categoria(html, "Midia"), /Radarr/);
    // E o inverso: o que e de Midia nao pode estar em Jogos.
    assert.doesNotMatch(categoria(html, "Jogos"), /Radarr/);
    assert.doesNotMatch(categoria(html, "Midia"), /Dofus login/);
  } finally { s.close(); }
});

test("os containers do Docker aparecem, com a maquina que os hospeda", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();
    for (const nome of ["Radarr", "Sonarr", "Prowlarr", "Bazarr", "qBittorrent", "Seerr", "FlareSolverr", "RomM"])
      assert.match(html, new RegExp(nome), `${nome} deveria aparecer no mapa`);
    // Cada um mora no CT 102, e o mapa tem que dizer isso.
    const folhas = html.match(/<li class="folha">[\s\S]*?<\/li>/g) ?? [];
    const radarr = folhas.find((f) => f.includes("Radarr"));
    assert.ok(radarr, "folha do Radarr nao encontrada");
    assert.match(radarr!, /CT 102/, "a folha do Radarr tem que dizer onde ele mora");
  } finally { s.close(); }
});

test("a Marcella nao ve os servicos de admin", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("marcella", "s2");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();
    assert.match(html, /Jellyfin/, "o Jellyfin e dela");
    assert.match(html, /Home Assistant/, "o Home Assistant e dela");
    for (const oculto of ["Radarr", "Sonarr", "qBittorrent", "Proxmox", "nginx do portal", "Jogo FloripaOT"])
      assert.doesNotMatch(html, new RegExp(oculto), `${oculto} e de admin, nao pode vazar`);
  } finally { s.close(); }
});

test("o estado da maquina que hospeda aparece na folha", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();
    const folhas = html.match(/<li class="folha">[\s\S]*?<\/li>/g) ?? [];
    const jellyfin = folhas.find((f) => f.includes("Jellyfin"));
    const batocera = folhas.find((f) => f.includes("Batocera"));
    assert.match(jellyfin!, /ponto ok/, "o CT 201 esta running, o ponto tem que ser verde");
    assert.match(batocera!, /ponto parado/, "a VM 120 esta stopped");
  } finally { s.close(); }
});

test("url de esquema perigoso nao vira link", async () => {
  const { db, s, base, entrar } = await servidor();
  try {
    db.prepare("UPDATE servicos SET url = ? WHERE nome = ?")
      .run("javascript:alert(1)", "Radarr");
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();
    assert.doesNotMatch(html, /javascript:/, "esquema perigoso nao pode chegar ao HTML");
    assert.match(html, /Radarr/, "o servico continua listado, so sem link");
  } finally { s.close(); }
});
