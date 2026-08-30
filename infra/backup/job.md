# Trabalho `casa-diario`

Diario as 03:00, storage `drive`, modo snapshot, compressao zstd.
Maquinas: 100, 101, 102, 104, 111, 120. A 110 fica fora (ver README).

03:00 e antes dos backups de aplicacao da VM 110 (04:00 FloripaOT,
04:20 StarLoco) para os dois nao disputarem disco.

Modo snapshot mantem tudo rodando: local-lvm e vg-canary sao LVM-thin.

Alterar sempre por `pvesh create/set /cluster/backup`, nunca editando
/etc/pve/jobs.cfg a mao.
