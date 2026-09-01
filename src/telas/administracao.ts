import type { RequestHandler } from "express";
import type Database from "better-sqlite3";
import { conferirCsrf, tokenCsrf } from "../auth/csrf.js";
import { gerarHash } from "../auth/senha.js";
import { registrar } from "../acoes/registro.js";
import { podeMexer, validarSenha, type Mudanca } from "../admin/regras.js";
import { escapar, layout } from "../html/base.js";

export type DepsAdmin = { db: Database.Database; segredoSessao: string };

type Usuario = { id: number; login: string; nome: string; papel: string; ativo: number };
type Maquina = {
  vmid: number; tipo: string; nome: string; descricao: string;
  acionavel: number; papel_minimo: string;
};
type Entrada = { quando: string; usuario: string; verbo: string; alvo: string; ok: number; detalhe: string };

function login(db: Database.Database, id: number): string {
  const u = db.prepare("SELECT login FROM usuarios WHERE id = ?").get(id) as { login: string } | undefined;
  return u?.login ?? "?";
}

function papeis(db: Database.Database): string[] {
  return (db.prepare("SELECT nome FROM papeis ORDER BY poder DESC").all() as { nome: string }[])
    .map((p) => p.nome);
}

function seletorPapel(nome: string, atual: string, lista: string[]): string {
  const opcoes = lista
    .map((p) => `<option value="${escapar(p)}"${p === atual ? " selected" : ""}>${escapar(p)}</option>`)
    .join("");
  return `<select name="${escapar(nome)}">${opcoes}</select>`;
}

// ---------------------------------------------------------------- a pagina

function pagina(deps: DepsAdmin, idSessao: string, eu: number, aviso: string): string {
  const db = deps.db;
  const csrf = tokenCsrf(idSessao, deps.segredoSessao);
  const oculto = `<input type="hidden" name="csrf" value="${escapar(csrf)}">`;
  const lista = papeis(db);

  const usuarios = db.prepare(
    "SELECT id, login, nome, papel, ativo FROM usuarios ORDER BY login"
  ).all() as Usuario[];

  const linhasUsuarios = usuarios.map((u) => {
    const souEu = u.id === eu;
    // Quem e voce fica marcado na propria linha: as recusas de "contra si
    // mesmo" so fazem sentido para quem sabe qual linha e a sua.
    const marca = souEu ? ' <span class="marca">voce</span>' : "";
    const acao = (campos: string) =>
      `<form method="post" action="/administracao/usuario">${oculto}
       <input type="hidden" name="id" value="${u.id}">${campos}</form>`;
    return `<tr>
<td><strong>${escapar(u.login)}</strong>${marca}<br><span class="fraco">${escapar(u.nome)}</span></td>
<td>${acao(`<input type="hidden" name="acao" value="papel">
   ${seletorPapel("papel", u.papel, lista)}<button>Mudar</button>`)}</td>
<td>${acao(`<input type="hidden" name="acao" value="ativo">
   <input type="hidden" name="ativo" value="${u.ativo ? 0 : 1}">
   <button>${u.ativo ? "Desativar" : "Ativar"}</button>`)}
   ${u.ativo ? "" : '<span class="fraco">desativado</span>'}</td>
<td>${acao(`<input type="hidden" name="acao" value="senha">
   <input type="password" name="senha" placeholder="nova senha" autocomplete="new-password" required>
   <button>Trocar</button>`)}</td>
</tr>`;
  }).join("");

  const criar = `<form method="post" action="/administracao/usuario" class="criar">${oculto}
<input type="hidden" name="acao" value="criar">
<input name="login" placeholder="login" required autocomplete="off">
<input name="nome" placeholder="nome" required autocomplete="off">
<input type="password" name="senha" placeholder="senha" required autocomplete="new-password">
${seletorPapel("papel", "casa", lista)}
<button>Criar usuario</button></form>`;

  const maquinas = db.prepare(
    "SELECT vmid, tipo, nome, descricao, acionavel, papel_minimo FROM maquinas ORDER BY vmid"
  ).all() as Maquina[];

  const linhasMaquinas = maquinas.map((m) => `<tr>
<td><span class="fraco">${escapar(m.tipo)}</span> ${m.vmid}<br><strong>${escapar(m.nome)}</strong></td>
<td colspan="3"><form method="post" action="/administracao/maquina" class="emlinha">${oculto}
<input type="hidden" name="vmid" value="${m.vmid}">
<input name="descricao" value="${escapar(m.descricao)}" placeholder="para que serve">
<label><input type="checkbox" name="acionavel" value="1"${m.acionavel ? " checked" : ""}> botoes</label>
${seletorPapel("papel_minimo", m.papel_minimo, lista)}
<button>Salvar</button></form></td>
</tr>`).join("");

  const registro = db.prepare(
    "SELECT quando, usuario, verbo, alvo, ok, detalhe FROM acoes_log ORDER BY id DESC LIMIT 40"
  ).all() as Entrada[];

  const linhasRegistro = registro.length === 0
    ? `<tr><td colspan="4" class="fraco">Nada registrado ainda.</td></tr>`
    : registro.map((e) => `<tr>
<td class="fraco">${escapar(e.quando.replace("T", " ").slice(0, 19))}</td>
<td>${escapar(e.usuario)}</td>
<td>${escapar(e.verbo)} <span class="fraco">${escapar(e.alvo)}</span></td>
<td>${e.ok ? '<span class="ok">ok</span>' : `<span class="falhou">recusado</span> <span class="fraco">${escapar(e.detalhe)}</span>`}</td>
</tr>`).join("");

  const avisoHtml = aviso ? `<p class="aviso">${escapar(aviso)}</p>` : "";

  const corpo = `<h2>Administracao</h2>${avisoHtml}

<section class="bloco">
<h3>Usuarios</h3>
<p class="fraco">Voce nao pode desativar nem rebaixar a si mesmo, e a casa nunca fica sem admin ativo — sao as duas travas que impedem alguem de se trancar do lado de fora.</p>
<table class="admin"><thead><tr><th>Quem</th><th>Papel</th><th>Acesso</th><th>Senha</th></tr></thead>
<tbody>${linhasUsuarios}</tbody></table>
${criar}
</section>

<section class="bloco">
<h3>Inventario</h3>
<p class="fraco">O que o Proxmox nao sabe: para que serve cada maquina, quem pode ve-la, e se o portal oferece botao de ligar e desligar.</p>
<table class="admin"><thead><tr><th>Maquina</th><th colspan="3">Como o portal a trata</th></tr></thead>
<tbody>${linhasMaquinas}</tbody></table>
</section>

<section class="bloco">
<h3>Registro</h3>
<p class="fraco">As 40 acoes mais recentes, inclusive as recusadas — saber o que alguem tentou vale tanto quanto saber o que conseguiu.</p>
<table class="admin"><thead><tr><th>Quando</th><th>Quem</th><th>O que</th><th>Resultado</th></tr></thead>
<tbody>${linhasRegistro}</tbody></table>
</section>`;

  return layout({ titulo: "Administracao", poder: 100, atual: "/administracao", corpoHtml: corpo });
}

