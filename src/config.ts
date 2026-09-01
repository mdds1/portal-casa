export type Config = {
  porta: number;
  caminhoBanco: string;
  segredoSessao: string;
  pveUrl: string;
  pveToken: string;
  haUrl: string;
  haToken: string;
};

// Falhar no arranque, com o nome da variavel que faltou, e melhor do que subir
// e quebrar so quando alguem abrir a tela que precisa daquele token.
function obrigatoria(env: NodeJS.ProcessEnv, nome: string): string {
  const v = env[nome];
  if (!v) throw new Error(`variavel de ambiente ausente: ${nome}`);
  return v;
}

export function lerConfig(env: NodeJS.ProcessEnv): Config {
  return {
    porta: Number(env.PORTAL_PORTA ?? 3000),
    caminhoBanco: env.PORTAL_BANCO ?? "portal.db",
    segredoSessao: obrigatoria(env, "PORTAL_SEGREDO_SESSAO"),
    pveUrl: obrigatoria(env, "PORTAL_PVE_URL"),
    pveToken: obrigatoria(env, "PORTAL_PVE_TOKEN"),
    haUrl: obrigatoria(env, "PORTAL_HA_URL"),
    haToken: obrigatoria(env, "PORTAL_HA_TOKEN"),
  };
}
