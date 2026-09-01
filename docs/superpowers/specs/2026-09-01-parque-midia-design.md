# Melhorias no parque de midia — desenho

**Data:** 01/09/2026
**Escopo:** CT 201 (jellyfin) e CT 102 (media-stack Docker) no Proxmox `pve`.

## Problema

O parque de midia funciona, mas carrega riscos herdados da migracao do Jellyfin
(CT 101 -> CT 201, concluida em 30/08/2026). O levantamento de 01/09 encontrou:

| # | Achado | Peso |
|---|---|---|
| 1 | O job de backup `casa-diario` cobre o CT **101** (morto) e **nao cobre o 201** (vivo) | alto |
| 2 | CT 101 e CT 201 compartilham o MAC `BC:24:11:C0:32:06` | alto |
| 3 | O CT 201 pega IP por DHCP (`192.168.15.15`) sem reserva | medio |
| 4 | Nao ha mecanismo de atualizacao; tudo em `:latest`, pasta `config/watchtower` orfa | medio |
| 5 | `compose.yaml` fora do Git, com 5 arquivos `.bak` empilhados | medio |
| 6 | Jellyfin com 2 nucleos, sem aceleracao por hardware | baixo |
| 7 | CT 101 ocupa 12 GB e entra no backup diario a toa | baixo |

O unico backup do CT 201 e um `vzdump` manual de 31/08 no **disco local do host** —
exatamente o disco de que um backup nao deveria depender.

## Fora de escopo (decisoes do dono, 01/09)

- **VPN no qBittorrent.** Fica sem.
- **Backup da biblioteca de midia.** `/mnt/media` (60 GB) segue sem copia. O
  `vzdump` ja a exclui por ser bind mount, e isso permanece deliberado.
- **Atualizacao automatica** (Watchtower). Substituida por atualizacao manual com aviso.
- Sonarr, Radarr, Prowlarr, Seerr, RomM e qBittorrent nao serao tocados: funcionam
  e nao fazem parte do problema.

## Contexto medido

    Host pve: 12 nucleos, 15 GB RAM (10 GB em uso, 18,5 GB alocados — memoria e o recurso apertado)
    GPU GTX 760 dedicada a VM 120 (Batocera); nao ha /dev/dri no host
    /mnt/media: 916 GB, 60 GB usados
    Jellyfin 10.11.11 (ultima release), usando 166 MB dos 2 GB que tem
    Drive de backup: 453 GB livres
    Retencao do job: 3 diarios + 2 semanais + 1 mensal, as 03:00, storage `drive`

## Arquitetura

Seis unidades independentes. Cada uma entrega valor sozinha. A unica ordem
obrigatoria e **1 antes de 2** (o backup do 101 precisa existir antes de destrui-lo).

---

### Unidade 1 — O backup passa a cobrir o Jellyfin

**O que faz:** corrige a lista do job `casa-diario` (entra o 201, sai o 101) e cria
um verificador que impede a lista de ficar desatualizada de novo.

**Por que o verificador:** a linha de configuracao conserta hoje; o verificador
conserta o padrao. A lista ficou errada porque uma migracao criou uma maquina nova
e ninguem lembrou do job. Isso vai se repetir.

**Como funciona:** um script compara os guests existentes (`pvesh get /cluster/resources`)
contra a lista `vmid` do job e reporta quem esta de fora. Exclusoes deliberadas
(a VM 110, bancada) vivem num arquivo de excecoes, para o alerta nao virar ruido
que se aprende a ignorar. Roda semanalmente por cron.

**Interface:** `/usr/local/sbin/verifica-backup` — saida vazia e codigo 0 quando tudo
coberto; lista os vmid descobertos e codigo 1 quando falta alguem.
Excecoes em `/etc/verifica-backup.excecoes`, um vmid por linha, `#` comenta.

**Verificacao:** restaurar o backup do 201 num VMID descartavel (999), confirmar que
o Jellyfin sobe e que `jellyfin.db` tem as contas, e destruir o restaurado. Backup
que nunca foi restaurado e hipotese, nao backup.
Alem disso: criar um CT descartavel fora da lista e confirmar que o verificador o acusa.

---

### Unidade 2 — O CT 101 e aposentado

**O que faz:** `vzdump` final para o storage `drive`, conferencia do arquivo,
`pct destroy 101`, e remocao do vmid do job.

**Ganhos:** libera 12 GB, tira um container morto do backup diario e **acaba com a
colisao de MAC** — hoje ligar o 101 com o 201 no ar derruba a rede dos dois.

**Verificacao:** listar o conteudo do arquivo `.tar.zst` e confirmar que
`/var/lib/jellyfin/data/jellyfin.db` esta la antes de destruir. Depois de destruir,
confirmar que `pct list` nao mostra mais o 101 e que o job nao o cita.

---

### Unidade 3 — Endereco fixo para o Jellyfin

