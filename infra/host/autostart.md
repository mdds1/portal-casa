# Autostart do parque

| ID  | Maquina          | onboot | Por que                                   |
|-----|------------------|--------|-------------------------------------------|
| 100 | drive            | 0      | sob demanda                               |
| 101 | Jellyfin         | 0      | sob demanda; nao gastar RAM sem uso       |
| 102 | Docker           | 0      | sob demanda; nao gastar RAM sem uso       |
| 104 | starloco         | 0      | sob demanda                               |
| 110 | bancada (tfs)    | 0      | POR OPCAO do Matheus, nao por esquecimento|
| 111 | home-assistant   | 1      | sustenta a rotina da casa                 |
| 120 | gamebox-batocera | 0      | sob demanda                               |

Explicito em todas: ausencia da linha e esquecimento, nao decisao.

Quando o FloripaOT virar producao para jogadores, ele passa a onboot 1 —
mas na VM nova de producao, nao na 110, que fica sendo a bancada.
