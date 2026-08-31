import { test } from "node:test";
import assert from "node:assert/strict";
import { comandoDe, acionar, mensagemDeFalha, type Executor } from "../src/acoes/wrapper.js";
import { bom, ruim } from "../src/fontes/tipos.js";

test("o comando enviado ao host tem a forma exata que o portal-acao espera", () => {
  assert.equal(comandoDe({ tipo: "maquina", vmid: 201, classe: "ct" }, "shutdown"), "ct shutdown 201");
  assert.equal(comandoDe({ tipo: "maquina", vmid: 301, classe: "vm" }, "start"), "vm start 301");
  assert.equal(comandoDe({ tipo: "host" }, "shutdown"), "host shutdown");
});

test("o tipo vm/ct sai do inventario, nao do palpite", () => {
  // 100 e um container, 120 e uma VM: se o wrapper chutasse pelo numero, erraria.
  assert.equal(comandoDe({ tipo: "maquina", vmid: 100, classe: "ct" }, "start"), "ct start 100");
  assert.equal(comandoDe({ tipo: "maquina", vmid: 120, classe: "vm" }, "start"), "vm start 120");
});

test("acionar devolve o estado que o host respondeu", async () => {
  const exec: Executor = async (c) => {
    assert.equal(c, "ct start 201");
    return bom("running\n");
  };
  const r = await acionar(exec, { tipo: "maquina", vmid: 201, classe: "ct" }, "start");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.dado, "running", "a quebra de linha precisa sair");
});

test("recusa do host vira falha, nao excecao", async () => {
  const exec: Executor = async () => ruim("alvo recusado");
  const r = await acionar(exec, { tipo: "maquina", vmid: 103, classe: "ct" }, "shutdown");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /recusado/);
});

test("executor que LANCA nao derruba quem chamou", async () => {
  const exec: Executor = async () => { throw new Error("ssh sumiu"); };
  const r = await acionar(exec, { tipo: "host" }, "shutdown");
  assert.equal(r.ok, false, "acionar precisa segurar a excecao");
  if (!r.ok) assert.match(r.erro, /ssh sumiu/);
});

test("mensagemDeFalha nunca vaza a chave nem o destino do erro.message do execFile", () => {
  const chaveFalsa = "/home/matheus/.ssh/chave_secreta";
  const destinoFalso = "destino-secreto@10.0.0.5";
  const erroForjado = Object.assign(
    new Error(`Command failed: false -i ${chaveFalsa} ${destinoFalso} host shutdown`),
    { code: 255 }
  );
  const msg = mensagemDeFalha(erroForjado, "", "");
  assert.doesNotMatch(msg, /chave_secreta/);
  assert.doesNotMatch(msg, /10\.0\.0\.5/);
  assert.doesNotMatch(msg, /destino-secreto/);
});

test("mensagemDeFalha usa a saida do portal-acao quando existe", () => {
  const erroForjado = Object.assign(new Error("Command failed"), { code: 3 });
  const msg = mensagemDeFalha(erroForjado, "", "alvo recusado\n");
  assert.match(msg, /alvo recusado/);
});
