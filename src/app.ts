import express from "express";
import type Database from "better-sqlite3";
import { carregarSessao, exigirLogin, exigirPapel } from "./auth/middleware.js";
import { rotasLogin } from "./telas/login.js";
import { rotaInicio, type Caches } from "./telas/inicio.js";
import { rotaInfraestrutura } from "./telas/infraestrutura.js";

export type Deps = {
  db: Database.Database;
  segredoSessao: string;
  caches: Caches;
};

export function criarApp(deps: Deps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.use(carregarSessao(deps.db, deps.segredoSessao));

  app.get("/saude", (_req, res) => { res.json({ ok: true }); });
  app.use(rotasLogin(deps.db, deps.segredoSessao));

  app.get("/", exigirLogin, rotaInicio({ db: deps.db, caches: deps.caches }));

  app.get("/infraestrutura", exigirPapel(deps.db, "admin"),
    rotaInfraestrutura({ db: deps.db, caches: deps.caches }));

  return app;
}
