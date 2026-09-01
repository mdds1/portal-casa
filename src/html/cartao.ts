import { escapar } from "./base.js";

export function cartao(o: {
  titulo: string;
  estado: "ok" | "parado" | "erro" | "velho";
  linhasHtml: string[]; // HTML pronto (cada linha já escapada pela funcao linha())
  nota?: string;
  rodapeHtml?: string; // HTML pronto, ja montado e ja escapado pelo chamador -- mesma convencao de linhasHtml
}): string {
  const linhasHtml = o.linhasHtml.join("");
  const nota = o.nota ? `<p class="nota">${escapar(o.nota)}</p>` : "";
  const rodape = o.rodapeHtml ?? "";
  return `<section class="cartao">
<h3><span class="ponto ${escapar(o.estado)}"></span>${escapar(o.titulo)}</h3>
<dl>${linhasHtml}</dl>${nota}${rodape}</section>`;
}

// O <span class="fio"> entre o rotulo e o valor e o pontilhado que liga os
// dois quando a distancia cresce. Sem ele, rotulo curto e valor longo ficam
// orfaos nas pontas da linha e o olho perde o par.
export function linha(rotulo: string, valor: unknown): string {
  return `<div class="par"><dt>${escapar(rotulo)}</dt><span class="fio"></span><dd>${escapar(valor)}</dd></div>`;
}
