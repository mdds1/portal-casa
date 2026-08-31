# Portal da Casa — primeira fatia

> **Para trabalhadores agenticos:** SUB-SKILL OBRIGATORIA: use
> superpowers:subagent-driven-development (recomendado) ou
> superpowers:executing-plans para implementar tarefa a tarefa. Os passos usam
> caixas (`- [ ]`) para acompanhamento.

**Objetivo:** entregar o portal em modo somente leitura — login com dois papeis,
tela Inicio, tela Infraestrutura e o inventario SQLite populado com a casa real.

**Arquitetura:** um processo Node com TypeScript no CT 103. Ele le tres fontes
(API do Proxmox, API do Home Assistant, conexao TCP direta), guarda o resultado
em um cache de 15 segundos e renderiza HTML no servidor. O inventario SQLite
descreve o que as APIs nao sabem — para que serve cada maquina, quem pode ver o
que — e e dele que os cartoes sao montados.

**Tecnologia:** Node 20 (o que Debian 13 entrega, igual na bancada e no CT 103),
TypeScript, Express 5, better-sqlite3, e `node:test` para os testes. Hash de
senha com `scrypt` do `node:crypto`. Nenhuma dependencia nativa alem do
better-sqlite3, que baixa binario pronto para Node 20 em x86_64.

## Restricoes globais

Valem para toda tarefa, copiadas do spec (secao 8):

- Nada de reinstalar, apagar ou remover o que existe.
- Nada de alterar rede, firewall, discos ou storages fora do escrito aqui.
- Nenhuma porta nova exposta para a internet.
- A senha de root nunca entra no portal.
- Credenciais nunca no codigo e nunca no git: nem senhas, nem tokens, nem chaves
  de API, nem `.env`, nem certificados privados.
- O painel do Proxmox nao fica aberto para a internet.
- **Nenhuma acao de escrita nesta fatia.** Nenhuma rota POST alem do login, e
  nenhum caminho que ligue, desligue ou altere maquina. O wrapper de acoes e
  desenhado na fatia seguinte.
- O papel e conferido **no servidor**, em toda requisicao. Esconder botao e
  conveniencia, nao seguranca.
- Toda saida HTML passa por escape. Nada de concatenar dado de fonte externa
  direto no template.
- O desenvolvimento acontece na bancada (VM 110). O CT 103 so recebe o resultado,
  na ultima tarefa.

## Estrutura de arquivos

    src/
      index.ts               arranque: le config, abre banco, escuta
      app.ts                 montagem do Express e das rotas
      config.ts              variaveis de ambiente, com falha explicita se faltar
      db/
        esquema.sql          DDL das tabelas
        conexao.ts           abre o SQLite e aplica o esquema
        inventario.ts        consultas tipadas sobre o inventario
        semente.ts           popula o inventario com a casa real
      auth/
        senha.ts             hash e verificacao com scrypt
        sessao.ts            cookie assinado + tabela de sessoes
        middleware.ts        exigirLogin e exigirPapel
      fontes/
        tipos.ts             o tipo Resultado<T>, comum as tres fontes
        proxmox.ts           API do Proxmox (somente leitura)
        homeassistant.ts     API REST do Home Assistant
        porta.ts             checagem TCP direta
      cache.ts               cache de 15s que guarda o ultimo valor bom
      html/
        base.ts              escape, layout, navegacao
        cartao.ts            o componente de cartao
      telas/
        login.ts
        inicio.ts
        infraestrutura.ts
    test/
      (espelha src/, um arquivo por modulo)

Cada arquivo tem uma responsabilidade. As tres fontes ficam separadas porque
falham de formas diferentes e sao testadas com respostas gravadas distintas.

---

### Task 1: Esqueleto do projeto e servidor que responde

**Arquivos:**
- Criar: `package.json`, `tsconfig.json`, `.gitignore`, `src/index.ts`,
  `src/app.ts`, `src/config.ts`
- Teste: `test/app.test.ts`

**Interfaces:**
- Consome: nada.
- Produz: `criarApp(deps: Deps): express.Express` e
  `type Deps = { db: Database.Database }`. Toda tarefa seguinte acrescenta rota
  dentro de `criarApp`. `lerConfig(env: NodeJS.ProcessEnv): Config` e
  `type Config = { porta: number; caminhoBanco: string; segredoSessao: string;
  pveUrl: string; pveToken: string; haUrl: string; haToken: string }`.

- [ ] **Passo 1: iniciar o projeto**

```bash
cd ~/projetos/portal-casa
npm init -y
npm install express@^5 better-sqlite3
npm install -D typescript @types/node @types/express @types/better-sqlite3 tsx
```

Acrescente `"type": "module"` ao `package.json`. Sem isso os imports com
extensao `.js` e o `import.meta.url` da Task 2 nao funcionam.

- [ ] **Passo 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "node16",
    "moduleResolution": "node16",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src", "test", "scripts"]
}
```

- [ ] **Passo 3: `.gitignore`**

Credencial nunca entra no git. Esta lista e a primeira linha de defesa disso.

```
node_modules/
dist/
*.db
*.db-journal
.env
.env.*
```

- [ ] **Passo 4: escrever o teste que falha**

`test/app.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { criarApp } from "../src/app.js";

