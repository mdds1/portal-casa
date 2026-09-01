import { Cache } from "../src/cache.js";
import { bom, ruim } from "../src/fontes/tipos.js";
import type { NoPve, RecursoPve } from "../src/fontes/proxmox.js";
import type { Dispositivo } from "../src/fontes/tailscale.js";
import type { Tempo } from "../src/fontes/tempo.js";
import type { EstadoHa } from "../src/fontes/homeassistant.js";
import type { ChamarHa } from "../src/telas/midia.js";
import type { Resultado } from "../src/fontes/tipos.js";

export const NO_TESTE: NoPve = {
  uptime: 90061, cpu: 0.07, memoria: 12e9, memoriaMax: 32e9,
  disco: 15e9, discoMax: 37e9, carga: 0.52,
};

export const REDE_TESTE: Dispositivo[] = [
  { nome: "portal", sistema: "linux", online: true, visto: "", proprio: true },
  { nome: "iphone-do-matheus", sistema: "iOS", online: true, visto: "", proprio: false },
  { nome: "drive", sistema: "linux", online: false, visto: "ha 2d", proprio: false },
];

export const TEMPO_TESTE: Tempo = {
  agora: 18, umidade: 98, ceu: "garoa",
  dias: [
    { dia: "2026-08-31", min: 16, max: 21, ceu: "chuva" },
    { dia: "2026-09-01", min: 17, max: 24, ceu: "nublado" },
  ],
};

// Os caches que toda tela precisa. Quem se importa com uma fonte especifica
// passa a sua; as outras vem com dado plausivel para a pagina renderizar.
export const HA_TESTE: EstadoHa[] = [
  { entidade: "media_player.suite_luke_s", estado: "off", rotulo: "Luke's" },
];

export function cachesDeTeste(
  pve: RecursoPve[] = [],
  ha: Resultado<EstadoHa[]> = bom(HA_TESTE)
) {
  return {
    pve: new Cache(async () => bom(pve)),
    no: new Cache(async () => bom(NO_TESTE)),
    rede: new Cache(async () => bom(REDE_TESTE)),
    tempo: new Cache(async () => bom(TEMPO_TESTE)),
    ha: new Cache(async () => ha),
  };
}

/**
 * O `chamarHa` dos testes que nao se importam com o Home Assistant.
 *
 * Devolve falha de proposito: um teste que nao declarou interesse em chamar
 * servico do HA nao deveria conseguir chamar um sem querer e passar mesmo
 * assim. Quem testa a Midia passa o proprio.
 */
export const chamarHaDeTeste: ChamarHa = async () =>
  ruim("Home Assistant nao usado neste teste");
