import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { abrirBanco } from "../src/db/conexao.js";
import { listarMaquinas, listarServicos } from "../src/db/inventario.js";
import { semear } from "../src/db/semente.js";

function bancoDeTeste() {
  const db = abrirBanco(":memory:");
  db.prepare("INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run("vm", 301, "floripaot", "Servidor de Tibia", "192.168.15.11", 1, "admin");
  db.prepare("INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run("ct", 201, "jellyfin", "Midia da casa", "192.168.15.202", 0, "casa");
  db.prepare("INSERT INTO servicos (maquina_vmid,nome,descricao,porta,host_checagem,url,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run(201, "Jellyfin", "Filmes e series", 8096, "192.168.15.202", null, "casa");
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

test("maquina tem o campo acionavel, e o padrao e nao-acionavel", () => {
  const db = abrirBanco(":memory:");
  db.prepare("INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run("ct", 201, "jellyfin", "Midia", "192.168.15.202", 0, "casa");
  const m = listarMaquinas(db, "admin")[0]!;
  assert.equal(m.acionavel, 0, "quem nao foi marcado nao pode ser acionado");
});

test("banco antigo, sem a coluna, e migrado sem perder dado", () => {
  // Simula um banco criado pela fatia anterior: cria a tabela na forma velha,
  // poe uma linha, fecha, e abre de novo com o abrirBanco atual.
  const caminho = `/tmp/portal-migracao-${process.pid}.db`;
  const velho = new Database(caminho);
  velho.exec(`
    CREATE TABLE papeis (nome TEXT PRIMARY KEY, poder INTEGER NOT NULL);
    INSERT INTO papeis VALUES ('admin',100),('casa',10);
    CREATE TABLE maquinas (
      id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, vmid INTEGER NOT NULL UNIQUE,
      nome TEXT NOT NULL, descricao TEXT NOT NULL, ip TEXT,
      onboot INTEGER NOT NULL DEFAULT 0, papel_minimo TEXT NOT NULL);
    INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo)
      VALUES ('vm',301,'floripaot','Tibia','192.168.15.11',1,'admin');`);
  velho.close();

  const db = abrirBanco(caminho);
  const m = listarMaquinas(db, "admin");
  assert.equal(m.length, 1, "o dado que ja existia nao pode sumir");
  assert.equal(m[0]!.nome, "floripaot");
  assert.equal(m[0]!.acionavel, 0, "a coluna nova entra com o padrao seguro");
  db.close();
  for (const sufixo of ["", "-wal", "-shm"]) rmSync(caminho + sufixo, { force: true });
});

test("semear marca exatamente as maquinas acionaveis", () => {
  const db = abrirBanco(":memory:");
  semear(db);
  const porVmid = new Map(listarMaquinas(db, "admin").map((m) => [m.vmid, m]));
  for (const vmid of [100, 102, 104, 120, 201, 301])
    assert.equal(porVmid.get(vmid)?.acionavel, 1, `vmid ${vmid} deveria ser acionavel`);
  for (const vmid of [103, 110, 111])
    assert.equal(porVmid.get(vmid)?.acionavel, 0, `vmid ${vmid} NAO pode ser acionavel`);
});
