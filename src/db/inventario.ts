import type Database from "better-sqlite3";

export type Maquina = {
  id: number;
  tipo: "vm" | "ct";
  vmid: number;
  nome: string;
  descricao: string;
  ip: string | null;
  onboot: 0 | 1;
  acionavel: 0 | 1;
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
  categoria: string;
  grupo: string;
  ordem: number;
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

// Mesma fonte de verdade que FILTRO e exigirPapel: o poder vem sempre do
// banco, nunca de uma comparacao de string com o nome do papel.
export function poderDoPapel(db: Database.Database, papel: string): number {
  const linha = db.prepare("SELECT poder FROM papeis WHERE nome = ?").get(papel) as
    | { poder: number }
    | undefined;
  return linha?.poder ?? 0;
}

// A arvore do Mapa. Usa o mesmo FILTRO por papel das outras consultas — quem
// nao pode ver um servico tambem nao o ve aqui — e ordena pelos galhos, para a
// tela so precisar agrupar sequencialmente.
export function listarArvore(db: Database.Database, papel: string): Servico[] {
  return db
    .prepare(
      `SELECT * FROM servicos WHERE ${FILTRO}
       ORDER BY categoria, grupo, ordem, nome`
    )
    .all(papel) as Servico[];
}
