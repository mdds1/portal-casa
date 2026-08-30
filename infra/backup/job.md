# Trabalho `casa-diario`

Diario as 03:00, storage `drive`, modo snapshot, compressao zstd.
Maquinas: 100, 101, 102, 104, 111, 120. A 110 fica fora (ver README).

03:00 e antes dos backups de aplicacao da VM 110 (04:00 FloripaOT,
04:20 StarLoco) para os dois nao disputarem disco.

Modo snapshot mantem tudo rodando: local-lvm e vg-canary sao LVM-thin.

Alterar sempre por `pvesh create/set /cluster/backup`, nunca editando
/etc/pve/jobs.cfg a mao.

## Pendencias conhecidas

- **Sem notificacao de falha.** Nao existe `/etc/pve/notifications.cfg` nem
  `mailto` configurado no job, e o postfix esta ativo mas sem alias de
  root. Se o job das 03:00 falhar, o aviso vai para `/var/mail/root` e
  ninguem le — o backup pode ficar quebrado por semanas em silencio. Fica
  para o proximo plano.
- **Lista `vmid` e estatica.** O job aponta para `100,101,102,104,111,120`
  fixo em `/etc/pve/jobs.cfg`; maquina nova nao entra sozinha na lista, nao
  tem backup e nao ha aviso nenhum disso. Fica para o proximo plano.
