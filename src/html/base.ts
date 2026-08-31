// Tudo que vem do Proxmox, do Home Assistant ou do banco passa por aqui antes
// de virar HTML. Nome de VM e texto que alguem escolheu: e entrada, nao codigo.
export function escapar(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