test("GET /saude responde ok", async () => {
  const app = criarApp({ db: new Database(":memory:") });
  const servidor = app.listen(0);
  const porta = (servidor.address() as { port: number }).port;
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/saude`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  } finally {
    servidor.close();
  }
});

test("lerConfig falha com mensagem clara quando falta variavel", async () => {
  const { lerConfig } = await import("../src/config.js");
  assert.throws(
    () => lerConfig({}),
    /PORTAL_SEGREDO_SESSAO/,
    "a mensagem precisa dizer QUAL variavel faltou"
  );
});
```

- [ ] **Passo 5: rodar e confirmar que falha**

```bash
npx tsx --test test/app.test.ts
```

Esperado: FALHA, `Cannot find module '../src/app.js'`.

- [ ] **Passo 6: `src/config.ts`**

```typescript
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
```

- [ ] **Passo 7: `src/app.ts`**

```typescript
import express from "express";
import type Database from "better-sqlite3";

export type Deps = { db: Database.Database };

export function criarApp(deps: Deps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));

  app.get("/saude", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}
```

- [ ] **Passo 8: `src/index.ts`**

```typescript
import { lerConfig } from "./config.js";
import { abrirBanco } from "./db/conexao.js";
import { criarApp } from "./app.js";

const config = lerConfig(process.env);
const db = abrirBanco(config.caminhoBanco);
criarApp({ db }).listen(config.porta, () => {
  console.log(`portal escutando em ${config.porta}`);
});
```

Este arquivo referencia `abrirBanco`, criado na Task 2. Ate la ele nao compila,
e isso e esperado — o teste da Task 1 exercita `criarApp`, nao o arranque.

- [ ] **Passo 9: rodar e confirmar que passa**

```bash
npx tsx --test test/app.test.ts
```

Esperado: 2 testes passando.

- [ ] **Passo 10: comitar**

```bash
git add package.json package-lock.json tsconfig.json .gitignore src test
git commit -m "portal: esqueleto do projeto e rota de saude"
```

---

### Task 2: Esquema do inventario e acesso ao banco

**Arquivos:**
- Criar: `src/db/esquema.sql`, `src/db/conexao.ts`, `src/db/inventario.ts`
- Teste: `test/inventario.test.ts`

**Interfaces:**
- Consome: nada da Task 1 alem do projeto montado.
- Produz: `abrirBanco(caminho: string): Database.Database`;
  `type Maquina = { id: number; tipo: "vm" | "ct"; vmid: number; nome: string;
  descricao: string; ip: string | null; onboot: 0 | 1; papel_minimo: string }`;
  `type Servico = { id: number; maquina_vmid: number; nome: string;
  descricao: string; porta: number | null; host_checagem: string | null;
  url: string | null; papel_minimo: string }`;
  `listarMaquinas(db, papel: string): Maquina[]`;
  `listarServicos(db, papel: string): Servico[]`.

- [ ] **Passo 1: `src/db/esquema.sql`**

```sql
-- O inventario guarda o que as APIs NAO sabem: para que serve cada maquina,
-- quem pode ver o que, qual porta e de que. As APIs sabem estado; isto sabe
-- significado.

CREATE TABLE IF NOT EXISTS papeis (
  nome  TEXT PRIMARY KEY,
  poder INTEGER NOT NULL   -- maior vence; admin=100, casa=10
);

CREATE TABLE IF NOT EXISTS usuarios (
  id      INTEGER PRIMARY KEY,
  login   TEXT NOT NULL UNIQUE,
  nome    TEXT NOT NULL,
  senha   TEXT NOT NULL,          -- scrypt, formato "scrypt$<sal>$<hash>"
  papel   TEXT NOT NULL REFERENCES papeis(nome),
  ativo   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS maquinas (
  id           INTEGER PRIMARY KEY,
  tipo         TEXT NOT NULL CHECK (tipo IN ('vm','ct')),
  vmid         INTEGER NOT NULL UNIQUE,
  nome         TEXT NOT NULL,
  descricao    TEXT NOT NULL,
  ip           TEXT,
  onboot       INTEGER NOT NULL DEFAULT 0,
  papel_minimo TEXT NOT NULL REFERENCES papeis(nome)
);

CREATE TABLE IF NOT EXISTS servicos (
  id            INTEGER PRIMARY KEY,
  maquina_vmid  INTEGER NOT NULL REFERENCES maquinas(vmid),
  nome          TEXT NOT NULL,
  descricao     TEXT NOT NULL,
  porta         INTEGER,
  host_checagem TEXT,
  url           TEXT,
  papel_minimo  TEXT NOT NULL REFERENCES papeis(nome)
);

CREATE TABLE IF NOT EXISTS dependencias (
  servico_id   INTEGER NOT NULL REFERENCES servicos(id),
  depende_de   INTEGER NOT NULL REFERENCES servicos(id),
  observacao   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (servico_id, depende_de)
);

CREATE TABLE IF NOT EXISTS sessoes (
  id       TEXT PRIMARY KEY,
  usuario  INTEGER NOT NULL REFERENCES usuarios(id),
  criada   TEXT NOT NULL,
  expira   TEXT NOT NULL
);

-- Existe desde ja, mesmo sem acoes de escrita nesta fatia: o login entra aqui.
CREATE TABLE IF NOT EXISTS acoes_log (
  id       INTEGER PRIMARY KEY,
  quando   TEXT NOT NULL,
  usuario  TEXT NOT NULL,
  verbo    TEXT NOT NULL,
  alvo     TEXT NOT NULL,
  ok       INTEGER NOT NULL,
  detalhe  TEXT NOT NULL DEFAULT ''
);
```

- [ ] **Passo 2: escrever o teste que falha**

`test/inventario.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { listarMaquinas, listarServicos } from "../src/db/inventario.js";

function bancoDeTeste() {
  const db = abrirBanco(":memory:");
  db.prepare("INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run("vm", 301, "floripaot", "Servidor de Tibia", "192.168.15.11", 1, "admin");
  db.prepare("INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run("ct", 201, "jellyfin", "Midia da casa", "192.168.15.15", 0, "casa");
  db.prepare("INSERT INTO servicos (maquina_vmid,nome,descricao,porta,host_checagem,url,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run(201, "Jellyfin", "Filmes e series", 8096, "192.168.15.15", null, "casa");
  db.prepare("INSERT INTO servicos (maquina_vmid,nome,descricao,porta,host_checagem,url,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run(301, "Jogo FloripaOT", "Porta de login", 7171, "192.168.15.11", null, "admin");
  return db;
}

test("o esquema e aplicado na abertura, e reaplicar nao quebra", () => {
  const db = abrirBanco(":memory:");
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const nomes = t.map((x) => x.name).sort();
  for (const esperada of ["acoes_log", "dependencias", "maquinas", "papeis", "servicos", "sessoes", "usuarios"]) {
    assert.ok(nomes.includes(esperada), `faltou a tabela ${esperada}`);
  }
});

test("papeis vem semeados com admin e casa", () => {
  const db = abrirBanco(":memory:");
  const p = db.prepare("SELECT nome, poder FROM papeis ORDER BY poder DESC").all();
  assert.deepEqual(p, [{ nome: "admin", poder: 100 }, { nome: "casa", poder: 10 }]);
});

test("papel casa NAO enxerga maquina de admin", () => {
  const db = bancoDeTeste();
  const vistas = listarMaquinas(db, "casa").map((m) => m.nome);
  assert.deepEqual(vistas, ["jellyfin"]);
});

test("papel admin enxerga tudo", () => {
  const db = bancoDeTeste();
  assert.equal(listarMaquinas(db, "admin").length, 2);
  assert.equal(listarServicos(db, "admin").length, 2);
});

test("papel casa NAO enxerga servico de admin", () => {
  const db = bancoDeTeste();
  const vistos = listarServicos(db, "casa").map((s) => s.nome);
  assert.deepEqual(vistos, ["Jellyfin"]);
});
```

- [ ] **Passo 3: rodar e confirmar que falha**

```bash
npx tsx --test test/inventario.test.ts
```

Esperado: FALHA, `Cannot find module '../src/db/conexao.js'`.

- [ ] **Passo 4: `src/db/conexao.ts`**

```typescript
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));

export function abrirBanco(caminho: string): Database.Database {
  const db = new Database(caminho);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(aqui, "esquema.sql"), "utf8"));

  // Os papeis sao estrutura, nao dado de usuario: existem sempre.
  const inserir = db.prepare("INSERT OR IGNORE INTO papeis (nome, poder) VALUES (?, ?)");
  inserir.run("admin", 100);
  inserir.run("casa", 10);

  return db;
}
```

- [ ] **Passo 5: `src/db/inventario.ts`**

```typescript
import type Database from "better-sqlite3";

export type Maquina = {
  id: number;
  tipo: "vm" | "ct";
  vmid: number;
  nome: string;
  descricao: string;
  ip: string | null;
  onboot: 0 | 1;
  papel_minimo: string;
};

export type Servico = {
  id: number;
  maquina_vmid: number;
  nome: string;
  descricao: string;
  porta: number | null;
  host_checagem: string | null;
  url: string | null;
  papel_minimo: string;
};

// O recorte por papel acontece no SQL, nao na tela. Assim nenhum caminho novo
// de renderizacao pode vazar linha que o usuario nao deveria ver.
const FILTRO = `
  papel_minimo IN (
    SELECT nome FROM papeis
    WHERE poder <= (SELECT poder FROM papeis WHERE nome = ?)
  )`;

export function listarMaquinas(db: Database.Database, papel: string): Maquina[] {
  return db
    .prepare(`SELECT * FROM maquinas WHERE ${FILTRO} ORDER BY vmid`)
    .all(papel) as Maquina[];
}

export function listarServicos(db: Database.Database, papel: string): Servico[] {
  return db
    .prepare(`SELECT * FROM servicos WHERE ${FILTRO} ORDER BY nome`)
    .all(papel) as Servico[];
}
```

- [ ] **Passo 6: rodar e confirmar que passa**

```bash
npx tsx --test test/inventario.test.ts
```

Esperado: 5 testes passando.

- [ ] **Passo 7: comitar**

```bash
git add src/db test/inventario.test.ts package.json
git commit -m "portal: esquema do inventario e consultas com recorte por papel"
```

---

### Task 3: Semente com a casa real

**Arquivos:**
- Criar: `src/db/semente.ts`, `scripts/semear.ts`
- Teste: `test/semente.test.ts`

**Interfaces:**
- Consome: `abrirBanco`, `listarMaquinas`, `listarServicos` da Task 2.
- Produz: `semear(db: Database.Database): void`, idempotente.

- [ ] **Passo 1: escrever o teste que falha**

`test/semente.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { listarMaquinas, listarServicos } from "../src/db/inventario.js";

test("semeia as 10 maquinas da casa", () => {
  const db = abrirBanco(":memory:");
  semear(db);
  const m = listarMaquinas(db, "admin");
  assert.equal(m.length, 10);
  const floripa = m.find((x) => x.vmid === 301);
  assert.equal(floripa?.nome, "floripaot");
  assert.equal(floripa?.onboot, 1);
  assert.equal(floripa?.ip, "192.168.15.11");
});

test("semear duas vezes nao duplica", () => {
  const db = abrirBanco(":memory:");
  semear(db);
  const maquinas = listarMaquinas(db, "admin").length;
  const servicos = listarServicos(db, "admin").length;
  semear(db);
  assert.equal(listarMaquinas(db, "admin").length, maquinas);
  assert.equal(listarServicos(db, "admin").length, servicos);
  assert.equal(maquinas, 10);
});

test("a Marcella enxerga midia e casa, nao infraestrutura", () => {
  const db = abrirBanco(":memory:");
  semear(db);
  const nomes = listarServicos(db, "casa").map((s) => s.nome);
  assert.ok(nomes.includes("Jellyfin"), "Jellyfin e da casa");
  assert.ok(!nomes.includes("Jogo FloripaOT"), "servidor de jogo e de admin");
  assert.ok(!nomes.includes("Proxmox"), "o hipervisor nunca e da casa");
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

```bash
npx tsx --test test/semente.test.ts
```

Esperado: FALHA, `Cannot find module '../src/db/semente.js'`.

- [ ] **Passo 3: `src/db/semente.ts`**

Os dados abaixo sao o estado real do parque em 30/08/2026, conferido por
`qm config` e `pct config` no host. `INSERT OR REPLACE` por `vmid` mantem a
funcao idempotente.

```typescript
import type Database from "better-sqlite3";

type LinhaMaquina = [tipo: "vm" | "ct", vmid: number, nome: string, descricao: string, ip: string | null, onboot: 0 | 1, papel: string];

const MAQUINAS: LinhaMaquina[] = [
  ["vm", 110, "tfs-server", "Bancada de desenvolvimento", "192.168.15.10", 0, "admin"],
  ["vm", 111, "home-assistant", "Automacao da casa", "192.168.15.8", 1, "casa"],
  ["vm", 120, "gamebox-batocera", "Emulador na TV", null, 0, "casa"],
  ["vm", 301, "floripaot", "Servidor de Tibia e site, producao", "192.168.15.11", 1, "admin"],
  ["ct", 100, "drive", "Drive de midias por SMB", null, 0, "admin"],
  ["ct", 101, "Jellyfin", "Jellyfin antigo, privilegiado, a remover", null, 0, "admin"],
  ["ct", 102, "Docker", "Containers avulsos", null, 0, "admin"],
  ["ct", 103, "portal", "Porteiro da casa: nginx, tunel e este portal", "192.168.15.14", 1, "admin"],
  ["ct", 104, "starloco", "Servidor de Dofus Retro", "192.168.15.16", 0, "admin"],
  ["ct", 201, "jellyfin", "Midia da casa, nao-privilegiado", "192.168.15.15", 0, "casa"],
];

type LinhaServico = [vmid: number, nome: string, descricao: string, porta: number | null, host: string | null, url: string | null, papel: string];

const SERVICOS: LinhaServico[] = [
  [301, "Site FloripaOT", "Site publico, conta e highscores", 80, "192.168.15.11", "https://floripaot.dinizismo.com.br", "admin"],
  [301, "Jogo FloripaOT", "Porta de login do cliente", 7171, "192.168.15.11", null, "admin"],
  [111, "Home Assistant", "Automacao, so pela Tailscale", 80, "192.168.15.8", "https://ha.dinizismo.com.br", "casa"],
  [201, "Jellyfin", "Filmes e series", 8096, "192.168.15.15", null, "casa"],
  [104, "Dofus login", "StarLoco, servidor de login", 450, "192.168.15.16", null, "admin"],
  [104, "Dofus jogo", "StarLoco, servidor de jogo", 5555, "192.168.15.16", null, "admin"],
  [103, "nginx do portal", "TLS e proxy reverso", 443, "192.168.15.14", null, "admin"],
  [110, "Proxmox", "Interface do hipervisor", 8006, "192.168.15.200", null, "admin"],
];

export function semear(db: Database.Database): void {
  const m = db.prepare(`
    INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(vmid) DO UPDATE SET
      tipo=excluded.tipo, nome=excluded.nome, descricao=excluded.descricao,
      ip=excluded.ip, onboot=excluded.onboot, papel_minimo=excluded.papel_minimo`);

  const s = db.prepare(`
    INSERT INTO servicos (maquina_vmid,nome,descricao,porta,host_checagem,url,papel_minimo)
    SELECT ?,?,?,?,?,?,?
    WHERE NOT EXISTS (SELECT 1 FROM servicos WHERE maquina_vmid=? AND nome=?)`);

  db.transaction(() => {
    for (const l of MAQUINAS) m.run(...l);
    for (const l of SERVICOS) s.run(...l, l[0], l[1]);
  })();
}
```

- [ ] **Passo 4: `scripts/semear.ts`**

```typescript
// Popular um banco de verdade, fora dos testes.
// Uso: PORTAL_BANCO=portal.db npx tsx scripts/semear.ts
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";

const db = abrirBanco(process.env.PORTAL_BANCO ?? "portal.db");
semear(db);
console.log("inventario semeado");
```

- [ ] **Passo 5: rodar e confirmar que passa**

```bash
npx tsx --test test/semente.test.ts
```

Esperado: 3 testes passando.

- [ ] **Passo 6: comitar**

```bash
git add src/db/semente.ts scripts/semear.ts test/semente.test.ts
git commit -m "portal: inventario semeado com o parque real"
```

---

### Task 4: Autenticacao, sessao e papeis

**Arquivos:**
- Criar: `src/auth/senha.ts`, `src/auth/sessao.ts`, `src/auth/middleware.ts`,
  `src/telas/login.ts`, `scripts/criar-usuario.ts`
- Modificar: `src/app.ts` (montar as rotas de login e o middleware)
- Teste: `test/auth.test.ts`

**Interfaces:**
- Consome: `abrirBanco` e os tipos da Task 2.
- Produz: `gerarHash(senha: string): string`;
  `conferirSenha(senha: string, guardado: string): boolean`;
  `abrirSessao(db, usuarioId: number): string`;
  `lerSessao(db, id: string): { usuario: number; papel: string } | null`;
  `assinar(valor: string, segredo: string): string`;
  `verificarAssinatura(assinado: string, segredo: string): string | null`;
  `exigirLogin` e `exigirPapel(papel: string)` como middlewares Express.
  `Deps` ganha `segredoSessao: string`.

- [ ] **Passo 1: escrever o teste que falha**

`test/auth.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarHash, conferirSenha } from "../src/auth/senha.js";
import { assinar, verificarAssinatura } from "../src/auth/sessao.js";

test("a senha guardada nao contem a senha em texto", () => {
  const h = gerarHash("segredo123");
  assert.ok(!h.includes("segredo123"));
  assert.match(h, /^scrypt\$/);
});

test("conferirSenha aceita a certa e recusa a errada", () => {
  const h = gerarHash("segredo123");
  assert.equal(conferirSenha("segredo123", h), true);
  assert.equal(conferirSenha("segredo124", h), false);
});

test("dois hashes da mesma senha sao diferentes (sal)", () => {
  assert.notEqual(gerarHash("igual"), gerarHash("igual"));
});

test("cookie adulterado e recusado", () => {
  const a = assinar("sessao-abc", "segredo-do-servidor");
  assert.equal(verificarAssinatura(a, "segredo-do-servidor"), "sessao-abc");
  assert.equal(verificarAssinatura(a + "x", "segredo-do-servidor"), null);
  assert.equal(verificarAssinatura(a, "outro-segredo"), null,
    "assinatura de outro servidor nao pode valer");
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

```bash
npx tsx --test test/auth.test.ts
```

Esperado: FALHA, `Cannot find module '../src/auth/senha.js'`.

- [ ] **Passo 3: `src/auth/senha.ts`**

```typescript
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt vem no Node. Evita dependencia nativa a mais num container de 512 MB,
// e e adequado para senha (custo de memoria, nao so de CPU).
const N = 16384;

export function gerarHash(senha: string): string {
  const sal = randomBytes(16);
  const hash = scryptSync(senha, sal, 64, { N });
  return `scrypt$${sal.toString("hex")}$${hash.toString("hex")}`;
}

export function conferirSenha(senha: string, guardado: string): boolean {
  const partes = guardado.split("$");
  if (partes.length !== 3 || partes[0] !== "scrypt") return false;
  const sal = Buffer.from(partes[1]!, "hex");
  const esperado = Buffer.from(partes[2]!, "hex");
  const obtido = scryptSync(senha, sal, esperado.length, { N });
  // Comparacao de tempo constante: comparar com === vazaria informacao pelo
  // tempo de resposta.
  return timingSafeEqual(esperado, obtido);
}
```

- [ ] **Passo 4: `src/auth/sessao.ts`**

```typescript
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";

const DURACAO_HORAS = 12;

export function assinar(valor: string, segredo: string): string {
  const mac = createHmac("sha256", segredo).update(valor).digest("hex");
  return `${valor}.${mac}`;
}

export function verificarAssinatura(assinado: string, segredo: string): string | null {
  const corte = assinado.lastIndexOf(".");
  if (corte < 0) return null;
  const valor = assinado.slice(0, corte);
  const mac = assinado.slice(corte + 1);
  const esperado = createHmac("sha256", segredo).update(valor).digest("hex");
  // Buffer.from(x, "hex") ignora silenciosamente lixo no fim de uma string
  // hex invalida (para no primeiro byte que nao forma par valido). Sem esta
  // checagem de tamanho, "assinatura-valida" + "x" decodifica pro MESMO
  // buffer da assinatura original e passaria no timingSafeEqual.
  if (mac.length !== esperado.length) return null;
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(esperado, "hex");
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? valor : null;
}

export function abrirSessao(db: Database.Database, usuarioId: number): string {
  const id = randomBytes(24).toString("hex");
  const agora = new Date();
  const expira = new Date(agora.getTime() + DURACAO_HORAS * 3600 * 1000);
  db.prepare("INSERT INTO sessoes (id,usuario,criada,expira) VALUES (?,?,?,?)")
    .run(id, usuarioId, agora.toISOString(), expira.toISOString());
  return id;
}

export function lerSessao(db: Database.Database, id: string): { usuario: number; papel: string } | null {
  const linha = db.prepare(`
    SELECT s.usuario AS usuario, u.papel AS papel, s.expira AS expira
    FROM sessoes s JOIN usuarios u ON u.id = s.usuario
    WHERE s.id = ? AND u.ativo = 1`).get(id) as
    { usuario: number; papel: string; expira: string } | undefined;
  if (!linha) return null;
  if (new Date(linha.expira) < new Date()) {
    db.prepare("DELETE FROM sessoes WHERE id = ?").run(id);
    return null;
  }
  return { usuario: linha.usuario, papel: linha.papel };
}

export function fecharSessao(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM sessoes WHERE id = ?").run(id);
}
```

- [ ] **Passo 5: rodar e confirmar que passa**

```bash
npx tsx --test test/auth.test.ts
```

Esperado: 4 testes passando.

- [ ] **Passo 6: `src/auth/middleware.ts`**

```typescript
import type { RequestHandler } from "express";
import type Database from "better-sqlite3";
import { lerSessao, verificarAssinatura } from "./sessao.js";

declare global {
  namespace Express {
    interface Request {
      sessao?: { usuario: number; papel: string };
    }
  }
}

const COOKIE = "portal_sessao";

function lerCookie(cabecalho: string | undefined, nome: string): string | null {
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(";")) {
    const [k, ...resto] = parte.trim().split("=");
    if (k === nome) return decodeURIComponent(resto.join("="));
  }
  return null;
}

export function carregarSessao(db: Database.Database, segredo: string): RequestHandler {
  return (req, _res, prox) => {
    const bruto = lerCookie(req.headers.cookie, COOKIE);
    if (bruto) {
      const id = verificarAssinatura(bruto, segredo);
      if (id) {
        const s = lerSessao(db, id);
        if (s) req.sessao = s;
      }
    }
    prox();
  };
}

export const exigirLogin: RequestHandler = (req, res, prox) => {
  if (!req.sessao) return res.redirect("/entrar");
  prox();
};

// O poder do papel vem do banco, nao de uma lista no codigo: acrescentar papel
// novo nao exige mexer aqui.
export function exigirPapel(db: Database.Database, minimo: string): RequestHandler {
  return (req, res, prox) => {
    if (!req.sessao) return res.redirect("/entrar");
    const linha = db.prepare(`
      SELECT (SELECT poder FROM papeis WHERE nome = ?) >= (SELECT poder FROM papeis WHERE nome = ?) AS pode`)
      .get(req.sessao.papel, minimo) as { pode: number };
    if (!linha.pode) return res.status(403).send("Sem permissao.");
    prox();
  };
}

export { COOKIE };
```

- [ ] **Passo 7: acrescentar o teste de papel — a regra que mais importa**

Acrescente ao fim de `test/auth.test.ts`:

```typescript
import Database from "better-sqlite3";
import { abrirBanco } from "../src/db/conexao.js";
import { criarApp } from "../src/app.js";
import { gerarHash as hash } from "../src/auth/senha.js";

async function comServidor(fn: (base: string, db: Database.Database) => Promise<void>) {
  const db = abrirBanco(":memory:");
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("matheus", "Matheus", hash("s1"), "admin");
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("marcella", "Marcella", hash("s2"), "casa");
  const servidor = criarApp({ db, segredoSessao: "teste" }).listen(0);
  const porta = (servidor.address() as { port: number }).port;
  try {
    await fn(`http://127.0.0.1:${porta}`, db);
  } finally {
    servidor.close();
  }
}

async function entrar(base: string, login: string, senha: string): Promise<string> {
  const r = await fetch(`${base}/entrar`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ login, senha }).toString(),
    redirect: "manual",
  });
  return r.headers.get("set-cookie") ?? "";
}

