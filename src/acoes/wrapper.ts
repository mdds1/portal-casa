import { execFile } from "node:child_process";
import { bom, ruim, type Resultado } from "../fontes/tipos.js";
import type { Alvo, Verbo } from "./tipos.js";

export type Executor = (comando: string) => Promise<Resultado<string>>;

export function comandoDe(alvo: Alvo, verbo: Verbo): string {
  if (alvo.tipo === "host") return `host ${verbo}`;
  return `${alvo.classe} ${verbo} ${alvo.vmid}`;
}

// erro.message do execFile inclui a linha de comando inteira que falhou —
// e nela vao "-i <chave>" e "usuario@destino". NUNCA deixe erro.message cru
// virar Resultado.erro: isso vaza caminho de chave e destino do host para
// qualquer tela ou log que mostre o erro. Se o portal-acao respondeu algo em
// stdout/stderr, isso e seguro de usar (e texto dele, nao a linha de comando).
// Sem isso, so sobra um resumo fixo com o que da para saber sem repetir o
// comando: codigo de saida e/ou sinal.
export function mensagemDeFalha(erro: Error & { code?: number | string | null; signal?: string | null }, saida: string, saidaErro: string): string {
  const textoDoHost = (saida || saidaErro || "").trim();
  if (textoDoHost) return textoDoHost;
  const partes = [
    erro.code !== undefined && erro.code !== null ? `codigo ${erro.code}` : null,
    erro.signal ? `sinal ${erro.signal}` : null,
  ].filter((p): p is string => p !== null);
  return partes.length > 0
    ? `falha ao executar no host (${partes.join(", ")})`
    : "falha ao executar no host";
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
          if (erro) return resolver(ruim(mensagemDeFalha(erro, saida, saidaErro)));
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
