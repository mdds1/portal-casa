# Portal da Casa — segunda fatia: acoes de escrita

> **Para trabalhadores agenticos:** SUB-SKILL OBRIGATORIA: use
> superpowers:subagent-driven-development (recomendado) ou
> superpowers:executing-plans para implementar tarefa a tarefa. Os passos usam
> caixas (`- [ ]`) para acompanhamento.

**Objetivo:** dar botoes ao portal — ligar, desligar e reiniciar as maquinas que
o inventario marcar como acionaveis, e desligar o proprio Proxmox.

**Arquitetura:** o portal nunca fala com a API de escrita do Proxmox. Ele conecta
por SSH, com chave propria e comando forcado, a um unico programa no host —
`/usr/local/sbin/portal-acao` — que aceita um verbo e um alvo e recusa qualquer
coisa fora da lista. E o mesmo desenho do `ha-pve-power`, que ja esta em producao
desde antes. Do lado do portal, quem decide o que cada pessoa pode fazer e o
**inventario**: a coluna `papel_minimo`, que ja existe, mais uma coluna
`acionavel` nova.

**Tecnologia:** Node 20, TypeScript, Express 5, SQLite (better-sqlite3), testes
com `node:test`. Nenhuma dependencia nova.

## Restricoes globais

- **Nenhuma acao fora da lista.** Nao existe caixa de texto que execute comando
  arbitrario, nem no navegador nem na API. Todo verbo e um item de uma lista
  fechada, escrita no codigo do wrapper E conferida no portal.
- **A permissao e conferida no servidor, em toda requisicao.** Esconder o botao e
  conveniencia, nao seguranca.
- **A senha de root nunca entra no portal.** O acesso ao host e por chave com
  comando forcado.
- Credenciais nunca no codigo e nunca no git.
- Toda saida HTML passa por escape.
- Toda acao executada vai para `acoes_log` com usuario, hora, verbo, alvo e
  resultado — inclusive as recusadas.
- **Estas maquinas NUNCA sao acionaveis, por decisao de desenho:** o CT 103 (o
  proprio portal se mataria no meio do clique), a VM 111 (Home Assistant, derruba
  a automacao da casa) e a VM 110 (a bancada de desenvolvimento).
- O portal roda num container de 512 MB, atras de nginx, alcancavel so pela
  Tailscale.

## Estrutura de arquivos

    src/acoes/
      tipos.ts        Verbo, Alvo, e a lista fechada de verbos
      permissao.ts    quem pode agir sobre o que — funcao pura, muito testada
      wrapper.ts      executa o SSH e interpreta a resposta
      registro.ts     grava em acoes_log
    src/auth/
      csrf.ts         token por sessao, para o POST
    src/telas/
      acao.ts         a rota POST /acao e a tela de confirmacao
    infra/portal/
      portal-acao     o programa que roda no host (versionado aqui, instalado la)

Arquivos existentes modificados: `src/db/esquema.sql` e `src/db/conexao.ts`
(coluna nova e migracao), `src/db/semente.ts`, `src/app.ts`, `src/telas/inicio.ts`
e `src/telas/infraestrutura.ts` (os botoes), `src/html/base.ts` (estilo dos
botoes).

---

### Task 1: A coluna `acionavel`, com migracao do banco que ja existe

**Arquivos:**
- Modificar: `src/db/esquema.sql`, `src/db/conexao.ts`, `src/db/semente.ts`
- Teste: `test/inventario.test.ts`, `test/semente.test.ts`

**Interfaces:**
- Consome: `abrirBanco(caminho): Database.Database`, `listarMaquinas(db, papel)`,
  `semear(db)`, tipo `Maquina`.
- Produz: `Maquina` ganha o campo `acionavel: 0 | 1`.

**Por que uma migracao, e nao so mexer no esquema:** ja existe um banco em
producao, em `/var/lib/portal/portal.db`, com usuarios e sessoes. O
`CREATE TABLE IF NOT EXISTS` nao acrescenta coluna em tabela que ja existe — ele
simplesmente nao faz nada, em silencio, e o codigo novo quebra em producao
enquanto passa em todos os testes (que criam banco do zero).

- [ ] **Passo 1: escrever o teste que falha**

Acrescente a `test/inventario.test.ts`:

```typescript
test("maquina tem o campo acionavel, e o padrao e nao-acionavel", () => {
  const db = abrirBanco(":memory:");
  db.prepare("INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo) VALUES (?,?,?,?,?,?,?)")
    .run("ct", 201, "jellyfin", "Midia", "192.168.15.15", 0, "casa");
  const m = listarMaquinas(db, "admin")[0]!;
  assert.equal(m.acionavel, 0, "quem nao foi marcado nao pode ser acionado");
});

test("banco antigo, sem a coluna, e migrado sem perder dado", () => {
  // Simula um banco criado pela fatia anterior: cria a tabela na forma velha,
  // poe uma linha, fecha, e abre de novo com o abrirBanco atual.
  const caminho = `/tmp/portal-migracao-${process.pid}.db`;
  const velho = new Database(caminho);
  velho.exec(`
    CREATE TABLE papeis (nome TEXT PRIMARY KEY, poder INTEGER NOT NULL);
    INSERT INTO papeis VALUES ('admin',100),('casa',10);
    CREATE TABLE maquinas (
      id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, vmid INTEGER NOT NULL UNIQUE,
      nome TEXT NOT NULL, descricao TEXT NOT NULL, ip TEXT,
      onboot INTEGER NOT NULL DEFAULT 0, papel_minimo TEXT NOT NULL);
    INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo)
      VALUES ('vm',301,'floripaot','Tibia','192.168.15.11',1,'admin');`);
  velho.close();

  const db = abrirBanco(caminho);
  const m = listarMaquinas(db, "admin");
  assert.equal(m.length, 1, "o dado que ja existia nao pode sumir");
  assert.equal(m[0]!.nome, "floripaot");
  assert.equal(m[0]!.acionavel, 0, "a coluna nova entra com o padrao seguro");
  db.close();
  for (const sufixo of ["", "-wal", "-shm"]) rmSync(caminho + sufixo, { force: true });
});

test("semear marca exatamente as maquinas acionaveis", () => {
  const db = abrirBanco(":memory:");
  semear(db);
  const porVmid = new Map(listarMaquinas(db, "admin").map((m) => [m.vmid, m]));
  for (const vmid of [100, 102, 104, 120, 201, 301])
    assert.equal(porVmid.get(vmid)?.acionavel, 1, `vmid ${vmid} deveria ser acionavel`);
  for (const vmid of [103, 110, 111, 101])
    assert.equal(porVmid.get(vmid)?.acionavel, 0, `vmid ${vmid} NAO pode ser acionavel`);
});
```

Estes testes precisam de tres imports no topo de `test/inventario.test.ts`, se
ainda nao estiverem la:

```typescript
import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { semear } from "../src/db/semente.js";
```

- [ ] **Passo 2: rodar e confirmar que falha**

```bash
cd ~/projetos/portal-casa && npx tsx --test test/inventario.test.ts
```

Esperado: FALHA, `acionavel` nao existe.

- [ ] **Passo 3: acrescentar a coluna ao esquema**

