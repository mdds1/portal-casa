import type { RequestHandler } from "express";
import { listarMaquinas } from "../db/inventario.js";
import { layout, escapar } from "../html/base.js";
import type { DepsTela } from "./inicio.js";

function gb(bytes: number): string {
  return bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "—";
}

export function rotaInfraestrutura(deps: DepsTela): RequestHandler {
  return async (req, res) => {
    const papel = req.sessao!.papel;
    const maquinas = listarMaquinas(deps.db, papel);
    const pve = await deps.caches.pve.obter();

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
</tr>`;
    }).join("");

    const aviso = pve.desatualizado
      ? `<p class="nota">Estado desatualizado${pve.em ? `, de ${escapar(pve.em.toLocaleTimeString("pt-BR"))}` : ""}: ${escapar(pve.erro)}</p>`
      : "";

    res.type("html").send(layout({
      titulo: "Infraestrutura",
      papel,
      atual: "/infraestrutura",
      corpoHtml: `<h1>Infraestrutura</h1>${aviso}
<div style="overflow-x:auto">
<table>
<thead><tr><th>ID</th><th>Maquina</th><th>Estado</th><th>IP</th><th>Memoria</th><th>Volta sozinha</th></tr></thead>
<tbody>${linhas}</tbody>
</table></div>`,
    }));
  };
}
