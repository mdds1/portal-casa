import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash } from "../src/auth/senha.js";
import { criarApp } from "../src/app.js";
import { bom, ruim } from "../src/fontes/tipos.js";
import type { RecursoPve } from "../src/fontes/proxmox.js";
import type { Resultado } from "../src/fontes/tipos.js";
import { cachesDeTeste , chamarHaDeTeste } from "./apoio.js";

const RECURSOS: RecursoPve[] = [
  { tipo: "lxc", vmid: 102, nome: "Docker", estado: "running", cpu: 0, memoria: 0, memoriaMax: 4e9, uptime: 25200 },
  { tipo: "lxc", vmid: 201, nome: "jellyfin", estado: "running", cpu: 0, memoria: 0, memoriaMax: 2e9, uptime: 25200 },
  { tipo: "qemu", vmid: 120, nome: "gamebox-batocera", estado: "stopped", cpu: 0, memoria: 0, memoriaMax: 4e9, uptime: 0 },
  { tipo: "qemu", vmid: 301, nome: "floripaot", estado: "running", cpu: 0, memoria: 0, memoriaMax: 4e9, uptime: 25200 },
  // O CT 104 e omitido de proposito: e a maquina que sumiu do hipervisor.
];

async function servidor(pve: RecursoPve[] | Resultado<RecursoPve[]> = RECURSOS) {
  const db = abrirBanco(":memory:");
  semear(db);
  const inserir = db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)");
  inserir.run("matheus", "Matheus", gerarHash("s1"), "admin");
  inserir.run("marcella", "Marcella", gerarHash("s2"), "casa");
  const app = criarApp({
    db, segredoSessao: "teste",
    exec: async () => bom("running"),
    chamarHa: chamarHaDeTeste,
    caches: cachesDeTeste(pve),
  });
  const s = app.listen(0);
  const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  const entrar = async (login: string, senha: string) => {
    const r = await fetch(`${base}/entrar`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ login, senha }).toString(),
      redirect: "manual",
    });
    return (r.headers.get("set-cookie") ?? "").split(";")[0]!;
  };
  return { db, s, base, entrar };
}

// Recorta o bloco de uma categoria inteira, para afirmar CONTENCAO — que um
// item esta DENTRO do galho certo — em vez de so perguntar se ele aparece em
// algum lugar da pagina, que passaria com a arvore toda embaralhada.
function categoria(html: string, nome: string): string {
  const inicio = html.search(
    new RegExp(`<details class="secao" open>\\s*<summary>${nome}[<\\s]`)
  );
  assert.ok(inicio >= 0, `categoria ${nome} nao encontrada`);
  // A arvore tem <details> dentro de <details>, entao parar no primeiro
  // </details> recortaria so o comeco da secao — e as afirmacoes de
  // CONTENCAO passariam sem ter olhado o galho inteiro. Conta a profundidade.
  let nivel = 0;
  const marcas = /<details\b|<\/details>/g;
  marcas.lastIndex = inicio;
  for (let m = marcas.exec(html); m; m = marcas.exec(html)) {
    nivel += m[0] === "</details>" ? -1 : 1;
    if (nivel === 0) return html.slice(inicio, m.index + m[0].length);
  }
  assert.fail(`categoria ${nome} nao fecha`);
}

test("cada servico aparece dentro da sua categoria, nao so em algum lugar da pagina", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();

    assert.match(categoria(html, "Jogos"), /Dofus login/);
    assert.match(categoria(html, "Jogos"), /Jogo FloripaOT/);
    assert.match(categoria(html, "Midia"), /Jellyfin/);
    assert.match(categoria(html, "Midia"), /Radarr/);
    // E o inverso: o que e de Midia nao pode estar em Jogos.
    assert.doesNotMatch(categoria(html, "Jogos"), /Radarr/);
    assert.doesNotMatch(categoria(html, "Midia"), /Dofus login/);
  } finally { s.close(); }
});

