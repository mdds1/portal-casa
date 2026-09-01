import { lerConfig } from "./config.js";
import { abrirBanco } from "./db/conexao.js";
import { criarApp } from "./app.js";
import { Cache } from "./cache.js";
import { buscarNo, buscarRecursos } from "./fontes/proxmox.js";
import { buscarDispositivos } from "./fontes/tailscale.js";
import { buscarTempo } from "./fontes/tempo.js";
import { buscarEstados, chamarServico } from "./fontes/homeassistant.js";
import { executorSsh } from "./acoes/wrapper.js";

const config = lerConfig(process.env);
const db = abrirBanco(config.caminhoBanco);

const exec = executorSsh(
  process.env.PORTAL_CHAVE_ACAO ?? "/etc/portal/acao_key",
  process.env.PORTAL_HOST_ACAO ?? "root@192.168.15.200"
);

// A tela de Midia consome os estados do Home Assistant desde 01/09/2026, entao
// o cache volta a ser montado -- e PORTAL_HA_URL/PORTAL_HA_TOKEN passam a ser
// exigidos no arranque.
const caches = {
  pve: new Cache(() => buscarRecursos(config.pveUrl, config.pveToken)),
  no: new Cache(() => buscarNo(config.pveUrl, config.pveToken)),
  rede: new Cache(() => buscarDispositivos()),
  // A previsao muda de hora em hora, nao de 15 em 15 segundos: consultar mais
  // que isso e gastar rede de graca e abusar de um servico gratuito.
  tempo: new Cache(() => buscarTempo(), 15 * 60_000),
  ha: new Cache(() => buscarEstados(config.haUrl, config.haToken)),
};

criarApp({
  db,
  segredoSessao: config.segredoSessao,
  caches,
  exec,
  chamarHa: (dominio, servico, dados) =>
    chamarServico(config.haUrl, config.haToken, dominio, servico, dados),
}).listen(config.porta, () => {
  console.log(`portal escutando em ${config.porta}`);
});