Em `src/db/esquema.sql`, na tabela `maquinas`, depois de `onboot`:

```sql
  -- 0 = o portal nao oferece botao para esta maquina. O padrao e o valor
  -- seguro: quem nao foi marcado explicitamente nao pode ser desligado.
  acionavel    INTEGER NOT NULL DEFAULT 0,
```

- [ ] **Passo 4: migrar o banco que ja existe**

Em `src/db/conexao.ts`, depois do `db.exec(...)` do esquema e antes de semear os
papeis:

```typescript
  // CREATE TABLE IF NOT EXISTS nao acrescenta coluna em tabela existente: ele
  // nao faz nada, em silencio. Sem esta migracao o banco de producao (que foi
  // criado pela fatia anterior) fica sem `acionavel`, e todo teste continua
  // passando porque teste cria banco do zero.
  const colunas = db.prepare("PRAGMA table_info(maquinas)").all() as { name: string }[];
  if (!colunas.some((c) => c.name === "acionavel")) {
    db.exec("ALTER TABLE maquinas ADD COLUMN acionavel INTEGER NOT NULL DEFAULT 0");
  }
```

- [ ] **Passo 5: o tipo `Maquina` ganha o campo**

Em `src/db/inventario.ts`, dentro de `export type Maquina`, depois de `onboot`:

```typescript
  acionavel: 0 | 1;
```

- [ ] **Passo 6: a semente marca quem pode ser acionado**

Em `src/db/semente.ts`, o tipo da linha e as linhas passam a levar o campo. O
tipo vira:

```typescript
type LinhaMaquina = [tipo: "vm" | "ct", vmid: number, nome: string, descricao: string, ip: string | null, onboot: 0 | 1, papel: string, acionavel: 0 | 1];
```

E a lista, com o ultimo campo acrescentado a cada linha:

```typescript
const MAQUINAS: LinhaMaquina[] = [
  // A bancada, o Home Assistant e o proprio portal NUNCA sao acionaveis.
  ["vm", 110, "tfs-server", "Bancada de desenvolvimento", "192.168.15.10", 0, "admin", 0],
  ["vm", 111, "home-assistant", "Automacao da casa", "192.168.15.8", 1, "casa", 0],
  ["vm", 120, "gamebox-batocera", "Emulador na TV", null, 0, "casa", 1],
  ["vm", 301, "floripaot", "Servidor de Tibia e site, producao", "192.168.15.11", 1, "admin", 1],
  ["ct", 100, "drive", "Drive de midias por SMB", null, 0, "admin", 1],
  ["ct", 101, "Jellyfin", "Jellyfin antigo, privilegiado, a remover", null, 0, "admin", 0],
  ["ct", 102, "Docker", "Containers avulsos", null, 0, "admin", 1],
  ["ct", 103, "portal", "Porteiro da casa: nginx, tunel e este portal", "192.168.15.14", 1, "admin", 0],
  ["ct", 104, "starloco", "Servidor de Dofus Retro", "192.168.15.16", 0, "admin", 1],
  ["ct", 201, "jellyfin", "Midia da casa, nao-privilegiado", "192.168.15.15", 0, "casa", 1],
];
```

E o `INSERT` de maquinas passa a ter oito colunas:

```typescript
  const m = db.prepare(`
    INSERT INTO maquinas (tipo,vmid,nome,descricao,ip,onboot,papel_minimo,acionavel)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(vmid) DO UPDATE SET
      tipo=excluded.tipo, nome=excluded.nome, descricao=excluded.descricao,
      ip=excluded.ip, onboot=excluded.onboot, papel_minimo=excluded.papel_minimo,
      acionavel=excluded.acionavel`);
```

- [ ] **Passo 7: rodar tudo e confirmar que passa**

```bash
cd ~/projetos/portal-casa && npm test && npx tsc --noEmit
```

Esperado: toda a suite passando.

- [ ] **Passo 8: comitar**

```bash
git add src/db test/inventario.test.ts test/semente.test.ts
git commit -m "portal: coluna acionavel no inventario, com migracao do banco existente"
```

---

### Task 2: A regra de quem pode agir sobre o que

**Arquivos:**
- Criar: `src/acoes/tipos.ts`, `src/acoes/permissao.ts`
- Teste: `test/permissao.test.ts`

**Interfaces:**
- Consome: `abrirBanco`, `semear`, `poderDoPapel(db, papel): number`.
- Produz:
  `type Verbo = "start" | "shutdown" | "reboot"`;
  `const VERBOS: readonly Verbo[]`;
  `const DESTRUTIVOS: readonly Verbo[]` (shutdown e reboot);
  `type Alvo = { tipo: "maquina"; vmid: number; classe: "vm" | "ct" } | { tipo: "host" }`;
  `type Decisao = { permitido: true } | { permitido: false; motivo: string }`;
  `function podeAgir(db, papel: string, alvo: Alvo, verbo: string): Decisao`;
  `function ehVerbo(v: string): v is Verbo`.

Esta e a peca mais importante da fatia: uma funcao pura, sem rede e sem HTTP, que
concentra toda a decisao. Tudo o mais so obedece.

- [ ] **Passo 1: escrever o teste que falha**

`test/permissao.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db/conexao.js";
import { semear } from "../src/db/semente.js";
import { podeAgir, ehVerbo } from "../src/acoes/permissao.js";

function banco() {
  const db = abrirBanco(":memory:");
  semear(db);
  return db;
}

test("verbo fora da lista e recusado, inclusive coisa parecida", () => {
  const db = banco();
  for (const v of ["destroy", "delete", "rm", "start;rm -rf /", "START", ""]) {
    const d = podeAgir(db, "admin", { tipo: "maquina", vmid: 201, classe: "ct" }, v);
    assert.equal(d.permitido, false, `"${v}" nao pode passar`);
  }
  assert.equal(ehVerbo("start"), true);
  assert.equal(ehVerbo("destroy"), false);
});

test("admin liga e desliga maquina acionavel", () => {
  const db = banco();
  for (const v of ["start", "shutdown", "reboot"])
    assert.equal(podeAgir(db, "admin", { tipo: "maquina", vmid: 301, classe: "vm" }, v).permitido, true);
});

test("nem o admin aciona o portal, o Home Assistant ou a bancada", () => {
  const db = banco();
  const classes: Record<number, "vm" | "ct"> = { 103: "ct", 111: "vm", 110: "vm" };
  for (const vmid of [103, 111, 110]) {
    const d = podeAgir(db, "admin", { tipo: "maquina", vmid, classe: classes[vmid]! }, "shutdown");
    assert.equal(d.permitido, false, `vmid ${vmid} nao pode ser desligado pelo portal`);
  }
});

test("papel casa aciona o que enxerga, e nada alem", () => {
  const db = banco();
  // O Jellyfin (CT 201) e da casa e e acionavel.
  assert.equal(podeAgir(db, "casa", { tipo: "maquina", vmid: 201, classe: "ct" }, "shutdown").permitido, true);
  // O servidor de jogo e de admin: ela nem ve, e nao pode agir.
  assert.equal(podeAgir(db, "casa", { tipo: "maquina", vmid: 301, classe: "vm" }, "shutdown").permitido, false);
  // O drive e de admin.
  assert.equal(podeAgir(db, "casa", { tipo: "maquina", vmid: 100, classe: "ct" }, "start").permitido, false);
});

test("desligar o host e so do admin, e so shutdown", () => {
  const db = banco();
  assert.equal(podeAgir(db, "admin", { tipo: "host" }, "shutdown").permitido, true);
  assert.equal(podeAgir(db, "admin", { tipo: "host" }, "start").permitido, false);
  assert.equal(podeAgir(db, "admin", { tipo: "host" }, "reboot").permitido, false);
  assert.equal(podeAgir(db, "casa", { tipo: "host" }, "shutdown").permitido, false);
});

test("maquina que nao existe no inventario e recusada", () => {
  const db = banco();
  assert.equal(podeAgir(db, "admin", { tipo: "maquina", vmid: 999, classe: "vm" }, "start").permitido, false);
});

test("papel desconhecido nao pode nada", () => {
  const db = banco();
  assert.equal(podeAgir(db, "inventado", { tipo: "maquina", vmid: 201, classe: "ct" }, "start").permitido, false);
  assert.equal(podeAgir(db, "", { tipo: "host" }, "shutdown").permitido, false);
});

test("a recusa sempre explica o motivo", () => {
  const db = banco();
  const d = podeAgir(db, "casa", { tipo: "host" }, "shutdown");
  assert.equal(d.permitido, false);
  if (!d.permitido) assert.ok(d.motivo.length > 0, "motivo vazio nao ajuda ninguem");
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

```bash
cd ~/projetos/portal-casa && npx tsx --test test/permissao.test.ts
```

Esperado: FALHA, `Cannot find module '../src/acoes/permissao.js'`.

- [ ] **Passo 3: `src/acoes/tipos.ts`**

```typescript
// A lista de verbos e fechada e mora aqui. Ela e conferida DUAS vezes: neste
// portal e, de novo, dentro do /usr/local/sbin/portal-acao no host. As duas
// listas precisam continuar iguais.
export const VERBOS = ["start", "shutdown", "reboot"] as const;
export type Verbo = (typeof VERBOS)[number];

