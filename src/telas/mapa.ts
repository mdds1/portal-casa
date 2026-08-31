import type { RequestHandler } from "express";
import type Database from "better-sqlite3";
import type { Cache } from "../cache.js";
import type { RecursoPve } from "../fontes/proxmox.js";
import { listarArvore, listarMaquinas, poderDoPapel, type Servico } from "../db/inventario.js";
import { layout, escapar, faixaDeAviso } from "../html/base.js";

export type DepsMapa = { db: Database.Database; caches: { pve: Cache<RecursoPve[]> } };

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

    const arvore = agrupar(itens)
      .map(([categoria, grupos]) => {
        const corpo = grupos
          .map(([grupo, servicos]) => {
            const linhas = servicos
              .map((s) => {
                const m = maquinas.find((x) => x.vmid === s.maquina_vmid);
                const vivo = pve.dado?.find((x) => x.vmid === s.maquina_vmid);
                // O estado que importa aqui e o da MAQUINA que hospeda: o Mapa
                // responde "onde isto mora e essa casa esta de pe", nao "a
                // porta respondeu" — isso e a tela de Inicio que faz.
                const estado = vivo?.estado ?? (m ? "desconhecido" : "");
                const onde = m
                  ? `${m.tipo.toUpperCase()} ${m.vmid} · ${m.nome}`
                  : `vmid ${s.maquina_vmid}`;
                return `<li class="folha">
<span class="ponto ${estado === "running" ? "ok" : estado ? "parado" : "erro"}"></span>
<span class="nome">${link(s.url, s.nome)}</span>
<span class="porta">${s.porta ? escapar(s.porta) : "—"}</span>
<span class="onde">${escapar(onde)}</span>
<span class="nota">${escapar(s.descricao)}</span>
</li>`;
              })
              .join("");
            const titulo = grupo ? `<h3 class="galho">${escapar(grupo)}</h3>` : "";
            return `${titulo}<ul class="ramo">${linhas}</ul>`;
          })
          .join("");
        return `<section class="tronco">
<h2>${escapar(categoria)}</h2>
${corpo}
</section>`;
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
<p class="nota">Tudo que roda na casa, e em qual maquina cada coisa mora.</p>
<div class="mapa">${arvore}</div>`,
      })
    );
  };
}
