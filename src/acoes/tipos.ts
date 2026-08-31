// A lista de verbos e fechada e mora aqui. Ela e conferida DUAS vezes: neste
// portal e, de novo, dentro do /usr/local/sbin/portal-acao no host. As duas
// listas precisam continuar iguais -- e desde a revisao final isso e provado:
// test/consistencia.test.ts le infra/portal/portal-acao e compara os dois
// `case` (verbos e alvos) com esta lista e com a semente do inventario.
export const VERBOS = ["start", "shutdown", "reboot"] as const;
export type Verbo = (typeof VERBOS)[number];

// Verbos que pedem confirmacao na tela antes de executar.
export const DESTRUTIVOS: readonly Verbo[] = ["shutdown", "reboot"];

// A classe (vm ou ct) viaja junto com o alvo porque o comando enviado ao host
// depende dela, e adivinhar pelo numero daria errado: o 100 e container e o 120
// e VM. Quem monta o Alvo le a classe do inventario.
export type Alvo =
  | { tipo: "maquina"; vmid: number; classe: "vm" | "ct" }
  | { tipo: "host" };

export type Decisao =
  | { permitido: true }
  | { permitido: false; motivo: string };

// Rotulos vem de um lugar so: a tela de confirmacao (acao.ts) e os botoes
// nas telas (inicio.ts, infraestrutura.ts) usavam listas separadas antes
// desta declaracao, e as duas podiam divergir sem que nada avisasse.
export const ROTULOS: Record<Verbo, string> = {
  start: "Ligar",
  shutdown: "Desligar",
  reboot: "Reiniciar",
};

export function ehVerbo(v: string): v is Verbo {
  return (VERBOS as readonly string[]).includes(v);
}

export function ehDestrutivo(v: Verbo): boolean {
  return DESTRUTIVOS.includes(v);
}
