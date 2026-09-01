import type { RequestHandler } from "express";
import type Database from "better-sqlite3";
import { conferirCsrf, tokenCsrf } from "../auth/csrf.js";
import { registrar } from "../acoes/registro.js";
import { poderDoPapel } from "../db/inventario.js";
import type { EstadoHa } from "../fontes/homeassistant.js";
import type { Resultado } from "../fontes/tipos.js";
import type { Instantaneo } from "../cache.js";
import type { Caches } from "./inicio.js";
import { escapar, layout } from "../html/base.js";
import { cartao, linha } from "../html/cartao.js";

export type ChamarHa = (
  dominio: string,
  servico: string,
  dados: Record<string, unknown>
) => Promise<Resultado<null>>;

export type DepsMidia = {
  db: Database.Database;
  caches: Caches;
  segredoSessao: string;
  chamarHa: ChamarHa;
};

/**
 * Lista fechada de aparelhos que esta tela sabe comandar.
 *
 * Fechada de proposito, e nao lida do Home Assistant: a entidade chega pelo
 * formulario, e sem lista o campo viraria "chame qualquer servico do HA em
 * qualquer coisa" — o portal passaria a poder desligar o servidor de jogo por
 * um POST de mídia. Aparelho novo entra aqui a mao, de olhos abertos.
 *
 * A `media_player.luke_tv` ficou de fora: e entidade orfa, duplicata da
 * `luke_tv_un55au7700gxzd`, permanentemente indisponivel.
 */
const TVS = [
  { entidade: "media_player.suite_luke_s", nome: "TV do quarto", nota: "Philco, com Roku" },
  { entidade: "media_player.luke_tv_un55au7700gxzd", nome: "TV da sala", nota: "Samsung UN55AU7700" },
  { entidade: "media_player.fire_tv_192_168_15_9", nome: "Fire TV", nota: "192.168.15.9" },
] as const;

const VERBOS = ["turn_on", "turn_off"] as const;
type Verbo = (typeof VERBOS)[number];

/** Servicos de midia, so para o admin: a casa nao precisa saber o que e Radarr. */
const SERVICOS = [
  { entidade: "binary_sensor.jellyfin_tailscale", nome: "Jellyfin" },
  { entidade: "binary_sensor.seerr_tailscale", nome: "Seerr" },
  { entidade: "binary_sensor.radarr", nome: "Radarr" },
  { entidade: "binary_sensor.sonarr", nome: "Sonarr" },
  { entidade: "binary_sensor.bazarr", nome: "Bazarr" },
  { entidade: "binary_sensor.prowlarr", nome: "Prowlarr" },
  { entidade: "binary_sensor.qbittorrent", nome: "qBittorrent" },
] as const;

const ARMAZENAMENTO = "sensor.armazenamento_media";

function ehTv(entidade: string): boolean {
  return TVS.some((t) => t.entidade === entidade);
}

function ehVerbo(v: string): v is Verbo {
  return (VERBOS as readonly string[]).includes(v);
}

function poderDaSessao(db: Database.Database, papel: string): number {
  return poderDoPapel(db, papel);
}