test("login com senha errada nao cria sessao", async () => {
  await comServidor(async (base) => {
    const cookie = await entrar(base, "matheus", "errada");
    assert.equal(cookie, "", "nao pode devolver cookie de sessao");
  });
});

test("usuario casa recebe 403 em rota de admin", async () => {
  await comServidor(async (base) => {
    const cookie = await entrar(base, "marcella", "s2");
    assert.notEqual(cookie, "");
    const r = await fetch(`${base}/infraestrutura`, {
      headers: { cookie: cookie.split(";")[0]! },
      redirect: "manual",
    });
    assert.equal(r.status, 403);
  });
});

test("sem cookie, rota protegida redireciona para o login", async () => {
  await comServidor(async (base) => {
    const r = await fetch(`${base}/infraestrutura`, { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/entrar");
  });
});

test("cookie forjado nao vale", async () => {
  await comServidor(async (base) => {
    const r = await fetch(`${base}/infraestrutura`, {
      headers: { cookie: "portal_sessao=qualquercoisa.deadbeef" },
      redirect: "manual",
    });
    assert.equal(r.status, 302, "deve cair no login, nao entrar");
  });
});
```

- [ ] **Passo 8: `src/telas/login.ts`**

```typescript
import type { Router } from "express";
import express from "express";
import type Database from "better-sqlite3";
import { conferirSenha } from "../auth/senha.js";
import { abrirSessao, assinar, fecharSessao, verificarAssinatura } from "../auth/sessao.js";
import { COOKIE } from "../auth/middleware.js";
import { escapar } from "../html/base.js";

export function rotasLogin(db: Database.Database, segredo: string): Router {
  const r = express.Router();

  r.get("/entrar", (req, res) => {
    const erro = req.query.erro ? "<p class='erro'>Login ou senha invalidos.</p>" : "";
    res.type("html").send(`<!doctype html><meta charset="utf-8">
<title>Entrar — Portal da Casa</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<form method="post" action="/entrar">
  <h1>Portal da Casa</h1>
  ${erro}
  <label>Login <input name="login" autocomplete="username" autofocus></label>
  <label>Senha <input name="senha" type="password" autocomplete="current-password"></label>
  <button>Entrar</button>
</form>`);
  });

  r.post("/entrar", (req, res) => {
    const login = String(req.body.login ?? "");
    const senha = String(req.body.senha ?? "");
    const u = db.prepare("SELECT id, senha FROM usuarios WHERE login = ? AND ativo = 1")
      .get(login) as { id: number; senha: string } | undefined;

    const ok = !!u && conferirSenha(senha, u.senha);
    db.prepare("INSERT INTO acoes_log (quando,usuario,verbo,alvo,ok) VALUES (?,?,?,?,?)")
      .run(new Date().toISOString(), login, "entrar", "portal", ok ? 1 : 0);

    if (!ok) return res.redirect("/entrar?erro=1");

    const id = abrirSessao(db, u!.id);
    res.cookie(COOKIE, assinar(id, segredo), {
      httpOnly: true, sameSite: "lax", secure: true, maxAge: 12 * 3600 * 1000,
    });
    res.redirect("/");
  });

  r.post("/sair", (req, res) => {
    const bruto = req.headers.cookie?.match(/portal_sessao=([^;]+)/)?.[1];
    if (bruto) {
      const id = verificarAssinatura(decodeURIComponent(bruto), segredo);
      if (id) fecharSessao(db, id);
    }
    res.clearCookie(COOKIE);
    res.redirect("/entrar");
  });

  return r;
}
```

Nota: `escapar` so ganha corpo na Task 7. Como esta tarefa ja precisa dele,
crie agora `src/html/base.ts` contendo **apenas** a funcao `escapar` — o codigo
exato esta no Passo 3 da Task 7 — e deixe o resto do arquivo para la.

- [ ] **Passo 9: modificar `src/app.ts`**

```typescript
import express from "express";
import type Database from "better-sqlite3";
import { carregarSessao } from "./auth/middleware.js";
import { rotasLogin } from "./telas/login.js";

export type Deps = { db: Database.Database; segredoSessao: string };

export function criarApp(deps: Deps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.use(carregarSessao(deps.db, deps.segredoSessao));

  app.get("/saude", (_req, res) => { res.json({ ok: true }); });
  app.use(rotasLogin(deps.db, deps.segredoSessao));

  return app;
}
```

Ajuste `test/app.test.ts` para passar `segredoSessao: "teste"` e
`src/index.ts` para passar `config.segredoSessao`.

Acrescente tambem, so para o teste de 403 ter alvo, uma rota provisoria:

```typescript
import { exigirPapel } from "./auth/middleware.js";
app.get("/infraestrutura", exigirPapel(deps.db, "admin"), (_req, res) => {
  res.send("em construcao");
});
```

A Task 9 substitui o corpo dela.

- [ ] **Passo 10: `scripts/criar-usuario.ts`**

```typescript
// Uso: PORTAL_BANCO=portal.db npx tsx scripts/criar-usuario.ts <login> <nome> <papel>
// A senha e lida da entrada padrao para nao ficar no historico do shell.
import { abrirBanco } from "../src/db/conexao.js";
import { gerarHash } from "../src/auth/senha.js";
import { createInterface } from "node:readline/promises";

const [login, nome, papel] = process.argv.slice(2);
if (!login || !nome || !papel) {
  console.error("uso: criar-usuario.ts <login> <nome> <admin|casa>");
  process.exit(2);
}
const rl = createInterface({ input: process.stdin, output: process.stderr });
const senha = await rl.question("senha: ");
rl.close();

const db = abrirBanco(process.env.PORTAL_BANCO ?? "portal.db");
db.prepare(`INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)
  ON CONFLICT(login) DO UPDATE SET nome=excluded.nome, senha=excluded.senha, papel=excluded.papel`)
  .run(login, nome, gerarHash(senha), papel);
console.error(`usuario ${login} gravado como ${papel}`);
```

- [ ] **Passo 11: rodar tudo e confirmar que passa**

```bash
npx tsx --test test/
```

Esperado: todos os testes passando, incluindo os quatro de papel.

- [ ] **Passo 12: comitar**

```bash
git add src test scripts
git commit -m "portal: login, sessao assinada e recorte por papel no servidor"
```

---

### Task 5: As tres fontes de leitura

**Arquivos:**
- Criar: `src/fontes/tipos.ts`, `src/fontes/proxmox.ts`,
  `src/fontes/homeassistant.ts`, `src/fontes/porta.ts`
- Teste: `test/fontes.test.ts`, `test/respostas/pve-nodes.json`,
  `test/respostas/pve-recursos.json`, `test/respostas/ha-estados.json`

**Interfaces:**
- Consome: nada das tarefas anteriores.
- Produz:
  `type Resultado<T> = { ok: true; dado: T; em: Date } | { ok: false; erro: string; em: Date }`;
  `interpretarRecursos(json: unknown): RecursoPve[]` e
  `type RecursoPve = { tipo: "qemu" | "lxc"; vmid: number; nome: string;
  estado: string; cpu: number; memoria: number; memoriaMax: number }`;
  `buscarRecursos(url: string, token: string, fetchFn?: typeof fetch): Promise<Resultado<RecursoPve[]>>`;
  `interpretarEstados(json: unknown): EstadoHa[]` e
  `type EstadoHa = { entidade: string; estado: string; rotulo: string }`;
  `buscarEstados(url: string, token: string, fetchFn?: typeof fetch): Promise<Resultado<EstadoHa[]>>`;
  `checarPorta(host: string, porta: number, msLimite?: number): Promise<Resultado<true>>`.

- [ ] **Passo 1: gravar as respostas reais**

Rode na bancada e salve a saida. Sao as respostas que os testes usam — assim o
parser e testado contra o formato de verdade, sem depender da API no ar.

```bash
mkdir -p test/respostas
# O token do Proxmox e criado no passo seguinte; ate la, use o exemplo abaixo.
```

`test/respostas/pve-recursos.json` (formato real da rota `/cluster/resources`):

```json
{"data":[
 {"id":"qemu/301","type":"qemu","vmid":301,"name":"floripaot","status":"running","cpu":0.021,"mem":2147483648,"maxmem":8589934592,"node":"pve"},
 {"id":"lxc/103","type":"lxc","vmid":103,"name":"portal","status":"running","cpu":0.001,"mem":54525952,"maxmem":536870912,"node":"pve"},
 {"id":"lxc/104","type":"lxc","vmid":104,"name":"starloco","status":"stopped","cpu":0,"mem":0,"maxmem":2147483648,"node":"pve"},
 {"id":"storage/pve/local","type":"storage","storage":"local","status":"available","node":"pve"}
]}
```

`test/respostas/ha-estados.json`:

```json
[
 {"entity_id":"sensor.pve_temperatura","state":"46.0","attributes":{"friendly_name":"Temperatura do PVE"}},
 {"entity_id":"switch.ct_jellyfin","state":"on","attributes":{"friendly_name":"CT Jellyfin"}},
 {"entity_id":"sensor.indisponivel","state":"unavailable","attributes":{"friendly_name":"Sensor fora do ar"}}
]
```

- [ ] **Passo 2: escrever o teste que falha**

`test/fontes.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { interpretarRecursos, buscarRecursos } from "../src/fontes/proxmox.js";
import { interpretarEstados, buscarEstados } from "../src/fontes/homeassistant.js";
import { checarPorta } from "../src/fontes/porta.js";

const pve = JSON.parse(readFileSync("test/respostas/pve-recursos.json", "utf8"));
const ha = JSON.parse(readFileSync("test/respostas/ha-estados.json", "utf8"));

test("o parser do Proxmox ignora o que nao e maquina", () => {
  const r = interpretarRecursos(pve);
  assert.equal(r.length, 3, "storage nao e maquina");
  assert.deepEqual(r.map((x) => x.vmid).sort(), [103, 104, 301]);
});

test("o parser do Proxmox le nome, estado e memoria", () => {
  const r = interpretarRecursos(pve);
  const f = r.find((x) => x.vmid === 301)!;
  assert.equal(f.nome, "floripaot");
  assert.equal(f.estado, "running");
  assert.equal(f.memoriaMax, 8589934592);
});

test("o parser do Proxmox nao explode com resposta torta", () => {
  assert.deepEqual(interpretarRecursos({}), []);
  assert.deepEqual(interpretarRecursos(null), []);
  assert.deepEqual(interpretarRecursos({ data: "nao e lista" }), []);
});

test("API fora do ar vira Resultado de falha, nao excecao", async () => {
  const quebrada: typeof fetch = async () => { throw new Error("ECONNREFUSED"); };
  const r = await buscarRecursos("https://x", "t", quebrada);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /ECONNREFUSED/);
});

test("status HTTP ruim tambem vira falha", async () => {
  const negada: typeof fetch = async () => new Response("nope", { status: 401 });
  const r = await buscarRecursos("https://x", "t", negada);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /401/);
});

