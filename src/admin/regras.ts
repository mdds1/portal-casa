import type Database from "better-sqlite3";

// As mudancas que a tela de Administracao sabe fazer num usuario. Sao tipos
// separados porque as regras que as recusam sao diferentes: trocar senha e
// inofensivo, desativar pode trancar a casa inteira do lado de fora.
export type Mudanca =
  | { tipo: "senha"; senha: string }
  | { tipo: "ativo"; ativo: boolean }
  | { tipo: "papel"; papel: string };

export type Decisao = { permitido: true } | { permitido: false; motivo: string };

// Dez caracteres, e nao oito: o portal e alcancavel da internet pelo tunel, e
// as senhas de fabrica tinham exatamente oito. Exigir mais forca a troca a ser
// uma troca de verdade, e nao uma variacao da mesma senha.
const MINIMO = 10;

export function validarSenha(senha: string): string | null {
  if (senha.trim().length < MINIMO) {
    return `A senha precisa de pelo menos ${MINIMO} caracteres.`;
  }
  return null;
}

const PODER_ADMIN = 100;

function poderDe(db: Database.Database, papel: string): number | null {
  const p = db.prepare("SELECT poder FROM papeis WHERE nome = ?").get(papel) as
    { poder: number } | undefined;
  return p?.poder ?? null;
}

/** Quantos usuarios ativos teriam poder de admin DEPOIS da mudanca. */
function adminsRestantes(db: Database.Database, alvoId: number, m: Mudanca): number {
  const linhas = db.prepare(`
    SELECT u.id AS id, u.ativo AS ativo, p.poder AS poder
    FROM usuarios u JOIN papeis p ON p.nome = u.papel
  `).all() as { id: number; ativo: number; poder: number }[];

  return linhas.filter((u) => {
    let ativo = u.ativo === 1;
    let poder = u.poder;
    if (u.id === alvoId) {
      if (m.tipo === "ativo") ativo = m.ativo;
      if (m.tipo === "papel") poder = poderDe(db, m.papel) ?? 0;
    }
    return ativo && poder >= PODER_ADMIN;
  }).length;
}

/**
 * Decide se `ator` pode aplicar `m` em `alvo`.
 *
 * Duas familias de recusa, e as duas existem para impedir que alguem se tranque
 * do lado de fora:
 *
 *   - **Contra si mesmo.** Desativar-se ou rebaixar-se e o jeito mais rapido de
 *     perder o acesso, e sempre por engano. Quem quiser sair de admin pede a
 *     outro admin.
 *   - **Contra a casa.** Se a mudanca deixasse zero admins ativos, ninguem mais
 *     entraria na Administracao para desfazer — o conserto passaria a exigir
 *     mexer no banco por SSH.
 */
export function podeMexer(
  db: Database.Database,
  atorId: number,
  alvoId: number,
  m: Mudanca
): Decisao {
  const alvo = db.prepare("SELECT id, papel FROM usuarios WHERE id = ?").get(alvoId) as
    { id: number; papel: string } | undefined;
  if (!alvo) return { permitido: false, motivo: "Esse usuario nao existe." };

  if (m.tipo === "senha") {
    const erro = validarSenha(m.senha);
    return erro ? { permitido: false, motivo: erro } : { permitido: true };
  }

  if (m.tipo === "papel" && poderDe(db, m.papel) === null) {
    return { permitido: false, motivo: `O papel "${m.papel}" nao existe.` };
  }

  if (atorId === alvoId) {
    if (m.tipo === "ativo" && !m.ativo) {
      return { permitido: false, motivo: "Voce nao pode desativar a si mesmo." };
    }
    if (m.tipo === "papel") {
      const atual = poderDe(db, alvo.papel) ?? 0;
      const novo = poderDe(db, m.papel) ?? 0;
      if (novo < atual) {
        return { permitido: false, motivo: "Voce nao pode rebaixar a si mesmo." };
      }
    }
  }

  if (adminsRestantes(db, alvoId, m) === 0) {
    return {
      permitido: false,
      motivo: "Isso deixaria a casa sem admin ativo, e ninguem poderia desfazer.",
    };
  }

  return { permitido: true };
}
