import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash, conferirSenha } from "../src/auth/senha.js";
import { criarApp } from "../src/app.js";
import { bom } from "../src/fontes/tipos.js";
import { cachesDeTeste , chamarHaDeTeste } from "./apoio.js";

// Recebe o contexto do teste para registrar o fechamento do servidor em
// t.after(). Fechar so no fim do corpo do teste parece funcionar — ate a
// primeira assercao falhar: dali em diante o servidor fica escutando, o laco
// de eventos nunca esvazia e a suite PENDURA em vez de reportar a falha.
// Justo no momento em que o teste existe para avisar.
async function subir(t: { after: (fn: () => void) => void }) {
  const db = abrirBanco(":memory:");
  semear(db);
  const criar = db.prepare(
    "INSERT INTO usuarios (login,nome,senha,papel,ativo) VALUES (?,?,?,?,?)"
  );
  criar.run("matheus", "Matheus", gerarHash("senha-de-teste"), "admin", 1);
  criar.run("marcella", "Marcella", gerarHash("senha-de-teste"), "casa", 1);
  const app = criarApp({
    chamarHa: chamarHaDeTeste,
    db, segredoSessao: "teste", exec: async () => bom("running"),
    caches: cachesDeTeste([]),
  });
  const s = app.listen(0);
  t.after(() => s.close());
  const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;

  async function entrar(login: string, senha: string) {
    const r = await fetch(`${base}/entrar`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ login, senha }).toString(),
      redirect: "manual",
    });
    return (r.headers.get("set-cookie") ?? "").split(";")[0]!;
  }

  const cookie = await entrar("matheus", "senha-de-teste");
  const pagina = await (await fetch(`${base}/administracao`, { headers: { cookie } })).text();
  const csrf = pagina.match(/name="csrf" value="([^"]+)"/)?.[1] ?? "";

  const post = (caminho: string, campos: Record<string, string>, ck = cookie) =>
    fetch(`${base}${caminho}`, {
      method: "POST",
      headers: { cookie: ck, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, ...campos }).toString(),
      redirect: "manual",
    });

  const idDe = (login: string) =>
    String((db.prepare("SELECT id FROM usuarios WHERE login = ?").get(login) as { id: number }).id);

  return { db, base, s, cookie, csrf, post, idDe, entrar, pagina };
}

test("a Administracao e so do admin", async (t) => {
  const a = await subir(t);
  const ck = await a.entrar("marcella", "senha-de-teste");
  const r = await fetch(`${a.base}/administracao`, { headers: { cookie: ck }, redirect: "manual" });
  assert.equal(r.status, 403);
});

test("a Administracao nao aparece no menu de quem nao e admin", async (t) => {
  const a = await subir(t);
  const ck = await a.entrar("marcella", "senha-de-teste");
  const html = await (await fetch(`${a.base}/`, { headers: { cookie: ck } })).text();
  assert.ok(!html.includes("/administracao"), "o menu da casa nao deve citar a Administracao");
});

test("trocar a senha realmente troca: a nova entra e a antiga nao", async (t) => {
  const a = await subir(t);
  const r = await a.post("/administracao/usuario", {
    acao: "senha", id: a.idDe("marcella"), senha: "uma-senha-nova-longa",
  });
  assert.equal(r.status, 303);

  const guardado = (a.db.prepare("SELECT senha FROM usuarios WHERE login='marcella'")
    .get() as { senha: string }).senha;
  assert.ok(conferirSenha("uma-senha-nova-longa", guardado), "a senha nova deveria valer");
  assert.ok(!conferirSenha("senha-de-teste", guardado), "a senha antiga NAO deveria mais valer");
});

test("senha curta e recusada e nada muda no banco", async (t) => {
  const a = await subir(t);
  const antes = (a.db.prepare("SELECT senha FROM usuarios WHERE login='marcella'")
    .get() as { senha: string }).senha;
  const r = await a.post("/administracao/usuario", {
    acao: "senha", id: a.idDe("marcella"), senha: "curta",
  });
  const depois = (a.db.prepare("SELECT senha FROM usuarios WHERE login='marcella'")
    .get() as { senha: string }).senha;
  assert.equal(antes, depois, "a senha nao podia ter mudado");
  assert.match(await r.text(), /10 caracteres/);
});

test("sem CSRF nada acontece", async (t) => {
  const a = await subir(t);
  const r = await fetch(`${a.base}/administracao/usuario`, {
    method: "POST",
    headers: { cookie: a.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ acao: "senha", id: a.idDe("marcella"), senha: "uma-senha-nova-longa" }).toString(),
    redirect: "manual",
  });
  assert.equal(r.status, 403);
  const guardado = (a.db.prepare("SELECT senha FROM usuarios WHERE login='marcella'")
    .get() as { senha: string }).senha;
  assert.ok(conferirSenha("senha-de-teste", guardado), "sem CSRF a senha tinha de continuar a antiga");
});

test("desativar a si mesmo e recusado, com o motivo na tela", async (t) => {
  const a = await subir(t);
  const r = await a.post("/administracao/usuario", {
    acao: "ativo", id: a.idDe("matheus"), ativo: "0",
  });
  assert.match(await r.text(), /si mesmo/i);
  const u = a.db.prepare("SELECT ativo FROM usuarios WHERE login='matheus'").get() as { ativo: number };
  assert.equal(u.ativo, 1, "o admin tinha de continuar ativo");
});

