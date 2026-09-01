# Melhorias no parque de midia — desenho

**Data:** 01/09/2026
**Escopo:** CT 201 (jellyfin) e CT 102 (media-stack Docker) no Proxmox `pve`.

## Problema

O parque de midia funciona, mas carrega riscos herdados da migracao do Jellyfin
(CT 101 -> CT 201, concluida em 30/08/2026). O levantamento de 01/09 encontrou:

| # | Achado | Peso |
|---|---|---|
| 1 | O job de backup `casa-diario` cobre o CT **101** (morto) e **nao cobre o 201** (vivo) | alto |
| 1b | O agendador do Proxmox **nao recupera execucao perdida**, e o host fica desligado em horarios irregulares | alto |
| 2 | CT 101 e CT 201 compartilham o MAC `BC:24:11:C0:32:06` | alto |
| 3 | O CT 201 pega IP por DHCP (`192.168.15.15`) sem reserva | medio |
| 4 | Nao ha mecanismo de atualizacao; tudo em `:latest`, pasta `config/watchtower` orfa | medio |
| 5 | `compose.yaml` fora do Git, com 5 arquivos `.bak` empilhados | medio |
| 6 | **30 das 48 sessoes sao transcodificacao completa** — assiste-se pelo navegador em todos os aparelhos | alto |
| 7 | CT 101 ocupa 12 GB e entra no backup diario a toa | baixo | **resolvido em 01/09** |

O unico backup do CT 201 e um `vzdump` manual de 31/08 no **disco local do host** —
exatamente o disco de que um backup nao deveria depender.

## Fora de escopo (decisoes do dono, 01/09)

- **VPN no qBittorrent.** Fica sem.
- **Backup da biblioteca de midia.** `/mnt/media` (60 GB) segue sem copia. O
  `vzdump` ja a exclui por ser bind mount, e isso permanece deliberado.
- **Atualizacao automatica** (Watchtower). Substituida por atualizacao manual com aviso.
- **Backup diario.** Passa a semanal, as sextas. O dono considera diario excessivo.
- **Encenar o filme num SSD antes de assistir.** Descartado por medicao, nao por
  gosto: o gargalo e transcodificacao de CPU, nao leitura de disco, e nao ha espaco
  de SSD livre. Registrado para nao voltar como "ideia nova" mais adiante.
- Sonarr, Radarr, Prowlarr, Seerr, RomM e qBittorrent nao serao tocados: funcionam
  e nao fazem parte do problema.

## Contexto medido

    Host pve: 12 nucleos, 15 GB RAM (10 GB em uso, 18,5 GB alocados — memoria e o recurso apertado)
    GPU GTX 760 dedicada a VM 120 (Batocera); nao ha /dev/dri no host
    /mnt/media: 916 GB, 60 GB usados
    Jellyfin 10.11.11 (ultima release), usando 166 MB dos 2 GB que tem
    Drive de backup: 453 GB livres
    Retencao do job: 3 diarios + 2 semanais + 1 mensal, as 03:00, storage `drive`
    Discos: 2 SSD de 112 GB (ambos totalmente alocados), 1 HD de 466 GB (backups), 1 HD de 932 GB (midia)
    Reproducao: 30 de 48 sessoes sao transcodificacao; 100% via "Jellyfin Web"
    Arquivos: HEVC Main 10 + E-AC3 Atmos
    Host desligado em horarios irregulares (03:26-12:23, 00:03-18:40, 23:47-07:14), sem agendamento

## Arquitetura

Seis unidades independentes. Cada uma entrega valor sozinha. A unica ordem
obrigatoria e **1 antes de 2** (o backup do 101 precisa existir antes de destrui-lo).

---

### Unidade 1 — O backup passa a cobrir o Jellyfin, e passa a ser semanal

**O que faz:** troca o job `casa-diario` por um semanal as sextas, com o `201`
incluido, e cria um verificador que impede a lista de ficar desatualizada de novo.

**Por que o verificador:** a linha de configuracao conserta hoje; o verificador
conserta o padrao. A lista ficou errada porque uma migracao criou uma maquina nova
e ninguem lembrou do job. Isso vai se repetir.

