import express from "express";
import type Database from "better-sqlite3";
import { carregarSessao, exigirPapel } from "./auth/middleware.js";
import { rotasLogin } from "./telas/login.js";

export type Deps = { db: Database.Database; segredoSessao: string };

export function criarApp(deps: Deps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.use(carregarSessao(deps.db, deps.segredoSessao));

  app.get("/saude", (_req, res) => { res.json({ ok: true }); });
  app.use(rotasLogin(deps.db, deps.segredoSessao));

  // Rota provisoria, so para o teste de 403 ter alvo; a Task 9 substitui o corpo.
  app.get("/infraestrutura", exigirPapel(deps.db, "admin"), (_req, res) => {
    res.send("em construcao");
  });

  return app;
}
