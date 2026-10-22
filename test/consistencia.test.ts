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

// Em 19/09/2026 a casa mudou de endereco e a LAN inteira trocou de numero. A
// semente tinha IP de LAN em 15 dos 18 servicos, e a checagem de todos eles
// quebrou junto: o painel ficou vermelho sem nada estar fora do ar.
//
// O nome de MagicDNS acompanha a maquina; o IP de LAN pertence ao roteador, e o
// roteador muda. Este teste impede que um IP de LAN volte a entrar na semente
// por distracao. As duas excecoes sao deliberadas e estao comentadas em
// src/db/semente.ts -- se uma terceira aparecer, ela tem que ser justificada
// aqui tambem, e nao so silenciada.
const HOSTS_POR_IP_PERMITIDOS = new Map([
  // O starloco (CT 104) nao esta na tailnet: nao ha nome para usar.
  ["192.168.15.13", "starloco, fora da tailnet"],
  // O certificado do Proxmox tem `IP Address:192.168.15.200` como unico SAN.
  ["192.168.15.200", "Proxmox, SAN do certificado e o IP"],
]);

test("nenhum servico da semente e checado por IP de LAN sem justificativa", () => {
  const db = abrirBanco(":memory:");
  semear(db);
  const linhas = db
    .prepare("SELECT nome, host_checagem FROM servicos WHERE host_checagem IS NOT NULL")
    .all() as { nome: string; host_checagem: string }[];

  // Garante que o teste esta mesmo olhando dados; uma semente vazia passaria
  // calada por um laco sobre lista vazia.
  assert.ok(linhas.length >= 10, `esperava a semente cheia, vi ${linhas.length} servicos`);

  for (const l of linhas) {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(l.host_checagem)) continue;
    assert.ok(
      HOSTS_POR_IP_PERMITIDOS.has(l.host_checagem),
      `"${l.nome}" e checado pelo IP de LAN ${l.host_checagem}. Use o nome de ` +
        `MagicDNS da maquina, ou registre a excecao em HOSTS_POR_IP_PERMITIDOS.`
    );
  }
});
