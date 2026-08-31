import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { criarApp } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { bom } from "../src/fontes/tipos.js";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash } from "../src/auth/senha.js";

test("GET /saude responde ok", async () => {
  const app = criarApp({
    db: new Database(":memory:"),
    segredoSessao: "teste",
    exec: async () => bom("running"),
    caches: {
      pve: new Cache(async () => bom([])),
    },
  });
  const servidor = app.listen(0);
  const porta = (servidor.address() as { port: number }).port;
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/saude`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  } finally {
    servidor.close();
  }
});

test("lerConfig falha com mensagem clara quando falta variavel", async () => {
  const { lerConfig } = await import("../src/config.js");
  assert.throws(
    () => lerConfig({}),
    /PORTAL_SEGREDO_SESSAO/,
    "a mensagem precisa dizer QUAL variavel faltou"
  );
});

test("rota inexistente devolve 404 com pagina curta, nao o handler padrao do Express", async () => {
  const app = criarApp({
    db: new Database(":memory:"),
    segredoSessao: "teste",
    exec: async () => bom("running"),
    caches: { pve: new Cache(async () => bom([])) },
  });
  const servidor = app.listen(0);
  const porta = (servidor.address() as { port: number }).port;
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/isto-nao-existe`);
    assert.equal(r.status, 404);
    const html = await r.text();
    assert.ok(html.includes("<html"), "devolve pagina, nao JSON cru do Express");
  } finally {
    servidor.close();
  }
});

test("excecao fora das fontes externas cai no handler de erro, sem stack na resposta", async () => {
  const db = abrirBanco(":memory:");
  semear(db);
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("matheus", "Matheus", gerarHash("s1"), "admin");
  const app = criarApp({
    db,
    segredoSessao: "teste",
    exec: async () => bom("running"),
    caches: { pve: new Cache(async () => bom([])) },
  });
  const servidor = app.listen(0);
  const base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;
  try {
    const login = await fetch(`${base}/entrar`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ login: "matheus", senha: "s1" }).toString(),
      redirect: "manual",
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;

    // Simula uma falha de banco no meio de uma consulta do inventario (o
    // exemplo do enunciado e SQLITE_BUSY; derrubar a tabela produz o mesmo
    // efeito de excecao vinda de fora do caminho das fontes externas).
    db.pragma("foreign_keys = OFF");
    db.exec("DROP TABLE maquinas");

    const r = await fetch(`${base}/infraestrutura`, { headers: { cookie } });
    assert.equal(r.status, 500);
    const html = await r.text();
    assert.ok(!/no such table|SQLITE|at Object|\.ts:\d+|\.js:\d+/.test(html),
      "stack trace ou detalhe interno nunca pode chegar ao navegador");
    assert.ok(html.includes("<html"));
  } finally {
    servidor.close();
  }
});
