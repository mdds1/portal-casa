import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { interpretarRecursos, buscarRecursos } from "../src/fontes/proxmox.js";
import { interpretarEstados, buscarEstados } from "../src/fontes/homeassistant.js";
import { checarPorta } from "../src/fontes/porta.js";

const pve = JSON.parse(readFileSync("test/respostas/pve-recursos.json", "utf8"));
const ha = JSON.parse(readFileSync("test/respostas/ha-estados.json", "utf8"));

test("o parser do Proxmox ignora o que nao e maquina", () => {
  const r = interpretarRecursos(pve);
  assert.equal(r.length, 3, "storage nao e maquina");
  assert.deepEqual(r.map((x) => x.vmid).sort(), [103, 104, 301]);
});

test("o parser do Proxmox le nome, estado e memoria", () => {
  const r = interpretarRecursos(pve);
  const f = r.find((x) => x.vmid === 301)!;
  assert.equal(f.nome, "floripaot");
  assert.equal(f.estado, "running");
  assert.equal(f.memoriaMax, 8589934592);
});

test("o parser do Proxmox nao explode com resposta torta", () => {
  assert.deepEqual(interpretarRecursos({}), []);
  assert.deepEqual(interpretarRecursos(null), []);
  assert.deepEqual(interpretarRecursos({ data: "nao e lista" }), []);
});

test("API fora do ar vira Resultado de falha, nao excecao", async () => {
  const quebrada: typeof fetch = async () => { throw new Error("ECONNREFUSED"); };
  const r = await buscarRecursos("https://x", "t", quebrada);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /ECONNREFUSED/);
});

test("status HTTP ruim tambem vira falha", async () => {
  const negada: typeof fetch = async () => new Response("nope", { status: 401 });
  const r = await buscarRecursos("https://x", "t", negada);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /401/);
});

test("o token do Proxmox vai no cabecalho no formato PVEAPIToken", async () => {
  let visto = "";
  const espiao: typeof fetch = async (_u, init) => {
    visto = String((init?.headers as Record<string, string>).Authorization);
    return new Response(JSON.stringify(pve), { status: 200 });
  };
  await buscarRecursos("https://x", "portal@pve!leitura=abc", espiao);
  assert.equal(visto, "PVEAPIToken=portal@pve!leitura=abc");
});

test("o parser do HA descarta entidade indisponivel", () => {
  const e = interpretarEstados(ha);
  assert.equal(e.length, 2);
  assert.ok(!e.some((x) => x.entidade === "sensor.indisponivel"));
});

test("o parser do HA usa friendly_name como rotulo", () => {
  const e = interpretarEstados(ha);
  assert.equal(e.find((x) => x.entidade === "sensor.pve_temperatura")!.rotulo, "Temperatura do PVE");
});

test("checarPorta acha porta aberta", async () => {
  const s = createServer().listen(0);
  await new Promise((r) => s.once("listening", r));
  const porta = (s.address() as { port: number }).port;
  try {
    const r = await checarPorta("127.0.0.1", porta, 1000);
    assert.equal(r.ok, true);
  } finally { s.close(); }
});

test("checarPorta devolve falha em porta fechada, sem lancar", async () => {
  const r = await checarPorta("127.0.0.1", 1, 500);
  assert.equal(r.ok, false);
});
