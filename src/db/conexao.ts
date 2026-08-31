import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));

export function abrirBanco(caminho: string): Database.Database {
  const db = new Database(caminho);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(aqui, "esquema.sql"), "utf8"));

  // CREATE TABLE IF NOT EXISTS nao acrescenta coluna em tabela existente: ele
  // nao faz nada, em silencio. Sem esta migracao o banco de producao (que foi
  // criado pela fatia anterior) fica sem `acionavel`, e todo teste continua
  // passando porque teste cria banco do zero.
  const colunas = db.prepare("PRAGMA table_info(maquinas)").all() as { name: string }[];
  if (!colunas.some((c) => c.name === "acionavel")) {
    db.exec("ALTER TABLE maquinas ADD COLUMN acionavel INTEGER NOT NULL DEFAULT 0");
  }

  // Mesma armadilha, agora em `servicos`: a arvore do Mapa precisa das tres
  // colunas, e o banco de producao ja existe sem elas.
  const cs = db.prepare("PRAGMA table_info(servicos)").all() as { name: string }[];
  const tem = (n: string) => cs.some((c) => c.name === n);
  if (!tem("categoria")) db.exec("ALTER TABLE servicos ADD COLUMN categoria TEXT NOT NULL DEFAULT 'Outros'");
  if (!tem("grupo")) db.exec("ALTER TABLE servicos ADD COLUMN grupo TEXT NOT NULL DEFAULT ''");
  if (!tem("ordem")) db.exec("ALTER TABLE servicos ADD COLUMN ordem INTEGER NOT NULL DEFAULT 0");

  // Os papeis sao estrutura, nao dado de usuario: existem sempre.
  const inserir = db.prepare("INSERT OR IGNORE INTO papeis (nome, poder) VALUES (?, ?)");
  inserir.run("admin", 100);
  inserir.run("casa", 10);

  return db;
}
