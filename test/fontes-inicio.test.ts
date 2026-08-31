import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretarTailscale } from "../src/fontes/tailscale.js";
import { interpretarTempo, descreverCeu, buscarTempo } from "../src/fontes/tempo.js";
import { interpretarNo, interpretarRecursos } from "../src/fontes/proxmox.js";

test("tailscale: separa quem esta online, e diz ha quanto tempo os outros sumiram", () => {
  const agora = Date.now();
  const d = interpretarTailscale({
    Self: { HostName: "portal", OS: "linux", Online: true },
    Peer: {
      a: { HostName: "iphone-do-matheus", OS: "iOS", Online: true },
      b: { HostName: "drive", OS: "linux", Online: false, LastSeen: new Date(agora - 2 * 86400e3).toISOString() },
      c: { HostName: "docker-media-pve", OS: "linux", Online: false, LastSeen: new Date(agora - 13 * 60e3).toISOString() },
    },
  });
  assert.equal(d.length, 4);
  // Online primeiro.
  assert.deepEqual(d.slice(0, 2).map((x) => x.nome), ["iphone-do-matheus", "portal"]);
  assert.equal(d.find((x) => x.nome === "portal")!.proprio, true);
  assert.equal(d.find((x) => x.nome === "drive")!.visto, "ha 2d");
  assert.equal(d.find((x) => x.nome === "docker-media-pve")!.visto, "ha 13min");
  // Quem esta online nao carrega "visto", senao a tela mostra duas coisas
  // dizendo a mesma coisa.
  assert.equal(d.find((x) => x.nome === "iphone-do-matheus")!.visto, "");
});

test("tailscale: entrada vazia nao quebra", () => {
  assert.deepEqual(interpretarTailscale({}), []);
  assert.deepEqual(interpretarTailscale(null), []);
});

test("previsao: le a temperatura de agora e tres dias", () => {
  const t = interpretarTempo({
    current: { temperature_2m: 18, relative_humidity_2m: 98, weather_code: 55 },
    daily: {
      time: ["2026-08-31", "2026-09-01", "2026-09-02"],
      temperature_2m_max: [21, 24, 19],
      temperature_2m_min: [16, 17, 14],
      weather_code: [61, 3, 0],
    },
  });
  assert.equal(t.agora, 18);
  assert.equal(t.umidade, 98);
  assert.equal(t.ceu, "garoa");
  assert.equal(t.dias.length, 3);
  assert.deepEqual(t.dias[1], { dia: "2026-09-01", min: 17, max: 24, ceu: "nublado" });
});

test("previsao: o codigo do ceu vira texto util, nao numero", () => {
  assert.equal(descreverCeu(0), "ceu limpo");
  assert.equal(descreverCeu(61), "chuva");
  assert.equal(descreverCeu(95), "tempestade");
  assert.equal(descreverCeu(999), "desconhecido");
});

test("previsao: erro de rede vira Resultado ruim, nao excecao", async () => {
  const r = await buscarTempo(async () => { throw new Error("sem rede"); });
  assert.equal(r.ok, false);
  assert.match(String(r.erro), /sem rede/);
});

test("previsao: resposta HTTP de erro nao e tratada como sucesso", async () => {
  const r = await buscarTempo(async () => new Response("nao", { status: 503 }));
  assert.equal(r.ok, false);
  assert.match(String(r.erro), /503/);
});

test("proxmox: o no traz uptime, memoria e disco", () => {
  const n = interpretarNo({
    data: {
      uptime: 90061,
      cpu: 0.07,
      loadavg: ["0.52", "0.4", "0.3"],
      memory: { used: 12e9, total: 32e9 },
      rootfs: { used: 15e9, total: 37e9 },
    },
  });
  assert.equal(n.uptime, 90061);
  assert.equal(n.memoria, 12e9);
  assert.equal(n.discoMax, 37e9);
  assert.equal(n.carga, 0.52);
});

test("proxmox: o uptime de cada maquina chega junto com o resto", () => {
  const r = interpretarRecursos({
    data: [{ type: "lxc", vmid: 201, name: "jellyfin", status: "running", cpu: 0.01, mem: 1e9, maxmem: 2e9, uptime: 7200 }],
  });
  assert.equal(r[0]!.uptime, 7200);
});
