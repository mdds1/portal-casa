import type { RequestHandler } from "express";
import type Database from "better-sqlite3";
import type { Cache } from "../cache.js";
import type { RecursoPve } from "../fontes/proxmox.js";
import type { EstadoHa } from "../fontes/homeassistant.js";
import { listarServicos } from "../db/inventario.js";
import { checarPorta } from "../fontes/porta.js";
import { layout } from "../html/base.js";
import { cartao, linha } from "../html/cartao.js";

export type Caches = { pve: Cache<RecursoPve[]>; ha: Cache<EstadoHa[]> };
export type DepsTela = { db: Database.Database; caches: Caches };

export function rotaInicio(deps: DepsTela): RequestHandler {
  return async (req, res) => {
    const papel = req.sessao!.papel;
    const servicos = listarServicos(deps.db, papel);
    const pve = await deps.caches.pve.obter();

    // As checagens de porta correm juntas: em serie, oito servicos com dois
    // segundos de limite cada dariam dezesseis segundos de pagina em branco.
    const checagens = await Promise.all(
      servicos.map(async (s) =>
        s.host_checagem && s.porta
          ? { s, r: await checarPorta(s.host_checagem, s.porta, 1500) }
          : { s, r: null }
      )
    );

    const cartoes = checagens.map(({ s, r }) => {
      const maquina = pve.dado?.find((m) => m.vmid === s.maquina_vmid);
      // Estado do cartao e uniao fechada: derivado por comparacao explicita,
      // nunca por cast, para o compilador continuar apanhando valor invalido.
      const estado = r === null ? "parado" : r.ok === true ? "ok" : "erro";
      const linhasHtml = [
        linha("Estado", r === null ? "sem checagem" : r.ok ? "no ar" : "sem resposta"),
        s.porta ? linha("Porta", s.porta) : "",
        maquina ? linha("Maquina", `${maquina.nome} (${maquina.estado})`) : "",
        s.url ? `<dt>Endereco</dt><dd><a href="${s.url}">abrir</a></dd>` : "",
      ].filter(Boolean);
      return cartao({ titulo: s.nome, estado, linhasHtml, nota: s.descricao });
    });

    const aviso = pve.desatualizado
      ? cartao({
          titulo: "Proxmox",
          estado: "velho",
          linhasHtml: [linha("Consulta", pve.erro ?? "falhou")],
          nota: pve.em
            ? `Dado desatualizado, de ${pve.em.toLocaleTimeString("pt-BR")}.`
            : "Indisponivel: nenhuma leitura boa ainda.",
        })
      : "";

    res.type("html").send(
      layout({
        titulo: "Inicio",
        papel,
        atual: "/",
        corpoHtml: `<h1>Inicio</h1><div class="grade">${aviso}${cartoes.join("")}</div>`,
      })
    );
  };
}
