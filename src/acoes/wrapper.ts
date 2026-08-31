import { execFile } from "node:child_process";
import { bom, ruim, type Resultado } from "../fontes/tipos.js";
import type { Alvo, Verbo } from "./tipos.js";

export type Executor = (comando: string) => Promise<Resultado<string>>;

export function comandoDe(alvo: Alvo, verbo: Verbo): string {
  if (alvo.tipo === "host") return `host ${verbo}`;
  return `${alvo.classe} ${verbo} ${alvo.vmid}`;
}

// A chave do portal tem comando forcado no host, entao o que vai aqui e apenas
// o argumento — o host ignora qualquer tentativa de rodar outra coisa. Ainda
// assim usamos execFile com lista de argumentos, nunca uma string de shell:
// assim nao existe interpretacao de aspas nem de ponto-e-virgula no caminho.
export function executorSsh(chave: string, destino: string, msLimite = 20000): Executor {
  return (comando) =>
    new Promise((resolver) => {
      execFile(
        "ssh",
        ["-i", chave, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
         "-o", `ConnectTimeout=${Math.ceil(msLimite / 1000)}`, destino, comando],
        { timeout: msLimite },
        (erro, saida, saidaErro) => {
          if (erro) return resolver(ruim(`${(saida || saidaErro || erro.message).trim()}`));
          resolver(bom(saida));
        }
      );
    });
}

export async function acionar(
  exec: Executor,
  alvo: Alvo,
  verbo: Verbo
): Promise<Resultado<string>> {
  try {
    const r = await exec(comandoDe(alvo, verbo));
    return r.ok ? bom(r.dado.trim()) : r;
  } catch (e) {
    // Mesma razao do try/catch do cache: esta camada existe para a pagina nao
    // cair. Confiar no contrato de quem foi injetado anula o proposito dela.
    return ruim(e instanceof Error ? e.message : String(e));
  }
}