test("o token do Proxmox vai no cabecalho no formato PVEAPIToken", async () => {
  let visto = "";
  const espiao: typeof fetch = async (_u, init) => {
    visto = String((init?.headers as Record<string, string>).Authorization);
    return new Response(JSON.stringify(pve), { status: 200 });
  };
  await buscarRecursos("https://x", "portal@pve!leitura=abc", espiao);
  assert.equal(visto, "PVEAPIToken=portal@pve!leitura=abc");
});

test("o parser do HA descarta entidade indisponivel", () => {
  const e = interpretarEstados(ha);
  assert.equal(e.length, 2);
  assert.ok(!e.some((x) => x.entidade === "sensor.indisponivel"));
});

test("o parser do HA usa friendly_name como rotulo", () => {
  const e = interpretarEstados(ha);
  assert.equal(e.find((x) => x.entidade === "sensor.pve_temperatura")!.rotulo, "Temperatura do PVE");
});

test("checarPorta acha porta aberta", async () => {
  const s = createServer().listen(0);
  await new Promise((r) => s.once("listening", r));
  const porta = (s.address() as { port: number }).port;
  try {
    const r = await checarPorta("127.0.0.1", porta, 1000);
    assert.equal(r.ok, true);
  } finally { s.close(); }
});

test("checarPorta devolve falha em porta fechada, sem lancar", async () => {
  const r = await checarPorta("127.0.0.1", 1, 500);
  assert.equal(r.ok, false);
});
```

- [ ] **Passo 3: rodar e confirmar que falha**

```bash
npx tsx --test test/fontes.test.ts
```

Esperado: FALHA, `Cannot find module '../src/fontes/proxmox.js'`.

- [ ] **Passo 4: `src/fontes/tipos.ts`**

```typescript
// Toda fonte externa devolve isto. Nunca lanca excecao para cima: uma API fora
// do ar precisa degradar UM cartao, nunca a pagina inteira.
export type Resultado<T> =
  | { ok: true; dado: T; em: Date }
  | { ok: false; erro: string; em: Date };

