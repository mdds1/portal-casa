import { bom, ruim, type Resultado } from "./tipos.js";

export type Dia = { dia: string; min: number; max: number; ceu: string };
export type Tempo = {
  agora: number;
  umidade: number;
  ceu: string;
  dias: Dia[];
};

// Codigos WMO, que e o que a Open-Meteo devolve. So os grupos que interessam:
// a diferenca entre 61 e 63 e "chuva fraca" e "chuva moderada", e ninguem
// decide nada com isso — decide-se com "vai chover".
const CEU: [number, string][] = [
  [0, "ceu limpo"],
  [3, "nublado"],
  [48, "neblina"],
  [57, "garoa"],
  [67, "chuva"],
  [77, "neve"],
  [82, "pancadas de chuva"],
  [86, "neve"],
  [99, "tempestade"],
];

export function descreverCeu(codigo: number): string {
  for (const [ate, texto] of CEU) if (codigo <= ate) return texto;
  return "desconhecido";
}

export function interpretarTempo(json: unknown): Tempo {
  const d = (json ?? {}) as Record<string, unknown>;
  const agora = (d.current ?? {}) as Record<string, unknown>;
  const diario = (d.daily ?? {}) as Record<string, unknown[]>;
  const datas = (diario.time ?? []) as string[];
  const dias: Dia[] = datas.slice(0, 3).map((dia, i) => ({
    dia,
    min: Number((diario.temperature_2m_min ?? [])[i] ?? 0),
    max: Number((diario.temperature_2m_max ?? [])[i] ?? 0),
    ceu: descreverCeu(Number((diario.weather_code ?? [])[i] ?? -1)),
  }));
  return {
    agora: Number(agora.temperature_2m ?? 0),
    umidade: Number(agora.relative_humidity_2m ?? 0),
    ceu: descreverCeu(Number(agora.weather_code ?? -1)),
    dias,
  };
}

// Florianopolis. A Open-Meteo nao pede chave, entao nao ha segredo para
// guardar nem cota para estourar.
const URL_PADRAO =
  "https://api.open-meteo.com/v1/forecast" +
  "?latitude=-27.5954&longitude=-48.5480" +
  "&current=temperature_2m,relative_humidity_2m,weather_code" +
  "&daily=temperature_2m_max,temperature_2m_min,weather_code" +
  "&timezone=America/Sao_Paulo&forecast_days=3";

export async function buscarTempo(
  fetchFn: typeof fetch = fetch,
  url = URL_PADRAO
): Promise<Resultado<Tempo>> {
  try {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return ruim(`previsao respondeu ${r.status}`);
    return bom(interpretarTempo(await r.json()));
  } catch (e) {
    return ruim(e instanceof Error ? e.message : String(e));
  }
}
