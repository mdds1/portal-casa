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