test("toda mudanca entra no registro, inclusive a recusada", async (t) => {
  const a = await subir(t);
  await a.post("/administracao/usuario", { acao: "senha", id: a.idDe("marcella"), senha: "uma-senha-nova-longa" });
  await a.post("/administracao/usuario", { acao: "ativo", id: a.idDe("matheus"), ativo: "0" });
  const linhas = a.db.prepare("SELECT verbo, alvo, ok FROM acoes_log ORDER BY id").all() as
    { verbo: string; alvo: string; ok: number }[];
  const senha = linhas.find((l) => l.verbo === "senha");
  const ativo = linhas.find((l) => l.verbo === "ativo");
  assert.ok(senha && senha.ok === 1, "a troca de senha bem-sucedida tinha de estar registrada");
  assert.ok(ativo && ativo.ok === 0, "a tentativa recusada tinha de estar registrada como falha");
});

test("editar o inventario muda a maquina e registra", async (t) => {
  const a = await subir(t);
  const vmid = (a.db.prepare("SELECT vmid FROM maquinas LIMIT 1").get() as { vmid: number }).vmid;
  const r = await a.post("/administracao/maquina", {
    vmid: String(vmid), descricao: "descricao nova", acionavel: "1", papel_minimo: "casa",
  });
  assert.equal(r.status, 303);
  const m = a.db.prepare("SELECT descricao, acionavel, papel_minimo FROM maquinas WHERE vmid = ?")
    .get(vmid) as { descricao: string; acionavel: number; papel_minimo: string };
  assert.equal(m.descricao, "descricao nova");
  assert.equal(m.acionavel, 1);
  assert.equal(m.papel_minimo, "casa");
});

test("papel_minimo inexistente e recusado e a maquina nao muda", async (t) => {
  const a = await subir(t);
  const vmid = (a.db.prepare("SELECT vmid FROM maquinas LIMIT 1").get() as { vmid: number }).vmid;
  const antes = a.db.prepare("SELECT descricao FROM maquinas WHERE vmid = ?").get(vmid) as { descricao: string };
  const r = await a.post("/administracao/maquina", {
    vmid: String(vmid), descricao: "nao deveria colar", acionavel: "0", papel_minimo: "imperador",
  });
  assert.match(await r.text(), /papel/i);
  const depois = a.db.prepare("SELECT descricao FROM maquinas WHERE vmid = ?").get(vmid) as { descricao: string };
  assert.equal(antes.descricao, depois.descricao, "nada podia ter mudado");
});

test("criar usuario funciona e ele consegue entrar", async (t) => {
  const a = await subir(t);
  const r = await a.post("/administracao/usuario", {
    acao: "criar", login: "visita", nome: "Visita", senha: "senha-de-visita", papel: "casa",
  });
  assert.equal(r.status, 303);
  const ck = await a.entrar("visita", "senha-de-visita");
  assert.ok(ck.startsWith("portal_sessao="), "o usuario novo tinha de conseguir entrar");
});

test("login repetido e recusado com mensagem, sem quebrar", async (t) => {
  const a = await subir(t);
  const r = await a.post("/administracao/usuario", {
    acao: "criar", login: "marcella", nome: "Outra", senha: "senha-de-visita", papel: "casa",
  });
  assert.match(await r.text(), /ja existe/i);
  const n = a.db.prepare("SELECT count(*) AS n FROM usuarios WHERE login='marcella'").get() as { n: number };
  assert.equal(n.n, 1);
});

test("o registro aparece na tela", async (t) => {
  const a = await subir(t);
  await a.post("/administracao/usuario", { acao: "senha", id: a.idDe("marcella"), senha: "uma-senha-nova-longa" });
  const html = await (await fetch(`${a.base}/administracao`, { headers: { cookie: a.cookie } })).text();
  assert.match(html, /senha/);
  assert.match(html, /marcella/);
});

test("a senha nunca aparece no registro", async (t) => {
  const a = await subir(t);
  await a.post("/administracao/usuario", {
    acao: "senha", id: a.idDe("marcella"), senha: "banana-com-abacaxi",
  });
  // Tambem a recusada: uma senha curta e recusada COM a senha em maos, e o
  // caminho de erro e onde e mais facil vazar sem perceber.
  await a.post("/administracao/usuario", {
    acao: "senha", id: a.idDe("marcella"), senha: "curta",
  });
  const tudo = JSON.stringify(a.db.prepare("SELECT * FROM acoes_log").all());
  assert.ok(!tudo.includes("banana-com-abacaxi"), "a senha vazou para o registro");
  assert.ok(!tudo.includes("curta"), "a senha recusada vazou para o registro");
});

test("a senha nunca volta no HTML da pagina", async (t) => {
  const a = await subir(t);
  const r = await a.post("/administracao/usuario", {
    acao: "senha", id: a.idDe("marcella"), senha: "curta-demais-nao",
  });
  const html = await r.text();
  assert.ok(!html.includes("curta-demais-nao"), "a senha recusada foi devolvida no HTML");
});
