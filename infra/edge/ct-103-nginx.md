# CT 103 como porteiro: nginx + Tailscale

Feito em 30/08/2026, substituindo o tunel Cloudflare no mesmo dia em que ele
subiu. Ver `infra/tunel/cloudflare.md` para o que ficou para tras e como voltar.

## Por que trocou

O tunel funcionava, mas publicava a tela de login do Home Assistant para a
internet inteira. O pedido foi: manter o endereco bonito
`https://ha.dinizismo.com.br` e ao mesmo tempo so quem esta na Tailscale
alcancar.

Isso e possivel porque **DNS publico e alcance sao coisas separadas**. O
registro `ha` aponta, em DNS aberto, para `100.67.193.85` — um endereco da
Tailscale, dentro da faixa CGNAT 100.64.0.0/10. Qualquer resolver do mundo
responde esse valor; nenhuma operadora roteia ate ele. Quem nao esta no tailnet
resolve o nome e a conexao morre no caminho.

Nao e seguranca por obscuridade: o endereco esta publico de proposito. O que
protege e a ausencia de rota.

## O preco

Fora de casa, o app do Home Assistant so funciona com a **Tailscale ligada no
celular**. Se ela cair ou for desativada, o painel some — e o sintoma que chega
e "o Home Assistant parou", nao "faltou VPN". Vale conferir o modo always-on nos
aparelhos da casa.

## Peças

    CT 103 `portal`   192.168.15.14 (LAN)   100.67.193.85 (tailnet)

    /etc/nginx/sites-available/ha.dinizismo.com.br   proxy reverso
    /etc/nginx/conf.d/upgrade-map.conf               map do WebSocket
    /etc/letsencrypt/live/ha.dinizismo.com.br/       certificado
    /etc/letsencrypt/cloudflare.ini                  token da API, modo 600

O nginx repassa para `192.168.15.8:80`, o Home Assistant.

## Armadilhas que custaram tempo

**O container e nao-privilegiado e nao cria device node.** Sem `/dev/net/tun` o
tailscaled sobe em userspace networking, e ai o nginx nao recebe conexao nenhuma
vinda do tailnet — parece que a Tailscale funcionou, e nao funcionou. A correcao
esta em `/etc/pve/lxc/103.conf`:

    lxc.cgroup2.devices.allow: c 10:200 rwm
    lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file

**O certificado sai por DNS-01, nunca por HTTP-01.** A Vivo bloqueia a porta 80
de entrada, entao o desafio HTTP jamais completa. O DNS-01 cria um TXT via API e
nao depende de porta aberta:

    certbot certonly --dns-cloudflare \
      --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
      --dns-cloudflare-propagation-seconds 30 -d ha.dinizismo.com.br

O `cert.pem` que o `cloudflared login` deixou NAO serve aqui — e credencial de
tunel, nao token de API. Foi preciso criar um token `Edit zone DNS` no painel.

**O registro tem que ficar cinza (DNS only).** Proxied nao funciona: a Cloudflare
nao consegue alcancar um 100.x, e mesmo que conseguisse o trafego voltaria a
passar pela internet, que e justamente o que se quis evitar.

**Os resolvers publicos guardam o valor antigo.** Depois da troca, o autoritativo
(`dig @damiete.ns.cloudflare.com`) ja respondia o IP novo enquanto o 1.1.1.1
ainda devolvia os IPs da Cloudflare. Conferir sempre no autoritativo antes de
concluir que algo quebrou.

**O painel do HA e quase todo WebSocket.** Sem `Upgrade`/`Connection` no proxy a
pagina carrega e fica eternamente em "Conectando".

**`trusted_proxies` mora em `.storage/http`.** Desde a migracao do YAML
(`yaml_migration_done: true`), o bloco `http:` do configuration.yaml e ignorado.
O HA confia em `192.168.15.14/32`, o IP de LAN do CT 103. Se ele mudar, o HA
responde 400 em tudo.

## Renovacao

O certbot instalou o timer proprio. Renova sozinho, por DNS-01, sem intervencao.
Conferir com `systemctl list-timers certbot` e `certbot renew --dry-run`.

## Estado verificado em 30/08/2026

    dig +short ha.dinizismo.com.br @damiete.ns.cloudflare.com  -> 100.67.193.85
    https://ha.dinizismo.com.br/  -> 200, <title>Home Assistant</title>
    TLS valido ate 28/11/2026, ssl_verify_result=0
    tempo total 0,06 s (pelo tunel eram 0,18 s)
    cloudflared: inactive, disabled — mantido instalado para rollback
