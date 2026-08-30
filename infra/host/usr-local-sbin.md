# /usr/local/sbin no host

Deve conter apenas:
- ha-pve-power    — wrapper de acoes com lista fechada, chamado pelo HA
- noip-update.sh  — atualizador de DNS dinamico (timer noip-ddns)

Cinco copias `.bak*` de ha-pve-power, tres delas executaveis, foram movidas
para /root/arquivo/ha-pve-power/. Variante executavel no PATH de root e
convite a rodar a errada.

Copia nova daqui em diante vai para /root/arquivo/, nunca para o PATH.

## Lista fechada do ha-pve-power

Levantada lendo o script em 30/08/2026. O portal vai depender dela.

**Sintaxe de invocacao: `TIPO ACAO ID`, separado por espaco.**

    SSH_ORIGINAL_COMMAND="ct status 100"  /usr/local/sbin/ha-pve-power
    SSH_ORIGINAL_COMMAND="vm status 110"  /usr/local/sbin/ha-pve-power

CUIDADO com uma leitura errada facil de fazer: dentro do script a validacao
compara `"$TYPE:$ID"`, entao o codigo mostra `vm:110`, `ct:100` etc. Isso e o
formato INTERNO da checagem, **nao** o que se digita. Passar `status ct:100`
e recusado.

Alvos aceitos (na forma interna `TIPO:ID`):
  vm:110 | vm:120 | ct:100 | ct:101 | ct:102 | gamebox: | host:

Acoes aceitas:
  status | start | shutdown | reboot | backup_age

Restricoes por alvo:
  - `reboot` so vale para vm:120
  - `shutdown` de `host:` desliga o proprio Proxmox
  - `exit_console` e exclusivo de `gamebox:`

O comando chega por `SSH_ORIGINAL_COMMAND` (forced command na chave SSH),
nao por argv — testar o wrapper exige simular isso.

**ct:104 (starloco) NAO esta na lista.** Acrescenta-lo e pendencia ja
registrada no spec do portal.
