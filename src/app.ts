import express from "express";
import type { ErrorRequestHandler } from "express";
import type Database from "better-sqlite3";
import { carregarSessao, exigirLogin, exigirPapel } from "./auth/middleware.js";
import { rotasLogin } from "./telas/login.js";
import { rotaInicio, type Caches } from "./telas/inicio.js";
import { rotaInfraestrutura } from "./telas/infraestrutura.js";
import { escapar } from "./html/base.js";

// Pagina curta para 404 e para erro: nunca stack trace no navegador. O
// Express, sem isto, usa o handler padrao dele, que imprime o stack na
// resposta quando NODE_ENV nao e "production" -- e a degradacao desenhada
// para as fontes externas nao cobre uma excecao vinda do banco, por exemplo.
function paginaErro(titulo: string, mensagem: string): string {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<title>${escapar(titulo)} — Portal da Casa</title>
<body><h1>${escapar(titulo)}</h1><p>${escapar(mensagem)}</p></body></html>`;
}

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

  app.use((_req, res) => {
    res.status(404).type("html").send(paginaErro("Nao encontrado", "Esta pagina nao existe."));
  });

  const tratarErro: ErrorRequestHandler = (erro, _req, res, _prox) => {
    console.error("erro nao tratado:", erro);
    res.status(500).type("html").send(paginaErro("Erro", "Algo deu errado. Tente de novo em instantes."));
  };
  app.use(tratarErro);

  return app;
}
