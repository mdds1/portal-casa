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
                return `<li class="item">
<span class="ponto ${classePonto(estado)}"></span>
<span class="nome">${link(s.url, s.nome)}</span>
<span class="fio"></span>
<span class="endereco">${escapar(endereco)}</span>
<span class="maquina">${escapar(onde)}</span>
<span class="nota">${escapar(s.descricao)}</span>
</li>`;
              })
              .join("");
            const titulo = grupo ? `<h3>${escapar(grupo)}</h3>` : "";
            return `<div class="grupo">${titulo}<ul class="itens">${linhas}</ul></div>`;
          })
          .join("");

        // As maquinas que hospedam esta categoria, com os botoes que a pessoa
        // pode usar. Os verbos oferecidos sao os que `podeAgir` aprova — a
        // mesma funcao que a rota confere depois.
        const vmids = [...new Set(grupos.flatMap(([, s]) => s.map((x) => x.maquina_vmid)))];
        const hospedes = vmids
          .map((v) => maquinas.find((m) => m.vmid === v))
          .filter((m): m is Maquina => !!m)
          .map((m) => {
            const acoes = botoesDaMaquina(deps.db, papel, m.vmid, m.tipo, csrf, "mapa");
            if (!acoes) return "";
            const estado = estadoDe(m.vmid);
            return `<div class="hospede">
<span class="ponto ${classePonto(estado)}"></span>
<span class="quem">${escapar(m.tipo.toUpperCase())} ${escapar(m.vmid)} · ${escapar(m.nome)} — ${escapar(estado)}</span>
<div class="acoes">${acoes}</div>
</div>`;
          })
          .join("");
        const bloco = hospedes ? `<div class="maquinas">${hospedes}</div>` : "";

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
