import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bom, ruim, type Resultado } from "./tipos.js";

const rodar = promisify(execFile);

export type Dispositivo = {
  nome: string;
  sistema: string;
  online: boolean;
  // Vazio quando esta online; senao, "ha 13m", "ha 1d".
  visto: string;
  proprio: boolean;
};

// Quem esta no tailnet, lido do `tailscale status --json` da propria maquina.
// Nao precisa de credencial nem de rede: o daemon ja mantem esse estado, e o
// usuario do servico consegue ler o socket sem privilegio.
export function interpretarTailscale(json: unknown): Dispositivo[] {
  const d = (json ?? {}) as Record<string, unknown>;
  const pares = (d.Peer ?? {}) as Record<string, Record<string, unknown>>;
  const eu = (d.Self ?? {}) as Record<string, unknown>;

  const um = (p: Record<string, unknown>, proprio: boolean): Dispositivo => {
    const online = Boolean(p.Online);
    return {
      nome: String(p.HostName ?? p.DNSName ?? "?").replace(/\..*$/, ""),
      sistema: String(p.OS ?? ""),
      online,
      visto: online ? "" : desde(String(p.LastSeen ?? "")),
      proprio,
    };
  };

  const saida = [um(eu, true), ...Object.values(pares).map((p) => um(p, false))];
  // Online primeiro, e dentro de cada grupo por nome: quem esta em casa agora
  // e a informacao que se procura.
  return saida
    .filter((x) => x.nome !== "?")
    .sort((a, b) => Number(b.online) - Number(a.online) || a.nome.localeCompare(b.nome));
}

function desde(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return "agora ha pouco";
  if (s < 3600) return `ha ${Math.round(s / 60)}min`;
  if (s < 86400) return `ha ${Math.round(s / 3600)}h`;
  return `ha ${Math.round(s / 86400)}d`;
}

export async function buscarDispositivos(
  executar: (cmd: string, args: string[]) => Promise<{ stdout: string }> = (c, a) =>
    rodar(c, a, { timeout: 5000 })
): Promise<Resultado<Dispositivo[]>> {
  try {
    const { stdout } = await executar("tailscale", ["status", "--json"]);
    return bom(interpretarTailscale(JSON.parse(stdout)));
  } catch (e) {
    return ruim(e instanceof Error ? e.message : String(e));
  }
}
