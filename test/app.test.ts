import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { criarApp } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { bom } from "../src/fontes/tipos.js";

test("GET /saude responde ok", async () => {
  const app = criarApp({
    db: new Database(":memory:"),
    segredoSessao: "teste",
    caches: {
      pve: new Cache(async () => bom([])),
      ha: new Cache(async () => bom([])),
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