export function rotaAdministracao(deps: DepsAdmin): RequestHandler {
  return (req, res) => {
    const s = req.sessao!;
    res.type("html").send(pagina(deps, s.id, s.usuario, ""));
  };
}

// ---------------------------------------------------------------- escrita

/** Responde a um POST recusado: 422 com a pagina inteira e o motivo no topo. */
function recusar(deps: DepsAdmin, req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], motivo: string) {
  const s = req.sessao!;
  res.status(422).type("html").send(pagina(deps, s.id, s.usuario, motivo));
}

export function rotaUsuario(deps: DepsAdmin): RequestHandler {
  return (req, res) => {
    const s = req.sessao!;
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const quem = login(deps.db, s.usuario);

    if (!conferirCsrf(String(corpo.csrf ?? ""), s.id, deps.segredoSessao)) {
      registrar(deps.db, quem, "admin", "usuario", false, "csrf invalido");
      res.status(403).send("Pedido invalido. Recarregue a pagina e tente de novo.");
      return;
    }

    const acao = String(corpo.acao ?? "");

    if (acao === "criar") {
      const novoLogin = String(corpo.login ?? "").trim();
      const nome = String(corpo.nome ?? "").trim();
      const senha = String(corpo.senha ?? "");
      const papel = String(corpo.papel ?? "");
      const erro =
        !novoLogin || !nome ? "Login e nome sao obrigatorios."
        : validarSenha(senha) ??
          (papeis(deps.db).includes(papel) ? null : `O papel "${papel}" nao existe.`);
      if (erro) {
        registrar(deps.db, quem, "criar", novoLogin || "?", false, erro);
        return recusar(deps, req, res, erro);
      }
      // UNIQUE(login) e a fonte da verdade: consultar antes e inserir depois
      // deixaria uma janela entre a consulta e o insert.
      try {
        deps.db.prepare("INSERT INTO usuarios (login,nome,senha,papel,ativo) VALUES (?,?,?,?,1)")
          .run(novoLogin, nome, gerarHash(senha), papel);
      } catch {
        const msg = `O login "${novoLogin}" ja existe.`;
        registrar(deps.db, quem, "criar", novoLogin, false, msg);
        return recusar(deps, req, res, msg);
      }
      registrar(deps.db, quem, "criar", novoLogin, true, `papel ${papel}`);
      res.redirect(303, "/administracao");
      return;
    }

    const alvoId = Number(corpo.id);
    if (!Number.isInteger(alvoId)) return recusar(deps, req, res, "Usuario invalido.");
    const alvo = login(deps.db, alvoId);

    let mudanca: Mudanca;
    if (acao === "senha") mudanca = { tipo: "senha", senha: String(corpo.senha ?? "") };
    else if (acao === "ativo") mudanca = { tipo: "ativo", ativo: String(corpo.ativo) === "1" };
    else if (acao === "papel") mudanca = { tipo: "papel", papel: String(corpo.papel ?? "") };
    else {
      registrar(deps.db, quem, "admin", alvo, false, `acao desconhecida: ${acao}`);
      return recusar(deps, req, res, "Acao desconhecida.");
    }

    const d = podeMexer(deps.db, s.usuario, alvoId, mudanca);
    if (!d.permitido) {
      registrar(deps.db, quem, acao, alvo, false, d.motivo);
      return recusar(deps, req, res, d.motivo);
    }

    if (mudanca.tipo === "senha") {
      deps.db.prepare("UPDATE usuarios SET senha = ? WHERE id = ?")
        .run(gerarHash(mudanca.senha), alvoId);
      // A senha NUNCA entra no detalhe do registro.
      registrar(deps.db, quem, "senha", alvo, true);
    } else if (mudanca.tipo === "ativo") {
      deps.db.prepare("UPDATE usuarios SET ativo = ? WHERE id = ?").run(mudanca.ativo ? 1 : 0, alvoId);
      registrar(deps.db, quem, "ativo", alvo, true, mudanca.ativo ? "ativado" : "desativado");
    } else {
      deps.db.prepare("UPDATE usuarios SET papel = ? WHERE id = ?").run(mudanca.papel, alvoId);
      registrar(deps.db, quem, "papel", alvo, true, `-> ${mudanca.papel}`);
    }

    res.redirect(303, "/administracao");
  };
}

