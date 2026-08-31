import { lerConfig } from "./config.js";
import { abrirBanco } from "./db/conexao.js";
import { criarApp } from "./app.js";
import { Cache } from "./cache.js";
import { buscarRecursos } from "./fontes/proxmox.js";
import { buscarEstados } from "./fontes/homeassistant.js";

const config = lerConfig(process.env);
const db = abrirBanco(config.caminhoBanco);

const caches = {
  pve: new Cache(() => buscarRecursos(config.pveUrl, config.pveToken)),
  ha: new Cache(() => buscarEstados(config.haUrl, config.haToken)),
};

criarApp({ db, segredoSessao: config.segredoSessao, caches }).listen(config.porta, () => {
  console.log(`portal escutando em ${config.porta}`);
});
