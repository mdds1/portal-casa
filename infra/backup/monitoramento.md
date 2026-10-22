# Como se sabe que o backup falhou

O problema: nao ha notificacao de falha. Sem `notifications.cfg`, sem `mailto`
no job, e o postfix sem alias de root — um job que falha as 03:00 escreve em
/var/mail/root e ninguem le. O backup pode estar quebrado por semanas.

A solucao nao foi montar cadeia de e-mail, e sim tornar o dado consultavel pelo
caminho que o Home Assistant ja usa: um verbo somente-leitura no wrapper de
lista fechada.

## O verbo

    SSH_ORIGINAL_COMMAND="backup_age" /usr/local/sbin/ha-pve-power

Devolve a idade, em horas inteiras, do dump mais recente em /mnt/drive/dump/.
Devolve **-1** quando nao existe dump nenhum — que e diferente de "backup
velho" e o consumidor precisa tratar separado.

## Como consumir

O job roda diariamente as 03:00. Portanto:

- idade <= 30h  -> saudavel
- idade  > 30h  -> o job falhou ou nao rodou; investigar
- idade == -1   -> nunca houve backup; grave

O Home Assistant e o portal leem por aqui. Nao ha necessidade de servidor de
e-mail em lugar nenhum.

Copia do wrapper anterior em /root/arquivo/ha-pve-power.antes-do-backup-age.

## 19/09/2026 — o que este verbo NAO cobre

O `backup_age` olha `/mnt/drive/dump/`, ou seja **so o vzdump do Proxmox**. Os
backups de *aplicacao* — os que vao para o Google Drive por rclone, do FloripaOT
e do StarLoco — nao passam por aqui e **nao tinham vigia nenhum**.

Custou caro descobrir isso. O `~/bin/backup-starloco.sh` na bancada apontava
para um IP que a renumeracao da casa deu a outra maquina, e falhou todo dia sem
que nada avisasse:

    29/08 16:53   ultimo backup bem-sucedido
    04-07/09      4 execucoes, todas "root@192.168.15.14: Permission denied"
    08-19/09      nao rodou — a bancada estava desligada

O cron manda a saida para `/dev/null`, entao os 15 dias passaram calados. Quando
o CT 104 foi destruido por engano em 19/09 (ver
`infra/host/ct-104-starloco-destruido.md`), o unico backup recente que existia
era o vzdump do Proxmox — o de aplicacao estava tres semanas atrasado.

### O que foi feito

O `backup-starloco.sh` ganhou duas coisas:

1. **Conferencia de identidade do alvo.** Antes de dumpar, exige que o host
   responda com `/opt/starloco` presente. Se o IP tiver mudado de dono, ele
   recusa alto em vez de conversar com a maquina errada. Testado apontando de
   proposito para o portal: recusou.
2. **Arquivo de estado** em `~/logs/backup-starloco.estado`, com
   `<data> <OK|FALHA|EXECUTANDO> <detalhe>`. E a unica coisa que precisa ser
   lida para saber se o ultimo backup prestou — mesmo padrao de ideia do
   `backup_age`: dado consultavel, sem cadeia de e-mail.

### O que continua pendente

- O `backup-floripaot.sh` tem o mesmo desenho e provavelmente a mesma cegueira;
  nao foi revisado em 19/09.
- Nada ainda **le** o arquivo de estado. Expor por `ha-pve-power` (um verbo
  irmao do `backup_age`) fecharia o ciclo, mas o arquivo vive na bancada, nao
  no host — precisa de desenho antes de codigo.

## Nota sobre a convencao de chamada

Os verbos existentes (`status`, `start`, `shutdown`, `reboot`) recebem
`TYPE ACTION ID`, por exemplo `vm status 110` ou `ct status 100` — nao
`ACTION TYPE:ID`. Isso foi confirmado lendo o script e testando contra a
copia de seguranca antes de qualquer alteracao.