export function bom<T>(dado: T): Resultado<T> {
  return { ok: true, dado, em: new Date() };
}

export function ruim<T>(erro: string): Resultado<T> {
  return { ok: false, erro, em: new Date() };
}
```

- [ ] **Passo 5: `src/fontes/proxmox.ts`**

```typescript
import { bom, ruim, type Resultado } from "./tipos.js";

export type RecursoPve = {
  tipo: "qemu" | "lxc";
  vmid: number;
  nome: string;
  estado: string;
  cpu: number;
  memoria: number;
  memoriaMax: number;
};

export function interpretarRecursos(json: unknown): RecursoPve[] {
  const dados = (json as { data?: unknown })?.data;
  if (!Array.isArray(dados)) return [];
  const saida: RecursoPve[] = [];
  for (const bruto of dados) {
    const r = bruto as Record<string, unknown>;
    if (r.type !== "qemu" && r.type !== "lxc") continue;
    saida.push({
      tipo: r.type,
      vmid: Number(r.vmid ?? 0),
      nome: String(r.name ?? ""),
      estado: String(r.status ?? "desconhecido"),
      cpu: Number(r.cpu ?? 0),
      memoria: Number(r.mem ?? 0),
      memoriaMax: Number(r.maxmem ?? 0),
    });
  }
  return saida;
}

