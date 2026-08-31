import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash } from "../src/auth/senha.js";
import { criarApp } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { bom, ruim, type Resultado } from "../src/fontes/tipos.js";
import type { RecursoPve } from "../src/fontes/proxmox.js";

const RECURSOS: RecursoPve[] = [
  { tipo: "qemu", vmid: 301, nome: "floripaot", estado: "running", cpu: 0.02, memoria: 2e9, memoriaMax: 8e9 },
  { tipo: "lxc", vmid: 201, nome: "jellyfin", estado: "stopped", cpu: 0, memoria: 0, memoriaMax: 2e9 },
];

async function servidor(caches: {
  pve?: () => Promise<Resultado<RecursoPve[]>>;
} = {}) {
  const db = abrirBanco(":memory:");
  semear(db);
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("matheus", "Matheus", gerarHash("s1"), "admin");
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("marcella", "Marcella", gerarHash("s2"), "casa");
  const app = criarApp({
    db,
    segredoSessao: "teste",
    exec: async () => bom("running"),
    caches: {
      pve: new Cache(caches.pve ?? (async () => bom(RECURSOS))),
    },
  });
  const s = app.listen(0);
  const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  const entrar = async (login: string, senha: string) => {
    const r = await fetch(`${base}/entrar`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ login, senha }).toString(),
      redirect: "manual",
    });
    return (r.headers.get("set-cookie") ?? "").split(";")[0]!;
  };
  return { base, s, entrar };
}

test("o admin ve o servidor de jogo na Inicio", async () => {
  const { base, s, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();
    assert.ok(html.includes("Jogo FloripaOT"));
  } finally { s.close(); }
});

test("a Marcella NAO ve o servidor de jogo na Inicio", async () => {
  const { base, s, entrar } = await servidor();
  try {
    const c = await entrar("marcella", "s2");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();
    assert.ok(html.includes("Jellyfin"), "o que e dela aparece");
    assert.ok(!html.includes("Jogo FloripaOT"), "o que nao e dela, nao");
    assert.ok(!html.includes("Proxmox"));
  } finally { s.close(); }
});

test("Proxmox fora do ar degrada o cartao, nao a pagina", async () => {
  const { base, s, entrar } = await servidor({ pve: async () => ruim<RecursoPve[]>("caiu") });
  try {
    const c = await entrar("matheus", "s1");
    const r = await fetch(base + "/", { headers: { cookie: c } });
    assert.equal(r.status, 200, "a pagina inteira nao pode cair junto");
    const html = await r.text();
    assert.ok(/desatualizado|indispon/i.test(html), "e precisa dizer que esta ruim");
  } finally { s.close(); }
});

test("a Marcella ve botao do Jellyfin e nenhum do que nao e dela", async () => {
  const { base, s, entrar } = await servidor();
  try {
    const c = await entrar("marcella", "s2");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();
    assert.match(html, /name="alvo" value="201"/, "o Jellyfin e dela");
    assert.doesNotMatch(html, /name="alvo" value="301"/, "o servidor de jogo nao");
    assert.doesNotMatch(html, /name="alvo" value="host"/, "e o host muito menos");
  } finally { s.close(); }
});

test("os botoes de acao ficam DENTRO do cartao da propria maquina, nao soltos na grade", async () => {
  // Regressao do defeito visual/de seguranca: os botoes apareciam como
  // irmaos do <section class="cartao">, celulas soltas do grid — impossivel
  // dizer com certeza a qual maquina cada grupo de botoes pertence. Os
  // testes antigos so procuravam os campos em html.includes()/match() na
  // pagina inteira, e eles estavam la — so no lugar errado. Este teste
  // recorta a pagina em blocos de cartao e prova contencao, nao presenca.
  const { base, s, entrar } = await servidor();
  try {
    const c = await entrar("marcella", "s2");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();

    const blocos = html.match(/<section class="cartao">[\s\S]*?<\/section>/g) ?? [];
    assert.ok(blocos.length > 0, "a pagina tem que ter pelo menos um cartao");

    const blocoJellyfin = blocos.find((b) => b.includes("Jellyfin"));
    assert.ok(blocoJellyfin, "tem que existir um cartao do Jellyfin");
    assert.match(
      blocoJellyfin!,
      /name="alvo" value="201"/,
      "o botao do Jellyfin tem que estar DENTRO do cartao do Jellyfin"
    );

    // Nenhum grupo de botoes pode sobrar fora de um bloco de cartao: some
    // toda ocorrencia de class="acoes" dentro de algum bloco e compare com
    // o total na pagina inteira.
    const totalAcoesNaPagina = (html.match(/class="acoes"/g) ?? []).length;
    const totalAcoesDentroDeCartoes = blocos.reduce(
      (soma, b) => soma + (b.match(/class="acoes"/g) ?? []).length,
      0
    );
    assert.equal(
      totalAcoesDentroDeCartoes,
      totalAcoesNaPagina,
      "nenhum bloco de botoes pode ficar fora de um <section class=\"cartao\">"
    );
  } finally { s.close(); }
});
