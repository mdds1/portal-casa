import { bom, ruim, type Resultado } from "./tipos.js";

export type RecursoPve = {
  tipo: "qemu" | "lxc";
  vmid: number;
  nome: string;
  estado: string;
  cpu: number;
  memoria: number;
  memoriaMax: number;
  // Segundos desde que a maquina subiu. Zero quando esta parada.
  uptime: number;
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
      uptime: Number(r.uptime ?? 0),
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

// O estado do proprio host: o `cluster/resources` fala das maquinas, nao da
// maquina que as hospeda. Sem isto o painel nao sabe dizer ha quanto tempo a
// casa esta de pe.
export type NoPve = {
  uptime: number;
  cpu: number;
  memoria: number;
  memoriaMax: number;
  disco: number;
  discoMax: number;
  carga: number;
};

export function interpretarNo(json: unknown): NoPve {
  const d = ((json as { data?: unknown })?.data ?? {}) as Record<string, unknown>;
  const mem = (d.memory ?? {}) as Record<string, unknown>;
  const raiz = (d.rootfs ?? {}) as Record<string, unknown>;
  const carga = Array.isArray(d.loadavg) ? Number(d.loadavg[0] ?? 0) : 0;
  return {
    uptime: Number(d.uptime ?? 0),
    cpu: Number(d.cpu ?? 0),
    memoria: Number(mem.used ?? 0),
    memoriaMax: Number(mem.total ?? 0),
    disco: Number(raiz.used ?? 0),
    discoMax: Number(raiz.total ?? 0),
    carga,
  };
}

export async function buscarNo(
  url: string,
  token: string,
  no = "pve",
  fetchFn: typeof fetch = fetch
): Promise<Resultado<NoPve>> {
  try {
    const r = await fetchFn(`${url}/api2/json/nodes/${no}/status`, {
      headers: { Authorization: `PVEAPIToken=${token}` },
    });
    if (!r.ok) return ruim(`Proxmox respondeu ${r.status}`);
    return bom(interpretarNo(await r.json()));
  } catch (e) {
    return ruim(e instanceof Error ? e.message : String(e));
  }
}
