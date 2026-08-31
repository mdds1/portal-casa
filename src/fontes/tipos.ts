// Toda fonte externa devolve isto. Nunca lanca excecao para cima: uma API fora
// do ar precisa degradar UM cartao, nunca a pagina inteira.
export type Resultado<T> =
  | { ok: true; dado: T; em: Date }
  | { ok: false; erro: string; em: Date };

export function bom<T>(dado: T): Resultado<T> {
  return { ok: true, dado, em: new Date() };
}

export function ruim<T>(erro: string): Resultado<T> {
  return { ok: false, erro, em: new Date() };
}