test("os containers do Docker aparecem, com a maquina que os hospeda", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();
    for (const nome of ["Radarr", "Sonarr", "Prowlarr", "Bazarr", "qBittorrent", "Seerr", "FlareSolverr", "RomM"])
      assert.match(html, new RegExp(nome), `${nome} deveria aparecer no mapa`);
    // Cada um mora no CT 102, e o mapa tem que dizer isso.
    const itens = html.match(/<li class="item">[\s\S]*?<\/li>/g) ?? [];
    const radarr = itens.find((f) => f.includes("Radarr"));
    assert.ok(radarr, "item do Radarr nao encontrado");
    assert.match(radarr!, /CT 102/, "o item do Radarr tem que dizer onde ele mora");
  } finally { s.close(); }
});

test("a Marcella nao ve os servicos de admin", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("marcella", "s2");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();
    assert.match(html, /Jellyfin/, "o Jellyfin e dela");
    assert.match(html, /Home Assistant/, "o Home Assistant e dela");
    for (const oculto of ["Radarr", "Sonarr", "qBittorrent", "Proxmox", "nginx do portal", "Jogo FloripaOT"])
      assert.doesNotMatch(html, new RegExp(oculto), `${oculto} e de admin, nao pode vazar`);
  } finally { s.close(); }
});

test("o estado da maquina que hospeda aparece no item", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();
    const itens = html.match(/<li class="item">[\s\S]*?<\/li>/g) ?? [];
    const jellyfin = itens.find((f) => f.includes("Jellyfin"));
    const batocera = itens.find((f) => f.includes("Batocera"));
    assert.match(jellyfin!, /ponto ok/, "o CT 201 esta running, o ponto tem que ser verde");
    assert.match(batocera!, /ponto parado/, "a VM 120 esta stopped");
  } finally { s.close(); }
});

test("url de esquema perigoso nao vira link", async () => {
  const { db, s, base, entrar } = await servidor();
  try {
    db.prepare("UPDATE servicos SET url = ? WHERE nome = ?")
      .run("javascript:alert(1)", "Radarr");
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();
    assert.doesNotMatch(html, /javascript:/, "esquema perigoso nao pode chegar ao HTML");
    assert.match(html, /Radarr/, "o servico continua listado, so sem link");
  } finally { s.close(); }
});

test("cada categoria traz os botoes das maquinas que a hospedam, e eles voltam ao Mapa", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();

    // Jogos e hospedada pelo CT 104, CT 102 e VM 301: tem que haver botao para
    // as acionaveis, DENTRO da secao de Jogos.
    const jogos = categoria(html, "Jogos");
    assert.match(jogos, /name="alvo" value="301"/, "a VM do FloripaOT hospeda o Tibia");
    // O CT 104 hospeda o Dofus e e acionavel, mas sumiu do Proxmox: nao ha
    // acao a oferecer, e a linha nem aparece na lista de maquinas do grupo.
    assert.doesNotMatch(jogos, /name="alvo" value="104"/, "maquina ausente nao ganha botao");

    // Todo formulario do Mapa volta para o Mapa, senao a acao joga a pessoa
    // para outra tela sem explicacao.
    const forms = html.match(/<form[^>]*action="\/acao"[\s\S]*?<\/form>/g) ?? [];
    assert.ok(forms.length > 0, "deveria haver botoes de acao no mapa");
    for (const f of forms) {
      assert.match(f, /name="csrf"/, "formulario sem csrf");
      assert.match(f, /name="voltar" value="mapa"/, "o botao do Mapa tem que voltar ao Mapa");
    }
  } finally { s.close(); }
});

test("a Marcella nao recebe botao de maquina que nao pode acionar", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("marcella", "s2");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();
    // A VM 301 e de admin: nem o servico nem o botao dela podem aparecer.
    assert.doesNotMatch(html, /name="alvo" value="301"/, "o servidor de jogo nao e dela");
    assert.doesNotMatch(html, /name="alvo" value="host"/, "o host nunca aparece no mapa");
  } finally { s.close(); }
});

