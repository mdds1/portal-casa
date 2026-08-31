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

export const ESTILO = `
:root { color-scheme: light dark; --fundo:#f6f6f7; --cartao:#fff; --borda:#e2e2e5; --texto:#1a1a1c; --fraco:#6b6b70; }
@media (prefers-color-scheme: dark) {
  :root { --fundo:#151517; --cartao:#1e1e21; --borda:#2e2e33; --texto:#ececee; --fraco:#9a9aa0; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--fundo); color:var(--texto);
  font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; }
header { display:flex; gap:1rem; align-items:center; flex-wrap:wrap;
  padding:.75rem 1rem; background:var(--cartao); border-bottom:1px solid var(--borda); }
header a { color:inherit; text-decoration:none; padding:.35rem .6rem; border-radius:6px; }
header a[aria-current="page"] { background:var(--fundo); font-weight:600; }
main { padding:1rem; max-width:1100px; margin:0 auto; }
.grade { display:grid; gap:.75rem; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); }
.cartao { background:var(--cartao); border:1px solid var(--borda); border-radius:10px; padding:.85rem; }
.cartao h3 { margin:0 0 .5rem; font-size:1rem; display:flex; align-items:center; gap:.5rem; }
.ponto { width:.6rem; height:.6rem; border-radius:50%; flex:none; }
.ponto.ok{background:#2e9e4f}.ponto.parado{background:#8a8a90}
.ponto.erro{background:#d13b3b}.ponto.velho{background:#d19a1e}
.cartao dl { margin:0; display:grid; grid-template-columns:auto 1fr; gap:.15rem .5rem; }
.cartao dt { color:var(--fraco); }
.cartao dd { margin:0; text-align:right; }
.nota { margin:.5rem 0 0; color:var(--fraco); font-size:.85rem; }
form.sair { margin-left:auto; }
button { font:inherit; padding:.35rem .7rem; border-radius:6px;
  border:1px solid var(--borda); background:var(--fundo); color:inherit; cursor:pointer; }
@media (max-width:520px) { .grade { grid-template-columns:1fr; } }
.acoes { display:flex; gap:.4rem; flex-wrap:wrap; margin-top:.5rem; }
.acao { display:inline; }
.acao button { padding:.25rem .5rem; font-size:.8rem; }
.perigo button { border-color:#d13b3b66; color:#d13b3b; }

/* Tela de login: cartao unico e centrado. Ela nao usa o layout() porque nao
   tem menu nem botao de sair — mas usa este mesmo bloco de estilo, senao
   aparece como HTML cru, que foi como ela nasceu. */
.entrada { min-height:100vh; display:grid; place-items:center; padding:1rem; }
.entrada form { background:var(--cartao); border:1px solid var(--borda);
  border-radius:10px; padding:1.5rem; width:100%; max-width:320px;
  display:flex; flex-direction:column; gap:.75rem; }
.entrada h1 { margin:0 0 .25rem; font-size:1.15rem; }
.entrada label { display:flex; flex-direction:column; gap:.25rem;
  font-size:.85rem; color:var(--fraco); }
.entrada input { font:inherit; color:inherit; padding:.5rem .6rem;
  border:1px solid var(--borda); border-radius:6px; background:var(--fundo); }
.entrada button { margin-top:.25rem; padding:.55rem; }
.erro { margin:0; padding:.5rem .6rem; border-radius:6px; font-size:.85rem;
  background:#d13b3b22; border:1px solid #d13b3b66; }
table { border-collapse:collapse; width:100%; background:var(--cartao);
  border:1px solid var(--borda); border-radius:10px; }
th,td { text-align:left; padding:.5rem .65rem; border-bottom:1px solid var(--borda); }
th { color:var(--fraco); font-weight:600; }
tr:last-child td { border-bottom:0; }
small { color:var(--fraco); }
`;

// Poder minimo, na mesma escala da tabela papeis (admin=100, casa=10) --
// nao o nome do papel. E a mesma mecanica que FILTRO (db/inventario.ts) e
// exigirPapel (auth/middleware.ts) usam, entao um papel novo com poder alto
// abre a rota em exigirPapel E aparece no menu, sem exigir mexer aqui.
type ItemMenu = { href: string; rotulo: string; poderMinimo: number };

const MENU: ItemMenu[] = [
  { href: "/", rotulo: "Inicio", poderMinimo: 10 },
  { href: "/infraestrutura", rotulo: "Infraestrutura", poderMinimo: 100 },
];

export function layout(o: {
  titulo: string;
  poder: number;
  atual: string;
  corpoHtml: string; // HTML pronto (cada pagina monta seu conteudo com escapar)
}): string {
  const itens = MENU
    .filter((i) => o.poder >= i.poderMinimo)
    .map((i) => `<a href="${i.href}"${i.href === o.atual ? ' aria-current="page"' : ""}>${escapar(i.rotulo)}</a>`)
    .join("");

  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(o.titulo)} — Portal da Casa</title>
<style>${ESTILO}</style>
<header>${itens}<form class="sair" method="post" action="/sair"><button>Sair</button></form></header>
<main>${o.corpoHtml}</main></html>`;
}