function paginaMidia(deps: DepsMidia, idSessao: string, poder: number, estados: Instantaneo<EstadoHa[]>): string {
  const csrf = tokenCsrf(idSessao, deps.segredoSessao);
  const mapa = new Map((estados.dado ?? []).map((e) => [e.entidade, e]));

  const falha = estados.erro === null
    ? ""
    : `<p class="aviso">Nao foi possivel falar com o Home Assistant: ${escapar(estados.erro)}.
       Os aparelhos abaixo aparecem sem estado — nao quer dizer que estejam desligados.</p>`;

  const cartoesTv = TVS.map((tv) => {
    const e = mapa.get(tv.entidade);
    // Sem dado nao se afirma estado: "indisponivel" e diferente de "desligada",
    // e mostrar uma pela outra faz a pessoa apertar o botao errado.
    const ligada = e?.estado === "on";
    const conhecido = e !== undefined;
    const estado = !conhecido ? "velho" : ligada ? "ok" : "parado";
    const texto = !conhecido ? "Indisponivel" : ligada ? "Ligada" : "Desligada";

    const botao = conhecido
      ? `<form method="post" action="/midia/tv" class="acoes">
<input type="hidden" name="csrf" value="${escapar(csrf)}">
<input type="hidden" name="entidade" value="${escapar(tv.entidade)}">
<input type="hidden" name="verbo" value="${ligada ? "turn_off" : "turn_on"}">
<button class="acao">${ligada ? "Desligar" : "Ligar"}</button></form>`
      : "";

    return cartao({
      titulo: tv.nome,
      estado: estado as "ok" | "parado" | "velho",
      linhasHtml: [linha("Estado", texto), linha("Aparelho", tv.nota)],
      rodapeHtml: botao,
    });
  }).join("");

  const disco = mapa.get(ARMAZENAMENTO);
  const cartaoDisco = disco
    ? cartao({
        titulo: "Biblioteca",
        estado: Number(disco.estado) >= 90 ? "erro" : "ok",
        linhasHtml: [linha("Disco usado", `${disco.estado}%`)],
        nota: "Filmes, series e animes. Nao ha copia de seguranca desta pasta, por decisao.",
      })
    : "";

  let blocoServicos = "";
  if (poder >= 100) {
    const linhas = SERVICOS.map((s) => {
      const e = mapa.get(s.entidade);
      const texto = e === undefined ? "sem resposta" : e.estado === "on" ? "no ar" : "parado";
      return linha(s.nome, texto);
    });
    blocoServicos = `<section class="bloco"><h3>Servicos de midia</h3>
<p class="fraco">O que faz a biblioteca crescer. Todos vivem no CT 102.</p>
<div class="grade">${cartao({ titulo: "Estado dos servicos", estado: "ok", linhasHtml: linhas })}</div></section>`;
  }

  const corpo = `<h2>Midia</h2>${falha}
<section class="bloco"><h3>Aparelhos</h3>
<p class="fraco">Ligar e desligar as TVs daqui. O que estiver sem resposta esta fora do ar ou da tomada.</p>
<div class="grade">${cartoesTv}${cartaoDisco}</div></section>
${blocoServicos}`;

  return layout({ titulo: "Midia", poder, atual: "/midia", corpoHtml: corpo });
}

export function rotaMidia(deps: DepsMidia): RequestHandler {
  return async (req, res) => {
    const s = req.sessao!;
    const estados = await deps.caches.ha.obter();
    res.type("html").send(paginaMidia(deps, s.id, poderDaSessao(deps.db, s.papel), estados));
  };
}

export function rotaTv(deps: DepsMidia): RequestHandler {
  return async (req, res) => {
    const s = req.sessao!;
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const u = deps.db.prepare("SELECT login FROM usuarios WHERE id = ?").get(s.usuario) as
      { login: string } | undefined;
    const quem = u?.login ?? "?";

    if (!conferirCsrf(String(corpo.csrf ?? ""), s.id, deps.segredoSessao)) {
      registrar(deps.db, quem, "tv", String(corpo.entidade ?? "?"), false, "csrf invalido");
      res.status(403).send("Pedido invalido. Recarregue a pagina e tente de novo.");
      return;
    }

    const entidade = String(corpo.entidade ?? "");
    const verbo = String(corpo.verbo ?? "");

    if (!ehTv(entidade)) {
      registrar(deps.db, quem, "tv", entidade, false, "aparelho fora da lista");
      res.status(403).send("Esse aparelho nao e comandado por esta tela.");
      return;
    }
    if (!ehVerbo(verbo)) {
      registrar(deps.db, quem, "tv", entidade, false, `verbo recusado: ${verbo}`);
      res.status(403).send("Essa acao nao existe nesta tela.");
      return;
    }

    const r = await deps.chamarHa("media_player", verbo, { entity_id: entidade });
    registrar(deps.db, quem, "tv", entidade, r.ok, r.ok ? verbo : r.erro);
    // O estado no HA leva alguns segundos para mudar; o cache seria mostrado
    // velho logo apos a acao. Invalidar aqui faz a proxima leitura ir a fonte.
    deps.caches.ha.invalidar();
    res.redirect(303, "/midia");
  };
}