// Verbos que pedem confirmacao na tela antes de executar.
export const DESTRUTIVOS: readonly Verbo[] = ["shutdown", "reboot"];

// A classe (vm ou ct) viaja junto com o alvo porque o comando enviado ao host
// depende dela, e adivinhar pelo numero daria errado: o 100 e container e o 120
// e VM. Quem monta o Alvo le a classe do inventario.
export type Alvo =
  | { tipo: "maquina"; vmid: number; classe: "vm" | "ct" }
  | { tipo: "host" };

export type Decisao =
  | { permitido: true }
  | { permitido: false; motivo: string };

export function ehVerbo(v: string): v is Verbo {
  return (VERBOS as readonly string[]).includes(v);
}

export function ehDestrutivo(v: Verbo): boolean {
  return DESTRUTIVOS.includes(v);
}
```

- [ ] **Passo 4: `src/acoes/permissao.ts`**

```typescript
import type Database from "better-sqlite3";
import { poderDoPapel } from "../db/inventario.js";
import { ehVerbo, type Alvo, type Decisao } from "./tipos.js";

// Toda a decisao de "quem pode o que" mora nesta funcao. Ela nao faz rede nem
// HTTP: da para exercitar cada regra em teste, e nenhuma tela pode contorna-la,
// porque a rota chama isto antes de qualquer outra coisa.
export function podeAgir(
  db: Database.Database,
  papel: string,
  alvo: Alvo,
  verbo: string
): Decisao {
  if (!ehVerbo(verbo)) return { permitido: false, motivo: `verbo desconhecido: ${verbo}` };

  const poder = poderDoPapel(db, papel);
  if (poder <= 0) return { permitido: false, motivo: "papel sem poder" };
  const poderAdmin = poderDoPapel(db, "admin");

  if (alvo.tipo === "host") {
    // Desligar o Proxmox derruba tudo junto, inclusive o Home Assistant e o
    // proprio portal. So admin, e so shutdown: nao existe ligar nem reiniciar
    // o host daqui, porque nao ha ninguem para receber o comando.
    if (poder < poderAdmin) return { permitido: false, motivo: "desligar o host e so do admin" };
    if (verbo !== "shutdown") return { permitido: false, motivo: "no host, so shutdown" };
    return { permitido: true };
  }

  const m = db
    .prepare("SELECT papel_minimo, acionavel FROM maquinas WHERE vmid = ?")
    .get(alvo.vmid) as { papel_minimo: string; acionavel: number } | undefined;

  if (!m) return { permitido: false, motivo: `maquina ${alvo.vmid} nao esta no inventario` };
  if (!m.acionavel) return { permitido: false, motivo: `maquina ${alvo.vmid} nao e acionavel` };

  // Quem age e quem ja enxerga: a mesma coluna que recorta a tela recorta o
  // botao. Sem lista de permissao paralela para envelhecer.
  if (poder < poderDoPapel(db, m.papel_minimo))
    return { permitido: false, motivo: "sem permissao para esta maquina" };

  return { permitido: true };
}

export { ehVerbo, ehDestrutivo, VERBOS, DESTRUTIVOS } from "./tipos.js";
export type { Verbo, Alvo, Decisao } from "./tipos.js";
```

- [ ] **Passo 5: rodar e confirmar que passa**

```bash
cd ~/projetos/portal-casa && npx tsx --test test/permissao.test.ts
```

Esperado: 8 testes passando.

- [ ] **Passo 6: comitar**

```bash
git add src/acoes test/permissao.test.ts
git commit -m "portal: regra de permissao das acoes, no inventario e nao em lista paralela"
```

---

### Task 3: O programa que roda no host

**Arquivos:**
- Criar: `infra/portal/portal-acao`, `infra/portal/acoes.md`
- Teste: `test/portal-acao.test.sh` (script de shell, rodado a mao)

**Interfaces:**
- Consome: nada do codigo TypeScript.
- Produz: o contrato que `src/acoes/wrapper.ts` vai falar —
  entrada `"<tipo> <verbo> [<id>]"` via `SSH_ORIGINAL_COMMAND`, saida de uma
  linha em `stdout`, codigo de saida 0 em sucesso.

Este arquivo e versionado no repositorio e **instalado a mao** no host. Ele e a
ultima barreira: mesmo que o portal inteiro seja comprometido, o que da para
fazer com a chave dele e exatamente o que estiver escrito aqui.

- [ ] **Passo 1: escrever `infra/portal/portal-acao`**

```sh
#!/bin/sh
# Acoes do Portal da Casa. Roda no host Proxmox como comando forcado da chave
# SSH do portal (CT 103) -- ver infra/portal/acoes.md.
#
# POR QUE ISTO EXISTE, E NAO A API DE ESCRITA DO PROXMOX: um token de escrita da
# API pode tudo que o papel permite, e os papeis do Proxmox sao grossos. Aqui a
# lista e explicita, curta, e legivel por qualquer pessoa em trinta segundos.
#
# ESTE ARQUIVO E A ULTIMA BARREIRA. Se o portal for comprometido, o dano possivel
# e exatamente o que estiver escrito abaixo. Nao acrescente verbo sem pensar
# nisso.
#
# Deliberadamente FORA da lista: o CT 103 (o portal se mataria), a VM 111 (Home
# Assistant, derruba a automacao) e a VM 110 (a bancada).
set -eu

