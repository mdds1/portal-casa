import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { listarMaquinas, listarServicos } from "../src/db/inventario.js";

function bancoDeTeste() {
  const db = abrirBanco(":memory:");
  db.prepare("INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run("vm", 301, "floripaot", "Servidor de Tibia", "192.168.15.11", 1, "admin");
  db.prepare("INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run("ct", 201, "jellyfin", "Midia da casa", "192.168.15.15", 0, "casa");
  db.prepare("INSERT INTO servicos (maquina_vmid,nome,descricao,porta,host_checagem,url,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run(201, "Jellyfin", "Filmes e series", 8096, "192.168.15.15", null, "casa");
  db.prepare("INSERT INTO servicos (maquina_vmid,nome,descricao,porta,host_checagem,url,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run(301, "Jogo FloripaOT", "Porta de login", 7171, "192.168.15.11", null, "admin");
  return db;
}

test("o esquema e aplicado na abertura, e reaplicar nao quebra", () => {
  const db = abrirBanco(":memory:");
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const nomes = t.map((x) => x.name).sort();
  for (const esperada of ["acoes_log", "dependencias", "maquinas", "papeis", "servicos", "sessoes", "usuarios"]) {
    assert.ok(nomes.includes(esperada), `faltou a tabela ${esperada}`);
  }
});

test("papeis vem semeados com admin e casa", () => {
  const db = abrirBanco(":memory:");
  const p = db.prepare("SELECT nome, poder FROM papeis ORDER BY poder DESC").all();
  assert.deepEqual(p, [{ nome: "admin", poder: 100 }, { nome: "casa", poder: 10 }]);
});

test("papel casa NAO enxerga maquina de admin", () => {
  const db = bancoDeTeste();
  const vistas = listarMaquinas(db, "casa").map((m) => m.nome);
  assert.deepEqual(vistas, ["jellyfin"]);
});

test("papel admin enxerga tudo", () => {
  const db = bancoDeTeste();
  assert.equal(listarMaquinas(db, "admin").length, 2);
  assert.equal(listarServicos(db, "admin").length, 2);
});

test("papel casa NAO enxerga servico de admin", () => {
  const db = bancoDeTeste();
  const vistos = listarServicos(db, "casa").map((s) => s.nome);
  assert.deepEqual(vistos, ["Jellyfin"]);
});