**Como funciona:** um script compara os guests existentes (`pvesh get /cluster/resources`)
contra a lista `vmid` do job e reporta quem esta de fora. Exclusoes deliberadas
(a VM 110, bancada) vivem num arquivo de excecoes, para o alerta nao virar ruido
que se aprende a ignorar.

**A armadilha do agendamento — medida em 01/09:** o host fica desligado em horarios
irregulares (03:26-12:23 em 01/09; 00:03-18:40 em 28/08; 23:47-07:14 em 26/08).
Nao ha desligamento agendado: e manual. O agendador de backup do Proxmox **nao
recupera execucao perdida**, entao um backup semanal marcado para sexta de
madrugada poderia passar semanas sem rodar, em silencio — pior que o diario atual,
porque a falha nao aparece.

Por isso o backup sai do agendador do Proxmox e passa a ser disparado por um
**systemd timer com `Persistent=true`**, que roda a tarefa perdida no boot seguinte.
"Sexta as 01:00" vira "sexta as 01:00, ou assim que a maquina ligar depois disso".

**Retencao:** com backup semanal, `keep-weekly=4,keep-monthly=2` — cerca de dois
meses de historico. A retencao diaria atual (`keep-daily=3`) deixa de fazer sentido.

**Interface:**
- `/usr/local/sbin/verifica-backup` — saida vazia e codigo 0 quando tudo coberto;
  lista os vmid descobertos e codigo 1 quando falta alguem.
  Excecoes em `/etc/verifica-backup.excecoes`, um vmid por linha, `#` comenta.
- `backup-casa.service` + `backup-casa.timer` (`OnCalendar=Fri 01:00`, `Persistent=true`).

**Verificacao:** restaurar o backup do 201 num VMID descartavel (999), confirmar que
o Jellyfin sobe e que `jellyfin.db` tem as contas, e destruir o restaurado. Backup
que nunca foi restaurado e hipotese, nao backup.
Alem disso: criar um CT descartavel fora da lista e confirmar que o verificador o
acusa; e simular execucao perdida (parar o timer, adiantar o relogio do teste) para
confirmar que a tarefa roda no boot seguinte em vez de ser pulada.

### Unidade 2 — O CT 101 e aposentado — CONCLUIDA EM 01/09/2026

**Executada antes do plano, a pedido do dono.** Registrada aqui para o historico.

    vzdump 101 --storage drive --mode stop
      -> /mnt/drive/dump/vzdump-lxc-101-2026_09_01-13_07_49.tar.zst  (543 MB)
    zstd -t                                    -> arquivo integro
    tar -tf | grep jellyfin.db                 -> banco de contas presente
    pct destroy 101 --purge 1                  -> feito

O `--purge` removeu o vmid do job de backup sozinho: a lista passou de
`100,101,102,104,111,120,301` para `100,102,104,111,120,301`.

**Ganhos confirmados:** 12 GB liberados, um container morto fora do backup, e a
**colisao de MAC resolvida** — o `BC:24:11:C0:32:06` agora e exclusivo do CT 201.

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

### Unidade 5 — Atualizacao controlada, com aviso semanal

Duas pecas separadas, por terem donos diferentes: uma informa, a outra age.

**O verificador** cobre o **Proxmox inteiro**, nao so a stack de midia:

    host pve          apt list --upgradable
    cada VM/CT ligado apt (ou equivalente) dentro do guest
    CT 102            digest local de cada imagem Docker contra o do registro

Nao muda nada — so relata. Roda **sexta as 01:00** por systemd timer com
`Persistent=true`, pela mesma razao da Unidade 1: o host raramente esta ligado
naquele horario, e sem `Persistent` a verificacao simplesmente nunca aconteceria.
Maquina desligada na hora da checagem e reportada como "nao verificada", nunca como
"atualizada" — silencio nao pode ser confundido com boa noticia.

O resultado vai para um arquivo lido pelo Home Assistant como sensor, para aparecer
no painel sem ninguem precisar entrar em nada.

**O atualizador** e disparado por voce, e cobre so a stack de Docker: anota os
digests atuais, puxa as imagens, sobe e faz *health check* HTTP em cada servico. Se
algum nao responder no prazo, **volta sozinho para os digests anotados**.

**Por que nao Watchtower:** atualizacao automatica sem rollback ja quebrou Sonarr e
Radarr para muita gente, e a descoberta acontece na hora de assistir. O rollback
automatico e o que separa as duas abordagens.

