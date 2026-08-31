import { escapar } from "./base.js";

export function cartao(o: {
  titulo: string;
  estado: "ok" | "parado" | "erro" | "velho";
  linhas: string[];
  nota?: string;
}): string {
  const linhas = o.linhas.join("");
  const nota = o.nota ? `<p class="nota">${escapar(o.nota)}</p>` : "";
  return `<section class="cartao">
<h3><span class="ponto ${o.estado}"></span>${escapar(o.titulo)}</h3>
<dl>${linhas}</dl>${nota}</section>`;
}

export function linha(rotulo: string, valor: unknown): string {
  return `<dt>${escapar(rotulo)}</dt><dd>${escapar(valor)}</dd>`;
}
