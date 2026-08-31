import type { RequestHandler } from "express";
import type Database from "better-sqlite3";
import { lerSessao, verificarAssinatura } from "./sessao.js";

declare global {
  namespace Express {
    interface Request {
      sessao?: { id: string; usuario: number; papel: string };
    }
  }
}

const COOKIE = "portal_sessao";

function lerCookie(cabecalho: string | undefined, nome: string): string | null {
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(";")) {
    const [k, ...resto] = parte.trim().split("=");
    if (k === nome) {
      // Um cookie malformado (ex.: "%") faz decodeURIComponent lancar
      // URIError. Sem este try/catch, isto derrubava TODA rota que passa
      // por carregarSessao (montado em app.use antes de tudo) com 500 --
      // inclusive /entrar, sem caminho de recuperacao pela interface.
      try {
        return decodeURIComponent(resto.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function carregarSessao(db: Database.Database, segredo: string): RequestHandler {
  return (req, _res, prox) => {
    const bruto = lerCookie(req.headers.cookie, COOKIE);
    if (bruto) {
      const id = verificarAssinatura(bruto, segredo);
      if (id) {
        const s = lerSessao(db, id);
        if (s) req.sessao = { id, ...s };
      }
    }
    prox();
  };
}

export const exigirLogin: RequestHandler = (req, res, prox) => {
  if (!req.sessao) return res.redirect("/entrar");
  prox();
};

// O poder do papel vem do banco, nao de uma lista no codigo: acrescentar papel
// novo nao exige mexer aqui.
export function exigirPapel(db: Database.Database, minimo: string): RequestHandler {
  return (req, res, prox) => {
    if (!req.sessao) return res.redirect("/entrar");
    const linha = db.prepare(`
      SELECT (SELECT poder FROM papeis WHERE nome = ?) >= (SELECT poder FROM papeis WHERE nome = ?) AS pode`)
      .get(req.sessao.papel, minimo) as { pode: number };
    if (!linha.pode) return res.status(403).send("Sem permissao.");
    prox();
  };
}

export { COOKIE };
