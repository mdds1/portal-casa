import { bom, ruim, type Resultado } from "./tipos.js";

export type RecursoPve = {
  tipo: "qemu" | "lxc";
  vmid: number;
  nome: string;
  estado: string;
  cpu: number;
  memoria: number;
  memoriaMax: number;
};

export function interpretarRecursos(json: unknown): RecursoPve[] {
  const dados = (json as { data?: unknown })?.data;
  if (!Array.isArray(dados)) return [];
  const saida: RecursoPve[] = [];
  for (const bruto of dados) {
    const r = bruto as Record<string, unknown>;
    if (r.type !== "qemu" && r.type !== "lxc") continue;
    saida.push({
      tipo: r.type,
      vmid: Number(r.vmid ?? 0),
      nome: String(r.name ?? ""),
      estado: String(r.status ?? "desconhecido"),
      cpu: Number(r.cpu ?? 0),
      memoria: Number(r.mem ?? 0),
      memoriaMax: Number(r.maxmem ?? 0),
    });
  }
  return saida;
}

export async function buscarRecursos(
  url: string,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<Resultado<RecursoPve[]>> {
  try {
    const r = await fetchFn(`${url}/api2/json/cluster/resources`, {
      headers: { Authorization: `PVEAPIToken=${token}` },
    });
    if (!r.ok) return ruim(`Proxmox respondeu ${r.status}`);
    return bom(interpretarRecursos(await r.json()));
  } catch (e) {
    return ruim(e instanceof Error ? e.message : String(e));
  }
}