test("as secoes sao dobraveis sem script", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();
    assert.match(html, /<details class="secao" open>/, "cada categoria e um <details>");
    assert.match(html, /<summary>/, "com um <summary> que abre e fecha");
    assert.doesNotMatch(html, /<script/, "o Mapa nao usa script nenhum");
    // O contador do cabecalho diz quantos estao no ar.
    assert.match(html, /class="conta">\d+ de \d+ no ar</, "cada secao mostra quantos estao no ar");
  } finally { s.close(); }
});

test("o recortador de categoria enxerga a secao inteira, nao so ate o primeiro </details>", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();
    const midia = categoria(html, "Midia");
    // O grupo Arquivos e o ultimo de Midia: se o recorte parasse cedo, ele
    // ficaria de fora e o teste de contencao viraria enfeite.
    assert.match(midia, /Drive/, "o recorte tem que alcancar o fim da secao");
    assert.match(midia, /<summary>Maquinas/, "e o grupo de maquinas, que vem depois de tudo");
  } finally { s.close(); }
});

test("maquina parada so oferece Ligar; no ar, so Desligar e Reiniciar", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();

    // Recorta os campos escondidos de cada formulario que mira uma maquina.
    const verbosDe = (vmid: number) => {
      const re = new RegExp(`value="${vmid}">\\s*<input type="hidden" name="verbo" value="(\\w+)"`, "g");
      return new Set([...html.matchAll(re)].map((m) => m[1]));
    };

    // O CT 201 esta running no fixture.
    assert.deepEqual(verbosDe(201), new Set(["shutdown", "reboot"]),
      "uma maquina no ar nao tem o que ligar");
    // A VM 120 esta stopped.
    assert.deepEqual(verbosDe(120), new Set(["start"]),
      "uma maquina parada nao tem o que desligar nem reiniciar");
    // O CT 104 nao aparece no fixture: a leitura foi boa e nao trouxe ele,
    // logo a maquina sumiu do hipervisor e nao ha acao possivel.
    assert.deepEqual(verbosDe(104), new Set(),
      "maquina que sumiu do Proxmox nao oferece acao nenhuma");
  } finally { s.close(); }
});

test("quando a leitura do Proxmox falha, todos os verbos voltam a ser oferecidos", async () => {
  // O oposto do teste acima, e a razao de a distincao existir: sem dado
  // nenhum nao da para saber se a maquina sumiu ou se so nao conseguimos
  // perguntar. Ai esconder botao seria pior que oferecer os tres.
  const { s, base, entrar } = await servidor(ruim("Proxmox fora do ar"));
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/infraestrutura", { headers: { cookie: c } })).text();
    const re = new RegExp(`value="301">\\s*<input type="hidden" name="verbo" value="(\\w+)"`, "g");
    assert.deepEqual(new Set([...html.matchAll(re)].map((m) => m[1])),
      new Set(["start", "shutdown", "reboot"]));
  } finally { s.close(); }
});

test("cada linha da arvore comeca fechada, mostrando so ponto e nome", async () => {
  const { s, base, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/mapa", { headers: { cookie: c } })).text();
    assert.doesNotMatch(html, /<details class="linha" open>/, "linha nenhuma nasce aberta");
    assert.match(html, /<details class="grupo" open>/, "os grupos, sim, nascem abertos");
    const itens = html.match(/<li class="item">[\s\S]*?<\/li>/g) ?? [];
    const radarr = itens.find((f) => f.includes("Radarr"))!;
    // A descricao mora no detalhe, nao no cabecalho da linha.
    const cabeca = radarr.slice(0, radarr.indexOf("</summary>"));
    // A url continua no href do nome — e o que torna o nome clicavel. O que
    // nao pode estar no cabecalho e o texto do detalhe.
    assert.doesNotMatch(cabeca, /procura e organiza/, "a descricao so aparece para quem abriu a linha");
    assert.doesNotMatch(cabeca, /class="endereco"/, "o endereco tambem mora no detalhe");
  } finally { s.close(); }
});
