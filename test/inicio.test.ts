import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash } from "../src/auth/senha.js";
import { criarApp } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { bom, ruim } from "../src/fontes/tipos.js";
import type { RecursoPve } from "../src/fontes/proxmox.js";
import { duracao } from "../src/telas/inicio.js";
import { cachesDeTeste } from "./apoio.js";

const RECURSOS: RecursoPve[] = [
  { tipo: "qemu", vmid: 301, nome: "floripaot", estado: "running", cpu: 0.02, memoria: 2e9, memoriaMax: 8e9, uptime: 90061 },
  { tipo: "lxc", vmid: 104, nome: "starloco", estado: "stopped", cpu: 0, memoria: 0, memoriaMax: 2e9, uptime: 0 },
  { tipo: "lxc", vmid: 103, nome: "portal", estado: "running", cpu: 0.01, memoria: 3e8, memoriaMax: 5e8, uptime: 7200 },
];

async function servidor(caches = cachesDeTeste(RECURSOS)) {
  const db = abrirBanco(":memory:");
  semear(db);
  const inserir = db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)");
  inserir.run("matheus", "Matheus", gerarHash("s1"), "admin");
  inserir.run("marcella", "Marcella", gerarHash("s2"), "casa");
  const app = criarApp({ db, segredoSessao: "teste", exec: async () => bom("running"), caches });
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

function cartao(html: string, titulo: string): string {
  const m = html.match(new RegExp(`<section class="cartao">(?:(?!</section>)[\\s\\S])*?${titulo}[\\s\\S]*?</section>`));
  assert.ok(m, `cartao "${titulo}" nao encontrado`);
  return m![0];
}

test("duracao usa duas unidades, e nao mente sobre valor invalido", () => {
  assert.equal(duracao(90061), "1d 1h");
  assert.equal(duracao(7200), "2h 0min");
  assert.equal(duracao(300), "5min");
  assert.equal(duracao(0), "—");
  assert.equal(duracao(-5), "—");
  assert.equal(duracao(NaN), "—");
});

test("a previsao aparece com a temperatura de agora e os proximos dias", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();
    const c1 = cartao(html, "Florianopolis");
    assert.match(c1, /18°C, garoa/);
    assert.match(c1, /98%/);
    // O dia vira nome, nao data crua: "2026-09-01" nao diz nada a ninguem.
    assert.doesNotMatch(c1, /2026-09-01/);
    assert.match(c1, /17° a 24° · nublado/);
  } finally { s.close(); }
});

test("quem esta conectado separa online de ausente, com ha quanto tempo", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();
    const c1 = cartao(html, "Quem esta conectado");
    assert.match(c1, /2 de 3/);
    assert.match(c1, /iphone-do-matheus[\s\S]*?conectado/);
    assert.match(c1, /drive[\s\S]*?ha 2d/);
    assert.match(c1, /portal \(este portal\)/);
  } finally { s.close(); }
});

test("o servidor mostra ha quanto tempo esta ligado, e quanto esta usando", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();
    const c1 = cartao(html, "Servidor da casa");
    assert.match(c1, /1d 1h/, "uptime em dias e horas");
    assert.match(c1, /12\.0 GB de 32\.0 GB \(38%\)/, "memoria com proporcao");
    assert.match(c1, /carga 0\.52/);
  } finally { s.close(); }
});

test("as maquinas ligadas aparecem com o tempo de cada uma; as paradas nao", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();
    const c1 = cartao(html, "Maquinas ligadas");
    assert.match(c1, /floripaot[\s\S]*?1d 1h/);
    assert.match(c1, /portal[\s\S]*?2h 0min/);
    assert.doesNotMatch(c1, /starloco/, "starloco esta parada, nao entra em 'ligadas'");
  } finally { s.close(); }
});

test("a Inicio nao repete os servicos: eles moram no Mapa", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();
    for (const servico of ["Radarr", "Sonarr", "Jellyfin", "Dofus login", "Site FloripaOT"])
      assert.doesNotMatch(html, new RegExp(servico), `${servico} e do Mapa, nao da Inicio`);
    assert.match(html, /href="\/mapa"/, "e a Inicio aponta para la");
  } finally { s.close(); }
});

test("a Marcella ve o tempo e a rede, e nao o estado do servidor", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("marcella", "s2");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();
    assert.match(html, /Florianopolis/);
    assert.match(html, /Quem esta conectado/);
    assert.doesNotMatch(html, /Servidor da casa/, "uso do host e de admin");
    assert.doesNotMatch(html, /Maquinas ligadas/, "as maquinas sao de admin");
  } finally { s.close(); }
});

test("fonte que falha vira cartao vermelho com o motivo, nao pagina quebrada", async () => {
  const caches = cachesDeTeste(RECURSOS);
  caches.tempo = new Cache(async () => ruim("previsao respondeu 503"));
  const { s, base, entrar } = await servidor(caches);
  try {
    const c = await entrar("matheus", "s1");
    const r = await fetch(base + "/", { headers: { cookie: c } });
    assert.equal(r.status, 200, "uma fonte fora do ar nao derruba a pagina");
    const html = await r.text();
    const c1 = cartao(html, "Florianopolis");
    assert.match(c1, /ponto erro/, "o cartao fica vermelho");
    assert.match(c1, /503/, "e diz o motivo");
    // As outras fontes continuam mostrando o que sabem.
    assert.match(html, /Quem esta conectado/);
  } finally { s.close(); }
});
