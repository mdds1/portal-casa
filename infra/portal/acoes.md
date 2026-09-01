# O programa de acoes no host Proxmox

## O que e

`portal-acao` e um script shell (`sh`, POSIX, sem bashismos) que roda no host
Proxmox como **comando forcado** da chave SSH do Portal da Casa (CT 103). Ele e
a ultima barreira: mesmo que o portal inteiro seja comprometido -- o container,
a aplicacao web, o processo Node -- o unico dano possivel e o que este arquivo
permite fazer, porque a chave SSH usada pelo portal nunca consegue rodar outro
comando no host.

## Onde e instalado

- Caminho no host: `/usr/local/sbin/portal-acao`
- Dono: `root`
- Modo: `700` (so root le, escreve ou executa)
- Origem: copia manual deste arquivo, `infra/portal/portal-acao`, do
  repositorio. A instalacao e feita a mao (Task 8 do plano) -- este arquivo
  aqui e so a fonte versionada, git nunca escreve direto no host.

## Como a chave do portal e autorizada

No host, no `~root/.ssh/authorized_keys`, a chave publica do portal (gerada no
CT 103, a privada nunca sai de la) ganha uma linha com **comando forcado**:

```
command="/usr/local/sbin/portal-acao",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... portal@ct103
```

O `command=` faz o sshd ignorar qualquer comando que o cliente tente mandar e
rodar sempre `portal-acao` no lugar. O que o portal realmente pediu chega pela
variavel de ambiente `SSH_ORIGINAL_COMMAND`, que e o unico dado que atravessa a
fronteira. As flags `no-*` fecham os outros usos que uma sessao SSH normalmente
permite (encaminhar porta, X11, agente, pseudo-terminal interativo) -- nenhum
deles e necessario para mandar uma linha de texto e ler uma linha de volta.

Sem credencial nenhuma no codigo ou no git: a chave privada mora so no CT 103,
a lista de autorizacao mora so no host, e nenhum dos dois versiona a outra.

## O contrato

Entrada, via `SSH_ORIGINAL_COMMAND`: `"<tipo> <verbo> [<id>]"`.
Saida: uma linha em `stdout`; codigo de saida `0` em sucesso.

## A lista de alvos, e por que cada exclusao existe

Alvos aceitos (`tipo:id`):

| tipo | id  | maquina |
|------|-----|---------|
| vm   | 120 | gamebox-batocera, emulador na TV |
| vm   | 301 | FloripaOT (jogo, site, banco) |
| ct   | 100 | drive de midias por SMB |
| ct   | 102 | Docker, containers avulsos |
| ct   | 104 | Dofus Retro (StarLoco) |
| ct   | 201 | Jellyfin, midia da casa |

Mais o pseudo-alvo `host`, que so aceita o verbo `shutdown` e desliga o
Proxmox inteiro (de proposito -- serve para quando o Matheus esta fora e
esqueceu a maquina ligada).

Deliberadamente FORA da lista, e por isso mesmo:

- **CT 103** -- e o proprio portal. Se ele pudesse se desligar, uma acao (ou um
  bug, ou um invasor) o derrubaria e ninguem conseguiria mais ligar nada pelo
  painel.
- **VM 111** -- e o Home Assistant. Derrubar ele junto derruba as automacoes da
  casa (luzes, alarme, monitoramento) sem relacao nenhuma com o que o portal
  deveria controlar.
- **VM 110** -- e a bancada de desenvolvimento. Nao e uma maquina de producao
  que faca sentido ligar/desligar pelo portal.

Qualquer `tipo:id` fora da tabela cai no `case` padrao e e recusado com
`alvo recusado`, saida 3.

## Codigos de saida, e por que o 4 existe

| saida | significado |
|---|---|
| 0 | a acao rodou e o `qm`/`pct` devolveu sucesso; stdout traz o estado depois dela |
| 2 | pedido malformado, tipo invalido ou verbo fora da lista |
| 3 | alvo fora da lista fechada |
| 4 | a acao foi tentada e o `qm`/`pct` FALHOU; stdout traz `falhou: <comando> (codigo N)` |

O 4 e a diferenca entre um log honesto e um log que mente. Antes, os tres
verbos terminavam em `|| true` e o script saia 0 sempre: um `pct shutdown`
que falhava virava `ok=1` no `acoes_log` — a unica testemunha de que uma
maquina real mudou de estado afirmando um sucesso que nao houve.

## O limite de tempo (`LIMITE=12`)

