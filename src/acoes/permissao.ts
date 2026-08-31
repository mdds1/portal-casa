import type Database from "better-sqlite3";
import { poderDoPapel } from "../db/inventario.js";
import { ehVerbo, type Alvo, type Decisao } from "./tipos.js";

// Toda a decisao de "quem pode o que" mora nesta funcao. Ela nao faz rede nem
// HTTP: da para exercitar cada regra em teste, e nenhuma tela pode contorna-la,
// porque a rota chama isto antes de qualquer outra coisa.
export function podeAgir(
  db: Database.Database,
  papel: string,
  alvo: Alvo,
  verbo: string
): Decisao {
  if (!ehVerbo(verbo)) return { permitido: false, motivo: `verbo desconhecido: ${verbo}` };

  const poder = poderDoPapel(db, papel);
  if (poder <= 0) return { permitido: false, motivo: "papel sem poder" };
  const poderAdmin = poderDoPapel(db, "admin");

  if (alvo.tipo === "host") {
    // Desligar o Proxmox derruba tudo junto, inclusive o Home Assistant e o
    // proprio portal. So admin, e so shutdown: nao existe ligar nem reiniciar
    // o host daqui, porque nao ha ninguem para receber o comando.
    if (poder < poderAdmin) return { permitido: false, motivo: "desligar o host e so do admin" };
    if (verbo !== "shutdown") return { permitido: false, motivo: "no host, so shutdown" };
    return { permitido: true };
  }

  const m = db
    .prepare("SELECT papel_minimo, acionavel FROM maquinas WHERE vmid = ?")
    .get(alvo.vmid) as { papel_minimo: string; acionavel: number } | undefined;

  if (!m) return { permitido: false, motivo: `maquina ${alvo.vmid} nao esta no inventario` };
  if (!m.acionavel) return { permitido: false, motivo: `maquina ${alvo.vmid} nao e acionavel` };

  // Quem age e quem ja enxerga: a mesma coluna que recorta a tela recorta o
  // botao. Sem lista de permissao paralela para envelhecer.
  if (poder < poderDoPapel(db, m.papel_minimo))
    return { permitido: false, motivo: "sem permissao para esta maquina" };

  return { permitido: true };
}

export { ehVerbo, ehDestrutivo, VERBOS, DESTRUTIVOS } from "./tipos.js";
export type { Verbo, Alvo, Decisao } from "./tipos.js";
