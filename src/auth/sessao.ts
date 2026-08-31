import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";

const DURACAO_HORAS = 12;

export function assinar(valor: string, segredo: string): string {
  const mac = createHmac("sha256", segredo).update(valor).digest("hex");
  return `${valor}.${mac}`;
}

export function verificarAssinatura(assinado: string, segredo: string): string | null {
  const corte = assinado.lastIndexOf(".");
  if (corte < 0) return null;
  const valor = assinado.slice(0, corte);
  const mac = assinado.slice(corte + 1);
  const esperado = createHmac("sha256", segredo).update(valor).digest("hex");
  // Buffer.from(x, "hex") ignora silenciosamente lixo no fim de uma string
  // hex invalida (para no primeiro byte que nao forma par valido). Sem esta
  // checagem de tamanho, "assinatura-valida" + "x" decodifica pro MESMO
  // buffer da assinatura original e passaria no timingSafeEqual.
  if (mac.length !== esperado.length) return null;
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(esperado, "hex");
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? valor : null;
}

export function abrirSessao(db: Database.Database, usuarioId: number): string {
  const id = randomBytes(24).toString("hex");
  const agora = new Date();
  const expira = new Date(agora.getTime() + DURACAO_HORAS * 3600 * 1000);
  db.prepare("INSERT INTO sessoes (id,usuario,criada,expira) VALUES (?,?,?,?)")
    .run(id, usuarioId, agora.toISOString(), expira.toISOString());
  return id;
}

export function lerSessao(db: Database.Database, id: string): { usuario: number; papel: string } | null {
  const linha = db.prepare(`
    SELECT s.usuario AS usuario, u.papel AS papel, s.expira AS expira
    FROM sessoes s JOIN usuarios u ON u.id = s.usuario
    WHERE s.id = ? AND u.ativo = 1`).get(id) as
    { usuario: number; papel: string; expira: string } | undefined;
  if (!linha) return null;
  if (new Date(linha.expira) < new Date()) {
    db.prepare("DELETE FROM sessoes WHERE id = ?").run(id);
    return null;
  }
  return { usuario: linha.usuario, papel: linha.papel };
}

export function fecharSessao(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM sessoes WHERE id = ?").run(id);
}
