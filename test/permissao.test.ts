import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { podeAgir, ehVerbo } from "../src/acoes/permissao.js";

function banco() {
  const db = abrirBanco(":memory:");
  semear(db);
  return db;
}

test("verbo fora da lista e recusado, inclusive coisa parecida", () => {
  const db = banco();
  for (const v of ["destroy", "delete", "rm", "start;rm -rf /", "START", ""]) {
    const d = podeAgir(db, "admin", { tipo: "maquina", vmid: 201, classe: "ct" }, v);
    assert.equal(d.permitido, false, `"${v}" nao pode passar`);
  }
  assert.equal(ehVerbo("start"), true);
  assert.equal(ehVerbo("destroy"), false);
});

test("admin liga e desliga maquina acionavel", () => {
  const db = banco();
  for (const v of ["start", "shutdown", "reboot"])
    assert.equal(podeAgir(db, "admin", { tipo: "maquina", vmid: 301, classe: "vm" }, v).permitido, true);
});

test("nem o admin aciona o portal, o Home Assistant ou a bancada", () => {
  const db = banco();
  const classes: Record<number, "vm" | "ct"> = { 103: "ct", 111: "vm", 110: "vm" };
  for (const vmid of [103, 111, 110]) {
    const d = podeAgir(db, "admin", { tipo: "maquina", vmid, classe: classes[vmid]! }, "shutdown");
    assert.equal(d.permitido, false, `vmid ${vmid} nao pode ser desligado pelo portal`);
  }
});

test("papel casa aciona o que enxerga, e nada alem", () => {
  const db = banco();
  // O Jellyfin (CT 201) e da casa e e acionavel.
  assert.equal(podeAgir(db, "casa", { tipo: "maquina", vmid: 201, classe: "ct" }, "shutdown").permitido, true);
  // O servidor de jogo e de admin: ela nem ve, e nao pode agir.
  assert.equal(podeAgir(db, "casa", { tipo: "maquina", vmid: 301, classe: "vm" }, "shutdown").permitido, false);
  // O drive e de admin.
  assert.equal(podeAgir(db, "casa", { tipo: "maquina", vmid: 100, classe: "ct" }, "start").permitido, false);
});

test("desligar o host e so do admin, e so shutdown", () => {
  const db = banco();
  assert.equal(podeAgir(db, "admin", { tipo: "host" }, "shutdown").permitido, true);
  assert.equal(podeAgir(db, "admin", { tipo: "host" }, "start").permitido, false);
  assert.equal(podeAgir(db, "admin", { tipo: "host" }, "reboot").permitido, false);
  assert.equal(podeAgir(db, "casa", { tipo: "host" }, "shutdown").permitido, false);
});

test("maquina que nao existe no inventario e recusada", () => {
  const db = banco();
  assert.equal(podeAgir(db, "admin", { tipo: "maquina", vmid: 999, classe: "vm" }, "start").permitido, false);
});

test("papel desconhecido nao pode nada", () => {
  const db = banco();
  assert.equal(podeAgir(db, "inventado", { tipo: "maquina", vmid: 201, classe: "ct" }, "start").permitido, false);
  assert.equal(podeAgir(db, "", { tipo: "host" }, "shutdown").permitido, false);
});

test("a recusa sempre explica o motivo", () => {
  const db = banco();
  const d = podeAgir(db, "casa", { tipo: "host" }, "shutdown");
  assert.equal(d.permitido, false);
  if (!d.permitido) assert.ok(d.motivo.length > 0, "motivo vazio nao ajuda ninguem");
});

test("maquina com papel_minimo que nao existe em papeis e recusada, nem para admin", () => {
  const db = banco();
  // Simula um papel removido depois de ja atribuido a uma maquina (inventario
  // inconsistente): desliga a FK so para forcar o estado, como aconteceria
  // com dado corrompido ou uma migracao incompleta.
  db.pragma("foreign_keys = OFF");
  db.prepare(
    "INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo,acionavel) VALUES ('ct',777,'fantasma','papel inexistente',NULL,0,'papel-removido',1)"
  ).run();
  db.pragma("foreign_keys = ON");
  const d = podeAgir(db, "admin", { tipo: "maquina", vmid: 777, classe: "ct" }, "start");
  assert.equal(d.permitido, false, "inventario inconsistente deve recusar, nao liberar");
});

test("sem a linha admin em papeis, ninguem desliga o host", () => {
  const db = banco();
  db.pragma("foreign_keys = OFF");
  db.prepare("DELETE FROM papeis WHERE nome = 'admin'").run();
  db.pragma("foreign_keys = ON");
  const d = podeAgir(db, "casa", { tipo: "host" }, "shutdown");
  assert.equal(d.permitido, false, "sem papel admin no inventario, o host fica travado, nao liberado");
});
