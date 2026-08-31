import type { Resultado } from "./fontes/tipos.js";

export type Instantaneo<T> = {
  dado: T | null;
  em: Date | null;
  desatualizado: boolean;
  erro: string | null;
};

export class Cache<T> {
  private ultimoBom: { dado: T; em: Date } | null = null;
  private ultimoErro: string | null = null;
  private buscadoEm = -Infinity;
  private emVoo: Promise<void> | null = null;

  constructor(
    private buscar: () => Promise<Resultado<T>>,
    private msValidade = 15000,
    private agora: () => number = Date.now
  ) {}

  async obter(): Promise<Instantaneo<T>> {
    if (this.agora() - this.buscadoEm >= this.msValidade) {
      // Uma busca de cada vez: sem isto, tres abas abrindo juntas viram tres
      // consultas simultaneas ao Proxmox.
      this.emVoo ??= this.atualizar().finally(() => { this.emVoo = null; });
      await this.emVoo;
    }
    return {
      dado: this.ultimoBom?.dado ?? null,
      em: this.ultimoBom?.em ?? null,
      desatualizado: this.ultimoErro !== null,
      erro: this.ultimoErro,
    };
  }

  private async atualizar(): Promise<void> {
    const r = await this.buscar();
    this.buscadoEm = this.agora();
    if (r.ok) {
      this.ultimoBom = { dado: r.dado, em: r.em };
      this.ultimoErro = null;
    } else {
      this.ultimoErro = r.erro;
    }
  }
}
