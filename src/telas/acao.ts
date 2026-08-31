import type { RequestHandler } from "express";
import type Database from "better-sqlite3";
import { podeAgir } from "../acoes/permissao.js";
import { ehDestrutivo, type Alvo, type Verbo } from "../acoes/tipos.js";
import { acionar, type Executor } from "../acoes/wrapper.js";
import { registrar } from "../acoes/registro.js";
import { conferirCsrf } from "../auth/csrf.js";
import { poderDoPapel } from "../db/inventario.js";
import { escapar, layout } from "../html/base.js";

export type DepsAcao = { db: Database.Database; segredoSessao: string; exec: Executor };

function alvoDe(db: Database.Database, bruto: string): Alvo | null {
  if (bruto === "host") return { tipo: "host" };
  if (!/^\d+$/.test(bruto)) return null;
  const vmid = Number(bruto);
  const m = db.prepare("SELECT tipo FROM maquinas WHERE vmid = ?").get(vmid) as
    { tipo: "vm" | "ct" } | undefined;
  if (!m) return null;
  return { tipo: "maquina", vmid, classe: m.tipo };
}

function nomeDoAlvo(a: Alvo): string {
  return a.tipo === "host" ? "host" : `${a.classe}:${a.vmid}`;
}

function loginDoUsuario(db: Database.Database, id: number): string {
  const u = db.prepare("SELECT login FROM usuarios WHERE id = ?").get(id) as
    { login: string } | undefined;
  return u?.login ?? "?";
}

const ROTULOS: Record<Verbo, string> = {
  start: "Ligar",
  shutdown: "Desligar",
  reboot: "Reiniciar",
};

function nomeDaMaquina(db: Database.Database, vmid: number): string | null {
  const m = db.prepare("SELECT nome FROM maquinas WHERE vmid = ?").get(vmid) as
    { nome: string } | undefined;
  return m?.nome ?? null;
}

function telaConfirmacao(
  deps: DepsAcao,
  req: Parameters<RequestHandler>[0],
  corpo: Record<string, unknown>,
  alvo: Alvo,
  verbo: Verbo
): string {
  const nome =
    alvo.tipo === "host"
      ? "o servidor Proxmox inteiro"
      : (nomeDaMaquina(deps.db, alvo.vmid) ?? nomeDoAlvo(alvo));

  // O aviso do host e diferente de proposito: desligar o Proxmox derruba a casa
  // inteira, e voltar depende de um atalho fora do portal. Quem clica precisa
  // saber disso ANTES, nao depois.
  const aviso =
    alvo.tipo === "host"
      ? `<p class="nota">Isto derruba <strong>tudo</strong>: o Home Assistant,
         o FloripaOT (com jogadores possivelmente conectados) e o proprio portal.
         Para religar sera preciso o atalho do iPhone, porque nada dentro da casa
         sobrevive para receber o comando.</p>`
      : "";

  const corpoHtml = `<h1>Confirmar</h1>
<p><strong>${escapar(ROTULOS[verbo])}</strong> ${escapar(nome)}?</p>
${aviso}
<form method="post" action="/acao" class="${alvo.tipo === "host" ? "perigo" : ""}">
  <input type="hidden" name="alvo" value="${escapar(alvo.tipo === "host" ? "host" : alvo.vmid)}">
  <input type="hidden" name="verbo" value="${escapar(verbo)}">
  <input type="hidden" name="csrf" value="${escapar(String(corpo.csrf ?? ""))}">
  <input type="hidden" name="voltar" value="${escapar(String(corpo.voltar ?? ""))}">
  <input type="hidden" name="confirmado" value="1">
  <button>Sim, ${escapar(ROTULOS[verbo].toLowerCase())}</button>
</form>
<p><a href="/">Cancelar</a></p>`;

  return layout({
    titulo: "Confirmar",
    poder: poderDoPapel(deps.db, req.sessao!.papel),
    atual: "",
    corpoHtml,
  });
}

export function rotaAcao(deps: DepsAcao): RequestHandler {
  return async (req, res) => {
    const sessao = req.sessao!;
    const usuario = loginDoUsuario(deps.db, sessao.usuario);
    // express.urlencoded so popula req.body quando o content-type casa; para
    // qualquer outro content-type (ou nenhum), o Express 5 deixa req.body
    // undefined. Sem este corpo defensivo, req.body.alvo estoura em 500 antes
    // de registrar a tentativa -- e a restricao e registrar TODA tentativa,
    // inclusive a que chega com corpo torto.
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const bruto = String(corpo.alvo ?? "");
    const verbo = String(corpo.verbo ?? "");
    const confirmado = corpo.confirmado === "1";

    if (!conferirCsrf(String(corpo.csrf ?? ""), sessao.id, deps.segredoSessao)) {
      registrar(deps.db, usuario, verbo || "?", bruto || "?", false, "csrf invalido");
      return res.status(403).send("Pedido invalido.");
    }

    const alvo = alvoDe(deps.db, bruto);
    if (!alvo) {
      registrar(deps.db, usuario, verbo || "?", bruto || "?", false, "alvo invalido");
      return res.status(403).send("Alvo invalido.");
    }

    const decisao = podeAgir(deps.db, sessao.papel, alvo, verbo);
    if (!decisao.permitido) {
      registrar(deps.db, usuario, verbo || "?", nomeDoAlvo(alvo), false, decisao.motivo);
      return res.status(403).send("Sem permissao.");
    }

    // podeAgir ja confere ehVerbo internamente e recusa verbo desconhecido;
    // a partir daqui verbo e um Verbo de verdade.
    const v = verbo as Verbo;
    if (ehDestrutivo(v) && !confirmado) {
      return res.type("html").send(telaConfirmacao(deps, req, corpo, alvo, v));
    }

    const r = await acionar(deps.exec, alvo, v);
    registrar(deps.db, usuario, v, nomeDoAlvo(alvo), r.ok, r.ok ? r.dado : r.erro);
    return res.redirect(
      alvo.tipo === "host" ? "/" : (corpo.voltar === "infra" ? "/infraestrutura" : "/")
    );
  };
}
