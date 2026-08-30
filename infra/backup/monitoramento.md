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

## Nota sobre a convencao de chamada

Os verbos existentes (`status`, `start`, `shutdown`, `reboot`) recebem
`TYPE ACTION ID`, por exemplo `vm status 110` ou `ct status 100` — nao
`ACTION TYPE:ID`. Isso foi confirmado lendo o script e testando contra a
copia de seguranca antes de qualquer alteracao.
