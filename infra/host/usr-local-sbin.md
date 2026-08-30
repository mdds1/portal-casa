# /usr/local/sbin no host

Deve conter apenas:
- ha-pve-power    — wrapper de acoes com lista fechada, chamado pelo HA
- noip-update.sh  — atualizador de DNS dinamico (timer noip-ddns)

Cinco copias `.bak*` de ha-pve-power, tres delas executaveis, foram movidas
para /root/arquivo/ha-pve-power/. Variante executavel no PATH de root e
convite a rodar a errada.

Copia nova daqui em diante vai para /root/arquivo/, nunca para o PATH.
