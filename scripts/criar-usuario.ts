// Uso: PORTAL_BANCO=portal.db npx tsx scripts/criar-usuario.ts <login> <nome> <papel>
// A senha e lida da entrada padrao para nao ficar no historico do shell.
import { abrirBanco } from "../src/db/conexao.js";
import { gerarHash } from "../src/auth/senha.js";
import { createInterface } from "node:readline/promises";

const [login, nome, papel] = process.argv.slice(2);
if (!login || !nome || !papel) {
  console.error("uso: criar-usuario.ts <login> <nome> <admin|casa>");
  process.exit(2);
}
const rl = createInterface({ input: process.stdin, output: process.stderr });
const senha = await rl.question("senha: ");
rl.close();

const db = abrirBanco(process.env.PORTAL_BANCO ?? "portal.db");
db.prepare(`INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)
  ON CONFLICT(login) DO UPDATE SET nome=excluded.nome, senha=excluded.senha, papel=excluded.papel`)
  .run(login, nome, gerarHash(senha), papel);
console.error(`usuario ${login} gravado como ${papel}`);
