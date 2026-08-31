import { Cache } from "../src/cache.js";
import { bom } from "../src/fontes/tipos.js";
import type { NoPve, RecursoPve } from "../src/fontes/proxmox.js";
import type { Dispositivo } from "../src/fontes/tailscale.js";
import type { Tempo } from "../src/fontes/tempo.js";

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
export function cachesDeTeste(pve: RecursoPve[] = []) {
  return {
    pve: new Cache(async () => bom(pve)),
    no: new Cache(async () => bom(NO_TESTE)),
    rede: new Cache(async () => bom(REDE_TESTE)),
    tempo: new Cache(async () => bom(TEMPO_TESTE)),
  };
}
