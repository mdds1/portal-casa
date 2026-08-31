import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt vem no Node. Evita dependencia nativa a mais num container de 512 MB,
// e e adequado para senha (custo de memoria, nao so de CPU).
const N = 16384;

export function gerarHash(senha: string): string {
  const sal = randomBytes(16);
  const hash = scryptSync(senha, sal, 64, { N });
  return `scrypt$${sal.toString("hex")}$${hash.toString("hex")}`;
}

export function conferirSenha(senha: string, guardado: string): boolean {
  const partes = guardado.split("$");
  if (partes.length !== 3 || partes[0] !== "scrypt") return false;
  const sal = Buffer.from(partes[1]!, "hex");
  const esperado = Buffer.from(partes[2]!, "hex");
  const obtido = scryptSync(senha, sal, esperado.length, { N });
  // Comparacao de tempo constante: comparar com === vazaria informacao pelo
  // tempo de resposta.
  return timingSafeEqual(esperado, obtido);
}
