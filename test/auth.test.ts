import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarHash, conferirSenha } from "../src/auth/senha.js";
import { assinar, verificarAssinatura } from "../src/auth/sessao.js";

test("a senha guardada nao contem a senha em texto", () => {
  const h = gerarHash("segredo123");
  assert.ok(!h.includes("segredo123"));
  assert.match(h, /^scrypt\$/);
});

test("conferirSenha aceita a certa e recusa a errada", () => {
  const h = gerarHash("segredo123");
  assert.equal(conferirSenha("segredo123", h), true);
  assert.equal(conferirSenha("segredo124", h), false);
});

test("dois hashes da mesma senha sao diferentes (sal)", () => {
  assert.notEqual(gerarHash("igual"), gerarHash("igual"));
});

test("cookie adulterado e recusado", () => {
  const a = assinar("sessao-abc", "segredo-do-servidor");
  assert.equal(verificarAssinatura(a, "segredo-do-servidor"), "sessao-abc");
  assert.equal(verificarAssinatura(a + "x", "segredo-do-servidor"), null);
  assert.equal(verificarAssinatura(a, "outro-segredo"), null,
    "assinatura de outro servidor nao pode valer");
});

import Database from "better-sqlite3";
import { abrirBanco } from "../src/db/conexao.js";
import { criarApp } from "../src/app.js";
import { gerarHash as hash } from "../src/auth/senha.js";

async function comServidor(fn: (base: string, db: Database.Database) => Promise<void>) {
  const db = abrirBanco(":memory:");
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("matheus", "Matheus", hash("s1"), "admin");
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("marcella", "Marcella", hash("s2"), "casa");
  const servidor = criarApp({ db, segredoSessao: "teste" }).listen(0);
  const porta = (servidor.address() as { port: number }).port;
  try {
    await fn(`http://127.0.0.1:${porta}`, db);
  } finally {
    servidor.close();
  }
}

async function entrar(base: string, login: string, senha: string): Promise<string> {
  const r = await fetch(`${base}/entrar`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ login, senha }).toString(),
    redirect: "manual",
  });
  return r.headers.get("set-cookie") ?? "";
}

test("login com senha errada nao cria sessao", async () => {
  await comServidor(async (base) => {
    const cookie = await entrar(base, "matheus", "errada");
    assert.equal(cookie, "", "nao pode devolver cookie de sessao");
  });
});

test("usuario casa recebe 403 em rota de admin", async () => {
  await comServidor(async (base) => {
    const cookie = await entrar(base, "marcella", "s2");
    assert.notEqual(cookie, "");
    const r = await fetch(`${base}/infraestrutura`, {
      headers: { cookie: cookie.split(";")[0]! },
      redirect: "manual",
    });
    assert.equal(r.status, 403);
  });
});

test("sem cookie, rota protegida redireciona para o login", async () => {
  await comServidor(async (base) => {
    const r = await fetch(`${base}/infraestrutura`, { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/entrar");
  });
});

test("cookie forjado nao vale", async () => {
  await comServidor(async (base) => {
    const r = await fetch(`${base}/infraestrutura`, {
      headers: { cookie: "portal_sessao=qualquercoisa.deadbeef" },
      redirect: "manual",
    });
    assert.equal(r.status, 302, "deve cair no login, nao entrar");
  });
});
