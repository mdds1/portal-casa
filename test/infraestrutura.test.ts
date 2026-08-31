import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash } from "../src/auth/senha.js";
import { criarApp } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { bom } from "../src/fontes/tipos.js";
import type { RecursoPve } from "../src/fontes/proxmox.js";

const RECURSOS: RecursoPve[] = [
  { tipo: "qemu", vmid: 301, nome: "floripaot", estado: "running", cpu: 0.02, memoria: 2e9, memoriaMax: 8e9 },
  { tipo: "lxc", vmid: 104, nome: "starloco", estado: "stopped", cpu: 0, memoria: 0, memoriaMax: 2e9 },
];

// Devolve o <tr>...</tr> inteiro que contem o nome dado, para asserir campo
// por linha em vez de perguntar se o texto aparece em algum lugar da pagina.
function linhaDaMaquina(html: string, nome: string): string {
  const m = html.match(new RegExp(`<tr>(?:(?!</tr>)[\\s\\S])*?${nome}[\\s\\S]*?</tr>`));
  assert.ok(m, `linha de ${nome} nao encontrada na tabela`);
  return m![0];
}

async function comAdmin() {
  const db = abrirBanco(":memory:");
  semear(db);
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("matheus", "Matheus", gerarHash("s1"), "admin");
  const app = criarApp({
    db, segredoSessao: "teste",
    exec: async () => bom("running"),
    caches: {
      pve: new Cache(async () => bom(RECURSOS)),
    },
  });
  const s = app.listen(0);
  const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  const r = await fetch(`${base}/entrar`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ login: "matheus", senha: "s1" }).toString(),
    redirect: "manual",
  });
  return { base, s, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0]! };
}

test("lista as maquinas do inventario com o estado vindo do Proxmox", async () => {
  const { base, s, cookie } = await comAdmin();
  try {
    const html = await (await fetch(base + "/infraestrutura", { headers: { cookie } })).text();
    assert.ok(html.includes("floripaot"));
    assert.ok(html.includes("starloco"));
    assert.ok(/running/.test(html));
  } finally { s.close(); }
});

test("maquina do inventario que o Proxmox nao devolveu aparece como desconhecida", async () => {
  const { base, s, cookie } = await comAdmin();
  try {
    const html = await (await fetch(base + "/infraestrutura", { headers: { cookie } })).text();
    // o inventario tem 10 maquinas; o cache devolveu 2
    assert.ok(html.includes("gamebox-batocera"), "some do Proxmox mas nao do inventario");
    assert.ok(/desconhecido/.test(html));
  } finally { s.close(); }
});

test("mostra quais maquinas voltam sozinhas depois de queda de luz", async () => {
  const { base, s, cookie } = await comAdmin();
  try {
    const html = await (await fetch(base + "/infraestrutura", { headers: { cookie } })).text();
    // A semente tem floripaot com onboot=1 e starloco com onboot=0 (src/db/semente.ts).
    // O cabecalho estatico "<th>Volta sozinha</th>" sozinho ja bateria numa regex
    // solta na pagina inteira -- por isso a checagem e por linha, no valor de fato.
    const linhaFloripaot = linhaDaMaquina(html, "floripaot");
    const linhaStarloco = linhaDaMaquina(html, "starloco");
    assert.ok(/<td>sim<\/td>/.test(linhaFloripaot), "floripaot volta sozinha (onboot=1)");
    assert.ok(/<td>nao<\/td>/.test(linhaStarloco), "starloco nao volta sozinha (onboot=0)");
  } finally { s.close(); }
});
