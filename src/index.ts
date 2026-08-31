import { lerConfig } from "./config.js";
import { abrirBanco } from "./db/conexao.js";
import { criarApp } from "./app.js";
import { Cache } from "./cache.js";
import { buscarRecursos } from "./fontes/proxmox.js";

const config = lerConfig(process.env);
const db = abrirBanco(config.caminhoBanco);

// A fonte do Home Assistant (fontes/homeassistant.ts) continua correta e
// testada, mas nenhuma tela desta fatia consome estado dela -- so montar o
// cache aqui gastava um GET /api/states a cada 15s sem leitor nenhum e ainda
// exigia PORTAL_HA_URL/PORTAL_HA_TOKEN no arranque. Volta a ser montado
// quando existir tela que a consuma.
const caches = {
  pve: new Cache(() => buscarRecursos(config.pveUrl, config.pveToken)),
};

criarApp({ db, segredoSessao: config.segredoSessao, caches }).listen(config.porta, () => {
  console.log(`portal escutando em ${config.porta}`);
});
