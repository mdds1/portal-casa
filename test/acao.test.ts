import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash } from "../src/auth/senha.js";
import { criarApp } from "../src/app.js";
import { bom, ruim } from "../src/fontes/tipos.js";
import type { RecursoPve } from "../src/fontes/proxmox.js";
import type { Executor } from "../src/acoes/wrapper.js";
import { cachesDeTeste , chamarHaDeTeste } from "./apoio.js";

function montar(exec: Executor) {
  const db = abrirBanco(":memory:");
  semear(db);
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("matheus", "Matheus", gerarHash("s1"), "admin");
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("marcella", "Marcella", gerarHash("s2"), "casa");
  const app = criarApp({
    chamarHa: chamarHaDeTeste,
    db, segredoSessao: "teste", exec,
    caches: cachesDeTeste([] as RecursoPve[]),
  });
  const s = app.listen(0);
  const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  return { db, s, base };
}

async function entrar(base: string, login: string, senha: string) {
  const r = await fetch(`${base}/entrar`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ login, senha }).toString(),
    redirect: "manual",
  });
  return (r.headers.get("set-cookie") ?? "").split(";")[0]!;
}

async function csrfDaPagina(base: string, cookie: string): Promise<string> {
  const html = await (await fetch(base + "/mapa", { headers: { cookie } })).text();
  const m = html.match(/name="csrf" value="([^"]+)"/);
  assert.ok(m, "o Mapa precisa trazer um token de csrf nos formularios");
  return m![1]!;
}

function postar(base: string, cookie: string, corpo: Record<string, string>) {
  return fetch(`${base}/acao`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(corpo).toString(),
    redirect: "manual",
  });
}

test("sem login, a acao e recusada e nada e executado", async () => {
  let chamou = false;
  const { s, base } = montar(async () => { chamou = true; return bom("running"); });
  try {
    const r = await postar(base, "", { alvo: "201", verbo: "start", csrf: "x", confirmado: "1" });
    assert.ok(r.status === 302 || r.status === 403);
    assert.equal(chamou, false, "nao pode ter chegado no host");
  } finally { s.close(); }
});

test("sem token de csrf valido, nada e executado", async () => {
  let chamou = false;
  const { s, base } = montar(async () => { chamou = true; return bom("running"); });
  try {
    const c = await entrar(base, "matheus", "s1");
    const r = await postar(base, c, { alvo: "201", verbo: "start", csrf: "forjado", confirmado: "1" });
    assert.equal(r.status, 403);
    assert.equal(chamou, false);
  } finally { s.close(); }
});

test("verbo destrutivo sem confirmacao mostra a tela de confirmar, e nao executa", async () => {
  let chamou = false;
  const { s, base } = montar(async () => { chamou = true; return bom("stopped"); });
  try {
    const c = await entrar(base, "matheus", "s1");
    const t = await csrfDaPagina(base, c);
    const r = await postar(base, c, { alvo: "301", verbo: "shutdown", csrf: t });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /confirmar/i);
    assert.equal(chamou, false, "confirmacao nao pode executar nada");
  } finally { s.close(); }
});

test("a Marcella nao desliga o servidor de jogo, e o host nao e chamado", async () => {
  let chamou = false;
  const { db, s, base } = montar(async () => { chamou = true; return bom("stopped"); });
  try {
    const c = await entrar(base, "marcella", "s2");
    const t = await csrfDaPagina(base, c);
    const r = await postar(base, c, { alvo: "301", verbo: "shutdown", csrf: t, confirmado: "1" });
    assert.equal(r.status, 403);
    assert.equal(chamou, false);
    const log = db.prepare("SELECT usuario, verbo, alvo, ok FROM acoes_log WHERE verbo='shutdown'").all();
    assert.equal(log.length, 1, "a recusa TAMBEM precisa ficar registrada");
    assert.deepEqual(log[0], { usuario: "marcella", verbo: "shutdown", alvo: "vm:301", ok: 0 });
  } finally { s.close(); }
});

test("a Marcella liga o Jellyfin, e fica registrado", async () => {
  const { db, s, base } = montar(async (c) => {
    assert.equal(c, "ct start 201");
    return bom("running");
  });
  try {
    const cookie = await entrar(base, "marcella", "s2");
    const t = await csrfDaPagina(base, cookie);
    const r = await postar(base, cookie, { alvo: "201", verbo: "start", csrf: t, confirmado: "1" });
    assert.equal(r.status, 302);
    const log = db.prepare("SELECT usuario, verbo, alvo, ok FROM acoes_log WHERE verbo='start'").get();
    assert.deepEqual(log, { usuario: "marcella", verbo: "start", alvo: "ct:201", ok: 1 });
  } finally { s.close(); }
});

