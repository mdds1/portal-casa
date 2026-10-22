# O jogo aberto para a internet

Feito em 30/08/2026, logo depois de o site ganhar dominio.

## O que mudou

Ate aqui o site era publico e o **jogo nao**: o `config.lua` anunciava um IP de
Tailscale, entao quem nao estava na VPN criava conta e nao conectava.

    play.dinizismo.com.br   A, cinza, -> IP publico da casa
    Vivo Box                7171 e 7172 TCP -> 192.168.15.11 (VM 301)
    config.lua              ip = "play.dinizismo.com.br"

**O registro tem que ser cinza.** O proxy da Cloudflare so entende HTTP; o
protocolo do Tibia nao e HTTP. Laranja aqui nao "fica mais seguro", fica quebrado.

## Por que um NOME no config.lua, e nao um IP

O campo `ip` do `config.lua` parece endereco de bind, e nao e — nao neste caso.
Em `src/server/server.cpp:156` ele so seria usado para bind se
`bindOnlyGlobalAddress` fosse true. Como e **false**, o Canary escuta em
`0.0.0.0` e o campo serve unicamente para **anunciar** o endereco ao cliente,
via `addString` em `src/server/network/protocol/protocollogin.cpp:79`.

`addString` e texto puro. Logo cabe um hostname — e e isso que torna o IP
dinamico da Vivo irrelevante: o cliente resolve o nome a cada login.

Se algum dia `bindOnlyGlobalAddress` virar true, isto quebra na hora, porque o
bind exige `address_v4::from_string` e um nome nao passa.

Conferir o que o servidor realmente anuncia (nao basta ler o arquivo):

    printf '\x06\x00\xff\xff\x69\x6e\x66\x6f' | nc <host> 7171 | tr -d '\0' | grep -o 'ip="[^"]*"'

## DNS dinamico

`/usr/local/sbin/cf-ddns.sh` no host PVE, no cron a cada 5 minutos, log em
`/var/log/cf-ddns.log`. Token da API em `/etc/cf-ddns.token`, modo 600.

So escreve quando o valor muda. Usa duas fontes para descobrir o IP publico e
valida o formato antes de gravar — se a consulta falhar, ele registra erro e sai,
em vez de escrever lixo no DNS e derrubar o servidor para todo mundo.

Testado sabotando o registro para 203.0.113.9: a execucao seguinte corrigiu e
registrou `play.dinizismo.com.br: 203.0.113.9 -> 191.35.241.115`.

## A tabela do roteador apodrece sozinha

Todas as VMs e containers pegam IP por DHCP. Depois das mudancas de 30/08 a
tabela de redirecionamento apontava para as maquinas erradas:

- `8096` (Jellyfin) ia para `.11`, que virou o **servidor de jogo**
- as 3 regras do Dofus iam para `.14`, que virou o **CT 103 / nginx**
- `80` e `443` eram regras inertes desde sempre — a Vivo bloqueia as duas

Nenhuma era buraco naquele momento, mas o Dofus teria falhado sem explicacao ao
ser religado. **Enquanto houver redirecionamento para IP de DHCP, isto se repete.**

Reservas por MAC feitas na Vivo Box:

    VM 301  floripaot       BC:24:11:F4:DA:C3   192.168.15.11
    VM 111  home-assistant  BC:24:11:83:51:A4   192.168.15.8
    CT 103  portal          BC:24:11:64:A3:BD   192.168.15.14
    CT 201  jellyfin        BC:24:11:C0:32:06   192.168.15.15
    CT 104  starloco        BC:24:11:41:06:83   192.168.15.16
    VM 110  bancada         BC:24:11:48:E7:59   192.168.15.10

O starloco mudou de `.14` para `.16` porque perdeu o endereco para o portal
enquanto estava desligado. **Ao religar o CT 104, conferir se a configuracao do
StarLoco tem o IP antigo gravado.**

> **DESATUALIZADO desde 19/09/2026.** A casa mudou de endereco fisico e a tabela
> acima e do roteador antigo — vale como historico, nao como referencia. Os MACs
> continuam valendo; os IPs, nao. O retrato conferido esta em
> `infra/host/renumeracao-20260919.md`.
>
> A advertencia em negrito acima, escrita em 30/08, descreveu por antecipacao o
> que de fato aconteceu — so que com o roteador inteiro, nao com uma maquina:
> "**enquanto houver redirecionamento para IP de DHCP, isto se repete**".
> Repetiu.

O Jellyfin saiu do redirecionamento de proposito: a 8096 e HTTP puro, com senha
em texto claro. Pela Tailscale ele funciona sem isso. Se o acesso externo virar
necessario, poe atras do nginx do CT 103 com TLS, como o Home Assistant.

## Estado verificado em 30/08/2026

Portas testadas de fora por 6 nos do check-host.net:

    7171  Ira x2, EUA          0,28 a 0,41 s   conectou
    7172  Canada, Alemanha, India  0,25 a 0,67 s   conectou

Servidor anunciando `ip="play.dinizismo.com.br"`, `port="7171"`.

## Pendencia que ficou

~~**A VM 301 esta com `onboot: 0`.**~~ **Corrigido.** Conferido em 01/09/2026:
`onboot: 1`. Ela volta sozinha depois de queda de luz.
