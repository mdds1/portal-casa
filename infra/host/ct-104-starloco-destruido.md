# CT 104 starloco — destruido por engano em 19/09/2026

As 20:18:29 de 19/09/2026 o CT 104 (`starloco`, servidor de Dofus Retro) foi
apagado do Proxmox. **Nao foi automacao, nem agente, nem o portal**: foi um
clique na interface web.

Escrito pouco depois do fato, com o container ainda destruido, para que a
decisao de restaurar seja tomada com o que se sabe — e nao com o que se lembra.

## A linha do tempo, do log

Tudo de `/var/log/pveproxy/access.log` e `/var/log/pve/tasks/index`, no dia
19/09/2026:

    18:36:09  login root@pam de 192.168.15.6 (maquina fisica da casa; o MAC
              00:e2:69:7c:5d:34 nao e do prefixo bc:24:11:* do Proxmox)
    18:43:51  PUT  lxc/102/config        \  a manutencao boa do dia:
    18:44:15  PUT  lxc/201/config         |  onboot e religamento depois
    18:44:33  POST lxc/102/status/start   |  da mudanca de endereco
    18:45:01  POST lxc/201/status/start  /
    19:50:32  vzstart:104  OK             <- o starloco e ligado
    20:14:10  vncproxy  qemu/301
    20:17:47  vncproxy  qemu/110
    20:18:13  POST lxc/104/status/stop
    20:18:29  DELETE lxc/104?purge=0&destroy-unreferenced-disks=0
              -> "Logical volume vm-104-disk-0 successfully removed"
    20:18:31  termproxy lxc/103

Trinta segundos entre abrir o console da VM 110 e apagar o CT 104, com o CT 103
aberto logo em seguida. O `api2/extjs` no caminho diz que veio da interface web,
navegando na arvore lateral — nao de script nem de API.

## Por que o dano foi limitado

O `purge=0` **nao removeu os backups**. Foi o que salvou.

    drive:backup/vzdump-lxc-104-2026_09_18-19_31_03.tar.zst   2,48 GB
    drive:backup/vzdump-lxc-104-2026_09_04-01_06_45.tar.zst   2,48 GB

O de 18/09 passou `zstd -t` (5,0 GiB descompactados) e foi tirado com o
container **parado** (`backup mode: stop`), entao e consistente — nao ha risco
de banco pela metade.

## O config original, extraido do vzdump

    hostname: starloco        onboot: 0
    cores: 4  memory: 4096    rootfs: local-lvm:vm-104-disk-0,size=30G
    unprivileged: 1           features: nesting=1,keyctl=1
    net0: name=eth0,bridge=vmbr0,hwaddr=BC:24:11:41:06:83,ip=dhcp,type=veth

Dois detalhes que **mudam o comando de restauracao**:

1. **`ip=dhcp`, nao IP estatico.** O `192.168.15.13` vem de reserva por MAC no
   roteador novo. Restaurar sem preservar `hwaddr=BC:24:11:41:06:83` faz o
   Proxmox gerar MAC novo, a reserva nao casa, e o `.13` **nao volta**.
2. **`onboot: 0`.** O `onboot=1` aplicado em 19/09 e posterior ao backup e se
   perdeu junto; tem que ser reaplicado na mao.

E `--unprivileged 1` e obrigatorio: sem ele o restore recria o container
**privilegiado**, que e exatamente o problema que o CT 201 existiu para
resolver (ver `ct-201-jellyfin.md`).

## O comando

    pct restore 104 /mnt/drive/dump/vzdump-lxc-104-2026_09_18-19_31_03.tar.zst \
      --storage      local-lvm \
      --unprivileged 1 \
      --net0         name=eth0,bridge=vmbr0,hwaddr=BC:24:11:41:06:83,ip=dhcp,type=veth \
      --onboot       1

Pre-requisitos conferidos em 19/09/2026 21:0x: ID 104 livre, nenhum volume
`vm-104-disk-0` residual, MAC nao usado por outro guest, e `local-lvm` com
46,7 GiB livres num pool thin (o restore grava ~5 GiB reais).

Depois de restaurar, **verificar por conteudo, nao por status**: o `.13`
responde a ping, as portas 450 e 5555 aceitam conexao, e os containers Docker
de dentro (mariadb, redis) subiram.

## O que se perde, e o que ja estava perdido

Do container: o que mudou entre **18/09 19:31** e a destruicao. O CT rodou 28
minutos em 19/09 (19:50 -> 20:18); o que tiver acontecido nessa janela some.

Mas o buraco maior e anterior e nao tem nada a ver com o clique: **o backup de
aplicacao do starloco estava quebrado desde 04/09**, e o ultimo bom e de
**29/08**. Ver `infra/backup/monitoramento.md` e a secao 4 de
`renumeracao-20260919.md`. Ou seja, no momento da destruicao o vzdump de 18/09
**ja era a copia mais recente que existia** — e quase foi a unica coisa entre o
starloco e o nada.

## O que evita a repeticao

O parque ja aprendeu, no CT 201, que **nome parecido mata**. Aqui o problema foi
outro: nao ha nenhum atrito entre "selecionar na arvore" e "destruir".

- **Ligue o `protection` nos containers que importam.** `pct set 104
  --protection 1` faz o Proxmox recusar remocao ate alguem desligar a trava de
  proposito. Custa um comando e teria impedido este incidente inteiro.
- **`purge=0` foi sorte, nao politica.** Marcar purge num container com backup
  apagaria os backups junto.
- **Backup de aplicacao que falha calado nao e backup.** O cron mandava a saida
  para `/dev/null` por 15 dias.
