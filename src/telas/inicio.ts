import type { RequestHandler } from "express";
import type Database from "better-sqlite3";
import type { Cache } from "../cache.js";
import type { NoPve, RecursoPve } from "../fontes/proxmox.js";
import type { Dispositivo } from "../fontes/tailscale.js";
import type { Tempo } from "../fontes/tempo.js";
import type { EstadoHa } from "../fontes/homeassistant.js";
import { listarMaquinas, poderDoPapel } from "../db/inventario.js";
import { layout, escapar, faixaDeAviso } from "../html/base.js";
import { cartao, linha } from "../html/cartao.js";

export type Caches = {
  pve: Cache<RecursoPve[]>;
  no: Cache<NoPve>;
  rede: Cache<Dispositivo[]>;
  tempo: Cache<Tempo>;
  ha: Cache<EstadoHa[]>;
};
export type DepsTela = { db: Database.Database; caches: Caches; segredoSessao: string };

// "3d 4h" diz mais que "277560s" e mais que "3.21 dias". Duas unidades bastam:
// a terceira nunca muda uma decisao.
export function duracao(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos <= 0) return "—";
  const d = Math.floor(segundos / 86400);
  const h = Math.floor((segundos % 86400) / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

export function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function porcento(parte: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((parte / total) * 100)}%`;
}

// Verde quando o dado e fresco, amarelo quando e guardado de uma consulta que
// falhou, vermelho quando nao ha dado nenhum. A distincao importa: um numero
// velho enganaria se aparecesse igual a um numero atual.
function estadoDoCache(i: { dado: unknown; desatualizado: boolean }): "ok" | "velho" | "erro" {
  if (i.dado === null) return "erro";
  return i.desatualizado ? "velho" : "ok";
}

const DIAS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

// O container roda em UTC e a previsao vem em horario de Sao Paulo. Sem fixar
// o fuso, das 21h em diante o "hoje" da previsao ja e "ontem" para o servidor
// e a lista inteira aparece deslocada um dia — defeito que so se manifesta a
// noite, que e justamente quando alguem olha a previsao de amanha.
const FUSO = "America/Sao_Paulo";

export function hojeEm(fuso = FUSO, agora = new Date()): string {
  // en-CA formata como AAAA-MM-DD, o mesmo formato que a API devolve.
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(agora);
}

export function nomeDoDia(iso: string, hoje = hojeEm()): string {
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return iso;
  if (iso === hoje) return "hoje";
  const [ha, hm, hd] = hoje.split("-").map(Number);
  if (ha && hm && hd) {
    const amanha = new Date(Date.UTC(ha, hm - 1, hd + 1));
    if (iso === amanha.toISOString().slice(0, 10)) return "amanha";
  }
  // O dia da semana sai de uma data em UTC de proposito: assim nao depende do
  // fuso do processo, so dos numeros que vieram na string.
  return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? iso;
}

export function rotaInicio(deps: DepsTela): RequestHandler {
  return async (req, res) => {
    const papel = req.sessao!.papel;
    const poder = poderDoPapel(deps.db, papel);
    const maquinas = listarMaquinas(deps.db, papel);

    // As quatro fontes correm juntas: em serie, a previsao esperaria o
    // Proxmox e a pagina levaria o dobro do tempo para aparecer.
    const [pve, no, rede, tempo] = await Promise.all([
      deps.caches.pve.obter(),
      deps.caches.no.obter(),
      deps.caches.rede.obter(),
      deps.caches.tempo.obter(),
    ]);

    // --- Previsao
    const t = tempo.dado;
    const cartaoTempo = cartao({
      titulo: "Florianopolis",
      estado: estadoDoCache(tempo),
      linhasHtml: t
        ? [
            linha("Agora", `${Math.round(t.agora)}°C, ${t.ceu}`),
            linha("Umidade", `${t.umidade}%`),
            ...t.dias.map((d) =>
              linha(nomeDoDia(d.dia), `${Math.round(d.min)}° a ${Math.round(d.max)}° · ${d.ceu}`)
            ),
          ]
        : [linha("Previsao", tempo.erro ?? "indisponivel")],
      nota: tempo.desatualizado && t ? "Dado guardado; a consulta falhou." : undefined,
    });

    // --- Quem esta conectado
    const d = rede.dado ?? [];
    const online = d.filter((x) => x.online);
    const cartaoRede = cartao({
      titulo: "Quem esta conectado",
      estado: estadoDoCache(rede),
      linhasHtml: d.length
        ? [
            linha("No ar agora", `${online.length} de ${d.length}`),
            ...d
              .slice(0, 12)
              .map((x) =>
                linha(x.nome + (x.proprio ? " (este portal)" : ""), x.online ? "conectado" : x.visto || "fora")
              ),
          ]
        : [linha("Rede", rede.erro ?? "sem dispositivos")],
      nota: "Dispositivos na Tailscale.",
    });

    // --- O host
    const n = no.dado;
    const cartaoHost = cartao({
      titulo: "Servidor da casa",
      estado: estadoDoCache(no),
      linhasHtml: n
        ? [
            linha("Ligado ha", duracao(n.uptime)),
            linha("Processador", `${Math.round(n.cpu * 100)}% · carga ${n.carga.toFixed(2)}`),
            linha("Memoria", `${gb(n.memoria)} de ${gb(n.memoriaMax)} (${porcento(n.memoria, n.memoriaMax)})`),
            linha("Disco", `${gb(n.disco)} de ${gb(n.discoMax)} (${porcento(n.disco, n.discoMax)})`),
          ]
        : [linha("Proxmox", no.erro ?? "indisponivel")],
      nota: no.desatualizado && n ? "Dado guardado; a consulta falhou." : undefined,
    });

    // --- As maquinas, e ha quanto tempo cada uma esta de pe
    const vivas = maquinas
      .map((m) => ({ m, r: pve.dado?.find((x) => x.vmid === m.vmid) }))
      .filter((x) => x.r?.estado === "running");
    const cartaoMaquinas = cartao({
      titulo: "Maquinas ligadas",
      estado: estadoDoCache(pve),
      linhasHtml: vivas.length
        ? [
            linha("Ligadas", `${vivas.length} de ${maquinas.length}`),
            ...vivas.map(({ m, r }) => linha(m.nome, duracao(r!.uptime))),
          ]
        : [linha("Maquinas", pve.erro ?? "nenhuma ligada")],
      nota: "Tempo desde que cada uma subiu.",
    });

    const cartoes =
      poder >= 100
        ? [cartaoTempo, cartaoRede, cartaoHost, cartaoMaquinas]
        : [cartaoTempo, cartaoRede];

    res.type("html").send(
      layout({
        titulo: "Inicio",
        poder,
        atual: "/",
        corpoHtml: `<h1>Inicio</h1>${faixaDeAviso(req.query.acao, req.query.alvo)}
<p class="nota">O que está acontecendo agora. Os serviços e os botões estão no <a href="/mapa">Mapa</a>.</p>
<div class="grade">${cartoes.join("")}</div>`,
      })
    );
  };
}