test("falha do host vira registro com ok=0 e nao derruba a pagina", async () => {
  const { db, s, base } = montar(async () => { throw new Error("ssh caiu"); });
  try {
    const c = await entrar(base, "matheus", "s1");
    const t = await csrfDaPagina(base, c);
    const r = await postar(base, c, { alvo: "201", verbo: "start", csrf: t, confirmado: "1" });
    assert.ok(r.status === 302 || r.status === 200, "nao pode ser 500");
    const log = db.prepare("SELECT ok, detalhe FROM acoes_log WHERE verbo='start'").get() as { ok: number; detalhe: string };
    assert.equal(log.ok, 0);
    assert.match(log.detalhe, /ssh caiu/);
  } finally { s.close(); }
});

test("desligar o host: a Marcella nao pode; o admin precisa confirmar", async () => {
  let comandos: string[] = [];
  const { s, base } = montar(async (c) => { comandos.push(c); return bom("agendado"); });
  try {
    const cm = await entrar(base, "marcella", "s2");
    const tm = await csrfDaPagina(base, cm);
    assert.equal((await postar(base, cm, { alvo: "host", verbo: "shutdown", csrf: tm, confirmado: "1" })).status, 403);

    const ca = await entrar(base, "matheus", "s1");
    const ta = await csrfDaPagina(base, ca);
    const semConfirmar = await postar(base, ca, { alvo: "host", verbo: "shutdown", csrf: ta });
    assert.equal(semConfirmar.status, 200);
    assert.deepEqual(comandos, [], "nada pode ter sido enviado ainda");

    const confirmado = await postar(base, ca, { alvo: "host", verbo: "shutdown", csrf: ta, confirmado: "1" });
    assert.equal(confirmado.status, 302);
    assert.deepEqual(comandos, ["host shutdown"]);
  } finally { s.close(); }
});

test("alvo que nao e numero nem 'host' e recusado sem chamar nada", async () => {
  let chamou = false;
  const { s, base } = montar(async () => { chamou = true; return bom("x"); });
  try {
    const c = await entrar(base, "matheus", "s1");
    const t = await csrfDaPagina(base, c);
    for (const alvo of ["../../etc", "201; rm -rf /", "", "NaN"]) {
      const r = await postar(base, c, { alvo, verbo: "start", csrf: t, confirmado: "1" });
      assert.equal(r.status, 403, `alvo "${alvo}" precisa ser recusado`);
    }
    assert.equal(chamou, false);
  } finally { s.close(); }
});

test("POST /acao com content-type que nao e urlencoded vira 403 registrado, nao 500", async () => {
  let chamou = false;
  const { db, s, base } = montar(async () => { chamou = true; return bom("running"); });
  try {
    const c = await entrar(base, "matheus", "s1");
    const r = await fetch(`${base}/acao`, {
      method: "POST",
      headers: { cookie: c, "content-type": "application/json" },
      body: JSON.stringify({ alvo: "201", verbo: "start", csrf: "x", confirmado: "1" }),
      redirect: "manual",
    });
    assert.equal(r.status, 403, "corpo torto nao pode virar 500");
    assert.equal(chamou, false);
    const log = db.prepare("SELECT usuario, ok FROM acoes_log ORDER BY id DESC LIMIT 1").get() as
      { usuario: string; ok: number };
    assert.equal(log.usuario, "matheus");
    assert.equal(log.ok, 0);
  } finally { s.close(); }
});

test("POST /acao sem content-type nenhum vira 403 registrado, nao 500", async () => {
  let chamou = false;
  const { db, s, base } = montar(async () => { chamou = true; return bom("running"); });
  try {
    const c = await entrar(base, "matheus", "s1");
    const r = await fetch(`${base}/acao`, {
      method: "POST",
      headers: { cookie: c },
      redirect: "manual",
    });
    assert.equal(r.status, 403, "corpo ausente nao pode virar 500");
    assert.equal(chamou, false);
    const log = db.prepare("SELECT usuario, ok FROM acoes_log ORDER BY id DESC LIMIT 1").get() as
      { usuario: string; ok: number };
    assert.equal(log.usuario, "matheus");
    assert.equal(log.ok, 0);
  } finally { s.close(); }
});

test("csrf invalido fica registrado em acoes_log, nao so recusado", async () => {
  const { db, s, base } = montar(async () => bom("running"));
  try {
    const c = await entrar(base, "matheus", "s1");
    const r = await postar(base, c, { alvo: "201", verbo: "start", csrf: "forjado", confirmado: "1" });
    assert.equal(r.status, 403);
    const log = db.prepare("SELECT usuario, verbo, alvo, ok, detalhe FROM acoes_log ORDER BY id DESC LIMIT 1").get() as
      { usuario: string; verbo: string; alvo: string; ok: number; detalhe: string };
    assert.equal(log.usuario, "matheus");
    assert.equal(log.ok, 0);
    assert.match(log.detalhe, /csrf/i);
  } finally { s.close(); }
});

