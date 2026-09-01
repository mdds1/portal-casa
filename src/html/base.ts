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
   isso a tipografia trabalha em dois registros — sem-serifa para o que se le,
   monoespacado para o que se compara. Numero embaixo de numero, alinhado a
   direita, e o que deixa a pagina varrivel de relance.

   A regua pontilhada que liga rotulo e valor e a assinatura da casa: quando a
   distancia entre os dois cresce, o olho continua achando o par.

   Tema claro fixo, por pedido: seguir o tema do sistema deixava o painel
   escuro na maquina do dono. Para voltar a seguir o sistema, basta reintroduzir
   um bloco prefers-color-scheme com os mesmos nomes de variavel.
   ========================================================================= */
:root {
  color-scheme: light;
  --fundo:#fafafb;
  --cartao:#ffffff;
  --borda:#e6e7ea;
  --borda-forte:#d3d5da;
  --texto:#16181d;
  --fraco:#6b7280;
  --acento:#1f6f6b;
  --acento-fraco:#eaf3f2;
  /* Estado nao e semaforo: parado nao e defeito, e escolha. So o que esta
     mesmo errado fica vermelho. */
  --no-ar:#17795e;
  --parado:#9aa0a6;
  --erro:#b3261e;
  --alerta:#8a6100;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --raio:8px;
}
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body {
  margin:0; background:var(--fundo); color:var(--texto);
  font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  letter-spacing:-.005em;
}

/* ---- Cabecalho: uma regua fina, nao uma barra pesada -------------------- */
header {
  display:flex; align-items:center; gap:.25rem; flex-wrap:wrap;
  padding:.6rem 1.25rem; background:var(--cartao);
  border-bottom:1px solid var(--borda); position:sticky; top:0; z-index:5;
}
header a {
  color:var(--fraco); text-decoration:none; padding:.35rem .65rem;
  border-radius:6px; font-size:.9rem;
}
header a:hover { color:var(--texto); background:var(--fundo); }
header a[aria-current="page"] { color:var(--texto); font-weight:600; background:var(--acento-fraco); }
header a:focus-visible, button:focus-visible, summary:focus-visible {
  outline:2px solid var(--acento); outline-offset:2px;
}
.sair { margin-left:auto; }
.sair button { color:var(--fraco); }

main { padding:1.75rem 1.25rem 3rem; max-width:1080px; margin:0 auto; }
h1 {
  margin:0 0 .2rem; font-size:1.55rem; font-weight:650; letter-spacing:-.02em;
}
main > .nota { margin:0 0 1.5rem; color:var(--fraco); font-size:.9rem; }
a { color:var(--acento); text-decoration:none; }
a:hover { text-decoration:underline; text-underline-offset:2px; }

