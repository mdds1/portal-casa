import type Database from "better-sqlite3";

// Toda acao entra aqui, inclusive as recusadas: saber o que alguem TENTOU fazer
// vale tanto quanto saber o que conseguiu.
export function registrar(
  db: Database.Database,
  usuario: string,
  verbo: string,
  alvo: string,
  ok: boolean,
  detalhe = ""
): void {
  db.prepare(
    "INSERT INTO acoes_log (quando,usuario,verbo,alvo,ok,detalhe) VALUES (?,?,?,?,?,?)"
  ).run(new Date().toISOString(), usuario, verbo, alvo, ok ? 1 : 0, detalhe);
}
