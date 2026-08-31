import type { Router } from "express";
import express from "express";
import type Database from "better-sqlite3";
import { conferirSenha } from "../auth/senha.js";
import { abrirSessao, assinar, fecharSessao, verificarAssinatura } from "../auth/sessao.js";
import { COOKIE } from "../auth/middleware.js";
import { escapar } from "../html/base.js";

export function rotasLogin(db: Database.Database, segredo: string): Router {
  const r = express.Router();

  r.get("/entrar", (req, res) => {
    const erro = req.query.erro ? "<p class='erro'>Login ou senha invalidos.</p>" : "";
    res.type("html").send(`<!doctype html><meta charset="utf-8">
<title>Entrar — Portal da Casa</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<form method="post" action="/entrar">
  <h1>Portal da Casa</h1>
  ${erro}
  <label>Login <input name="login" autocomplete="username" autofocus></label>
  <label>Senha <input name="senha" type="password" autocomplete="current-password"></label>
  <button>Entrar</button>
</form>`);
  });

  r.post("/entrar", (req, res) => {
    const login = String(req.body.login ?? "");
    const senha = String(req.body.senha ?? "");
    const u = db.prepare("SELECT id, senha FROM usuarios WHERE login = ? AND ativo = 1")
      .get(login) as { id: number; senha: string } | undefined;

    const ok = !!u && conferirSenha(senha, u.senha);
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
      const id = verificarAssinatura(decodeURIComponent(bruto), segredo);
      if (id) fecharSessao(db, id);
    }
    res.clearCookie(COOKIE);
    res.redirect("/entrar");
  });

  return r;
}
