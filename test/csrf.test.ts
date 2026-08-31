import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenCsrf, conferirCsrf } from "../src/auth/csrf.js";

const SEG = "segredo-do-servidor";

test("token da propria sessao e aceito", () => {
  const t = tokenCsrf("sessao-abc", SEG);
  assert.equal(conferirCsrf(t, "sessao-abc", SEG), true);
});

test("token de OUTRA sessao e recusado", () => {
  const t = tokenCsrf("sessao-abc", SEG);
  assert.equal(conferirCsrf(t, "sessao-xyz", SEG), false,
    "senao a Marcella poderia usar o token dela num pedido em nome de outro");
});

test("token adulterado e recusado, inclusive por acrescimo no fim", () => {
  const t = tokenCsrf("sessao-abc", SEG);
  assert.equal(conferirCsrf(t + "x", "sessao-abc", SEG), false);
  assert.equal(conferirCsrf(t.slice(0, -1), "sessao-abc", SEG), false);
});

test("token de outro servidor e recusado", () => {
  const t = tokenCsrf("sessao-abc", "outro-segredo");
  assert.equal(conferirCsrf(t, "sessao-abc", SEG), false);
});

test("token vazio ou sem forma e recusado, sem lancar", () => {
  for (const t of ["", ".", "abc", "a.b.c"])
    assert.equal(conferirCsrf(t, "sessao-abc", SEG), false, `"${t}" nao pode passar`);
});
