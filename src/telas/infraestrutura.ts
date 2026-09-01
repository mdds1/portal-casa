import type { RequestHandler } from "express";
import { listarMaquinas, poderDoPapel } from "../db/inventario.js";
import { layout, escapar, faixaDeAviso } from "../html/base.js";
import { tokenCsrf } from "../auth/csrf.js";
import { podeAgir } from "../acoes/permissao.js";
import { VERBOS, ROTULOS, ehDestrutivo, type Alvo } from "../acoes/tipos.js";
import type { DepsTela } from "./inicio.js";
import type Database from "better-sqlite3";

function gb(bytes: number): string {
  return bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "—";
}

// Os botoes oferecidos sao exatamente os verbos que podeAgir aprovaria: a
// tela pergunta a mesma funcao que a rota /acao vai consultar de novo, em
// vez de reimplementar a regra (e arriscar as duas divergirem).
export function botoesDaMaquina(
  db: Database.Database,
  papel: string,
  vmid: number,
  classe: "vm" | "ct",
  csrf: string,
  voltar = "infra"
): string {
  const alvo: Alvo = { tipo: "maquina", vmid, classe };
  const oferecidos = VERBOS.filter((v) => podeAgir(db, papel, alvo, v).permitido);
  if (oferecidos.length === 0) return "";

  const nome = (db.prepare("SELECT nome FROM maquinas WHERE vmid = ?").get(vmid) as
    { nome: string } | undefined)?.nome ?? `${classe} ${vmid}`;

  return oferecidos.map((v) => {
    const campos = `<input type="hidden" name="alvo" value="${escapar(vmid)}">
<input type="hidden" name="verbo" value="${escapar(v)}">
<input type="hidden" name="csrf" value="${escapar(csrf)}">
<input type="hidden" name="voltar" value="${escapar(voltar)}">`;

    // Ligar nao pede confirmacao: nao ha nada a perder. Desligar e reiniciar
    // pedem — e a pergunta aparece num balao na propria pagina, nao numa tela
    // separada, para nao perder o contexto do que se estava olhando.
    if (!ehDestrutivo(v)) {
      return `<form method="post" action="/acao" class="acao-form">${campos}
<button>${escapar(ROTULOS[v])}</button></form>`;
    }

    const id = `confirmar-${classe}-${vmid}-${v}`;
    return `<a class="acao" href="#${id}">${escapar(ROTULOS[v])}</a>
<div class="balao" id="${id}" role="dialog" aria-modal="true" aria-label="${escapar(ROTULOS[v])} ${escapar(nome)}">
  <div class="caixa">
    <a class="fecha" href="#" aria-label="Fechar">Fechar</a>
    <h3>${escapar(ROTULOS[v])} ${escapar(nome)}?</h3>
    <p class="fraco">A maquina para agora. Quem estiver usando perde a conexao.</p>
    <div class="acoes">
      <form method="post" action="/acao">${campos}
<input type="hidden" name="confirmado" value="1">
<button class="perigo">Sim, ${escapar(ROTULOS[v].toLowerCase())}</button></form>
      <a class="acao" href="#">Cancelar</a>
    </div>
  </div>
</div>`;
  }).join("");
}

export function botaoDoHost(db: Database.Database, papel: string, csrf: string): string {
  if (!podeAgir(db, papel, { tipo: "host" }, "shutdown").permitido) return "";
  return `<a class="acao perigo" href="#confirmar-host">${escapar(ROTULOS.shutdown)} o host</a>
<div class="balao" id="confirmar-host" role="dialog" aria-modal="true" aria-label="Desligar o servidor">
  <div class="caixa">
    <a class="fecha" href="#" aria-label="Fechar">Fechar</a>
    <h3>Desligar o servidor inteiro?</h3>
    <p>Isto derruba <strong>tudo</strong>: o Home Assistant, o FloripaOT (com
    jogadores possivelmente conectados) e o proprio portal. Para religar sera
    preciso o atalho do iPhone, porque nada dentro da casa sobrevive para
    receber o comando.</p>
    <div class="acoes">
      <form method="post" action="/acao">
<input type="hidden" name="alvo" value="host">
<input type="hidden" name="verbo" value="shutdown">
<input type="hidden" name="csrf" value="${escapar(csrf)}">
<input type="hidden" name="voltar" value="infra">
<input type="hidden" name="confirmado" value="1">
<button class="perigo">Sim, desligar tudo</button></form>
      <a class="acao" href="#">Cancelar</a>
    </div>
  </div>
</div>`;
}

export function rotaInfraestrutura(deps: DepsTela): RequestHandler {
  return async (req, res) => {
    const papel = req.sessao!.papel;
    const maquinas = listarMaquinas(deps.db, papel);
    const poder = poderDoPapel(deps.db, papel);
    const pve = await deps.caches.pve.obter();
    const csrf = tokenCsrf(req.sessao!.id, deps.segredoSessao);

    const linhas = maquinas.map((m) => {
      // O inventario e a fonte da lista; o Proxmox so acrescenta estado. Uma
      // maquina que sumiu da API continua visivel, marcada como desconhecida —
      // some da tela seria a pior forma de avisar que algo esta errado.
      const vivo = pve.dado?.find((x) => x.vmid === m.vmid);
      return `<tr>
<td>${escapar(m.tipo.toUpperCase())} ${escapar(m.vmid)}</td>
<td>${escapar(m.nome)}<br><small>${escapar(m.descricao)}</small></td>
<td>${escapar(vivo?.estado ?? "desconhecido")}</td>
<td>${escapar(m.ip ?? "—")}</td>
<td>${escapar(vivo ? gb(vivo.memoriaMax) : "—")}</td>
<td>${m.onboot ? "sim" : "nao"}</td>
<td><div class="acoes">${botoesDaMaquina(deps.db, papel, m.vmid, m.tipo, csrf)}</div></td>
</tr>`;
    }).join("");

    const aviso = pve.desatualizado
      ? `<p class="nota">Estado desatualizado${pve.em ? `, de ${escapar(pve.em.toLocaleTimeString("pt-BR"))}` : ""}: ${escapar(pve.erro)}</p>`
      : "";

    const host = botaoDoHost(deps.db, papel, csrf);

    res.type("html").send(layout({
      titulo: "Infraestrutura",
      poder,
      atual: "/infraestrutura",
      corpoHtml: `<h1>Infraestrutura</h1>${faixaDeAviso(req.query.acao, req.query.alvo)}${aviso}
<div style="overflow-x:auto">
<table>
<thead><tr><th>ID</th><th>Maquina</th><th>Estado</th><th>IP</th><th>Memoria</th><th>Volta sozinha</th><th>Acoes</th></tr></thead>
<tbody>${linhas}</tbody>
</table></div>
${host ? `<div class="acoes">${host}</div>` : ""}`,
    }));
  };
}
