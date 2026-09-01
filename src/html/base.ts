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

// A acao acontece num POST e termina num redirect: sem isto, "desligou" e
// "nao desligou" chegam ao operador exatamente iguais -- a mesma pagina, em
// silencio. O par (acao, alvo) vem da query, ou seja, e entrada do usuario:
// passa por escapar como qualquer outra saida.
export function faixaDeAviso(acao: unknown, alvo: unknown): string {
  const nome = alvo === undefined || alvo === null ? "" : String(alvo);
  const onde = nome ? ` em <strong>${escapar(nome)}</strong>` : "";
  if (acao === "falha")
    return `<p class="faixa ruim">A acao${onde} <strong>falhou</strong>.
      Nada garante que a maquina mudou de estado — confira o registro de acoes.</p>`;
  if (acao === "ok")
    return `<p class="faixa boa">Acao${onde} enviada com sucesso.</p>`;
  return "";
}

export const ESTILO = `
/* =========================================================================
   Portal da Casa — folha unica.

   O conteudo desta casa e DADO: portas, tempos, percentuais, enderecos. Por
   isso a tipografia trabalha em dois registros — Plus Jakarta Sans para o que
   se le, JetBrains Mono para o que se compara. Numero embaixo de numero,
   alinhado a direita, e o que deixa a pagina varrivel de relance.

   O vidro so existe se houver algo atras dele. Um painel translucido sobre
   branco chapado nao e vidro: e branco. Por isso o fundo carrega dois campos
   de luz desfocados — e o unico enfeite da folha, e ele e estrutural.
   ========================================================================= */

:root {
  --tinta:      #0f1729;
  --fraco:      #5b6478;
  --tenue:      #8b93a5;
  --acento:     #2563c9;
  --acento-luz: #e8f0fd;
  --ar:         #edf1f8;
  --vidro:      rgba(255,255,255,.62);
  --vidro-alto: rgba(255,255,255,.78);
  --risco:      rgba(15,23,41,.09);
  --brilho:     rgba(255,255,255,.75);
  --no-ar:      #0e7c5a;
  --parado:     #8b93a5;
  --erro:       #c0362c;
  --alerta:     #a1660f;
  --sombra:     0 1px 2px rgba(15,23,41,.04), 0 8px 24px rgba(15,23,41,.06);
  --curva:      14px;
  --sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  color-scheme: light;
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.6;
  color: var(--tinta);
  background: var(--ar);
  -webkit-font-smoothing: antialiased;
}

/* Os campos de luz. Ficam presos ao viewport para nao rolarem com a pagina —
   vidro que acompanha o conteudo denuncia o truque. */
body::before {
  content: "";
  position: fixed;
  inset: -20vmax;
  z-index: -1;
  background:
    radial-gradient(38vmax 38vmax at 18% 8%,  rgba(90,140,230,.30), transparent 62%),
    radial-gradient(34vmax 34vmax at 88% 22%, rgba(232,168,182,.26), transparent 60%),
    radial-gradient(42vmax 42vmax at 62% 96%, rgba(120,196,208,.20), transparent 64%);
  filter: blur(28px);
  pointer-events: none;
}

/* ---- a pilula do menu -------------------------------------------------- */

header {
  position: sticky;
  top: 14px;
  z-index: 20;
  width: min(1080px, calc(100% - 32px));
  margin: 14px auto 0;
  padding: 7px 8px 7px 14px;
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 999px;
  background: var(--vidro-alto);
  border: 1px solid var(--brilho);
  box-shadow: var(--sombra);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
}

header a {
  padding: .42rem .8rem;
  border-radius: 999px;
  color: var(--fraco);
  text-decoration: none;
  font-size: .875rem;
  font-weight: 500;
  white-space: nowrap;
}
header a:hover { color: var(--tinta); background: rgba(15,23,41,.045); }
header a[aria-current="page"] { color: var(--acento); background: var(--acento-luz); }

header .sair { margin-left: auto; }
header .sair button {
  border: 0; background: none; color: var(--tenue);
  font: inherit; font-size: .82rem; cursor: pointer;
  padding: .42rem .8rem; border-radius: 999px;
}
header .sair button:hover { color: var(--erro); background: rgba(192,54,44,.08); }

main {
  width: min(1080px, calc(100% - 32px));
  margin: 0 auto;
  padding: 2rem 0 5rem;
}

/* ---- tipografia -------------------------------------------------------- */

h1, h2 {
  font-weight: 700;
  letter-spacing: -.022em;
  margin: 0 0 .35rem;
  text-wrap: balance;
}
h1 { font-size: 1.7rem; }
h2 { font-size: 1.45rem; }
h3 {
  font-weight: 600; font-size: .95rem;
  letter-spacing: -.008em; margin: 0 0 .6rem;
}
p { margin: 0 0 .9rem; max-width: 66ch; }
a { color: var(--acento); }
strong { font-weight: 600; }

.fraco  { color: var(--fraco); }
.nota   { color: var(--fraco); font-size: .82rem; margin: .7rem 0 0; }
.ok     { color: var(--no-ar); font-weight: 500; }
.falhou { color: var(--erro); font-weight: 500; }
.boa    { color: var(--no-ar); }
.ruim   { color: var(--erro); }

/* ---- cartoes de vidro -------------------------------------------------- */

.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
  margin: 0 0 1.6rem;
}

.cartao {
  background: var(--vidro);
  border: 1px solid var(--brilho);
  border-radius: var(--curva);
  padding: 1.1rem 1.2rem;
  box-shadow: var(--sombra);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  display: flex;
  flex-direction: column;
}

.cartao h3 { display: flex; align-items: center; gap: .5rem; }
.cartao dl { margin: 0; }

/* O ponto de estado ganha um halo quando esta no ar: diz "vivo" sem animar. */
.ponto {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--parado); flex: none;
}
.ponto.ok     { background: var(--no-ar); box-shadow: 0 0 0 3px rgba(14,124,90,.16); }
.ponto.parado { background: var(--parado); }
.ponto.erro   { background: var(--erro);   box-shadow: 0 0 0 3px rgba(192,54,44,.14); }
.ponto.velho  { background: var(--alerta); box-shadow: 0 0 0 3px rgba(161,102,15,.14); }

/* O pontilhado entre rotulo e valor: sem ele, rotulo curto e valor longo ficam
   orfaos nas pontas da linha e o olho perde o par. */
.par {
  display: flex; align-items: baseline; gap: .5rem;
  padding: .3rem 0; font-size: .875rem;
}
.par dt { color: var(--fraco); flex: none; }
.par dd { margin: 0; font-family: var(--mono); font-size: .82rem; font-variant-numeric: tabular-nums; }
.fio {
  flex: 1 1 auto; min-width: 1rem; height: 0;
  border-bottom: 1px dotted var(--risco); transform: translateY(-.22em);
}

/* ---- botoes ------------------------------------------------------------ */

button, .acao {
  font: inherit; font-size: .8rem; font-weight: 500;
  padding: .4rem .85rem;
  border: 1px solid var(--risco);
  border-radius: 8px;
  background: var(--vidro-alto);
  color: var(--tinta);
  cursor: pointer;
  text-decoration: none;
  display: inline-block;
  white-space: nowrap;
}
button:hover, .acao:hover { border-color: var(--acento); color: var(--acento); }
.acoes { display: flex; gap: .4rem; flex-wrap: wrap; margin-top: .9rem; }
.acoes form { margin: 0; }

.perigo button, .acao.perigo, a.perigo {
  color: var(--erro); border-color: rgba(192,54,44,.3);
}
.perigo button:hover, .acao.perigo:hover { background: rgba(192,54,44,.08); border-color: var(--erro); }

:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }

/* ---- balao de confirmacao ---------------------------------------------
   Sem JavaScript: o link aponta para o id do balao e o :target o revela. A
   trava de verdade continua no servidor, que recusa acao destrutiva sem
   confirmado=1 — o balao e conforto, nao seguranca. */

.balao { display: none; }
.balao:target {
  display: grid;
  place-items: center;
  position: fixed;
  inset: 0;
  z-index: 50;
  padding: 1rem;
  background: rgba(15,23,41,.28);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}
.balao .caixa {
  position: relative;
  width: min(30rem, 100%);
  background: var(--vidro-alto);
  border: 1px solid var(--brilho);
  border-radius: 18px;
  padding: 1.4rem 1.5rem 1.2rem;
  box-shadow: 0 20px 60px rgba(15,23,41,.22);
  backdrop-filter: blur(26px) saturate(1.5);
  -webkit-backdrop-filter: blur(26px) saturate(1.5);
}
.balao h3 { font-size: 1.05rem; margin-bottom: .5rem; }
.balao p { font-size: .9rem; margin-bottom: 1rem; }
.balao .acoes { margin-top: 1.1rem; }
/* A area fora da caixa fecha o balao. Fica ATRAS dela no empilhamento para
   nao capturar o clique dos botoes. */
.balao .fecha {
  position: absolute; inset: 0; z-index: -1;
  display: block; text-indent: -9999px; overflow: hidden;
}

/* ---- faixas e avisos --------------------------------------------------- */

.faixa, .aviso {
  padding: .75rem 1rem;
  border-radius: 10px;
  border: 1px solid var(--brilho);
  background: var(--vidro);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  margin: 0 0 1.4rem;
  font-size: .9rem;
  max-width: none;
}
.faixa.boa  { border-left: 3px solid var(--no-ar); }
.faixa.ruim, .aviso { border-left: 3px solid var(--erro); }

/* ---- Mapa: arvore ------------------------------------------------------ */

.mapa { display: flex; flex-direction: column; gap: 12px; }

.secao {
  background: var(--vidro);
  border: 1px solid var(--brilho);
  border-radius: var(--curva);
  box-shadow: var(--sombra);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  overflow: hidden;
}
.secao > summary {
  cursor: pointer; list-style: none;
  padding: .9rem 1.2rem;
  display: flex; align-items: center; gap: .6rem;
  font-weight: 600; font-size: .95rem;
}
.secao > summary::-webkit-details-marker { display: none; }
.secao > summary::before {
  content: "›"; color: var(--tenue); font-size: 1.1rem;
  transition: transform .15s ease; display: inline-block;
}
.secao[open] > summary::before { transform: rotate(90deg); }
.secao > summary:hover { background: rgba(255,255,255,.4); }
.conta {
  margin-left: auto; font-family: var(--mono);
  font-size: .72rem; color: var(--fraco); font-weight: 400;
}

.grupo { padding: 0 1.2rem .4rem; }
.grupo > h4 {
  margin: .6rem 0 .3rem;
  font-size: .68rem; text-transform: uppercase; letter-spacing: .1em;
  color: var(--tenue); font-weight: 600;
}
.itens { list-style: none; margin: 0; padding: 0; }
.item {
  display: flex; align-items: baseline; gap: .5rem;
  padding: .38rem 0; font-size: .875rem;
  border-bottom: 1px solid rgba(15,23,41,.05);
}
.item:last-child { border-bottom: 0; }
.item .nome { font-weight: 500; flex: none; }
.item .endereco, .item .maquina {
  font-family: var(--mono); font-size: .76rem; color: var(--fraco);
}
.item .endereco { flex: none; }
.item .maquina { margin-left: auto; flex: none; }
.maquinas { padding: .5rem 1.2rem 1rem; }

/* ---- tabelas ----------------------------------------------------------- */

table {
  width: 100%; border-collapse: collapse; font-size: .875rem;
  background: var(--vidro);
  border: 1px solid var(--brilho);
  border-radius: var(--curva);
  overflow: hidden;
  box-shadow: var(--sombra);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
}
th {
  text-align: left; font-weight: 500;
  font-size: .68rem; text-transform: uppercase; letter-spacing: .1em;
  color: var(--tenue);
  padding: .8rem 1rem; border-bottom: 1px solid var(--risco);
  white-space: nowrap;
}
td {
  padding: .8rem 1rem; border-bottom: 1px solid rgba(15,23,41,.055);
  vertical-align: middle;
}
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: rgba(255,255,255,.42); }
td .acao, td button { font-size: .76rem; padding: .3rem .65rem; }

/* ---- Administracao ----------------------------------------------------- */

.bloco { margin: 0 0 2.4rem; }
.bloco > .fraco { font-size: .875rem; margin: 0 0 1rem; }

table.admin form { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; margin: 0; }

input, select {
  font: inherit; font-size: .82rem;
  padding: .38rem .6rem;
  border: 1px solid var(--risco);
  border-radius: 8px;
  background: rgba(255,255,255,.7);
  color: var(--tinta);
  min-width: 0;
}
input::placeholder { color: var(--tenue); }
.emlinha input[name=descricao] { flex: 1 1 14rem; }
.emlinha label {
  font-size: .8rem; color: var(--fraco);
  display: flex; gap: .35rem; align-items: center;
}

form.criar {
  display: flex; gap: .5rem; flex-wrap: wrap; align-items: center;
  margin-top: 1rem; padding-top: 1rem;
  border-top: 1px dashed var(--risco);
}

/* Marca a propria linha de quem esta logado: as recusas de "contra si mesmo"
   so fazem sentido para quem sabe qual linha e a sua. */
.marca {
  font-size: .62rem; text-transform: uppercase; letter-spacing: .09em;
  color: var(--acento); background: var(--acento-luz);
  border-radius: 5px; padding: .1rem .35rem; vertical-align: middle;
  font-weight: 600;
}

/* ---- Inicio: rede e hospedes ------------------------------------------- */

.entrada {
  display: flex; align-items: baseline; gap: .5rem;
  padding: .3rem 0; font-size: .875rem;
}
.entrada .quem { font-weight: 500; }
.hospede { color: var(--fraco); }

/* ---- login ------------------------------------------------------------- */

body.entrar main { max-width: 22rem; padding-top: 12vh; }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}

@media (max-width: 640px) {
  header { top: 8px; margin-top: 8px; padding-left: 8px; overflow-x: auto; }
  main { padding-top: 1.4rem; }
  .grade { grid-template-columns: 1fr; }
  table.admin, table.admin tbody, table.admin tr, table.admin td { display: block; width: 100%; }
  table.admin thead { display: none; }
  table.admin tr { padding: .7rem 1rem; border-bottom: 1px solid var(--risco); }
  table.admin td { border: 0; padding: .25rem 0; }
  .item { flex-wrap: wrap; }
  .item .maquina { margin-left: 0; }
}

`;


// Poder minimo, na mesma escala da tabela papeis (admin=100, casa=10) --
// nao o nome do papel. E a mesma mecanica que FILTRO (db/inventario.ts) e
// exigirPapel (auth/middleware.ts) usam, entao um papel novo com poder alto
// abre a rota em exigirPapel E aparece no menu, sem exigir mexer aqui.
type ItemMenu = { href: string; rotulo: string; poderMinimo: number };

const MENU: ItemMenu[] = [
  { href: "/", rotulo: "Inicio", poderMinimo: 10 },
  { href: "/mapa", rotulo: "Mapa", poderMinimo: 10 },
  { href: "/midia", rotulo: "Midia", poderMinimo: 10 },
  { href: "/infraestrutura", rotulo: "Infraestrutura", poderMinimo: 100 },
  { href: "/administracao", rotulo: "Administracao", poderMinimo: 100 },
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">
<style>${ESTILO}</style>
<header>${itens}<form class="sair" method="post" action="/sair"><button>Sair</button></form></header>
<main>${o.corpoHtml}</main></html>
`;
}