export async function buscarRecursos(
  url: string,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<Resultado<RecursoPve[]>> {
  try {
    const r = await fetchFn(`${url}/api2/json/cluster/resources`, {
      headers: { Authorization: `PVEAPIToken=${token}` },
    });
    if (!r.ok) return ruim(`Proxmox respondeu ${r.status}`);
    return bom(interpretarRecursos(await r.json()));
  } catch (e) {
    return ruim(e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Passo 6: `src/fontes/homeassistant.ts`**

```typescript
import { bom, ruim, type Resultado } from "./tipos.js";

export type EstadoHa = { entidade: string; estado: string; rotulo: string };

export function interpretarEstados(json: unknown): EstadoHa[] {
  if (!Array.isArray(json)) return [];
  const saida: EstadoHa[] = [];
  for (const bruto of json) {
    const e = bruto as Record<string, unknown>;
    const estado = String(e.state ?? "");
    // "unavailable" e "unknown" nao sao valor: mostrar isso na tela e pior do
    // que omitir, porque parece dado.
    if (estado === "unavailable" || estado === "unknown" || estado === "") continue;
    const attrs = (e.attributes ?? {}) as Record<string, unknown>;
    saida.push({
      entidade: String(e.entity_id ?? ""),
      estado,
      rotulo: String(attrs.friendly_name ?? e.entity_id ?? ""),
    });
  }
  return saida;
}

export async function buscarEstados(
  url: string,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<Resultado<EstadoHa[]>> {
  try {
    const r = await fetchFn(`${url}/api/states`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return ruim(`Home Assistant respondeu ${r.status}`);
    return bom(interpretarEstados(await r.json()));
  } catch (e) {
    return ruim(e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Passo 7: `src/fontes/porta.ts`**

```typescript
import { Socket } from "node:net";
import { bom, ruim, type Resultado } from "./tipos.js";

// Nem tudo aparece nas APIs: o servidor de Tibia, o de Dofus e o site so
// respondem "estou vivo" abrindo conexao na porta.
export function checarPorta(host: string, porta: number, msLimite = 2000): Promise<Resultado<true>> {
  return new Promise((resolver) => {
    const s = new Socket();
    let respondido = false;
    const terminar = (r: Resultado<true>) => {
      if (respondido) return;
      respondido = true;
      s.destroy();
      resolver(r);
    };
    s.setTimeout(msLimite);
    s.once("connect", () => terminar(bom(true as const)));
    s.once("timeout", () => terminar(ruim(`sem resposta em ${msLimite} ms`)));
    s.once("error", (e) => terminar(ruim(e.message)));
    s.connect(porta, host);
  });
}
```

- [ ] **Passo 8: rodar e confirmar que passa**

```bash
npx tsx --test test/fontes.test.ts
```

Esperado: 10 testes passando.

- [ ] **Passo 9: comitar**

```bash
git add src/fontes test/fontes.test.ts test/respostas
git commit -m "portal: leitura do Proxmox, do Home Assistant e de portas TCP"
```

---

### Task 6: Cache de 15 segundos que preserva o ultimo valor bom

**Arquivos:**
- Criar: `src/cache.ts`
- Teste: `test/cache.test.ts`

**Interfaces:**
- Consome: `Resultado<T>` da Task 5.
- Produz: `class Cache<T>` com
  `constructor(buscar: () => Promise<Resultado<T>>, msValidade = 15000, agora: () => number = Date.now)`,
  `obter(): Promise<Instantaneo<T>>` e `parar(): void`; e
  `type Instantaneo<T> = { dado: T | null; em: Date | null; desatualizado: boolean; erro: string | null }`.

- [ ] **Passo 1: escrever o teste que falha**

`test/cache.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { Cache } from "../src/cache.js";
import { bom, ruim, type Resultado } from "../src/fontes/tipos.js";

test("a primeira chamada busca; a segunda, dentro da validade, nao", async () => {
  let chamadas = 0;
  const c = new Cache<number>(async () => { chamadas++; return bom(chamadas); }, 15000);
  assert.equal((await c.obter()).dado, 1);
  assert.equal((await c.obter()).dado, 1);
  assert.equal(chamadas, 1, "cinco abas abertas nao podem virar cinco consultas");
});

test("passada a validade, busca de novo", async () => {
  let chamadas = 0;
  let relogio = 1000;
  const c = new Cache<number>(async () => { chamadas++; return bom(chamadas); }, 15000, () => relogio);
  await c.obter();
  relogio += 16000;
  assert.equal((await c.obter()).dado, 2);
});

test("falha depois de sucesso mantem o ultimo valor bom, marcado", async () => {
  let quebrar = false;
  let relogio = 1000;
  const buscar = async (): Promise<Resultado<string>> => quebrar ? ruim("caiu") : bom("valor-bom");
  const c = new Cache<string>(buscar, 15000, () => relogio);

  const primeiro = await c.obter();
  assert.equal(primeiro.desatualizado, false);

  quebrar = true;
  relogio += 16000;
  const segundo = await c.obter();
  assert.equal(segundo.dado, "valor-bom", "o dado velho e melhor que nenhum dado");
  assert.equal(segundo.desatualizado, true, "mas a tela precisa saber que e velho");
  assert.equal(segundo.erro, "caiu");
});

test("falha logo na primeira busca devolve nada, sem lancar", async () => {
  const c = new Cache<string>(async () => ruim("nunca funcionou"), 15000);
  const i = await c.obter();
  assert.equal(i.dado, null);
  assert.equal(i.erro, "nunca funcionou");
  assert.equal(i.desatualizado, true);
});

test("chamadas simultaneas nao disparam duas buscas", async () => {
  let chamadas = 0;
  const c = new Cache<number>(async () => {
    chamadas++;
    await new Promise((r) => setTimeout(r, 20));
    return bom(chamadas);
  }, 15000);
  await Promise.all([c.obter(), c.obter(), c.obter()]);
  assert.equal(chamadas, 1);
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

```bash
npx tsx --test test/cache.test.ts
```

Esperado: FALHA, `Cannot find module '../src/cache.js'`.

- [ ] **Passo 3: `src/cache.ts`**

```typescript
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
```

- [ ] **Passo 4: rodar e confirmar que passa**

```bash
npx tsx --test test/cache.test.ts
```

Esperado: 5 testes passando.

- [ ] **Passo 5: comitar**

```bash
git add src/cache.ts test/cache.test.ts
git commit -m "portal: cache de 15s que degrada mostrando o ultimo valor bom"
```

---

### Task 7: Renderizacao de HTML com escape

**Arquivos:**
- Criar/completar: `src/html/base.ts`, `src/html/cartao.ts`
- Teste: `test/html.test.ts`

**Interfaces:**
- Consome: nada.
- Produz: `escapar(v: unknown): string`;
  `layout(o: { titulo: string; papel: string; atual: string; corpo: string }): string`;
  `cartao(o: { titulo: string; estado: "ok" | "parado" | "erro" | "velho"; linhas: string[]; nota?: string }): string`.

- [ ] **Passo 1: escrever o teste que falha**

`test/html.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapar, layout } from "../src/html/base.js";
import { cartao } from "../src/html/cartao.js";

test("escapar neutraliza script", () => {
  assert.equal(escapar("<script>alert(1)</script>"),
    "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("escapar cuida de aspas e do e-comercial", () => {
  assert.equal(escapar(`a"b'c&d`), "a&quot;b&#39;c&amp;d");
});

test("escapar aceita numero, nulo e indefinido sem quebrar", () => {
  assert.equal(escapar(42), "42");
  assert.equal(escapar(null), "");
  assert.equal(escapar(undefined), "");
});

test("nome de maquina malicioso nao vira HTML no cartao", () => {
  const h = cartao({ titulo: `<img src=x onerror=alert(1)>`, estado: "ok", linhas: [] });
  assert.ok(!h.includes("<img"), "o nome veio da API do Proxmox: nunca confiar");
  assert.ok(h.includes("&lt;img"));
});

test("o menu esconde Infraestrutura do papel casa", () => {
  const dela = layout({ titulo: "t", papel: "casa", atual: "/", corpo: "" });
  assert.ok(!dela.includes("/infraestrutura"));
  const dele = layout({ titulo: "t", papel: "admin", atual: "/", corpo: "" });
  assert.ok(dele.includes("/infraestrutura"));
});

test("o layout declara viewport, porque a tela dela e o celular", () => {
  assert.ok(layout({ titulo: "t", papel: "casa", atual: "/", corpo: "" })
    .includes('name="viewport"'));
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

```bash
npx tsx --test test/html.test.ts
```

Esperado: FALHA.

- [ ] **Passo 3: `src/html/base.ts`**

```typescript
// Tudo que vem do Proxmox, do Home Assistant ou do banco passa por aqui antes
// de virar HTML. Nome de VM e texto que alguem escolheu: e entrada, nao codigo.
export function escapar(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const ESTILO = `
:root { color-scheme: light dark; --fundo:#f6f6f7; --cartao:#fff; --borda:#e2e2e5; --texto:#1a1a1c; --fraco:#6b6b70; }
@media (prefers-color-scheme: dark) {
  :root { --fundo:#151517; --cartao:#1e1e21; --borda:#2e2e33; --texto:#ececee; --fraco:#9a9aa0; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--fundo); color:var(--texto);
  font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; }
header { display:flex; gap:1rem; align-items:center; flex-wrap:wrap;
  padding:.75rem 1rem; background:var(--cartao); border-bottom:1px solid var(--borda); }
header a { color:inherit; text-decoration:none; padding:.35rem .6rem; border-radius:6px; }
header a[aria-current="page"] { background:var(--fundo); font-weight:600; }
main { padding:1rem; max-width:1100px; margin:0 auto; }
.grade { display:grid; gap:.75rem; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); }
.cartao { background:var(--cartao); border:1px solid var(--borda); border-radius:10px; padding:.85rem; }
.cartao h3 { margin:0 0 .5rem; font-size:1rem; display:flex; align-items:center; gap:.5rem; }
.ponto { width:.6rem; height:.6rem; border-radius:50%; flex:none; }
.ponto.ok{background:#2e9e4f}.ponto.parado{background:#8a8a90}
.ponto.erro{background:#d13b3b}.ponto.velho{background:#d19a1e}
.cartao dl { margin:0; display:grid; grid-template-columns:auto 1fr; gap:.15rem .5rem; }
.cartao dt { color:var(--fraco); }
.cartao dd { margin:0; text-align:right; }
.nota { margin:.5rem 0 0; color:var(--fraco); font-size:.85rem; }
form.sair { margin-left:auto; }
button { font:inherit; padding:.35rem .7rem; border-radius:6px;
  border:1px solid var(--borda); background:var(--fundo); color:inherit; cursor:pointer; }
@media (max-width:520px) { .grade { grid-template-columns:1fr; } }
`;

type ItemMenu = { href: string; rotulo: string; papel: string };

const MENU: ItemMenu[] = [
  { href: "/", rotulo: "Inicio", papel: "casa" },
  { href: "/infraestrutura", rotulo: "Infraestrutura", papel: "admin" },
];

export function layout(o: { titulo: string; papel: string; atual: string; corpo: string }): string {
  const itens = MENU
    .filter((i) => o.papel === "admin" || i.papel === "casa")
    .map((i) => `<a href="${i.href}"${i.href === o.atual ? ' aria-current="page"' : ""}>${escapar(i.rotulo)}</a>`)
    .join("");

  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(o.titulo)} — Portal da Casa</title>
<style>${ESTILO}</style>
<header>${itens}<form class="sair" method="post" action="/sair"><button>Sair</button></form></header>
<main>${o.corpo}</main></html>`;
}
```

- [ ] **Passo 4: `src/html/cartao.ts`**

```typescript
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
```

- [ ] **Passo 5: rodar e confirmar que passa**

```bash
npx tsx --test test/html.test.ts
```

Esperado: 6 testes passando.

- [ ] **Passo 6: comitar**

```bash
git add src/html test/html.test.ts
git commit -m "portal: layout e cartoes, com escape em toda saida"
```

---

### Task 8: Tela Inicio

**Arquivos:**
- Criar: `src/telas/inicio.ts`
- Modificar: `src/app.ts` (montar a rota e criar os caches), `src/index.ts`
- Teste: `test/inicio.test.ts`

**Interfaces:**
- Consome: `Cache`/`Instantaneo` (Task 6), `listarServicos` (Task 2),
  `checarPorta` (Task 5), `layout`/`cartao`/`linha` (Task 7),
  `exigirLogin` (Task 4).
- Produz: `rotaInicio(deps: DepsTela): RequestHandler` e
  `type DepsTela = { db: Database.Database; caches: Caches }`,
  `type Caches = { pve: Cache<RecursoPve[]>; ha: Cache<EstadoHa[]> }`.
  `Deps` de `criarApp` ganha `caches: Caches`.

- [ ] **Passo 1: escrever o teste que falha**

`test/inicio.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash } from "../src/auth/senha.js";
import { criarApp } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { bom, ruim, type Resultado } from "../src/fontes/tipos.js";
import type { RecursoPve } from "../src/fontes/proxmox.js";
import type { EstadoHa } from "../src/fontes/homeassistant.js";

const RECURSOS: RecursoPve[] = [
  { tipo: "qemu", vmid: 301, nome: "floripaot", estado: "running", cpu: 0.02, memoria: 2e9, memoriaMax: 8e9 },
  { tipo: "lxc", vmid: 201, nome: "jellyfin", estado: "stopped", cpu: 0, memoria: 0, memoriaMax: 2e9 },
];

async function servidor(caches: {
  pve?: () => Promise<Resultado<RecursoPve[]>>;
  ha?: () => Promise<Resultado<EstadoHa[]>>;
} = {}) {
  const db = abrirBanco(":memory:");
  semear(db);
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("matheus", "Matheus", gerarHash("s1"), "admin");
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("marcella", "Marcella", gerarHash("s2"), "casa");
  const app = criarApp({
    db,
    segredoSessao: "teste",
    caches: {
      pve: new Cache(caches.pve ?? (async () => bom(RECURSOS))),
      ha: new Cache(caches.ha ?? (async () => bom([] as EstadoHa[]))),
    },
  });
  const s = app.listen(0);
  const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  const entrar = async (login: string, senha: string) => {
    const r = await fetch(`${base}/entrar`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ login, senha }).toString(),
      redirect: "manual",
    });
    return (r.headers.get("set-cookie") ?? "").split(";")[0]!;
  };
  return { base, s, entrar };
}

test("o admin ve o servidor de jogo na Inicio", async () => {
  const { base, s, entrar } = await servidor();
  try {
    const c = await entrar("matheus", "s1");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();
    assert.ok(html.includes("Jogo FloripaOT"));
  } finally { s.close(); }
});

test("a Marcella NAO ve o servidor de jogo na Inicio", async () => {
  const { base, s, entrar } = await servidor();
  try {
    const c = await entrar("marcella", "s2");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();
    assert.ok(html.includes("Jellyfin"), "o que e dela aparece");
    assert.ok(!html.includes("Jogo FloripaOT"), "o que nao e dela, nao");
    assert.ok(!html.includes("Proxmox"));
  } finally { s.close(); }
});

test("Proxmox fora do ar degrada o cartao, nao a pagina", async () => {
  const { base, s, entrar } = await servidor({ pve: async () => ruim<RecursoPve[]>("caiu") });
  try {
    const c = await entrar("matheus", "s1");
    const r = await fetch(base + "/", { headers: { cookie: c } });
    assert.equal(r.status, 200, "a pagina inteira nao pode cair junto");
    const html = await r.text();
    assert.ok(/desatualizado|indispon/i.test(html), "e precisa dizer que esta ruim");
  } finally { s.close(); }
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

```bash
npx tsx --test test/inicio.test.ts
```

Esperado: FALHA.

- [ ] **Passo 3: `src/telas/inicio.ts`**

```typescript
import type { RequestHandler } from "express";
import type Database from "better-sqlite3";
import type { Cache } from "../cache.js";
import type { RecursoPve } from "../fontes/proxmox.js";
import type { EstadoHa } from "../fontes/homeassistant.js";
import { listarServicos } from "../db/inventario.js";
import { checarPorta } from "../fontes/porta.js";
import { layout } from "../html/base.js";
import { cartao, linha } from "../html/cartao.js";

export type Caches = { pve: Cache<RecursoPve[]>; ha: Cache<EstadoHa[]> };
export type DepsTela = { db: Database.Database; caches: Caches };

export function rotaInicio(deps: DepsTela): RequestHandler {
  return async (req, res) => {
    const papel = req.sessao!.papel;
    const servicos = listarServicos(deps.db, papel);
    const pve = await deps.caches.pve.obter();

    // As checagens de porta correm juntas: em serie, oito servicos com dois
    // segundos de limite cada dariam dezesseis segundos de pagina em branco.
    const checagens = await Promise.all(
      servicos.map(async (s) =>
        s.host_checagem && s.porta
          ? { s, r: await checarPorta(s.host_checagem, s.porta, 1500) }
          : { s, r: null }
      )
    );

    const cartoes = checagens.map(({ s, r }) => {
      const maquina = pve.dado?.find((m) => m.vmid === s.maquina_vmid);
      const estado = r === null ? "parado" : r.ok ? "ok" : "erro";
      const linhas = [
        linha("Estado", r === null ? "sem checagem" : r.ok ? "no ar" : "sem resposta"),
        s.porta ? linha("Porta", s.porta) : "",
        maquina ? linha("Maquina", `${maquina.nome} (${maquina.estado})`) : "",
        s.url ? `<dt>Endereco</dt><dd><a href="${s.url}">abrir</a></dd>` : "",
      ].filter(Boolean);
      return cartao({ titulo: s.nome, estado, linhas, nota: s.descricao });
    });

    const aviso = pve.desatualizado
      ? cartao({
          titulo: "Proxmox",
          estado: "velho",
          linhas: [linha("Consulta", pve.erro ?? "falhou")],
          nota: pve.em
            ? `Dado desatualizado, de ${pve.em.toLocaleTimeString("pt-BR")}.`
            : "Indisponivel: nenhuma leitura boa ainda.",
        })
      : "";

    res.type("html").send(
      layout({
        titulo: "Inicio",
        papel,
        atual: "/",
        corpo: `<h1>Inicio</h1><div class="grade">${aviso}${cartoes.join("")}</div>`,
      })
    );
  };
}
```

- [ ] **Passo 4: modificar `src/app.ts`**

```typescript
import { exigirLogin } from "./auth/middleware.js";
import { rotaInicio, type Caches } from "./telas/inicio.js";

export type Deps = {
  db: Database.Database;
  segredoSessao: string;
  caches: Caches;
};

// dentro de criarApp, depois de carregarSessao:
app.get("/", exigirLogin, rotaInicio({ db: deps.db, caches: deps.caches }));
```

Ajuste `test/app.test.ts` e `test/auth.test.ts` para passarem `caches` com
`new Cache(async () => bom([]))` nos dois campos.

- [ ] **Passo 5: modificar `src/index.ts`**

```typescript
import { lerConfig } from "./config.js";
import { abrirBanco } from "./db/conexao.js";
import { criarApp } from "./app.js";
import { Cache } from "./cache.js";
import { buscarRecursos } from "./fontes/proxmox.js";
import { buscarEstados } from "./fontes/homeassistant.js";

const config = lerConfig(process.env);
const db = abrirBanco(config.caminhoBanco);

const caches = {
  pve: new Cache(() => buscarRecursos(config.pveUrl, config.pveToken)),
  ha: new Cache(() => buscarEstados(config.haUrl, config.haToken)),
};

criarApp({ db, segredoSessao: config.segredoSessao, caches }).listen(config.porta, () => {
  console.log(`portal escutando em ${config.porta}`);
});
```

- [ ] **Passo 6: rodar tudo e confirmar que passa**

```bash
npx tsx --test test/
```

Esperado: todos passando.

- [ ] **Passo 7: comitar**

```bash
git add src test
git commit -m "portal: tela Inicio, com recorte por papel e degradacao por cartao"
```

---

### Task 9: Tela Infraestrutura

**Arquivos:**
- Criar: `src/telas/infraestrutura.ts`
- Modificar: `src/app.ts` (trocar a rota provisoria da Task 4)
- Teste: `test/infraestrutura.test.ts`

**Interfaces:**
- Consome: `DepsTela` e `Caches` (Task 8), `listarMaquinas` (Task 2),
  `exigirPapel` (Task 4).
- Produz: `rotaInfraestrutura(deps: DepsTela): RequestHandler`.

- [ ] **Passo 1: escrever o teste que falha**

`test/infraestrutura.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { gerarHash } from "../src/auth/senha.js";
import { criarApp } from "../src/app.js";
import { Cache } from "../src/cache.js";
import { bom } from "../src/fontes/tipos.js";
import type { RecursoPve } from "../src/fontes/proxmox.js";
import type { EstadoHa } from "../src/fontes/homeassistant.js";

const RECURSOS: RecursoPve[] = [
  { tipo: "qemu", vmid: 301, nome: "floripaot", estado: "running", cpu: 0.02, memoria: 2e9, memoriaMax: 8e9 },
  { tipo: "lxc", vmid: 104, nome: "starloco", estado: "stopped", cpu: 0, memoria: 0, memoriaMax: 2e9 },
];

async function comAdmin() {
  const db = abrirBanco(":memory:");
  semear(db);
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("matheus", "Matheus", gerarHash("s1"), "admin");
  const app = criarApp({
    db, segredoSessao: "teste",
    caches: {
      pve: new Cache(async () => bom(RECURSOS)),
      ha: new Cache(async () => bom([] as EstadoHa[])),
    },
  });
  const s = app.listen(0);
  const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  const r = await fetch(`${base}/entrar`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ login: "matheus", senha: "s1" }).toString(),
    redirect: "manual",
  });
  return { base, s, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0]! };
}

test("lista as maquinas do inventario com o estado vindo do Proxmox", async () => {
  const { base, s, cookie } = await comAdmin();
  try {
    const html = await (await fetch(base + "/infraestrutura", { headers: { cookie } })).text();
    assert.ok(html.includes("floripaot"));
    assert.ok(html.includes("starloco"));
    assert.ok(/running/.test(html));
  } finally { s.close(); }
});

test("maquina do inventario que o Proxmox nao devolveu aparece como desconhecida", async () => {
  const { base, s, cookie } = await comAdmin();
  try {
    const html = await (await fetch(base + "/infraestrutura", { headers: { cookie } })).text();
    // o inventario tem 10 maquinas; o cache devolveu 2
    assert.ok(html.includes("gamebox-batocera"), "some do Proxmox mas nao do inventario");
    assert.ok(/desconhecido/.test(html));
  } finally { s.close(); }
});

test("mostra quais maquinas voltam sozinhas depois de queda de luz", async () => {
  const { base, s, cookie } = await comAdmin();
  try {
    const html = await (await fetch(base + "/infraestrutura", { headers: { cookie } })).text();
    assert.ok(/onboot|Volta sozinha/i.test(html));
  } finally { s.close(); }
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

```bash
npx tsx --test test/infraestrutura.test.ts
```

Esperado: FALHA.

- [ ] **Passo 3: `src/telas/infraestrutura.ts`**

```typescript
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
      corpo: `<h1>Infraestrutura</h1>${aviso}
<div style="overflow-x:auto">
<table>
<thead><tr><th>ID</th><th>Maquina</th><th>Estado</th><th>IP</th><th>Memoria</th><th>Volta sozinha</th></tr></thead>
<tbody>${linhas}</tbody>
</table></div>`,
    }));
  };
}
```

- [ ] **Passo 4: modificar `src/app.ts`**

Troque a rota provisoria da Task 4 por:

```typescript
import { rotaInfraestrutura } from "./telas/infraestrutura.js";

app.get("/infraestrutura", exigirPapel(deps.db, "admin"),
  rotaInfraestrutura({ db: deps.db, caches: deps.caches }));
```

Acrescente ao `ESTILO` em `src/html/base.ts`:

```css
table { border-collapse:collapse; width:100%; background:var(--cartao);
  border:1px solid var(--borda); border-radius:10px; }
th,td { text-align:left; padding:.5rem .65rem; border-bottom:1px solid var(--borda); }
th { color:var(--fraco); font-weight:600; }
tr:last-child td { border-bottom:0; }
small { color:var(--fraco); }
```

- [ ] **Passo 5: rodar tudo e confirmar que passa**

```bash
npx tsx --test test/
```

Esperado: todos passando, e o teste de 403 da Task 4 continua verde.

- [ ] **Passo 6: comitar**

```bash
git add src test
git commit -m "portal: tela Infraestrutura, com o inventario mandando na lista"
```

---

### Task 10: Implantacao no CT 103

**Arquivos:**
- Criar: `infra/portal/implantacao.md`, `infra/portal/portal.service`,
  `infra/portal/implantar.sh`
- Modificar: `/etc/nginx/sites-available/ha.dinizismo.com.br` **nao** — criar
  um bloco novo no CT 103.

**Interfaces:**
- Consome: o projeto inteiro.
- Produz: o portal rodando no CT 103, alcancavel so pela Tailscale.

- [ ] **Passo 1: criar o token de leitura do Proxmox**

No host PVE. `PVEAuditor` nao permite escrita nenhuma: mesmo vazado, o dano e
ver o estado do cluster.

```bash
pveum user add portal@pve --comment "Portal da Casa, somente leitura"
pveum acl modify / --users portal@pve --roles PVEAuditor
pveum user token add portal@pve leitura --privsep 0
```

Guarde o valor mostrado: ele aparece **uma vez**. O formato para o portal e
`portal@pve!leitura=<uuid>`.

- [ ] **Passo 2: criar o token do Home Assistant**

Isto e manual e precisa do Matheus, porque o HA tem 2FA: no HA, clicar no nome
no rodape da barra lateral, aba **Seguranca**, ao fim da pagina
**Tokens de acesso de longa duracao** → *Criar token*. Nome: `portal`.

- [ ] **Passo 3: preparar o container**

```bash
pct exec 103 -- apt-get install -y nodejs npm
pct exec 103 -- useradd --system --home /opt/portal --shell /usr/sbin/nologin portal
pct exec 103 -- mkdir -p /opt/portal /var/lib/portal
pct exec 103 -- chown portal:portal /var/lib/portal
```

- [ ] **Passo 4: `infra/portal/portal.service`**

```ini
[Unit]
Description=Portal da Casa
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=portal
WorkingDirectory=/opt/portal
# As credenciais ficam neste arquivo, modo 600, fora do git. Nunca em
# ExecStart, que apareceria em ps e no journal.
EnvironmentFile=/etc/portal.env
ExecStart=/usr/bin/node dist/src/index.js
Restart=on-failure
RestartSec=5

# O portal so le. Nada aqui precisa escrever fora do proprio banco.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/portal

[Install]
WantedBy=multi-user.target
```

- [ ] **Passo 5: `/etc/portal.env` no CT 103, modo 600**

```bash
pct exec 103 -- /bin/sh -c 'umask 077; cat > /etc/portal.env <<EOF
PORTAL_PORTA=3000
PORTAL_BANCO=/var/lib/portal/portal.db
PORTAL_SEGREDO_SESSAO=<gerar com: openssl rand -hex 32>
PORTAL_PVE_URL=https://192.168.15.200:8006
PORTAL_PVE_TOKEN=portal@pve!leitura=<uuid do passo 1>
PORTAL_HA_URL=http://192.168.15.8
PORTAL_HA_TOKEN=<token do passo 2>
EOF
chmod 600 /etc/portal.env'
```

- [ ] **Passo 6: `infra/portal/implantar.sh`**

```bash
#!/bin/bash
# Implanta o portal da bancada no CT 103.
# Compila AQUI e envia o resultado: o container de 512 MB nao precisa de
# toolchain de TypeScript, e o que roda em producao e exatamente o que foi
# testado na bancada.
set -euo pipefail

REPO=~/projetos/portal-casa
PVE=root@100.71.204.68

cd "$REPO"
npx tsc

TAR=$(mktemp /tmp/portal-XXXX.tar.gz)
tar czf "$TAR" dist package.json package-lock.json src/db/esquema.sql

ssh "$PVE" "pct exec 103 -- systemctl stop portal 2>/dev/null || true"
ssh "$PVE" "cat > /tmp/portal.tar.gz" < "$TAR"
ssh "$PVE" "pct push 103 /tmp/portal.tar.gz /tmp/portal.tar.gz"
ssh "$PVE" "pct exec 103 -- /bin/sh -c '
  cd /opt/portal &&
  tar xzf /tmp/portal.tar.gz &&
  npm ci --omit=dev &&
  mkdir -p dist/src/db &&
  cp src/db/esquema.sql dist/src/db/ &&
  chown -R portal:portal /opt/portal &&
  systemctl start portal'"
rm -f "$TAR"
echo "implantado"
```

O `esquema.sql` e copiado a mao para junto do JavaScript compilado porque o
`tsc` so move `.ts` — sem esse passo, `abrirBanco` falha em producao com
`ENOENT` e passa nos testes.

- [ ] **Passo 7: bloco do nginx**

Nome novo, `portal.dinizismo.com.br`, no mesmo desenho do Home Assistant:
registro A para o IP de Tailscale do CT 103, certificado por DNS-01.

```bash
# no CT 103
certbot certonly --non-interactive --agree-tos -m kakalhu.aika@gmail.com \
  --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 30 -d portal.dinizismo.com.br
```

```nginx
server {
    listen 80; server_name portal.dinizismo.com.br;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl; http2 on;
    server_name portal.dinizismo.com.br;
    ssl_certificate     /etc/letsencrypt/live/portal.dinizismo.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/portal.dinizismo.com.br/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Registro na Cloudflare: `A portal -> 100.67.193.85`, **cinza**. O portal mostra o
mapa da casa inteira; nao vai para a internet.

- [ ] **Passo 8: criar os dois usuarios**

```bash
pct exec 103 -- /bin/sh -c 'cd /opt/portal && PORTAL_BANCO=/var/lib/portal/portal.db node dist/scripts/semear.js'
# e um usuario de cada papel, com a senha lida da entrada padrao
```

- [ ] **Passo 9: conferir o conteudo, nao o codigo de status**

A licao de 30/08: `curl -o /dev/null -w %{http_code}` ja aprovou pagina sem CSS
duas vezes neste projeto.

```bash
curl -s https://portal.dinizismo.com.br/entrar | grep -o '<title>[^<]*</title>'
curl -s -o /dev/null -w "%{http_code}\n" https://portal.dinizismo.com.br/
# esperado: 302 para /entrar, porque sem cookie nao entra
```

E abrir no celular, na largura real, para conferir a coluna unica.

- [ ] **Passo 10: `infra/portal/implantacao.md`**

Documentar: onde mora, como implantar, onde ficam as credenciais e por que fora
do git, o token do PVE e seu papel, e que o `esquema.sql` precisa ser copiado a
mao para o `dist`.

- [ ] **Passo 11: comitar**

```bash
git add infra/portal
git commit -m "portal: implantacao no CT 103, com token de leitura e systemd"
```

---

## Fora desta fatia

Registrado para nao se perder, e **nao** deve ser implementado agora:

- Qualquer acao de escrita, e o `/usr/local/sbin/portal-acao`.
- As telas Games, Midia, Casa e Administracao.
- A geracao de documentacao a partir do inventario (spec, secao 4.2).
- A tela de edicao de usuarios e papeis.

O spec (secao 4) lista uma tabela `permissoes`. Ela **nao** existe neste plano:
com dois papeis e uma ordem clara entre eles, a permissao cabe na coluna
`papel_minimo` de cada maquina e servico, e a comparacao sai em SQL. Uma tabela
de junca so se paga quando as permissoes deixarem de ser hierarquicas — se e
quando isso acontecer, ela entra sem quebrar as consultas atuais.

A limpeza do Home Assistant que corre em paralelo (spec, secao 9) tambem fica
fora: `modo_chegar_casa` ligando Jellyfin e Docker sozinho, e as entidades
orfas `switch.ct_ct103`, `switch.ct_pelican` e `script.preparar_midia`.
