# Portal da Casa — implantacao

Feito em 30/08/2026. Primeira fatia, somente leitura.

    https://portal.dinizismo.com.br  ->  nginx no CT 103  ->  127.0.0.1:3000

Mesmo desenho de `infra/edge/ct-103-nginx.md`: registro **cinza** apontando para
o IP de Tailscale do CT 103. O portal mostra o mapa da casa inteira; nao vai para
a internet.

## Onde as coisas moram

    /opt/portal                     codigo compilado + node_modules de producao
    /var/lib/portal/portal.db       banco, dono `portal`
    /etc/portal.env                 credenciais, modo 600
    /etc/portal/pve-root-ca.pem     CA do Proxmox
    /etc/systemd/system/portal.service

O servico roda como o usuario de sistema `portal`, com `ProtectSystem=strict` e
`ReadWritePaths=/var/lib/portal` — ele nao consegue escrever em mais nada.

## O token do Proxmox

    pveum user add portal@pve --comment "Portal da Casa, somente leitura"
    pveum acl modify / --users portal@pve --roles PVEAuditor
    pveum user token add portal@pve leitura --privsep 0

`PVEAuditor` da so permissoes `*.Audit`. Mesmo vazado, o dano possivel e ver o
estado do cluster. O valor aparece **uma vez**; esta em `/etc/portal.env`.

## TLS com o Proxmox: nao desligue a verificacao

O Proxmox usa certificado proprio, entao a primeira tentativa falha com
`fetch failed`. A saida obvia — `NODE_TLS_REJECT_UNAUTHORIZED=0` — exporia o
token a um intermediario na rede.

O certificado do PVE **ja tem `IP Address:192.168.15.200` como SAN**, entao basta
confiar na CA:

    cp /etc/pve/pve-root-ca.pem  ->  /etc/portal/pve-root-ca.pem   (no CT 103)
    NODE_EXTRA_CA_CERTS=/etc/portal/pve-root-ca.pem                (em portal.env)

Verificado nos dois sentidos: com a CA, le as 10 maquinas com verificacao ligada;
sem ela, falha. Se um dia o `pvecm updatecerts` regenerar a CA, este arquivo
precisa ser recopiado.

## Publicar uma versao nova

O `tsc` **so move `.ts`**. O `esquema.sql` precisa ser copiado a mao para junto do
JavaScript compilado — sem isso o portal sobe e morre ao abrir o banco, e os
testes passam do mesmo jeito porque na bancada o `tsx` roda a partir de `src/`.

    cd ~/projetos/portal-casa
    npx tsc
    cp src/db/esquema.sql dist/src/db/
    tar czf /tmp/portal.tar.gz dist package.json package-lock.json
    # enviar para o host, depois:
    #   pct push 103 /tmp/portal.tar.gz /tmp/portal.tar.gz
    #   pct exec 103 -- sh -c 'cd /opt/portal && tar xzf /tmp/portal.tar.gz &&
    #     npm ci --omit=dev && chown -R portal:portal /opt/portal &&
    #     systemctl restart portal'

## Banco novo sobe vazio

`src/index.ts` nao semeia nem cria usuario — isso e dos scripts. Um banco novo
sobe com zero usuarios e zero inventario, e o unico sintoma e o redirect eterno
para `/entrar`. Rode como o usuario `portal`, senao o arquivo do banco nasce de
root e o servico nao consegue escrever:

    su -s /bin/sh portal -c "PORTAL_BANCO=/var/lib/portal/portal.db node dist/scripts/semear.js"
    echo "<senha>" | su -s /bin/sh portal -c "PORTAL_BANCO=... node dist/scripts/criar-usuario.js <login> <Nome> <admin|casa>"

## O acesso e SEMPRE pelo nginx

O cookie de sessao e `Secure`. Quem alcancar o container direto em
`http://192.168.15.14:3000` cai num **laco silencioso de login**: o navegador
descarta o cookie, o portal devolve para `/entrar`, e nada na tela explica.
Se alguem relatar "o login nao funciona", conferir isto primeiro.

## Estado verificado em 30/08/2026

    GET /                     -> 302 para /entrar          (sem cookie)
    GET /entrar               -> <title>Entrar — Portal da Casa</title>
    login matheus (admin)     -> 8 cartoes
    login marcella (casa)     -> 2 cartoes (Home Assistant, Jellyfin)
    marcella GET /infraestrutura -> 403
    admin GET /infraestrutura -> as 10 maquinas com estado ao vivo do Proxmox
    certificado valido ate 29/11/2026, renovacao pelo timer do certbot

## O que NAO existe nesta fatia

Nenhuma acao de escrita: nada liga, desliga ou altera maquina. O
`/usr/local/sbin/portal-acao` foi desenhado no spec e fica para a fatia seguinte,
junto com as telas Games, Midia, Casa e Administracao, e com a leitura do Home
Assistant — cuja fonte ja existe em `src/fontes/homeassistant.ts`, testada, mas
deliberadamente nao montada por nao ter consumidor ainda.
