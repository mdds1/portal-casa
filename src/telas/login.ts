import type { Router } from "express";
import express from "express";
import type Database from "better-sqlite3";
import { conferirSenha, gerarHash } from "../auth/senha.js";
import { abrirSessao, assinar, fecharSessao, verificarAssinatura } from "../auth/sessao.js";
import { COOKIE } from "../auth/middleware.js";
import { ESTILO } from "../html/base.js";

// Hash-isca fixo: quando o login nao existe, roda-se o scrypt contra ele mesmo
// assim, para que o tempo de resposta seja igual ao caminho de "usuario existe,
// senha errada". Gerado uma unica vez (nao a cada requisicao) para nao pagar
// o custo do scrypt no import alem do necessario para a comparacao.
const HASH_ISCA = gerarHash("hash-isca-nunca-bate-com-senha-nenhuma");

export function rotasLogin(db: Database.Database, segredo: string): Router {
  const r = express.Router();

  r.get("/entrar", (req, res) => {
    const erro = req.query.erro ? "<p class='erro'>Login ou senha invalidos.</p>" : "";
    res.type("html").send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<title>Entrar — Portal da Casa</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${ESTILO}</style>
<body class="entrada">
<form method="post" action="/entrar">
  <h1>Portal da Casa</h1>
  ${erro}
  <label>Login <input name="login" autocomplete="username" autofocus></label>
  <label>Senha <input name="senha" type="password" autocomplete="current-password"></label>
  <button>Entrar</button>
</form>
</body></html>`);
  });

  r.post("/entrar", (req, res) => {
    const login = String(req.body.login ?? "");
    const senha = String(req.body.senha ?? "");
    const u = db.prepare("SELECT id, senha FROM usuarios WHERE login = ? AND ativo = 1")
      .get(login) as { id: number; senha: string } | undefined;

    // Roda conferirSenha nos dois casos, mesmo quando o login nao existe:
    // se so rodasse quando `u` existe, o curto-circuito do "&&" pouparia o
    // scrypt para logins inexistentes, e a diferenca de tempo (dezenas de ms)
    // entregaria de bandeja quais logins existem no banco.
    const ok = conferirSenha(senha, u?.senha ?? HASH_ISCA) && !!u;
    db.prepare("INSERT INTO acoes_log (quando,usuario,verbo,alvo,ok) VALUES (?,?,?,?,?)")
      .run(new Date().toISOString(), login, "entrar", "portal", ok ? 1 : 0);

    if (!ok) return res.redirect("/entrar?erro=1");

    const id = abrirSessao(db, u!.id);
    res.cookie(COOKIE, assinar(id, segredo), {
      httpOnly: true, sameSite: "lax", secure: true, maxAge: 12 * 3600 * 1000,
    });
    res.redirect("/");
  });

  r.post("/sair", (req, res) => {
    const bruto = req.headers.cookie?.match(/portal_sessao=([^;]+)/)?.[1];
    if (bruto) {
      // Mesma protecao do lerCookie em auth/middleware.ts: um cookie
      // malformado nao pode derrubar /sair com 500.
      let decodificado: string | null;
      try {
        decodificado = decodeURIComponent(bruto);
      } catch {
        decodificado = null;
      }
      if (decodificado) {
        const id = verificarAssinatura(decodificado, segredo);
        if (id) fecharSessao(db, id);
      }
    }
    res.clearCookie(COOKIE);
    res.redirect("/entrar");
  });

  return r;
}