test("alvo invalido fica registrado em acoes_log, nao so recusado", async () => {
  const { db, s, base } = montar(async () => bom("running"));
  try {
    const c = await entrar(base, "matheus", "s1");
    const t = await csrfDaPagina(base, c);
    const r = await postar(base, c, { alvo: "../../etc", verbo: "start", csrf: t, confirmado: "1" });
    assert.equal(r.status, 403);
    const log = db.prepare("SELECT usuario, verbo, alvo, ok, detalhe FROM acoes_log ORDER BY id DESC LIMIT 1").get() as
      { usuario: string; verbo: string; alvo: string; ok: number; detalhe: string };
    assert.equal(log.usuario, "matheus");
    assert.equal(log.ok, 0);
    assert.match(log.detalhe, /alvo/i);
  } finally { s.close(); }
});

test("a tela de confirmacao escapa o \"voltar\" refletido do POST", async () => {
  const { s, base } = montar(async () => bom("stopped"));
  try {
    const c = await entrar(base, "matheus", "s1");
    const t = await csrfDaPagina(base, c);
    const bruto = `"><script>alert(1)</script>`;
    const r = await postar(base, c, { alvo: "301", verbo: "shutdown", csrf: t, voltar: bruto });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(!html.includes(bruto), "o valor cru nao pode aparecer na pagina");
    assert.ok(
      html.includes("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"),
      "o valor escapado precisa aparecer no lugar do cru"
    );
  } finally { s.close(); }
});

// --- Achado 3: a maquina foi acionada, mas o registro falhou ---------------
test("se o registro falhar depois de acionar, o operador ve que a acao foi enviada e nao registrada", async () => {
  let chamou = false;
  const { db, s, base } = montar(async () => { chamou = true; return bom("running"); });
  const erros: unknown[][] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { erros.push(a); };
  try {
    const c = await entrar(base, "matheus", "s1");
    const t = await csrfDaPagina(base, c);
    db.exec("DROP TABLE acoes_log");
    const r = await postar(base, c, { alvo: "201", verbo: "start", csrf: t, confirmado: "1" });
    assert.equal(chamou, true, "o comando foi mesmo enviado ao host");
    const html = await r.text();
    assert.ok(!/Algo deu errado/i.test(html), "nao pode cair no 500 generico do Express");
    assert.match(html, /enviada/i);
    assert.match(html, /registr/i);
    assert.ok(
      erros.some((a) => a.join(" ").includes("start") && a.join(" ").includes("ct:201") && a.join(" ").includes("matheus")),
      "o console.error precisa carregar verbo, alvo e usuario: e o unico rastro que sobrou"
    );
  } finally { console.error = original; s.close(); }
});

// --- Triagem: avisar o operador quando a acao falha ------------------------
test("acao que falha manda o operador de volta com um aviso, nao em silencio", async () => {
  const { db, s, base } = montar(async () => ruim("falhou: pct shutdown 201 (codigo 1)"));
  try {
    const c = await entrar(base, "matheus", "s1");
    const t = await csrfDaPagina(base, c);
    const r = await postar(base, c, { alvo: "201", verbo: "start", csrf: t, confirmado: "1" });
    assert.equal(r.status, 302);
    const destino = r.headers.get("location") ?? "";
    assert.match(destino, /acao=falha/, "o redirect precisa carregar o aviso de falha");
    const log = db.prepare("SELECT ok FROM acoes_log ORDER BY id DESC LIMIT 1").get() as { ok: number };
    assert.equal(log.ok, 0);

    const html = await (await fetch(base + destino, { headers: { cookie: c } })).text();
    assert.match(html, /falhou/i, "a tela precisa mostrar a faixa de aviso");
  } finally { s.close(); }
});

test("acao que da certo volta com aviso de sucesso", async () => {
  const { s, base } = montar(async () => bom("running"));
  try {
    const c = await entrar(base, "matheus", "s1");
    const t = await csrfDaPagina(base, c);
    const r = await postar(base, c, { alvo: "201", verbo: "start", csrf: t, confirmado: "1" });
    assert.equal(r.status, 302);
    assert.match(r.headers.get("location") ?? "", /acao=ok/);
  } finally { s.close(); }
});

test("a faixa de aviso escapa o alvo vindo da query", async () => {
  const { s, base } = montar(async () => bom("running"));
  try {
    const c = await entrar(base, "matheus", "s1");
    const bruto = `"><script>alert(1)</script>`;
    const url = `${base}/?acao=falha&alvo=${encodeURIComponent(bruto)}`;
    const html = await (await fetch(url, { headers: { cookie: c } })).text();
    assert.ok(!html.includes(bruto), "o valor cru nao pode aparecer na pagina");
    assert.match(html, /&lt;script&gt;/);
  } finally { s.close(); }
});

test("a faixa de aviso tambem aparece na Infraestrutura, escapada", async () => {
  const { s, base } = montar(async () => bom("running"));
  try {
    const c = await entrar(base, "matheus", "s1");
    const bruto = `"><script>alert(1)</script>`;
    const url = `${base}/infraestrutura?acao=falha&alvo=${encodeURIComponent(bruto)}`;
    const html = await (await fetch(url, { headers: { cookie: c } })).text();
    assert.match(html, /falhou/i);
    assert.ok(!html.includes(bruto));
  } finally { s.close(); }
});
