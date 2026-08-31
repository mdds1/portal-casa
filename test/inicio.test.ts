import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash } from "../src/auth/senha.js";
import { criarApp } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { bom, ruim, type Resultado } from "../src/fontes/tipos.js";
import type { RecursoPve } from "../src/fontes/proxmox.js";
import type { EstadoHa } from "../src/fontes/homeassistant.js";

const RECURSOS: RecursoPve[] = [
  { tipo: "qemu", vmid: 301, nome: "floripaot", estado: "running", cpu: 0.02, memoria: 2e9, memoriaMax: 8e9 },
  { tipo: "lxc", vmid: 201, nome: "jellyfin", estado: "stopped", cpu: 0, memoria: 0, memoriaMax: 2e9 },
];

async function servidor(caches: {
  pve?: () => Promise<Resultado<RecursoPve[]>>;
  ha?: () => Promise<Resultado<EstadoHa[]>>;
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
    caches: {
      pve: new Cache(caches.pve ?? (async () => bom(RECURSOS))),
      ha: new Cache(caches.ha ?? (async () => bom([] as EstadoHa[]))),
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
