import { bom, ruim, type Resultado } from "./tipos.js";

export type EstadoHa = { entidade: string; estado: string; rotulo: string };

export function interpretarEstados(json: unknown): EstadoHa[] {
  if (!Array.isArray(json)) return [];
  const saida: EstadoHa[] = [];
  for (const bruto of json) {
    const e = bruto as Record<string, unknown>;
    const estado = String(e.state ?? "");
    // "unavailable" e "unknown" nao sao valor: mostrar isso na tela e pior do
    // que omitir, porque parece dado.
    if (estado === "unavailable" || estado === "unknown" || estado === "") continue;
    const attrs = (e.attributes ?? {}) as Record<string, unknown>;
    saida.push({
      entidade: String(e.entity_id ?? ""),
      estado,
      rotulo: String(attrs.friendly_name ?? e.entity_id ?? ""),
    });
  }
  return saida;
}

export async function buscarEstados(
  url: string,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<Resultado<EstadoHa[]>> {
  try {
    const r = await fetchFn(`${url}/api/states`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return ruim(`Home Assistant respondeu ${r.status}`);
    return bom(interpretarEstados(await r.json()));
  } catch (e) {
    return ruim(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Chama um servico do Home Assistant (ligar TV, pausar, etc).
 *
 * Existe separado de `buscarEstados` porque muda o mundo: leitura pode ser
 * cacheada e repetida a vontade, escrita nao. O token e o mesmo, mas o
 * chamador precisa ver a diferenca no nome do que esta invocando.
 */
export async function chamarServico(
  url: string,
  token: string,
  dominio: string,
  servico: string,
  dados: Record<string, unknown>,
  fetchFn: typeof fetch = fetch
): Promise<Resultado<null>> {
  try {
    const r = await fetchFn(`${url}/api/services/${dominio}/${servico}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(dados),
    });
    if (!r.ok) return ruim(`Home Assistant respondeu ${r.status}`);
    return bom(null);
  } catch (e) {
    return ruim(e instanceof Error ? e.message : String(e));
  }
}
