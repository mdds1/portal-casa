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
import { Cache } from "../src/cache.js";
import { bom } from "../src/fontes/tipos.js";

async function comServidor(fn: (base: string, db: Database.Database) => Promise<void>) {
  const db = abrirBanco(":memory:");
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("matheus", "Matheus", hash("s1"), "admin");
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("marcella", "Marcella", hash("s2"), "casa");
  const servidor = criarApp({
    db,
    segredoSessao: "teste",
    caches: {
      pve: new Cache(async () => bom([])),
    },
  }).listen(0);
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

// O teste anterior mandava um MAC de 8 caracteres, que ja era recusado so
// pela checagem de tamanho em verificarAssinatura -- passaria mesmo se a
// funcao sempre devolvesse o valor sem checar nada. Este aqui faz login de
// verdade, pega um cookie assinado valido, troca UM caractere hexadecimal do
// MAC mantendo o tamanho, e confirma que o servidor recusa mesmo assim.
test("cookie valido com um caractere do MAC trocado nao vale", async () => {
  await comServidor(async (base) => {
    const cookieBruto = await entrar(base, "matheus", "s1");
    assert.notEqual(cookieBruto, "");
    const par = cookieBruto.split(";")[0]!; // "portal_sessao=<valor>.<mac>"
    const [nome, valorAssinado] = par.split("=");
    const corte = valorAssinado!.lastIndexOf(".");
    const valor = valorAssinado!.slice(0, corte);
    const mac = valorAssinado!.slice(corte + 1);
    const ultimo = mac.at(-1)!;
    const trocado = ultimo === "0" ? "1" : "0";
    const macAdulterado = mac.slice(0, -1) + trocado;
    assert.equal(macAdulterado.length, mac.length, "tamanho do MAC precisa continuar igual");

    const r = await fetch(`${base}/infraestrutura`, {
      headers: { cookie: `${nome}=${valor}.${macAdulterado}` },
      redirect: "manual",
    });
    assert.equal(r.status, 302, "MAC adulterado deve cair no login, nao entrar");
    assert.equal(r.headers.get("location"), "/entrar");
  });
});

test("sessao expirada nao vale, e a linha e apagada", async () => {
  await comServidor(async (base, db) => {
    const cookieBruto = await entrar(base, "matheus", "s1");
    const par = cookieBruto.split(";")[0]!;
    const [, valorAssinado] = par.split("=");
    const id = verificarAssinatura(valorAssinado!, "teste");
    assert.ok(id, "cookie de login deveria trazer uma assinatura valida");

    // Forca a sessao a ja ter expirado.
    db.prepare("UPDATE sessoes SET expira = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), id);

    const r = await fetch(`${base}/infraestrutura`, {
      headers: { cookie: par },
      redirect: "manual",
    });
    assert.equal(r.status, 302, "sessao expirada nao pode dar acesso");
    assert.equal(r.headers.get("location"), "/entrar");

    const linha = db.prepare("SELECT 1 FROM sessoes WHERE id = ?").get(id);
    assert.equal(linha, undefined, "sessao expirada deveria ter sido apagada na leitura");
  });
});

test("usuario desativado perde a sessao na proxima requisicao", async () => {
  await comServidor(async (base, db) => {
    const cookieBruto = await entrar(base, "matheus", "s1");
    const par = cookieBruto.split(";")[0]!;

    // Confirma que, antes da desativacao, a sessao ainda vale.
    const antes = await fetch(`${base}/infraestrutura`, {
      headers: { cookie: par },
      redirect: "manual",
    });
    assert.equal(antes.status, 200);

    db.prepare("UPDATE usuarios SET ativo = 0 WHERE login = ?").run("matheus");

    const depois = await fetch(`${base}/infraestrutura`, {
      headers: { cookie: par },
      redirect: "manual",
    });
    assert.equal(depois.status, 302, "usuario desativado nao pode continuar usando a sessao aberta");
    assert.equal(depois.headers.get("location"), "/entrar");
  });
});

test("POST /sair invalida a sessao no servidor, nao so o cookie no navegador", async () => {
  await comServidor(async (base) => {
    const cookieBruto = await entrar(base, "matheus", "s1");
    const par = cookieBruto.split(";")[0]!;

    const antes = await fetch(`${base}/infraestrutura`, {
      headers: { cookie: par },
      redirect: "manual",
    });
    assert.equal(antes.status, 200);

    await fetch(`${base}/sair`, {
      method: "POST",
      headers: { cookie: par },
      redirect: "manual",
    });

    // Reusar o MESMO cookie antigo (como faria alguem com uma copia dele)
    // nao pode voltar a funcionar so porque o navegador ainda o tem.
    const depois = await fetch(`${base}/infraestrutura`, {
      headers: { cookie: par },
      redirect: "manual",
    });
    assert.equal(depois.status, 302, "sessao encerrada no servidor nao pode ser reusada");
    assert.equal(depois.headers.get("location"), "/entrar");
  });
});
