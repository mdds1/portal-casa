import type { RequestHandler } from "express";
import type Database from "better-sqlite3";
import type { Cache } from "../cache.js";
import type { RecursoPve } from "../fontes/proxmox.js";
import { listarArvore, listarMaquinas, poderDoPapel, type Maquina, type Servico } from "../db/inventario.js";
import { layout, escapar, faixaDeAviso } from "../html/base.js";
import { botoesDaMaquina } from "./infraestrutura.js";
import { tokenCsrf } from "../auth/csrf.js";

export type DepsMapa = {
  db: Database.Database;
  caches: { pve: Cache<RecursoPve[]> };
  segredoSessao: string;
};

// Aceita so http/https. Um "javascript:" nao tem aspas nem sinais de menor,
// entao atravessaria o escapar() intacto e executaria ao ser clicado.
function link(url: string | null, texto: string): string {
  if (!url) return escapar(texto);
  try {
    const e = new URL(url).protocol;
    if (e !== "http:" && e !== "https:") return escapar(texto);
  } catch {
    return escapar(texto);
  }
  return `<a href="${escapar(url)}">${escapar(texto)}</a>`;
}

// Agrupa a lista ja ordenada pelo SQL em categoria > grupo, preservando a
// ordem. Sequencial: nao varre a lista uma vez por galho.
function agrupar(itens: Servico[]): [string, [string, Servico[]][]][] {
  const fora: [string, [string, Servico[]][]][] = [];
  for (const s of itens) {
    let cat = fora[fora.length - 1];
    if (!cat || cat[0] !== s.categoria) fora.push((cat = [s.categoria, []]));
    let gru = cat[1][cat[1].length - 1];
    if (!gru || gru[0] !== s.grupo) cat[1].push((gru = [s.grupo, []]));
    gru[1].push(s);
  }
  return fora;
}

export function rotaMapa(deps: DepsMapa): RequestHandler {
  return async (req, res) => {
    const papel = req.sessao!.papel;
    const poder = poderDoPapel(deps.db, papel);
    const itens = listarArvore(deps.db, papel);
    const maquinas = listarMaquinas(deps.db, papel);
    const pve = await deps.caches.pve.obter();
    const csrf = tokenCsrf(req.sessao!.id, deps.segredoSessao);

    const estadoDe = (vmid: number) =>
      pve.dado?.find((x) => x.vmid === vmid)?.estado ?? "desconhecido";
    const classePonto = (e: string) => (e === "running" ? "ok" : e === "desconhecido" ? "erro" : "parado");
    // O estado cru do Proxmox e ingles e tecnico. Na arvore, quem le quer
    // saber se a coisa esta de pe, nao o vocabulario do hipervisor.
    const emPortugues = (e: string) =>
      e === "running" ? "no ar" : e === "stopped" ? "parada" : e;

    // Cada linha da arvore e um <details> fechado: de fora aparece so o ponto
    // de estado e o nome, que e o que a pessoa procura ao varrer a tela. O
    // endereco, a maquina e a descricao so aparecem para quem abriu aquela
    // linha — era essa pilha de detalhe repetida em toda linha que enchia a
    // secao.
    const linha = (
      classes: string,
      estado: string,
      cabeca: string,
      detalhe: string
    ) => `<li class="item${classes ? " " + classes : ""}">
<details class="linha">
<summary><span class="ponto ${classePonto(estado)}"></span>${cabeca}</summary>
<div class="detalhe">${detalhe}</div>
</details>
</li>`;

    const secoes = agrupar(itens)
      .map(([categoria, grupos]) => {
        const quantos = grupos.reduce((n, [, s]) => n + s.length, 0);
        const noAr = grupos.reduce(
          (n, [, s]) => n + s.filter((x) => estadoDe(x.maquina_vmid) === "running").length,
          0
        );

        const corpo = grupos
          .map(([grupo, servicos]) => {
            const linhas = servicos
              .map((s) => {
                const m = maquinas.find((x) => x.vmid === s.maquina_vmid);
                const estado = estadoDe(s.maquina_vmid);
                // O endereco e o que a pessoa digita para chegar la; quando nao
                // ha porta exposta, dizer isso e mais util que um travessao.
                const endereco = s.porta
                  ? `${s.host_checagem ?? ""}${s.host_checagem ? ":" : ""}${s.porta}`
                  : "sem porta";
                const onde = m ? `${m.tipo.toUpperCase()} ${m.vmid}` : `vmid ${s.maquina_vmid}`;
                return linha(
                  "",
                  estado,
                  `<span class="nome">${link(s.url, s.nome)}</span>`,
                  `<span class="endereco">${escapar(endereco)}</span>
<span class="maquina">${escapar(onde)}</span>
<span class="nota">${escapar(s.descricao)}</span>`
                );
              })
              .join("");
            const vivos = servicos.filter((s) => estadoDe(s.maquina_vmid) === "running").length;
            return `<details class="grupo" open>
<summary>${escapar(grupo || "Servicos")}<span class="conta">${vivos} de ${servicos.length}</span></summary>
<ul class="itens">${linhas}</ul>
</details>`;
          })
          .join("");

        // As maquinas que hospedam esta categoria viram mais um grupo da
        // arvore, no mesmo formato dos servicos, em vez de um bloco solto no
        // rodape. Os verbos oferecidos sao os que `podeAgir` aprova — a mesma
        // funcao que a rota confere depois — filtrados pelo estado atual.
        const vmids = [...new Set(grupos.flatMap(([, s]) => s.map((x) => x.maquina_vmid)))];
        const hospedes = vmids
          .map((v) => maquinas.find((m) => m.vmid === v))
          .filter((m): m is Maquina => !!m)
          .map((m) => {
            const estado = estadoDe(m.vmid);
            const acoes = botoesDaMaquina(deps.db, papel, m.vmid, m.tipo, csrf, "mapa", estado);
            return { m, estado, acoes };
          })
          .filter((h) => h.acoes !== "");
        const bloco = hospedes.length
          ? `<details class="grupo maquinas" open>
<summary>Maquinas<span class="conta">${
              hospedes.filter((h) => h.estado === "running").length
            } de ${hospedes.length}</span></summary>
<ul class="itens">${hospedes
              .map((h) =>
                linha(
                  "maq",
                  h.estado,
                  `<span class="nome">${escapar(h.m.tipo.toUpperCase())} ${escapar(h.m.vmid)}</span>
<span class="apelido">${escapar(h.m.nome)}</span>
<span class="situacao">${escapar(emPortugues(h.estado))}</span>`,
                  `<span class="nota">${escapar(h.m.descricao)}</span>
<div class="acoes">${h.acoes}</div>`
                )
              )
              .join("")}</ul>
</details>`
          : "";

        return `<details class="secao" open>
<summary>${escapar(categoria)}<span class="conta">${noAr} de ${quantos} no ar</span></summary>
${corpo}${bloco}
</details>`;
      })
      .join("");

    const aviso = pve.desatualizado
      ? `<p class="nota">Estado das maquinas desatualizado${
          pve.em ? `, de ${escapar(pve.em.toLocaleTimeString("pt-BR"))}` : ""
        }: ${escapar(pve.erro)}</p>`
      : "";

    res.type("html").send(
      layout({
        titulo: "Mapa",
        poder,
        atual: "/mapa",
        corpoHtml: `<h1>Mapa</h1>${faixaDeAviso(req.query.acao, req.query.alvo)}${aviso}
<p class="nota">Tudo que roda na casa, onde cada coisa mora, e os botoes da maquina que a hospeda.</p>
<div class="mapa">${secoes}</div>`,
      })
    );
  };
}