ORIG=${SSH_ORIGINAL_COMMAND:-}
set -- $ORIG
[ $# -ge 2 ] || { echo "invalido"; exit 2; }

TIPO=$1
VERBO=$2
ID=${3:-}

# Desligar o Proxmox inteiro. E de proposito: serve para quando o Matheus esta
# fora e percebe que esqueceu a maquina ligada. Derruba tudo junto.
if [ "$TIPO" = "host" ]; then
  [ "$VERBO" = "shutdown" ] || { echo "no host, so shutdown"; exit 2; }
  # Responde ANTES de desligar: sem o sleep, a conexao SSH morre junto com a
  # maquina e o portal mostra erro numa acao que na verdade deu certo.
  nohup sh -c "sleep 3; /sbin/shutdown -h now" >/dev/null 2>&1 &
  echo "agendado"
  exit 0
fi

case "$TIPO:$ID" in
  vm:120|vm:301|ct:100|ct:102|ct:104|ct:201) ;;
  *) echo "alvo recusado"; exit 3 ;;
esac

case "$TIPO" in
  vm) FERRAMENTA=qm ;;
  ct) FERRAMENTA=pct ;;
  *)  echo "tipo invalido"; exit 2 ;;
esac

case "$VERBO" in
  start)    $FERRAMENTA start "$ID"    >/dev/null 2>&1 || true ;;
  shutdown) $FERRAMENTA shutdown "$ID" >/dev/null 2>&1 || true ;;
  reboot)   $FERRAMENTA reboot "$ID"   >/dev/null 2>&1 || true ;;
  status)   ;;
  *) echo "verbo invalido"; exit 2 ;;
esac

# Sempre devolve o estado depois da acao, para o portal nao precisar de uma
# segunda chamada so para saber o que aconteceu.
$FERRAMENTA status "$ID" | awk '{print $2}'
```

- [ ] **Passo 2: escrever `test/portal-acao.test.sh`**

O programa e shell e roda no host; nao da para exercita-lo pelo `node:test`.
Este script prova o que importa **sem tocar em maquina nenhuma**: que a lista de
alvos e de verbos recusa o que deve recusar.

```sh
#!/bin/sh
# Exercita a barreira do portal-acao SEM executar qm/pct de verdade: poe stubs
# no PATH que so imprimem o que teriam feito.
# Uso, no host:  sh test/portal-acao.test.sh /usr/local/sbin/portal-acao
set -eu
ALVO=${1:-infra/portal/portal-acao}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
for f in qm pct shutdown; do
  printf '#!/bin/sh\necho "STUB $0 $*" >> %s/chamadas\nexit 0\n' "$TMP" > "$TMP/$f"
  chmod +x "$TMP/$f"
done
printf '#!/bin/sh\necho "id status running"\n' > "$TMP/qm"; chmod +x "$TMP/qm"
printf '#!/bin/sh\necho "id status running"\n' > "$TMP/pct"; chmod +x "$TMP/pct"
export PATH="$TMP:$PATH"

falhas=0
recusa() {
  if SSH_ORIGINAL_COMMAND="$1" sh "$ALVO" >/dev/null 2>&1; then
    echo "FALHOU: '$1' deveria ter sido recusado"; falhas=$((falhas+1))
  else
    echo "ok, recusado: $1"
  fi
}
aceita() {
  if SSH_ORIGINAL_COMMAND="$1" sh "$ALVO" >/dev/null 2>&1; then
    echo "ok, aceito: $1"
  else
    echo "FALHOU: '$1' deveria ter sido aceito"; falhas=$((falhas+1))
  fi
}

recusa "ct shutdown 103"          # o proprio portal
recusa "vm shutdown 111"          # Home Assistant
recusa "vm shutdown 110"          # a bancada
recusa "ct destroy 201"           # verbo fora da lista
recusa "vm start 999"             # alvo inexistente
recusa "host reboot"              # no host so shutdown
recusa "ct shutdown"              # sem id
recusa ""                         # vazio
aceita "ct shutdown 201"
aceita "vm start 301"

echo "---"
[ "$falhas" -eq 0 ] && echo "TODOS OS CASOS PASSARAM" || { echo "$falhas falha(s)"; exit 1; }
```

- [ ] **Passo 3: rodar o script contra o arquivo do repositorio**

```bash
cd ~/projetos/portal-casa && sh test/portal-acao.test.sh infra/portal/portal-acao
```

Esperado: `TODOS OS CASOS PASSARAM`. Se algum caso de "FALHOU", corrija o
`portal-acao` — nao o teste.

- [ ] **Passo 4: escrever `infra/portal/acoes.md`**

Documente: onde o arquivo e instalado (`/usr/local/sbin/portal-acao`, modo 700,
dono root), como a chave do portal e autorizada no host com comando forcado, a
lista de alvos e por que cada exclusao existe, e o lembrete de que a lista de
verbos aparece em dois lugares (aqui e em `src/acoes/tipos.ts`) e as duas
precisam continuar iguais.

- [ ] **Passo 5: comitar**

```bash
git add infra/portal/portal-acao infra/portal/acoes.md test/portal-acao.test.sh
git commit -m "portal: programa de acoes do host, com lista fechada de alvos e verbos"
```

---

### Task 4: O executor — falar com o host por SSH

**Arquivos:**
- Criar: `src/acoes/wrapper.ts`
- Teste: `test/wrapper.test.ts`

**Interfaces:**
- Consome: `Resultado<T>`, `bom`, `ruim` de `src/fontes/tipos.js`; `Alvo` e
  `Verbo` de `src/acoes/tipos.js`.
- Produz:
  `type Executor = (comando: string) => Promise<Resultado<string>>`;
  `function executorSsh(chave: string, destino: string, msLimite?: number): Executor`;
  `function comandoDe(alvo: Alvo, verbo: Verbo): string`;
  `function acionar(exec: Executor, alvo: Alvo, verbo: Verbo): Promise<Resultado<string>>`.

O `Executor` e injetavel de proposito: nenhum teste desta tarefa abre conexao.

- [ ] **Passo 1: escrever o teste que falha**

`test/wrapper.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { comandoDe, acionar, type Executor } from "../src/acoes/wrapper.js";
import { bom, ruim } from "../src/fontes/tipos.js";

test("o comando enviado ao host tem a forma exata que o portal-acao espera", () => {
  assert.equal(comandoDe({ tipo: "maquina", vmid: 201, classe: "ct" }, "shutdown"), "ct shutdown 201");
  assert.equal(comandoDe({ tipo: "maquina", vmid: 301, classe: "vm" }, "start"), "vm start 301");
  assert.equal(comandoDe({ tipo: "host" }, "shutdown"), "host shutdown");
});

test("o tipo vm/ct sai do inventario, nao do palpite", () => {
  // 100 e um container, 120 e uma VM: se o wrapper chutasse pelo numero, erraria.
  assert.equal(comandoDe({ tipo: "maquina", vmid: 100, classe: "ct" }, "start"), "ct start 100");
  assert.equal(comandoDe({ tipo: "maquina", vmid: 120, classe: "vm" }, "start"), "vm start 120");
});

