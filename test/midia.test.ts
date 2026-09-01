import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash } from "../src/auth/senha.js";
import { criarApp } from "../src/app.js";
import { bom, ruim } from "../src/fontes/tipos.js";
import type { EstadoHa } from "../src/fontes/homeassistant.js";
import { cachesDeTeste } from "./apoio.js";

const ESTADOS: EstadoHa[] = [
  { entidade: "media_player.suite_luke_s", estado: "off", rotulo: "Luke's" },
  { entidade: "media_player.luke_tv_un55au7700gxzd", estado: "on", rotulo: "Luke TV (UN55AU7700GXZD)" },
  { entidade: "binary_sensor.jellyfin_tailscale", estado: "on", rotulo: "Jellyfin Tailscale" },
  { entidade: "binary_sensor.radarr", estado: "on", rotulo: "Radarr" },
  { entidade: "binary_sensor.bazarr", estado: "off", rotulo: "Bazarr" },
  { entidade: "sensor.armazenamento_media", estado: "7", rotulo: "Armazenamento media" },
];

async function subir(t: { after: (fn: () => void) => void }, opcoes: {
  estados?: EstadoHa[] | "falha";
  chamadas?: { dominio: string; servico: string; dados: Record<string, unknown> }[];
} = {}) {
  const db = abrirBanco(":memory:");
  semear(db);
  const criar = db.prepare("INSERT INTO usuarios (login,nome,senha,papel,ativo) VALUES (?,?,?,?,1)");
  criar.run("matheus", "Matheus", gerarHash("senha-de-teste"), "admin");
  criar.run("marcella", "Marcella", gerarHash("senha-de-teste"), "casa");

  const registro = opcoes.chamadas ?? [];
  const app = criarApp({
    db, segredoSessao: "teste", exec: async () => bom("running"),
    caches: cachesDeTeste([], opcoes.estados === "falha"
      ? ruim("Home Assistant respondeu 401")
      : bom(opcoes.estados ?? ESTADOS)),
    chamarHa: async (dominio, servico, dados) => {
      registro.push({ dominio, servico, dados });
      return bom(null);
    },
  });
  const s = app.listen(0);
  t.after(() => s.close());
  const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;

  const entrar = async (login: string) => {
    const r = await fetch(`${base}/entrar`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ login, senha: "senha-de-teste" }).toString(),
      redirect: "manual",
    });
    return (r.headers.get("set-cookie") ?? "").split(";")[0]!;
  };

  const cookie = await entrar("matheus");
  const html = await (await fetch(`${base}/midia`, { headers: { cookie } })).text();
  const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1] ?? "";
  return { db, base, cookie, csrf, html, entrar, registro };
}

test("as TVs aparecem pelo nome que a casa usa, nao pelo do Home Assistant", async (t) => {
  const a = await subir(t);
  // "Luke's" e "Luke TV" sao indistinguiveis para quem le — a propria casa ja
  // tropecou nisso. A tela nomeia por comodo, que e como as pessoas pensam.
  assert.match(a.html, /TV do quarto/);
  assert.match(a.html, /TV da sala/);
  assert.match(a.html, /Ligada/, "a da sala esta on nos estados de teste");
  assert.match(a.html, /Desligada/, "a do quarto esta off");
});

test("a Marcella tambem ve a Midia — a tela e dela tanto quanto do admin", async (t) => {
  const a = await subir(t);
  const ck = await a.entrar("marcella");
  const r = await fetch(`${a.base}/midia`, { headers: { cookie: ck }, redirect: "manual" });
  assert.equal(r.status, 200);
});

test("os servicos de midia sao so do admin", async (t) => {
  const a = await subir(t);
  assert.match(a.html, /Radarr/, "o admin ve os servicos");
  const ck = await a.entrar("marcella");
  const html = await (await fetch(`${a.base}/midia`, { headers: { cookie: ck } })).text();
  assert.ok(!html.includes("Radarr"), "a casa nao precisa saber o que e Radarr");
});

test("desligar a TV chama o servico certo do Home Assistant", async (t) => {
  const chamadas: { dominio: string; servico: string; dados: Record<string, unknown> }[] = [];
  const a = await subir(t, { chamadas });
  const r = await fetch(`${a.base}/midia/tv`, {
    method: "POST",
    headers: { cookie: a.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrf: a.csrf, entidade: "media_player.luke_tv_un55au7700gxzd", verbo: "turn_off",
    }).toString(),
    redirect: "manual",
  });
  assert.equal(r.status, 303);
  assert.deepEqual(chamadas, [{
    dominio: "media_player", servico: "turn_off",
    dados: { entity_id: "media_player.luke_tv_un55au7700gxzd" },
  }]);
});

test("so entidades da lista fechada sao aceitas", async (t) => {
  const chamadas: { dominio: string; servico: string; dados: Record<string, unknown> }[] = [];
  const a = await subir(t, { chamadas });
  const r = await fetch(`${a.base}/midia/tv`, {
    method: "POST",
    headers: { cookie: a.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrf: a.csrf, entidade: "switch.ct_tfs_server", verbo: "turn_off",
    }).toString(),
    redirect: "manual",
  });
  assert.equal(r.status, 403);
  assert.deepEqual(chamadas, [], "nada podia ter sido chamado");
});

test("so os verbos de ligar e desligar sao aceitos", async (t) => {
  const chamadas: { dominio: string; servico: string; dados: Record<string, unknown> }[] = [];
  const a = await subir(t, { chamadas });
  const r = await fetch(`${a.base}/midia/tv`, {
    method: "POST",
    headers: { cookie: a.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrf: a.csrf, entidade: "media_player.suite_luke_s", verbo: "volume_up",
    }).toString(),
    redirect: "manual",
  });
  assert.equal(r.status, 403);
  assert.deepEqual(chamadas, []);
});

test("sem CSRF a TV nao se mexe", async (t) => {
  const chamadas: { dominio: string; servico: string; dados: Record<string, unknown> }[] = [];
  const a = await subir(t, { chamadas });
  const r = await fetch(`${a.base}/midia/tv`, {
    method: "POST",
    headers: { cookie: a.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      entidade: "media_player.suite_luke_s", verbo: "turn_on",
    }).toString(),
    redirect: "manual",
  });
  assert.equal(r.status, 403);
  assert.deepEqual(chamadas, []);
});

test("acao na TV entra no registro", async (t) => {
  const a = await subir(t);
  await fetch(`${a.base}/midia/tv`, {
    method: "POST",
    headers: { cookie: a.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrf: a.csrf, entidade: "media_player.suite_luke_s", verbo: "turn_on",
    }).toString(),
    redirect: "manual",
  });
  const l = a.db.prepare("SELECT verbo, alvo, ok FROM acoes_log ORDER BY id DESC LIMIT 1").get() as
    { verbo: string; alvo: string; ok: number };
  assert.equal(l.ok, 1);
  assert.match(l.alvo, /suite_luke_s/);
});

test("Home Assistant fora do ar degrada, nao quebra a pagina", async (t) => {
  const a = await subir(t, { estados: "falha" });
  assert.match(a.html, /Midia/);
  assert.match(a.html, /401|indispon|nao foi possivel/i);
});

test("entidade que o HA nao reportou aparece como indisponivel, nao como desligada", async (t) => {
  const a = await subir(t, { estados: [] });
  assert.ok(!a.html.includes(">Ligada<"), "sem dado nao se afirma estado");
  assert.match(a.html, /indispon/i);
});
