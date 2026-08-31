import { lerConfig } from "./config.js";
import { abrirBanco } from "./db/conexao.js";
import { criarApp } from "./app.js";

const config = lerConfig(process.env);
const db = abrirBanco(config.caminhoBanco);
criarApp({ db }).listen(config.porta, () => {
  console.log(`portal escutando em ${config.porta}`);
});
