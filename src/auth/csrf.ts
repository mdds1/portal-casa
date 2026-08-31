import { assinar, verificarAssinatura } from "./sessao.js";

// O token e a propria id de sessao assinada com um proposito diferente. Assim
// ele so vale para a sessao que o recebeu: um token vazado nao serve em outra.
const PROPOSITO = "csrf:";

export function tokenCsrf(idSessao: string, segredo: string): string {
  return assinar(PROPOSITO + idSessao, segredo);
}

export function conferirCsrf(token: string, idSessao: string, segredo: string): boolean {
  const valor = verificarAssinatura(token, segredo);
  return valor !== null && valor === PROPOSITO + idSessao;
}
