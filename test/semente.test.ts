import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { listarMaquinas, listarServicos } from "../src/db/inventario.js";

test("semeia as 9 maquinas da casa", () => {
  const db = abrirBanco(":memory:");
  semear(db);
  const m = listarMaquinas(db, "admin");
  assert.equal(m.length, 9);
  const floripa = m.find((x) => x.vmid === 301);
  assert.equal(floripa?.nome, "floripaot");
  assert.equal(floripa?.onboot, 1);
  assert.equal(floripa?.ip, "192.168.15.11");
});

test("semear duas vezes nao duplica", () => {
  const db = abrirBanco(":memory:");
  semear(db);
  const maquinas = listarMaquinas(db, "admin").length;
  const servicos = listarServicos(db, "admin").length;
  semear(db);
  assert.equal(listarMaquinas(db, "admin").length, maquinas);
  assert.equal(listarServicos(db, "admin").length, servicos);
  assert.equal(maquinas, 9);
});

test("a Marcella enxerga midia e casa, nao infraestrutura", () => {
  const db = abrirBanco(":memory:");
  semear(db);
  const nomes = listarServicos(db, "casa").map((s) => s.nome);
  assert.ok(nomes.includes("Jellyfin"), "Jellyfin e da casa");
  assert.ok(!nomes.includes("Jogo FloripaOT"), "servidor de jogo e de admin");
  assert.ok(!nomes.includes("Proxmox"), "o hipervisor nunca e da casa");
});

// O CT 101 era o Jellyfin privilegiado antigo; foi destruido no Proxmox.
// Como semear() so faz upsert, a linha sobrevivia no banco e a tela mostrava
// uma maquina inexistente com os tres botoes de acao (estado desconhecido
// oferece todos os verbos de proposito).
test("o CT 101 destruido nao volta pela semente", () => {
  const db = abrirBanco(":memory:");
  semear(db);
  const vmids = listarMaquinas(db, "admin").map((m) => m.vmid);
  assert.ok(!vmids.includes(101), "CT 101 nao existe mais");
  assert.ok(vmids.includes(201), "o Jellyfin da casa e o 201");
});