**O que faz:** troca `ip=dhcp` por `ip=192.168.15.15/24,gw=192.168.15.1` na
configuracao do CT 201.

**Por que na configuracao e nao no roteador:** fica sob nosso controle, segue o
padrao que o CT 102 ja usa (`192.168.15.102/24` fixo) e nao depende de mexer na
Vivo Box. O `.15` e o endereco que o DHCP ja vinha entregando, entao nada que
aponta para ele quebra.

**Verificacao:** reiniciar o container e confirmar `192.168.15.15` em `ip -4 addr`,
com o Jellyfin respondendo em `http://192.168.15.15:8096`.

---

### Unidade 4 — O compose entra no Git

**O que faz:** transforma `/opt/media-stack/` em repositorio Git local, apaga os
cinco `.bak` (o historico passa a guardar isso melhor) e cria um `.gitignore`.

**O que fica de fora do Git:** `.env` (segredos do RomM) e `config/` (bancos e
estado dos servicos). Os dois continuam protegidos pelo backup diario do CT 102.

**Sem remoto:** publicar exigiria credencial de Git dentro do container, ampliando
o que um invasor alcanca a partir dali. O backup diario ja resolve perda.

**Verificacao:** `git log` mostra o commit inicial; `git status` limpo; `.env` e
`config/` ausentes de `git ls-files`; os `.bak` fora do disco.

---

### Unidade 5 — Atualizacao controlada, com aviso

Duas pecas separadas, por terem donos diferentes: uma informa, a outra age.

**O verificador** compara o digest local de cada imagem com o do registro e lista o
que tem atualizacao. Nao muda nada. Exposto ao Home Assistant como sensor, para
aparecer no painel sem ninguem precisar entrar em nada.

**O atualizador** e disparado por voce: anota os digests atuais, puxa as imagens,
sobe a stack e faz *health check* HTTP em cada servico. Se algum nao responder no
prazo, **volta sozinho para os digests anotados**.

**Por que nao Watchtower:** atualizacao automatica sem rollback ja quebrou Sonarr e
Radarr para muita gente, e a descoberta acontece na hora de assistir. O rollback
automatico e o que separa as duas abordagens.

**Interface:**
- `/usr/local/sbin/media-stack-check` (no CT 102) — imprime uma linha por imagem
  com atualizacao pendente; vazio quando tudo atual.
- `/usr/local/sbin/media-stack-update` (no CT 102) — atualiza com rollback.
- Um verbo novo no `/usr/local/sbin/ha-pve-power` do host, `midia updates`, para o
  HA chamar o verificador dentro do CT 102. O wrapper tem lista fechada de comandos;
  o verbo entra nela e nao aceita argumento nenhum.
- Um `command_line` sensor no Home Assistant (`sensor.midia_atualizacoes_pendentes`)
  lendo esse verbo, com `scan_interval` de 6 horas.

**Verificacao (por mutacao):** apontar o *health check* para um servico parado de
proposito e confirmar que ele acusa falha e dispara o rollback. Um verificador que
so sabe dizer "esta tudo bem" nao prova nada. Confirmar tambem que, apos o rollback,
os digests voltaram aos anotados.

---

### Unidade 6 — Mais CPU para o Jellyfin

**O que faz:** `cores` de 2 para 4 no CT 201. A RAM fica em 2 GB.

**Por que so CPU:** a GTX 760 esta dedicada a VM 120, entao transcodificacao e por
CPU, e o host tem 12 nucleos ociosos. Ja a memoria do host esta apertada (18,5 GB
alocados para 15 GB fisicos) e o Jellyfin usa 166 MB dos 2 GB que tem — subir RAM
seria piorar o aperto para resolver um problema que nao existe.

**Documentacao junto:** registrar por que nao ha aceleracao por hardware, para
ninguem perder uma tarde procurando o `/dev/dri` que nao existe.

**Verificacao:** `nproc` dentro do container devolve 4.

---

## Tratamento de erro

Toda unidade que destroi ou sobrescreve tira copia antes e confere a copia antes de
destruir. O atualizador e o unico com rollback automatico, porque e o unico que roda
sem ninguem olhando.

Scripts falham com codigo de saida diferente de zero e mensagem em stderr dizendo o
que faltou. Nenhum deles usa `|| true`, que ja escondeu falha de acao no portal.

## Estrategia de teste

Isto e infraestrutura, nao biblioteca: os testes sao passos de verificacao
executados de verdade, nao suite automatizada. Cada unidade tem os seus, listados
acima. O criterio comum: **toda verificacao precisa ter sido vista falhar** —
restaurar o backup de fato, apontar o health check para um servico parado, criar um
CT fora da lista para o verificador acusar.

## Documentacao

Um runbook em `infra/midia/parque-midia.md` no repositorio do portal, cobrindo: o
que o backup do 201 contem e o que nao contem, como restaurar, como atualizar a
stack, e por que nao ha transcodificacao por hardware.