test("acionar devolve o estado que o host respondeu", async () => {
  const exec: Executor = async (c) => {
    assert.equal(c, "ct start 201");
    return bom("running\n");
  };
  const r = await acionar(exec, { tipo: "maquina", vmid: 201, classe: "ct" }, "start");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.dado, "running", "a quebra de linha precisa sair");
});

test("recusa do host vira falha, nao excecao", async () => {
  const exec: Executor = async () => ruim("alvo recusado");
  const r = await acionar(exec, { tipo: "maquina", vmid: 103, classe: "ct" }, "shutdown");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /recusado/);
});

test("executor que LANCA nao derruba quem chamou", async () => {
  const exec: Executor = async () => { throw new Error("ssh sumiu"); };
  const r = await acionar(exec, { tipo: "host" }, "shutdown");
  assert.equal(r.ok, false, "acionar precisa segurar a excecao");
  if (!r.ok) assert.match(r.erro, /ssh sumiu/);
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

```bash
cd ~/projetos/portal-casa && npx tsx --test test/wrapper.test.ts
```

Esperado: FALHA, modulo nao encontrado.

- [ ] **Passo 3: `src/acoes/wrapper.ts`**

```typescript
import { execFile } from "node:child_process";
import { bom, ruim, type Resultado } from "../fontes/tipos.js";
import type { Alvo, Verbo } from "./tipos.js";

export type Executor = (comando: string) => Promise<Resultado<string>>;

export function comandoDe(alvo: Alvo, verbo: Verbo): string {
  if (alvo.tipo === "host") return `host ${verbo}`;
  return `${alvo.classe} ${verbo} ${alvo.vmid}`;
}

// A chave do portal tem comando forcado no host, entao o que vai aqui e apenas
// o argumento — o host ignora qualquer tentativa de rodar outra coisa. Ainda
// assim usamos execFile com lista de argumentos, nunca uma string de shell:
// assim nao existe interpretacao de aspas nem de ponto-e-virgula no caminho.
export function executorSsh(chave: string, destino: string, msLimite = 20000): Executor {
  return (comando) =>
    new Promise((resolver) => {
      execFile(
        "ssh",
        ["-i", chave, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
         "-o", `ConnectTimeout=${Math.ceil(msLimite / 1000)}`, destino, comando],
        { timeout: msLimite },
        (erro, saida, saidaErro) => {
          if (erro) return resolver(ruim(`${(saida || saidaErro || erro.message).trim()}`));
          resolver(bom(saida));
        }
      );
    });
}

export async function acionar(
  exec: Executor,
  alvo: Alvo,
  verbo: Verbo
): Promise<Resultado<string>> {
  try {
    const r = await exec(comandoDe(alvo, verbo));
    return r.ok ? bom(r.dado.trim()) : r;
  } catch (e) {
    // Mesma razao do try/catch do cache: esta camada existe para a pagina nao
    // cair. Confiar no contrato de quem foi injetado anula o proposito dela.
    return ruim(e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Passo 4: rodar e confirmar que passa**

```bash
cd ~/projetos/portal-casa && npx tsx --test test/wrapper.test.ts && npx tsc --noEmit
```

Esperado: 5 testes passando.

- [ ] **Passo 5: comitar**

```bash
git add src/acoes/wrapper.ts test/wrapper.test.ts src/acoes/tipos.ts
git commit -m "portal: executor das acoes, com o SSH injetavel para teste"
```

---

### Task 5: Token de CSRF

**Arquivos:**
- Criar: `src/auth/csrf.ts`
- Teste: `test/csrf.test.ts`

**Interfaces:**
- Consome: `assinar`, `verificarAssinatura` de `src/auth/sessao.js`.
- Produz: `function tokenCsrf(idSessao: string, segredo: string): string`;
  `function conferirCsrf(token: string, idSessao: string, segredo: string): boolean`.

**Por que agora e nao antes:** ate esta fatia o unico POST era o login, e
`sameSite=lax` ja impedia envio de outro site. Agora existem POSTs que desligam
maquina, e uma segunda defesa vale o custo — `lax` protege contra o caso comum,
nao contra tudo (uma pagina no mesmo dominio, por exemplo).

- [ ] **Passo 1: escrever o teste que falha**

`test/csrf.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenCsrf, conferirCsrf } from "../src/auth/csrf.js";

const SEG = "segredo-do-servidor";

test("token da propria sessao e aceito", () => {
  const t = tokenCsrf("sessao-abc", SEG);
  assert.equal(conferirCsrf(t, "sessao-abc", SEG), true);
});

test("token de OUTRA sessao e recusado", () => {
  const t = tokenCsrf("sessao-abc", SEG);
  assert.equal(conferirCsrf(t, "sessao-xyz", SEG), false,
    "senao a Marcella poderia usar o token dela num pedido em nome de outro");
});

test("token adulterado e recusado, inclusive por acrescimo no fim", () => {
  const t = tokenCsrf("sessao-abc", SEG);
  assert.equal(conferirCsrf(t + "x", "sessao-abc", SEG), false);
  assert.equal(conferirCsrf(t.slice(0, -1), "sessao-abc", SEG), false);
});

test("token de outro servidor e recusado", () => {
  const t = tokenCsrf("sessao-abc", "outro-segredo");
  assert.equal(conferirCsrf(t, "sessao-abc", SEG), false);
});

test("token vazio ou sem forma e recusado, sem lancar", () => {
  for (const t of ["", ".", "abc", "a.b.c"])
    assert.equal(conferirCsrf(t, "sessao-abc", SEG), false, `"${t}" nao pode passar`);
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

```bash
cd ~/projetos/portal-casa && npx tsx --test test/csrf.test.ts
```

Esperado: FALHA, modulo nao encontrado.

- [ ] **Passo 3: `src/auth/csrf.ts`**

```typescript
import { assinar, verificarAssinatura } from "./sessao.js";

// O token e a propria id de sessao assinada com um proposito diferente. Assim
// ele so vale para a sessao que o recebeu: um token vazado nao serve em outra.
const PROPOSITO = "csrf:";

export function tokenCsrf(idSessao: string, segredo: string): string {
  return assinar(PROPOSITO + idSessao, segredo);
}

export function conferirCsrf(token: string, idSessao: string, segredo: string): boolean {
  const valor = verificarAssinatura(token, segredo);
  return valor !== null && valor === PROPOSITO + idSessao;
}
```

- [ ] **Passo 4: rodar e confirmar que passa**

```bash
cd ~/projetos/portal-casa && npx tsx --test test/csrf.test.ts
```

Esperado: 5 testes passando.

- [ ] **Passo 5: comitar**

```bash
git add src/auth/csrf.ts test/csrf.test.ts
git commit -m "portal: token de CSRF amarrado a sessao"
```

---

### Task 6: A rota da acao, com confirmacao e registro

**Arquivos:**
- Criar: `src/acoes/registro.ts`, `src/telas/acao.ts`
- Modificar: `src/app.ts`
- Teste: `test/acao.test.ts`

**Interfaces:**
- Consome: `podeAgir`, `ehVerbo`, `ehDestrutivo` (Task 2); `acionar`, `Executor`
  (Task 4); `tokenCsrf`, `conferirCsrf` (Task 5); `layout({ titulo, poder, atual,
  corpoHtml })`, `escapar`; `poderDoPapel(db, papel)`.
- Modifica: `req.sessao` ganha o campo `id: string`.
- Produz: `function registrar(db, usuario: string, verbo: string, alvo: string, ok: boolean, detalhe: string): void`;
  `function rotaAcao(deps: DepsAcao): RequestHandler`;
  `type DepsAcao = { db: Database.Database; segredoSessao: string; exec: Executor }`.
  `Deps` de `criarApp` ganha `exec: Executor`.

- [ ] **Passo 1: escrever o teste que falha**

`test/acao.test.ts`:

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
import type { Executor } from "../src/acoes/wrapper.js";

function montar(exec: Executor) {
  const db = abrirBanco(":memory:");
  semear(db);
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("matheus", "Matheus", gerarHash("s1"), "admin");
  db.prepare("INSERT INTO usuarios (login,nome,senha,papel) VALUES (?,?,?,?)")
    .run("marcella", "Marcella", gerarHash("s2"), "casa");
  const app = criarApp({
    db, segredoSessao: "teste", exec,
    caches: { pve: new Cache(async () => bom([] as RecursoPve[])) },
  });
  const s = app.listen(0);
  const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  return { db, s, base };
}

async function entrar(base: string, login: string, senha: string) {
  const r = await fetch(`${base}/entrar`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ login, senha }).toString(),
    redirect: "manual",
  });
  return (r.headers.get("set-cookie") ?? "").split(";")[0]!;
}

