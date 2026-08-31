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

  // Os papeis sao estrutura, nao dado de usuario: existem sempre.
  const inserir = db.prepare("INSERT OR IGNORE INTO papeis (nome, poder) VALUES (?, ?)");
  inserir.run("admin", 100);
  inserir.run("casa", 10);

  return db;
}
