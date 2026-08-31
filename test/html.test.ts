import { test } from "node:test";
import assert from "node:assert/strict";
import { escapar, layout } from "../src/html/base.js";
import { cartao } from "../src/html/cartao.js";

test("escapar neutraliza script", () => {
  assert.equal(escapar("<script>alert(1)</script>"),
    "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("escapar cuida de aspas e do e-comercial", () => {
  assert.equal(escapar(`a"b'c&d`), "a&quot;b&#39;c&amp;d");
});

test("escapar aceita numero, nulo e indefinido sem quebrar", () => {
  assert.equal(escapar(42), "42");
  assert.equal(escapar(null), "");
  assert.equal(escapar(undefined), "");
});

test("nome de maquina malicioso nao vira HTML no cartao", () => {
  const h = cartao({ titulo: `<img src=x onerror=alert(1)>`, estado: "ok", linhasHtml: [] });
  assert.ok(!h.includes("<img"), "o nome veio da API do Proxmox: nunca confiar");
  assert.ok(h.includes("&lt;img"));
});

test("o menu esconde Infraestrutura de quem tem poder de casa (10)", () => {
  const dela = layout({ titulo: "t", poder: 10, atual: "/", corpoHtml: "" });
  assert.ok(!dela.includes("/infraestrutura"));
  const dele = layout({ titulo: "t", poder: 100, atual: "/", corpoHtml: "" });
  assert.ok(dele.includes("/infraestrutura"));
});

test("o layout declara viewport, porque a tela dela e o celular", () => {
  assert.ok(layout({ titulo: "t", poder: 10, atual: "/", corpoHtml: "" })
    .includes('name="viewport"'));
});