async function csrfDaPagina(base: string, cookie: string): Promise<string> {
  const html = await (await fetch(base + "/", { headers: { cookie } })).text();
  const m = html.match(/name="csrf" value="([^"]+)"/);
  assert.ok(m, "a pagina precisa trazer um token de csrf nos formularios");
  return m![1]!;
}

function postar(base: string, cookie: string, corpo: Record<string, string>) {
  return fetch(`${base}/acao`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(corpo).toString(),
    redirect: "manual",
  });
}

test("sem login, a acao e recusada e nada e executado", async () => {
  let chamou = false;
  const { s, base } = montar(async () => { chamou = true; return bom("running"); });
  try {
    const r = await postar(base, "", { alvo: "201", verbo: "start", csrf: "x", confirmado: "1" });
    assert.ok(r.status === 302 || r.status === 403);
    assert.equal(chamou, false, "nao pode ter chegado no host");
  } finally { s.close(); }
});

test("sem token de csrf valido, nada e executado", async () => {
  let chamou = false;
  const { s, base } = montar(async () => { chamou = true; return bom("running"); });
  try {
    const c = await entrar(base, "matheus", "s1");
    const r = await postar(base, c, { alvo: "201", verbo: "start", csrf: "forjado", confirmado: "1" });
    assert.equal(r.status, 403);
    assert.equal(chamou, false);
  } finally { s.close(); }
});

test("verbo destrutivo sem confirmacao mostra a tela de confirmar, e nao executa", async () => {
  let chamou = false;
  const { s, base } = montar(async () => { chamou = true; return bom("stopped"); });
  try {
    const c = await entrar(base, "matheus", "s1");
    const t = await csrfDaPagina(base, c);
    const r = await postar(base, c, { alvo: "301", verbo: "shutdown", csrf: t });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /confirmar/i);
    assert.equal(chamou, false, "confirmacao nao pode executar nada");
  } finally { s.close(); }
});

test("a Marcella nao desliga o servidor de jogo, e o host nao e chamado", async () => {
  let chamou = false;
  const { db, s, base } = montar(async () => { chamou = true; return bom("stopped"); });
  try {
    const c = await entrar(base, "marcella", "s2");
    const t = await csrfDaPagina(base, c);
    const r = await postar(base, c, { alvo: "301", verbo: "shutdown", csrf: t, confirmado: "1" });
    assert.equal(r.status, 403);
    assert.equal(chamou, false);
    const log = db.prepare("SELECT usuario, verbo, alvo, ok FROM acoes_log WHERE verbo='shutdown'").all();
    assert.equal(log.length, 1, "a recusa TAMBEM precisa ficar registrada");
    assert.deepEqual(log[0], { usuario: "marcella", verbo: "shutdown", alvo: "vm:301", ok: 0 });
  } finally { s.close(); }
});

test("a Marcella liga o Jellyfin, e fica registrado", async () => {
  const { db, s, base } = montar(async (c) => {
    assert.equal(c, "ct start 201");
    return bom("running");
  });
  try {
    const cookie = await entrar(base, "marcella", "s2");
    const t = await csrfDaPagina(base, cookie);
    const r = await postar(base, cookie, { alvo: "201", verbo: "start", csrf: t, confirmado: "1" });
    assert.equal(r.status, 302);
    const log = db.prepare("SELECT usuario, verbo, alvo, ok FROM acoes_log WHERE verbo='start'").get();
    assert.deepEqual(log, { usuario: "marcella", verbo: "start", alvo: "ct:201", ok: 1 });
  } finally { s.close(); }
});

test("falha do host vira registro com ok=0 e nao derruba a pagina", async () => {
  const { db, s, base } = montar(async () => { throw new Error("ssh caiu"); });
  try {
    const c = await entrar(base, "matheus", "s1");
    const t = await csrfDaPagina(base, c);
    const r = await postar(base, c, { alvo: "201", verbo: "start", csrf: t, confirmado: "1" });
    assert.ok(r.status === 302 || r.status === 200, "nao pode ser 500");
    const log = db.prepare("SELECT ok, detalhe FROM acoes_log WHERE verbo='start'").get() as { ok: number; detalhe: string };
    assert.equal(log.ok, 0);
    assert.match(log.detalhe, /ssh caiu/);
  } finally { s.close(); }
});

test("desligar o host: a Marcella nao pode; o admin precisa confirmar", async () => {
  let comandos: string[] = [];
  const { s, base } = montar(async (c) => { comandos.push(c); return bom("agendado"); });
  try {
    const cm = await entrar(base, "marcella", "s2");
    const tm = await csrfDaPagina(base, cm);
    assert.equal((await postar(base, cm, { alvo: "host", verbo: "shutdown", csrf: tm, confirmado: "1" })).status, 403);

    const ca = await entrar(base, "matheus", "s1");
    const ta = await csrfDaPagina(base, ca);
    const semConfirmar = await postar(base, ca, { alvo: "host", verbo: "shutdown", csrf: ta });
    assert.equal(semConfirmar.status, 200);
    assert.deepEqual(comandos, [], "nada pode ter sido enviado ainda");

    const confirmado = await postar(base, ca, { alvo: "host", verbo: "shutdown", csrf: ta, confirmado: "1" });
    assert.equal(confirmado.status, 302);
    assert.deepEqual(comandos, ["host shutdown"]);
  } finally { s.close(); }
});

