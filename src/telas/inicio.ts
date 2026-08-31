import type { RequestHandler } from "express";
import type Database from "better-sqlite3";
import type { Cache } from "../cache.js";
import type { RecursoPve } from "../fontes/proxmox.js";
import { listarMaquinas, listarServicos, poderDoPapel } from "../db/inventario.js";
import { checarPorta } from "../fontes/porta.js";
import { layout, escapar, faixaDeAviso } from "../html/base.js";
import { cartao, linha } from "../html/cartao.js";
import { tokenCsrf } from "../auth/csrf.js";
import { VERBOS, ROTULOS } from "../acoes/tipos.js";

export type Caches = { pve: Cache<RecursoPve[]> };
export type DepsTela = { db: Database.Database; caches: Caches; segredoSessao: string };

// So conveniencia: o botao some quando a maquina nao e acionavel, mas o
// servidor confere tudo de novo em /acao — esconder o botao nunca e a
// barreira real.
function botoesDeAcao(vmid: number, csrf: string, voltar: string): string {
  const botoes = VERBOS
    .map((v) => `<form method="post" action="/acao" class="acao">
<input type="hidden" name="alvo" value="${escapar(vmid)}">
<input type="hidden" name="verbo" value="${escapar(v)}">
<input type="hidden" name="csrf" value="${escapar(csrf)}">
<input type="hidden" name="voltar" value="${escapar(voltar)}">
<button>${escapar(ROTULOS[v])}</button>
</form>`)
    .join("");
  return `<div class="acoes">${botoes}</div>`;
}

// Aceita so http/https: um esquema como "javascript:" nao tem aspas nem
// sinais de menor, entao atravessa o escapar() intacto e ainda executa ao
// ser clicado. Escapar sozinho nao basta -- exige o par: validar o esquema
// e so entao escapar o valor.
function linkServico(url: string): string {
  let esquema: string;
  try {
    esquema = new URL(url).protocol;
  } catch {
    return "";
  }
  if (esquema !== "http:" && esquema !== "https:") return "";
  return `<dt>Endereco</dt><dd><a href="${escapar(url)}">abrir</a></dd>`;
}

export function rotaInicio(deps: DepsTela): RequestHandler {
  return async (req, res) => {
    const papel = req.sessao!.papel;
    const servicos = listarServicos(deps.db, papel);
    const maquinas = listarMaquinas(deps.db, papel);
    const poder = poderDoPapel(deps.db, papel);
    const pve = await deps.caches.pve.obter();
    const csrf = tokenCsrf(req.sessao!.id, deps.segredoSessao);

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
        s.url ? linkServico(s.url) : "",
      ].filter(Boolean);
      const m = maquinas.find((x) => x.vmid === s.maquina_vmid);
      const rodapeHtml = m && m.acionavel ? botoesDeAcao(m.vmid, csrf, "inicio") : "";
      return cartao({ titulo: s.nome, estado, linhasHtml, nota: s.descricao, rodapeHtml });
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
        poder,
        atual: "/",
        corpoHtml: `<h1>Inicio</h1>${faixaDeAviso(req.query.acao, req.query.alvo)}<div class="grade">${aviso}${cartoes.join("")}</div>`,
      })
    );
  };
}
