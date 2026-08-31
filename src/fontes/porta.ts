import { Socket } from "node:net";
import { bom, ruim, type Resultado } from "./tipos.js";

// Nem tudo aparece nas APIs: o servidor de Tibia, o de Dofus e o site so
// respondem "estou vivo" abrindo conexao na porta.
export function checarPorta(host: string, porta: number, msLimite = 2000): Promise<Resultado<true>> {
  return new Promise((resolver) => {
    const s = new Socket();
    let respondido = false;
    const terminar = (r: Resultado<true>) => {
      if (respondido) return;
      respondido = true;
      s.destroy();
      resolver(r);
    };
    s.setTimeout(msLimite);
    s.once("connect", () => terminar(bom(true as const)));
    s.once("timeout", () => terminar(ruim(`sem resposta em ${msLimite} ms`)));
    s.once("error", (e) => terminar(ruim(e.message)));
    s.connect(porta, host);
  });
}