test("alvo que nao e numero nem 'host' e recusado sem chamar nada", async () => {
  let chamou = false;
  const { s, base } = montar(async () => { chamou = true; return bom("x"); });
  try {
    const c = await entrar(base, "matheus", "s1");
    const t = await csrfDaPagina(base, c);
    for (const alvo of ["../../etc", "201; rm -rf /", "", "NaN"]) {
      const r = await postar(base, c, { alvo, verbo: "start", csrf: t, confirmado: "1" });
      assert.equal(r.status, 403, `alvo "${alvo}" precisa ser recusado`);
    }
    assert.equal(chamou, false);
  } finally { s.close(); }
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

```bash
cd ~/projetos/portal-casa && npx tsx --test test/acao.test.ts
```

Esperado: FALHA.

- [ ] **Passo 3: a sessao passa a carregar o proprio id**

A rota precisa do id da sessao para conferir o CSRF, e as telas precisam dele
para gerar o token. Reler o cookie com uma regex em cada lugar duplicaria a
logica de `lerCookie` — e as duas copias ja divergiriam no primeiro dia. Em
`src/auth/middleware.ts`, o tipo declarado passa a ser:

```typescript
declare global {
  namespace Express {
    interface Request {
      sessao?: { id: string; usuario: number; papel: string };
    }
  }
}
```

e dentro de `carregarSessao`, onde hoje faz `req.sessao = s`:

```typescript
        if (s) req.sessao = { id, ...s };
```

- [ ] **Passo 4: `src/acoes/registro.ts`**

```typescript
import type Database from "better-sqlite3";

// Toda acao entra aqui, inclusive as recusadas: saber o que alguem TENTOU fazer
// vale tanto quanto saber o que conseguiu.
export function registrar(
  db: Database.Database,
  usuario: string,
  verbo: string,
  alvo: string,
  ok: boolean,
  detalhe = ""
): void {
  db.prepare(
    "INSERT INTO acoes_log (quando,usuario,verbo,alvo,ok,detalhe) VALUES (?,?,?,?,?,?)"
  ).run(new Date().toISOString(), usuario, verbo, alvo, ok ? 1 : 0, detalhe);
}
```

- [ ] **Passo 5: `src/telas/acao.ts`**

A rota faz, nesta ordem: exige sessao; confere o CSRF; interpreta o alvo;
consulta `podeAgir`; se for destrutivo e ainda nao confirmado, desenha a tela de
confirmacao; so entao executa. Cada recusa registra em `acoes_log` e responde
403. O nome do usuario para o registro sai da tabela `usuarios` pela sessao.

```typescript
import type { RequestHandler } from "express";
import type Database from "better-sqlite3";
import { podeAgir } from "../acoes/permissao.js";
import { ehVerbo, ehDestrutivo, type Alvo, type Verbo } from "../acoes/tipos.js";
import { acionar, type Executor } from "../acoes/wrapper.js";
import { registrar } from "../acoes/registro.js";
import { conferirCsrf } from "../auth/csrf.js";
import { verificarAssinatura } from "../auth/sessao.js";
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

export function rotaAcao(deps: DepsAcao): RequestHandler {
  return async (req, res) => {
    const sessao = req.sessao!;
    const usuario = loginDoUsuario(deps.db, sessao.usuario);
    const bruto = String(req.body.alvo ?? "");
    const verbo = String(req.body.verbo ?? "");
    const confirmado = req.body.confirmado === "1";

    if (!conferirCsrf(String(req.body.csrf ?? ""), sessao.id, deps.segredoSessao)) {
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

    const v = verbo as Verbo;
    if (ehDestrutivo(v) && !confirmado) {
      return res.type("html").send(telaConfirmacao(deps, req, alvo, v));
    }

    const r = await acionar(deps.exec, alvo, v);
    registrar(deps.db, usuario, v, nomeDoAlvo(alvo), r.ok, r.ok ? r.dado : r.erro);
    return res.redirect(alvo.tipo === "host" ? "/" : (req.body.voltar === "infra" ? "/infraestrutura" : "/"));
  };
}
```

E, no mesmo arquivo, as duas funcoes de apoio:

```typescript
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

function telaConfirmacao(
  deps: DepsAcao,
  req: Parameters<RequestHandler>[0],
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
  <input type="hidden" name="csrf" value="${escapar(String(req.body.csrf ?? ""))}">
  <input type="hidden" name="voltar" value="${escapar(String(req.body.voltar ?? ""))}">
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

function nomeDaMaquina(db: Database.Database, vmid: number): string | null {
  const m = db.prepare("SELECT nome FROM maquinas WHERE vmid = ?").get(vmid) as
    { nome: string } | undefined;
  return m?.nome ?? null;
}
```

- [ ] **Passo 6: montar a rota em `src/app.ts`**

```typescript
import { rotaAcao } from "./telas/acao.js";
import type { Executor } from "./acoes/wrapper.js";

export type Deps = {
  db: Database.Database;
  segredoSessao: string;
  caches: Caches;
  exec: Executor;
};

// dentro de criarApp, depois das telas e ANTES dos handlers de 404 e de erro:
app.post("/acao", exigirLogin, rotaAcao({
  db: deps.db, segredoSessao: deps.segredoSessao, exec: deps.exec,
}));
```

E em `src/index.ts`, monte o executor real:

```typescript
import { executorSsh } from "./acoes/wrapper.js";
const exec = executorSsh(
  process.env.PORTAL_CHAVE_ACAO ?? "/etc/portal/acao_key",
  process.env.PORTAL_HOST_ACAO ?? "root@192.168.15.200"
);
```

Ajuste `test/app.test.ts`, `test/auth.test.ts`, `test/inicio.test.ts` e
`test/infraestrutura.test.ts` para passarem `exec: async () => bom("running")`.

- [ ] **Passo 7: rodar tudo e confirmar que passa**

```bash
cd ~/projetos/portal-casa && npm test && npx tsc --noEmit
```

- [ ] **Passo 8: comitar**

```bash
git add src test
git commit -m "portal: rota das acoes, com csrf, confirmacao e registro de tudo"
```

---

### Task 7: Os botoes nas telas

**Arquivos:**
- Modificar: `src/telas/inicio.ts`, `src/telas/infraestrutura.ts`, `src/html/base.ts`
- Teste: `test/inicio.test.ts`, `test/infraestrutura.test.ts`

**Interfaces:**
- Consome: `tokenCsrf` (Task 5), `podeAgir` (Task 2), `Maquina.acionavel` (Task 1).
- Produz: nada consumido por tarefas seguintes.

- [ ] **Passo 1: escrever o teste que falha**

Acrescente a `test/infraestrutura.test.ts`:

```typescript
test("o admin ve botoes so nas maquinas acionaveis", async () => {
  const { base, s, cookie } = await comAdmin();
  try {
    const html = await (await fetch(base + "/infraestrutura", { headers: { cookie } })).text();
    // O FloripaOT e acionavel: tem formulario com o vmid dele.
    assert.match(html, /name="alvo" value="301"/);
    // O portal e o Home Assistant nao sao, nunca.
    assert.doesNotMatch(html, /name="alvo" value="103"/);
    assert.doesNotMatch(html, /name="alvo" value="111"/);
    assert.doesNotMatch(html, /name="alvo" value="110"/);
  } finally { s.close(); }
});

test("todo formulario de acao leva token de csrf", async () => {
  const { base, s, cookie } = await comAdmin();
  try {
    const html = await (await fetch(base + "/infraestrutura", { headers: { cookie } })).text();
    const forms = html.match(/<form[^>]*action="\/acao"[\s\S]*?<\/form>/g) ?? [];
    assert.ok(forms.length > 0, "deveria haver formularios de acao");
    for (const f of forms) assert.match(f, /name="csrf"/, "formulario sem csrf");
  } finally { s.close(); }
});

test("o botao de desligar o host aparece so para o admin", async () => {
  const { base, s, cookie } = await comAdmin();
  try {
    const html = await (await fetch(base + "/infraestrutura", { headers: { cookie } })).text();
    assert.match(html, /name="alvo" value="host"/);
  } finally { s.close(); }
});
```

E a `test/inicio.test.ts`:

```typescript
test("a Marcella ve botao do Jellyfin e nenhum do que nao e dela", async () => {
  const { base, s, entrar } = await servidor();
  try {
    const c = await entrar("marcella", "s2");
    const html = await (await fetch(base + "/", { headers: { cookie: c } })).text();
    assert.match(html, /name="alvo" value="201"/, "o Jellyfin e dela");
    assert.doesNotMatch(html, /name="alvo" value="301"/, "o servidor de jogo nao");
    assert.doesNotMatch(html, /name="alvo" value="host"/, "e o host muito menos");
  } finally { s.close(); }
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

```bash
cd ~/projetos/portal-casa && npx tsx --test test/infraestrutura.test.ts
```

- [ ] **Passo 3: desenhar os botoes**

Em `src/telas/infraestrutura.ts`, cada linha da tabela ganha uma celula de acoes.
Para cada maquina, os botoes oferecidos sao os verbos que `podeAgir` aprovar — a
tela **pergunta a mesma funcao** que a rota vai consultar, em vez de reimplementar
a regra:

```typescript
function botoes(db: Database.Database, papel: string, m: Maquina, csrf: string, voltar: string): string {
  const alvo: Alvo = { tipo: "maquina", vmid: m.vmid, classe: m.tipo };
  const oferecidos = VERBOS.filter((v) => podeAgir(db, papel, alvo, v).permitido);
  if (oferecidos.length === 0) return "";
  return oferecidos.map((v) => `<form method="post" action="/acao" class="acao">
<input type="hidden" name="alvo" value="${escapar(m.vmid)}">
<input type="hidden" name="verbo" value="${escapar(v)}">
<input type="hidden" name="csrf" value="${escapar(csrf)}">
<input type="hidden" name="voltar" value="${escapar(voltar)}">
<button>${escapar(rotulo(v))}</button>
</form>`).join("");
}
```

com os rotulos vindos do mesmo mapa usado na tela de confirmacao. Exporte-o de
`src/acoes/tipos.ts` para nao existirem duas listas:

```typescript
export const ROTULOS: Record<Verbo, string> = {
  start: "Ligar",
  shutdown: "Desligar",
  reboot: "Reiniciar",
};
```

e em `src/telas/acao.ts` importe-o em vez de redeclarar. O `csrf` vem de
`tokenCsrf(req.sessao!.id, segredo)` — o campo `id` foi acrescentado a
`req.sessao` na Task 6.

Na tela Inicio, o mesmo, dentro do cartao do servico, usando o `maquina_vmid` do
servico. Um botao para o host aparece no fim da tela Infraestrutura, so quando
`podeAgir(db, papel, { tipo: "host" }, "shutdown")` permitir.

Acrescente ao bloco `ESTILO` em `src/html/base.ts`:

```css
.acao { display:inline; }
.acao button { padding:.25rem .5rem; font-size:.8rem; }
.perigo button { border-color:#d13b3b66; color:#d13b3b; }
```

- [ ] **Passo 4: rodar tudo e confirmar que passa**

```bash
cd ~/projetos/portal-casa && npm test && npx tsc --noEmit
```

- [ ] **Passo 5: comitar**

```bash
git add src test
git commit -m "portal: botoes de acao nas telas, oferecidos pela mesma regra que a rota confere"
```

---

### Task 8: Implantacao

**Arquivos:**
- Modificar: `infra/portal/implantacao.md`, `infra/portal/acoes.md`

- [ ] **Passo 1: gerar a chave do portal e autorizar no host**

No CT 103, como root:

```bash
pct exec 103 -- /bin/sh -c 'mkdir -p /etc/portal && ssh-keygen -t ed25519 -N "" -C "portal-acao" -f /etc/portal/acao_key && chown portal:portal /etc/portal/acao_key && chmod 600 /etc/portal/acao_key && cat /etc/portal/acao_key.pub'
```

No host, acrescentar a `/root/.ssh/authorized_keys`, **com o comando forcado** —
sem ele a chave daria shell de root:

```
command="/usr/local/sbin/portal-acao",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... portal-acao
```

- [ ] **Passo 2: instalar o programa no host**

```bash
# do repositorio, enviar infra/portal/portal-acao para o host, depois:
install -m 700 -o root -g root /tmp/portal-acao /usr/local/sbin/portal-acao
sh /tmp/portal-acao.test.sh /usr/local/sbin/portal-acao
```

Esperado: `TODOS OS CASOS PASSARAM`.

- [ ] **Passo 3: provar a barreira de fora**

Do CT 103, como o usuario `portal`, tentar sair da lista:

```bash
ssh -i /etc/portal/acao_key root@192.168.15.200 'ct shutdown 103'   # deve recusar
ssh -i /etc/portal/acao_key root@192.168.15.200 'cat /etc/shadow'   # deve recusar
ssh -i /etc/portal/acao_key root@192.168.15.200 'ct status 201'     # deve responder
```

O segundo caso e o que prova o comando forcado: mesmo pedindo outra coisa, o
host so executa o `portal-acao`.

- [ ] **Passo 4: publicar a versao nova**

Seguindo `infra/portal/implantacao.md`: `npx tsc`, copiar `esquema.sql` para
`dist/src/db/`, empacotar, enviar, `npm ci --omit=dev`, reiniciar. A migracao da
coluna `acionavel` roda sozinha na abertura do banco.

Acrescentar a `/etc/portal.env`:

```
PORTAL_CHAVE_ACAO=/etc/portal/acao_key
PORTAL_HOST_ACAO=root@192.168.15.200
```

- [ ] **Passo 5: conferir no ar, pelo conteudo**

Entrar como admin, ligar o CT 104 (starloco, que fica desligado), confirmar que
ele sobe pelo `pct status`, e conferir a linha em `acoes_log`. Depois desligar.
Entrar como a Marcella e confirmar que ela ve botao do Jellyfin e nenhum do
servidor de jogo.

**Nao teste o botao de desligar o host sem combinar antes** — ele derruba a casa
inteira, e voltar depende do atalho do iPhone.

- [ ] **Passo 6: comitar**

```bash
git add infra/portal
git commit -m "portal: implantacao das acoes, com chave de comando forcado"
```

---

## Fora desta fatia

- As telas Games, Midia, Casa e Administracao.
- A leitura do Home Assistant, cuja fonte existe e e testada em
  `src/fontes/homeassistant.ts`, mas nao esta montada.
- A geracao de documentacao a partir do inventario.
- Uma tela para ler o `acoes_log` — por ora ele se le por SQL.
