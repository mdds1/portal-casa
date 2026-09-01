# Trabalho `casa-diario`

**Semanal desde 01/09/2026**, sextas as 01:00. O nome do trabalho continua
`casa-diario` porque renomear quebraria referencias; a periodicidade mudou.

Storage `drive`, modo snapshot, compressao zstd, retencao
`keep-weekly=4,keep-monthly=2` (cerca de dois meses).
Maquinas: 100, 102, 103, 104, 111, 120, 201, 301. A 110 fica fora (ver README).

## O disparo NAO e do agendador do Proxmox

O job esta com `enabled 0` de proposito. Quem dispara e o
`backup-casa.timer` do systemd, que chama `/usr/local/sbin/backup-casa`.

Motivo, medido em 01/09: **o agendador do Proxmox nao recupera execucao
perdida**, e o host fica desligado em horarios irregulares (03:26-12:23 em
01/09, 00:03-18:40 em 28/08, 23:47-07:14 em 26/08 — desligamento manual, sem
agendamento). Com backup semanal isso significaria semanas sem copia, em
silencio. `Persistent=true` no timer resolve: a tarefa perdida roda no boot
seguinte.

A definicao do job continua sendo a fonte unica — `backup-casa` le
`/cluster/backup` e monta a chamada do `vzdump` a partir dela. Mudar a lista de
maquinas pelo `pvesh` muda o que o timer faz.

**Cuidado:** o `vzdump` recebe os vmid como argumento POSICIONAL. `--vmid` e
recusado com "Unknown option", apesar de a mensagem de uso sugerir o contrario.

Modo snapshot mantem tudo rodando: local-lvm e vg-canary sao LVM-thin.

Alterar sempre por `pvesh create/set /cluster/backup`, nunca editando
/etc/pve/jobs.cfg a mao.

## Pendencias conhecidas

- **Sem notificacao de falha.** Nao existe `/etc/pve/notifications.cfg` nem
  `mailto` configurado no job, e o postfix esta ativo mas sem alias de
  root. Se o job das 03:00 falhar, o aviso vai para `/var/mail/root` e
  ninguem le — o backup pode ficar quebrado por semanas em silencio. Fica
  para o proximo plano.
- ~~**Lista `vmid` e estatica.**~~ **Fechada em 01/09/2026.** O
  `/usr/local/sbin/verifica-backup` compara os guests existentes contra a
  lista do job e reporta quem esta de fora; exclusoes deliberadas ficam em
  `/etc/verifica-backup.excecoes`. Ele roda junto do backup e o resultado
  entra no relatorio. Na primeira execucao encontrou **dois** descobertos: o
  CT 201 (Jellyfin) e o CT 103 (o proprio portal).


## Restauracao verificada

01/09/2026: o backup do CT 201 foi restaurado num container descartavel e o
Jellyfin subiu com as duas contas intactas. Ver `infra/midia/parque-midia.md`
para as duas armadilhas do restauro (MAC herdado e bind mount).

## Relatorio

`/var/lib/portal/backup-casa.txt` guarda a ultima execucao: data, maquinas,
resultado, guests sem cobertura e as ultimas 20 linhas do `vzdump`.
