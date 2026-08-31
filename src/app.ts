import express from "express";
import type Database from "better-sqlite3";

export type Deps = { db: Database.Database };

export function criarApp(deps: Deps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));

  app.get("/saude", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}
