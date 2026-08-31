import { test } from "node:test";
import assert from "node:assert/strict";
import { Cache } from "../src/cache.js";
import { bom, ruim, type Resultado } from "../src/fontes/tipos.js";

test("a primeira chamada busca; a segunda, dentro da validade, nao", async () => {
  let chamadas = 0;
  const c = new Cache<number>(async () => { chamadas++; return bom(chamadas); }, 15000);
  assert.equal((await c.obter()).dado, 1);
  assert.equal((await c.obter()).dado, 1);
  assert.equal(chamadas, 1, "cinco abas abertas nao podem virar cinco consultas");
});

test("passada a validade, busca de novo", async () => {
  let chamadas = 0;
  let relogio = 1000;
  const c = new Cache<number>(async () => { chamadas++; return bom(chamadas); }, 15000, () => relogio);
  await c.obter();
  relogio += 16000;
  assert.equal((await c.obter()).dado, 2);
});

test("falha depois de sucesso mantem o ultimo valor bom, marcado", async () => {
  let quebrar = false;
  let relogio = 1000;
  const buscar = async (): Promise<Resultado<string>> => quebrar ? ruim("caiu") : bom("valor-bom");
  const c = new Cache<string>(buscar, 15000, () => relogio);

  const primeiro = await c.obter();
  assert.equal(primeiro.desatualizado, false);

  quebrar = true;
  relogio += 16000;
  const segundo = await c.obter();
  assert.equal(segundo.dado, "valor-bom", "o dado velho e melhor que nenhum dado");
  assert.equal(segundo.desatualizado, true, "mas a tela precisa saber que e velho");
  assert.equal(segundo.erro, "caiu");
});

test("falha logo na primeira busca devolve nada, sem lancar", async () => {
  const c = new Cache<string>(async () => ruim("nunca funcionou"), 15000);
  const i = await c.obter();
  assert.equal(i.dado, null);
  assert.equal(i.erro, "nunca funcionou");
  assert.equal(i.desatualizado, true);
});

test("chamadas simultaneas nao disparam duas buscas", async () => {
  let chamadas = 0;
  const c = new Cache<number>(async () => {
    chamadas++;
    await new Promise((r) => setTimeout(r, 20));
    return bom(chamadas);
  }, 15000);
  await Promise.all([c.obter(), c.obter(), c.obter()]);
  assert.equal(chamadas, 1);
});

test("excecao logo na primeira busca devolve nada, sem lancar", async () => {
  const c = new Cache<string>(async () => {
    throw new Error("conexao perdida");
  }, 15000);
  const i = await c.obter();
  assert.equal(i.dado, null);
  assert.equal(i.erro, "conexao perdida");
  assert.equal(i.desatualizado, true);
});

test("excecao depois de sucesso mantem o ultimo valor bom, marcado", async () => {
  let lancae = false;
  let relogio = 1000;
  const buscar = async (): Promise<Resultado<string>> => {
    if (lancae) {
      throw new Error("conexao caiu");
    }
    return bom("valor-bom");
  };
  const c = new Cache<string>(buscar, 15000, () => relogio);

  const primeiro = await c.obter();
  assert.equal(primeiro.dado, "valor-bom");
  assert.equal(primeiro.desatualizado, false);

  lancae = true;
  relogio += 16000;
  const segundo = await c.obter();
  assert.equal(segundo.dado, "valor-bom", "o dado velho sobrevive mesmo quando a fonte lanca");
  assert.equal(segundo.desatualizado, true, "mas marcado como desatualizado");
  assert.equal(segundo.erro, "conexao caiu");
});
