import type Database from "better-sqlite3";

export type Maquina = {
  id: number;
  tipo: "vm" | "ct";
  vmid: number;
  nome: string;
  descricao: string;
  ip: string | null;
  onboot: 0 | 1;
  papel_minimo: string;
};

export type Servico = {
  id: number;
  maquina_vmid: number;
  nome: string;
  descricao: string;
  porta: number | null;
  host_checagem: string | null;
  url: string | null;
  papel_minimo: string;
};

// O recorte por papel acontece no SQL, nao na tela. Assim nenhum caminho novo
// de renderizacao pode vazar linha que o usuario nao deveria ver.
const FILTRO = `
  papel_minimo IN (
    SELECT nome FROM papeis
    WHERE poder <= (SELECT poder FROM papeis WHERE nome = ?)
  )`;

export function listarMaquinas(db: Database.Database, papel: string): Maquina[] {
  return db
    .prepare(`SELECT * FROM maquinas WHERE ${FILTRO} ORDER BY vmid`)
    .all(papel) as Maquina[];
}

export function listarServicos(db: Database.Database, papel: string): Servico[] {
  return db
    .prepare(`SELECT * FROM servicos WHERE ${FILTRO} ORDER BY nome`)
    .all(papel) as Servico[];
}
