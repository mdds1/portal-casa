import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { VERBOS } from "../src/acoes/tipos.js";

// A lista fechada de alvos e a de verbos vivem em DOIS arquivos: o script do
// host (a ultima barreira) e o portal (banco/tipos). Elas estao coerentes
// hoje, mas divergir e silencioso -- um `acionavel=1` numa maquina nova ganha
// botao, passa por podeAgir, chega ao SSH e volta "alvo recusado". Este teste
// e o unico lugar que compara os dois lados, e roda em `npm test`.
const SCRIPT = readFileSync("infra/portal/portal-acao", "utf8");

function alvosDoScript(): Set<string> {
  const m = SCRIPT.match(/case "\$TIPO:\$ID" in\s*\n\s*([^)]*)\)/);
  assert.ok(m, "nao achei o case dos alvos em infra/portal/portal-acao");
  return new Set(m![1]!.trim().split("|").map((s) => s.trim()));
}

function verbosDoScript(): Set<string> {
  const bloco = SCRIPT.match(/case "\$VERBO" in\n([\s\S]*?)\nesac/);
  assert.ok(bloco, "nao achei o case dos verbos em infra/portal/portal-acao");
  const verbos = new Set<string>();
  for (const linha of bloco![1]!.split("\n")) {
    const m = linha.match(/^\s{2}([a-z]+)\)/);
    if (m) verbos.add(m[1]!);
  }
  return verbos;
}

test("os alvos do portal-acao sao exatamente as maquinas acionaveis da semente", () => {
  const db = abrirBanco(":memory:");
  semear(db);
  const doBanco = new Set(
    (db.prepare("SELECT tipo, vmid FROM maquinas WHERE acionavel = 1").all() as
      { tipo: string; vmid: number }[]).map((m) => `${m.tipo}:${m.vmid}`)
  );
  assert.deepEqual([...alvosDoScript()].sort(), [...doBanco].sort());
});

test("as maquinas nao acionaveis da semente nao aparecem no portal-acao", () => {
  const db = abrirBanco(":memory:");
  semear(db);
  const fora = (db.prepare("SELECT tipo, vmid FROM maquinas WHERE acionavel = 0").all() as
    { tipo: string; vmid: number }[]).map((m) => `${m.tipo}:${m.vmid}`);
  const noScript = alvosDoScript();
  for (const a of fora) assert.equal(noScript.has(a), false, `${a} nao pode estar na lista do host`);
});

test("os verbos do portal-acao sao exatamente VERBOS", () => {
  assert.deepEqual([...verbosDoScript()].sort(), [...VERBOS].sort());
});
