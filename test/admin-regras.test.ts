import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash } from "../src/auth/senha.js";
import { podeMexer, validarSenha } from "../src/admin/regras.js";

function banco() {
  const db = abrirBanco(":memory:");
  semear(db);
  const criar = db.prepare(
    "INSERT INTO usuarios (login,nome,senha,papel,ativo) VALUES (?,?,?,?,?)"
  );
  criar.run("matheus", "Matheus", gerarHash("senha-de-teste"), "admin", 1);
  criar.run("marcella", "Marcella", gerarHash("senha-de-teste"), "casa", 1);
  const id = (login: string) =>
    (db.prepare("SELECT id FROM usuarios WHERE login = ?").get(login) as { id: number }).id;
  return { db, admin: id("matheus"), casa: id("marcella") };
}

test("admin pode trocar a senha de outra pessoa", () => {
  const { db, admin, casa } = banco();
  const d = podeMexer(db, admin, casa, { tipo: "senha", senha: "uma-senha-longa" });
  assert.equal(d.permitido, true);
});

test("ninguem pode desativar a si mesmo", () => {
  const { db, admin } = banco();
  const d = podeMexer(db, admin, admin, { tipo: "ativo", ativo: false });
  assert.equal(d.permitido, false);
  assert.match((d as { motivo: string }).motivo, /si mesmo/i);
});

test("ninguem pode rebaixar o proprio papel", () => {
  const { db, admin } = banco();
  const d = podeMexer(db, admin, admin, { tipo: "papel", papel: "casa" });
  assert.equal(d.permitido, false);
  assert.match((d as { motivo: string }).motivo, /si mesmo/i);
});

test("a casa nao pode ficar sem nenhum admin ativo", () => {
  const { db, admin, casa } = banco();
  // Promove a Marcella e depois desativa o Matheus: agora ha outro admin,
  // entao a operacao passa a ser permitida. E a prova de que a regra conta
  // admins de verdade, e nao apenas recusa mexer no ultimo usuario.
  const antes = podeMexer(db, casa, admin, { tipo: "ativo", ativo: false });
  assert.equal(antes.permitido, false, "com um admin so, desativar tinha de ser recusado");
  assert.match((antes as { motivo: string }).motivo, /sem admin/i);

  db.prepare("UPDATE usuarios SET papel = 'admin' WHERE id = ?").run(casa);
  const depois = podeMexer(db, casa, admin, { tipo: "ativo", ativo: false });
  assert.equal(depois.permitido, true, "com dois admins, desativar um e permitido");
});

test("rebaixar o ultimo admin tambem deixaria a casa sem admin", () => {
  const { db, admin, casa } = banco();
  const d = podeMexer(db, casa, admin, { tipo: "papel", papel: "casa" });
  assert.equal(d.permitido, false);
  assert.match((d as { motivo: string }).motivo, /sem admin/i);
});

test("usuario inexistente e recusado", () => {
  const { db, admin } = banco();
  const d = podeMexer(db, admin, 9999, { tipo: "ativo", ativo: false });
  assert.equal(d.permitido, false);
  assert.match((d as { motivo: string }).motivo, /nao existe/i);
});

test("papel inexistente e recusado", () => {
  const { db, admin, casa } = banco();
  const d = podeMexer(db, admin, casa, { tipo: "papel", papel: "imperador" });
  assert.equal(d.permitido, false);
  assert.match((d as { motivo: string }).motivo, /papel/i);
});

test("usuario desativado nao conta como admin ativo", () => {
  const { db, admin, casa } = banco();
  db.prepare("UPDATE usuarios SET papel='admin', ativo=0 WHERE id = ?").run(casa);
  const d = podeMexer(db, casa, admin, { tipo: "ativo", ativo: false });
  assert.equal(d.permitido, false, "um admin desativado nao segura a casa");
  assert.match((d as { motivo: string }).motivo, /sem admin/i);
});

test("senha curta e recusada, com o tamanho minimo na mensagem", () => {
  assert.match(validarSenha("h447cyzw") ?? "", /10/);
});

test("senha longa o bastante e aceita", () => {
  assert.equal(validarSenha("uma-senha-decente"), null);
});

test("senha so de espacos nao vale, mesmo longa", () => {
  assert.notEqual(validarSenha("              "), null);
});