export function rotaMaquina(deps: DepsAdmin): RequestHandler {
  return (req, res) => {
    const s = req.sessao!;
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const quem = login(deps.db, s.usuario);

    if (!conferirCsrf(String(corpo.csrf ?? ""), s.id, deps.segredoSessao)) {
      registrar(deps.db, quem, "admin", "maquina", false, "csrf invalido");
      res.status(403).send("Pedido invalido. Recarregue a pagina e tente de novo.");
      return;
    }

    const vmid = Number(corpo.vmid);
    const existe = Number.isInteger(vmid) &&
      deps.db.prepare("SELECT 1 FROM maquinas WHERE vmid = ?").get(vmid);
    if (!existe) {
      registrar(deps.db, quem, "inventario", String(corpo.vmid ?? "?"), false, "maquina inexistente");
      return recusar(deps, req, res, "Essa maquina nao existe no inventario.");
    }

    const papel = String(corpo.papel_minimo ?? "");
    if (!papeis(deps.db).includes(papel)) {
      const msg = `O papel "${papel}" nao existe.`;
      registrar(deps.db, quem, "inventario", String(vmid), false, msg);
      return recusar(deps, req, res, msg);
    }

    // Caixa desmarcada nao e enviada pelo navegador: ausencia significa 0.
    const acionavel = String(corpo.acionavel ?? "") === "1" ? 1 : 0;
    const descricao = String(corpo.descricao ?? "").trim();

    deps.db.prepare(
      "UPDATE maquinas SET descricao = ?, acionavel = ?, papel_minimo = ? WHERE vmid = ?"
    ).run(descricao, acionavel, papel, vmid);
    registrar(deps.db, quem, "inventario", String(vmid), true,
      `acionavel=${acionavel} papel=${papel}`);

    res.redirect(303, "/administracao");
  };
}