/* ---- Botoes: contorno fino, sem preenchimento. A acao e o texto --------- */
button {
  font:inherit; font-size:.82rem; color:var(--texto); background:var(--cartao);
  border:1px solid var(--borda-forte); border-radius:6px;
  padding:.3rem .7rem; cursor:pointer; transition:background .12s,border-color .12s;
}
button:hover { background:var(--fundo); border-color:var(--fraco); }
button:active { background:var(--borda); }
.perigo button { color:var(--erro); border-color:#e8c9c6; }
.perigo button:hover { background:#fdf3f2; border-color:var(--erro); }
.acoes { display:flex; gap:.4rem; flex-wrap:wrap; }
.acao { display:inline; margin:0; }

/* ---- Ponto de estado ---------------------------------------------------- */
.ponto {
  width:7px; height:7px; border-radius:50%; display:inline-block;
  background:var(--parado); flex:none;
}
.ponto.ok { background:var(--no-ar); }
.ponto.parado { background:var(--parado); }
.ponto.erro { background:var(--erro); }
.ponto.velho { background:var(--alerta); }

/* ---- Cartoes (Inicio): a regua pontilhada ------------------------------- */
.grade { display:grid; gap:1rem; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); }
.cartao {
  background:var(--cartao); border:1px solid var(--borda);
  border-radius:var(--raio); padding:1.1rem 1.15rem 1.15rem;
}
.cartao h3 {
  margin:0 0 .9rem; font-size:.78rem; font-weight:650; text-transform:uppercase;
  letter-spacing:.08em; color:var(--fraco);
  display:flex; align-items:center; gap:.5rem;
}
.cartao dl { margin:0; display:grid; gap:.05rem; }
.cartao div.par {
  display:flex; align-items:baseline; gap:.4rem; padding:.28rem 0;
}
.cartao dt { color:var(--fraco); font-size:.9rem; white-space:nowrap; }
.cartao .fio {
  flex:1; border-bottom:1px dotted var(--borda-forte); transform:translateY(-.2em);
  min-width:1rem;
}
.cartao dd {
  margin:0; font-family:var(--mono); font-size:.84rem;
  font-variant-numeric:tabular-nums; white-space:nowrap; text-align:right;
}
.cartao .nota { margin:.9rem 0 0; color:var(--fraco); font-size:.78rem; }

/* ---- Mapa --------------------------------------------------------------- */
.mapa { display:grid; gap:.9rem; }
.secao { background:var(--cartao); border:1px solid var(--borda); border-radius:var(--raio); }
.secao > summary {
  cursor:pointer; list-style:none; padding:.85rem 1.1rem;
  display:flex; align-items:center; gap:.6rem;
  font-size:.78rem; font-weight:650; text-transform:uppercase; letter-spacing:.08em;
  border-radius:var(--raio);
}
.secao > summary::-webkit-details-marker { display:none; }
.secao > summary::before {
  content:""; width:5px; height:5px; border-right:1.5px solid var(--fraco);
  border-bottom:1.5px solid var(--fraco); transform:rotate(-45deg);
  transition:transform .15s; flex:none;
}
.secao[open] > summary::before { transform:rotate(45deg); }
.secao[open] > summary { border-bottom:1px solid var(--borda); border-radius:var(--raio) var(--raio) 0 0; }
.conta {
  margin-left:auto; font-weight:400; letter-spacing:0; text-transform:none;
  font-family:var(--mono); font-size:.78rem; color:var(--fraco);
  font-variant-numeric:tabular-nums;
}
.grupo { padding:.9rem 1.1rem 1rem; }
.grupo + .grupo { border-top:1px solid var(--borda); }
.grupo > h3 {
  margin:0 0 .55rem; font-size:.7rem; font-weight:650; text-transform:uppercase;
  letter-spacing:.09em; color:var(--fraco);
}
.itens { list-style:none; margin:0; padding:0; display:grid; gap:.1rem; }
.item {
  display:grid; gap:.05rem .85rem; align-items:baseline; padding:.45rem .55rem;
  border-radius:6px; margin:0 -.55rem;
  grid-template-columns:auto minmax(8rem,auto) 1fr auto auto;
  grid-template-areas:"ponto nome fio endereco maquina" ". nota nota nota nota";
}
.item:hover { background:var(--fundo); }
.item .ponto { grid-area:ponto; transform:translateY(-1px); }
.item .nome { grid-area:nome; font-weight:550; }
.item .fio { grid-area:fio; border-bottom:1px dotted var(--borda-forte); transform:translateY(-.25em); }
.item .endereco {
  grid-area:endereco; font-family:var(--mono); font-size:.8rem;
  color:var(--fraco); font-variant-numeric:tabular-nums;
}
.item .maquina {
  grid-area:maquina; font-family:var(--mono); font-size:.72rem; color:var(--fraco);
  background:var(--fundo); border:1px solid var(--borda);
  border-radius:999px; padding:.08rem .5rem; white-space:nowrap;
}
.item .nota { grid-area:nota; font-size:.8rem; color:var(--fraco); padding-top:.1rem; }
.maquinas { display:grid; gap:.5rem; padding:0 1.1rem 1rem; }
.hospede {
  display:flex; align-items:center; gap:.6rem; flex-wrap:wrap;
  padding:.55rem .75rem; background:var(--fundo);
  border:1px solid var(--borda); border-radius:6px;
}
.hospede .quem { font-family:var(--mono); font-size:.78rem; color:var(--fraco); }
.hospede .acoes { margin-left:auto; }

/* ---- Tabela (Infraestrutura) -------------------------------------------- */
table {
  border-collapse:collapse; width:100%; background:var(--cartao);
  border:1px solid var(--borda); border-radius:var(--raio); overflow:hidden;
  font-size:.9rem;
}
th, td { text-align:left; padding:.6rem .8rem; border-bottom:1px solid var(--borda); }
th {
  font-size:.7rem; font-weight:650; text-transform:uppercase; letter-spacing:.08em;
  color:var(--fraco); background:var(--fundo); white-space:nowrap;
}
tbody tr:last-child td { border-bottom:0; }
tbody tr:hover { background:var(--fundo); }
td small { color:var(--fraco); }
td:nth-child(1), td:nth-child(4), td:nth-child(5) {
  font-family:var(--mono); font-size:.82rem; font-variant-numeric:tabular-nums;
}

/* ---- Faixa de aviso ----------------------------------------------------- */
.faixa {
  margin:0 0 1.25rem; padding:.7rem .9rem; border-radius:6px; font-size:.9rem;
  border:1px solid var(--borda);
}
.faixa.boa { background:var(--acento-fraco); border-color:#cfe4e1; color:#12564f; }
.faixa.ruim { background:#fdf3f2; border-color:#e8c9c6; color:#8c1d17; }

/* ---- Entrada ------------------------------------------------------------ */
.entrada { min-height:100vh; display:grid; place-items:center; padding:1rem; }
.entrada form {
  background:var(--cartao); border:1px solid var(--borda); border-radius:var(--raio);
  padding:1.75rem; width:min(22rem,100%); display:grid; gap:.75rem;
}
.entrada h1 { font-size:1.15rem; margin-bottom:.5rem; }
.entrada label { font-size:.85rem; color:var(--fraco); display:grid; gap:.3rem; }
.entrada input {
  font:inherit; padding:.55rem .7rem; border:1px solid var(--borda-forte);
  border-radius:6px; background:var(--cartao); color:var(--texto); width:100%;
}
.entrada input:focus-visible { outline:2px solid var(--acento); outline-offset:1px; border-color:var(--acento); }
.entrada button { padding:.55rem; font-size:.9rem; background:var(--acento); color:#fff; border-color:var(--acento); }
.entrada button:hover { background:#1a5f5b; border-color:#1a5f5b; }
.entrada .erro { color:var(--erro); font-size:.85rem; margin:0; }

@media (max-width:720px) {
  main { padding:1.25rem .9rem 2.5rem; }
  .grade { grid-template-columns:1fr; }
  .item {
    grid-template-columns:auto 1fr auto;
    grid-template-areas:"ponto nome endereco" ". maquina maquina" ". nota nota";
  }
  .item .fio { display:none; }
  .item .maquina { justify-self:start; margin-top:.15rem; }
  .hospede .acoes { margin-left:0; width:100%; }
}

/* ---- Administracao ------------------------------------------------------
   Tabela de edicao, nao de leitura: cada linha carrega formularios. O ritmo
   e mais apertado que o dos cartoes de propósito — aqui se compara e se
   altera, nao se contempla. */
.bloco { margin: 0 0 2.5rem; }
.bloco h3 { margin: 0 0 .25rem; font-size: 1rem; letter-spacing: .01em; }
.bloco > .fraco { margin: 0 0 .9rem; max-width: 62ch; font-size: .875rem; }

table.admin { width: 100%; border-collapse: collapse; }
table.admin th {
  font-size: .7rem; text-transform: uppercase; letter-spacing: .1em;
  color: var(--fraco); font-weight: 400; text-align: left;
  padding: 0 .75rem .5rem 0; border-bottom: 1px solid var(--borda);
}
table.admin td {
  padding: .7rem .75rem .7rem 0; border-bottom: 1px solid var(--borda);
  vertical-align: middle;
}
table.admin td:last-child, table.admin th:last-child { padding-right: 0; }
table.admin form { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; margin: 0; }

.admin input[type=text], .admin input[type=password], .admin input:not([type]), .admin select,
form.criar input, form.criar select {
  font: inherit; font-size: .85rem; padding: .3rem .5rem;
  border: 1px solid var(--borda); border-radius: 4px;
  background: var(--fundo); color: var(--texto); min-width: 0;
}
.admin input:focus-visible, .admin select:focus-visible,
form.criar input:focus-visible, form.criar select:focus-visible {
  outline: 2px solid var(--acento); outline-offset: 1px;
}
.emlinha input[name=descricao] { flex: 1 1 14rem; }
.emlinha label { font-size: .8rem; color: var(--fraco); display: flex; gap: .3rem; align-items: center; }

form.criar {
  display: flex; gap: .4rem; flex-wrap: wrap; align-items: center;
  margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed var(--borda);
}

/* Marca a propria linha de quem esta logado: as recusas de "contra si mesmo"
   so fazem sentido para quem sabe qual linha e a sua. */
.marca {
  font-size: .65rem; text-transform: uppercase; letter-spacing: .08em;
  color: var(--acento); border: 1px solid currentColor;
  border-radius: 3px; padding: .05rem .3rem; vertical-align: middle;
}

/* O motivo de uma recusa vai no topo da pagina, nao ao lado do campo: a
   pagina inteira e reconstruida no 422, e o olho volta para o comeco. */
.aviso {
  margin: 0 0 1.5rem; padding: .7rem .9rem;
  border-left: 3px solid var(--erro); background: var(--fundo);
  border-radius: 0 4px 4px 0; font-size: .9rem;
}

.ok { color: var(--no-ar); }
.falhou { color: var(--erro); }

@media (max-width: 640px) {
  table.admin, table.admin tbody, table.admin tr, table.admin td { display: block; width: 100%; }
  table.admin thead { display: none; }
  table.admin tr { padding: .6rem 0; border-bottom: 1px solid var(--borda); }
  table.admin td { border: 0; padding: .25rem 0; }
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
<style>${ESTILO}</style>
<header>${itens}<form class="sair" method="post" action="/sair"><button>Sair</button></form></header>
<main>${o.corpoHtml}</main></html>
`;
}
