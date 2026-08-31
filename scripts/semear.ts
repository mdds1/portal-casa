// Popular um banco de verdade, fora dos testes.
// Uso: PORTAL_BANCO=portal.db npx tsx scripts/semear.ts
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";

const db = abrirBanco(process.env.PORTAL_BANCO ?? "portal.db");
semear(db);
console.log("inventario semeado");