`qm shutdown` e `pct shutdown` BLOQUEIAM esperando o guest sair, e os padroes
do Proxmox (60 s no pct, 180 s no qm) sao maiores que os 20 s que o portal da
ao SSH (`src/acoes/wrapper.ts`). Sem limite proprio, o portal matava a conexao
antes de saber o desfecho e gravava `ok=0` numa acao que talvez tivesse dado
certo — o erro do achado 1 ao contrario.

Passamos `--timeout 12` ao `qm`/`pct`, confortavelmente dentro da janela do
SSH: o comando devolve um codigo de saida de verdade, e uma requisicao HTTP
nunca fica pendurada. Quem mexer no `msLimite` do wrapper tem que manter esta
folga.

No `pct` vai junto `--forceStop 0`. O padrao (`1`) mata o container quando o
tempo acaba, e o portal registraria `ok` para o que foi, na pratica, um puxao
de tomada. Preferimos a verdade: um guest que se recusa a desligar em 12 s sai
com 4, o operador ve a faixa de falha e decide se forca a mao.

## A lista de verbos

Verbos aceitos por maquina (`vm`/`ct`): `start`, `shutdown`, `reboot`. O host
so aceita `shutdown`.

`status` NAO e um verbo aceito: um pedido `ct status 201` e recusado com
`verbo invalido`. A leitura de estado continua existindo, mas so como ultima
linha do script, depois de uma acao que deu certo — nunca como pedido do
portal. Era o unico item em que as duas listas divergiam (o portal nunca teve
`status` em `VERBOS`), e a lista mais curta e a que vale numa barreira.

**Esta lista aparece em DOIS lugares e os dois precisam continuar iguais:**

1. Aqui, no `case "$VERBO" in ...` de `infra/portal/portal-acao`.
2. Em `src/acoes/tipos.ts`, na constante `VERBOS`.

Desde a correcao da revisao final isso NAO depende so de disciplina:
`test/consistencia.test.ts` le este arquivo, extrai os dois `case` e compara
com `VERBOS` e com as maquinas `acionavel=1` de `src/db/semente.ts`. Ele roda
em `npm test`. Ainda assim, conferir os dois no mesmo commit.

Se um verbo for adicionado, removido ou renomeado em um lugar sem o outro, o
portal e o host divergem silenciosamente: ou o portal oferece um botao que o
host recusa, ou o host aceita um verbo que o portal nunca pensou em mandar.
Ao mexer em qualquer um dos dois arquivos, conferir o outro no mesmo commit.

## Por que nao a API de escrita do Proxmox

Um token de escrita da API do Proxmox pode fazer tudo que o papel (role)
associado permite, e os papeis do Proxmox sao grossos -- nao da para conceder
"so ligar/desligar essas seis maquinas" com granularidade fina. Aqui a lista e
explicita, curta, e legivel por qualquer pessoa em trinta segundos: e um script
de ~40 linhas com um `case` fechado, nao uma politica de permissoes de um
sistema de terceiros.

## Testando sem tocar em maquina nenhuma

`test/portal-acao.test.sh` poe stubs de `qm`, `pct` e `shutdown` na frente do
`PATH` (eles so registram a chamada e devolvem sucesso) e verifica que a lista
fechada de alvos e verbos recusa o que deve recusar e aceita o que deve
aceitar. Roda com:

```sh
sh test/portal-acao.test.sh infra/portal/portal-acao
```

Nao roda em `npm test` (e um script `sh`, nao TypeScript) -- e chamado a mao,
localmente ou antes de reinstalar o arquivo no host.

## O limite de 12 s mentia (corrigido em 01/09/2026)

O portal registrou `shutdown ct:201 -> falhou: pct shutdown 201 --timeout 12
--forceStop 0 (codigo 255)` para um desligamento que **deu certo**: o container
so terminou de sair depois que o `pct` ja tinha desistido.

Medido na mao: o **Jellyfin leva 17 s** para desligar por completo. O `--timeout
12` devolvia 255 aos 12 s, e o portal gravava falha numa acao bem-sucedida.

E o defeito que o proprio comentario do script previa — "grava ok=0 numa acao
que talvez tenha dado certo" — so que causado pelo nosso limite, nao pelo padrao
do Proxmox. A estimativa e que estava errada, nao o raciocinio.

    portal-acao   LIMITE   12 s -> 45 s
    wrapper.ts    msLimite 20 s -> 60 s

Os dois andam juntos: o SSH precisa sobreviver a espera do `pct`. Mexer num sem
o outro recria o mesmo defeito com outro numero.

Provado depois da correcao: mesma acao, mesmo alvo, registro `OK stopped`.

**`--forceStop 0` continua.** Um container travado segue sem desligar, e isso e
deliberado: preferimos falhar e dizer a verdade a gravar "ok" para um puxao de
tomada. Botao de forcar continua na lista de pendencias.