Atualizacao de pacotes de host e guests permanece **manual**: o verificador avisa,
voce decide. Atualizar o kernel do Proxmox sem ninguem por perto e outro tipo de
risco.

**Interface:**
- `/usr/local/sbin/verifica-atualizacoes` (host) — relatorio em
  `/var/lib/portal/atualizacoes.txt`, uma linha por alvo.
- `verifica-atualizacoes.timer` (`OnCalendar=Fri 01:00`, `Persistent=true`).
- `/usr/local/sbin/media-stack-update` (no CT 102) — atualiza com rollback.
- Verbo `midia updates` no `/usr/local/sbin/ha-pve-power`, sem argumento, para o HA
  ler o relatorio. O wrapper tem lista fechada de comandos; o verbo entra nela.
- `sensor.atualizacoes_pendentes` no Home Assistant, `scan_interval` de 6 horas.

**Verificacao (por mutacao):** apontar o *health check* para um servico parado de
proposito e confirmar que ele acusa falha e dispara o rollback; confirmar que os
digests voltaram aos anotados. E desligar um guest antes da checagem para confirmar
que ele aparece como "nao verificado", e nao como "sem atualizacoes".

### Unidade 6 — Parar de transcodificar

**O diagnostico, medido em 01/09.** Das 48 sessoes de reproducao registradas no
Jellyfin, **30 foram transcodificacao completa**. O log de ffmpeg mostra o que
acontece:

    Stream #0:0: Video: hevc (Main 10), yuv420p10le       <- o arquivo
    scale=...min(1620,1080*a)...                          <- reduzindo para 1080p
    Stream #0:0: Video: h264, yuv420p                     <- o que sai
    Audio: eac3 (Dolby Digital Plus + Dolby Atmos)

E o log de sessoes mostra a causa:

    reported by app "Jellyfin Web" 10.11.11    <- todas as reproducoes

**Assiste-se pelo navegador nos tres aparelhos** (iPhone, PC e TVs). Navegador nao
decodifica HEVC 10 bits nem E-AC3 Atmos, entao o servidor reescreve cada quadro em
tempo real, em 2 nucleos, sem GPU. E isso que trava.

**Nao e disco.** O HD entrega perto de 100 MB/s; um 4K a 100 Mbps pede 12 MB/s. O
disco nunca foi o gargalo, e por isso a ideia de encenar o filme num SSD foi
descartada — alem de nao haver espaco: os dois SSDs de 112 GB estao inteiramente
comprometidos, sobram ~36 GB fisicos, menos que um unico 4K.

**A correcao e no cliente:**

    iPhone            app Jellyfin (App Store)              — decodifica HEVC 10 bits em hardware
    PC                Jellyfin Media Player (desktop)       — baseado em mpv, toca tudo
    TV do quarto      canal Jellyfin na loja do Roku        — Philco/Roku
    TV da sala        Samsung AU7700 (Tizen) — ver abaixo

A TV da sala e o unico caso sem solucao de loja: o app Tizen exige modo
desenvolvedor e a instalacao expira a cada 60 dias. Tres saidas, em ordem de
recomendacao: um Fire TV Stick 4K (app oficial, resolve de vez); o sideload com a
renovacao periodica; ou manter o navegador so nela, aceitando que ali havera
conversao.

**Folga no servidor:** `cores` de 2 para 6 no CT 201, para que a transcodificacao
residual (a TV da sala, ou um convidado no navegador) deixe de travar. A RAM fica em
2 GB: o Jellyfin usa 166 MB, e a memoria do host e que esta apertada (18,5 GB
alocados para 15 GB fisicos).

**A GPU nao entra na conta.** A GTX 760 esta dedicada a VM 120, mas mesmo livre nao
ajudaria: e Kepler, nao decodifica HEVC nem codifica HEVC.

**Verificacao:** reproduzir o mesmo arquivo pelo app nativo e confirmar, no log, que
nao aparece nenhum `FFmpeg.Transcode` novo — so `DirectPlay`. Um teste que so olha
"ficou fluido?" nao distingue melhora real de rede boa naquele minuto.

**Documentacao junto:** registrar no runbook que o gargalo e conversao, nao disco,
para ninguem daqui a um ano comprar SSD para resolver isso.

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
