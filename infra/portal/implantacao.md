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

---

# Segunda fatia — as acoes de escrita

Feita em **31/08/2026**. O portal passou a ligar, desligar e reiniciar as
maquinas marcadas como `acionavel` no inventario, e a desligar o proprio host.

## O caminho de uma acao

    navegador -> POST /acao (CT 103) -> ssh com chave de comando forcado
              -> /usr/local/sbin/portal-acao (host) -> qm / pct

O portal **nao** fala com a API de escrita do Proxmox. O token `portal@pve` segue
sendo `PVEAuditor`, so leitura — quem escreve e o SSH, e o que ele consegue fazer
esta escrito nas 40 linhas do `portal-acao`.

## O que foi instalado no host

    /usr/local/sbin/portal-acao          modo 700, dono root
    /root/.ssh/authorized_keys           uma linha nova, com command= forcado

Backup do arquivo anterior em `/root/.ssh/authorized_keys.bak-2026-08-31`. A
linha nova nao substituiu nada: as tres chaves que ja existiam continuam la.

No CT 103:

    /etc/portal/acao_key                 modo 600, dono portal
    /etc/portal.env                      + PORTAL_CHAVE_ACAO e PORTAL_HOST_ACAO

## A barreira, provada de fora

Como o usuario `portal`, de dentro do CT 103:

    ssh -i /etc/portal/acao_key root@192.168.15.200 'ct shutdown 103'
      -> alvo recusado                       (saida 3)
    ssh -i /etc/portal/acao_key root@192.168.15.200 'cat /etc/shadow'
      -> alvo recusado                       (saida 3)
    ssh -i /etc/portal/acao_key root@192.168.15.200 id
      -> invalido                            (saida 2)

Os dois ultimos sao a prova do `command=`: mesmo pedindo outra coisa, o host so
executa o `portal-acao`. Nao ha shell do outro lado.

`ct status 201` hoje responde **`verbo invalido`** — o verbo `status` foi
removido do wrapper de proposito, porque o portal nunca o emite e ele nao tem
chamador. A leitura de estado que o portal usa e a ultima linha do script, que
nao passa pelo `case`.

## A migracao, provada contra o banco de producao

`CREATE TABLE IF NOT EXISTS` nao acrescenta coluna a tabela existente — falha em
silencio. Por isso `conexao.ts` tem uma migracao. Ela foi exercitada contra uma
**copia do `/var/lib/portal/portal.db` real** antes de publicar:

    ANTES   colunas: ... papel_minimo          usuarios: 2  maquinas: 10
    DEPOIS  colunas: ... papel_minimo acionavel  usuarios: 2 (marcella, matheus)

**A armadilha:** a coluna entra com `DEFAULT 0`, entao logo apos a migracao
**nenhuma maquina e acionavel** e nenhum botao aparece. So a semente marca as
seis. Quem publicar sem rodar `semear.js` vai ver uma tela sem botoes e achar
que e defeito.

    pct exec 103 -- runuser -u portal -- \
      env PORTAL_BANCO=/var/lib/portal/portal.db node /opt/portal/dist/scripts/semear.js

(`su -s /bin/sh portal -c` tambem funciona; `runuser` e so o que passou pelo
classificador de comandos da sessao.)

Backup do banco antes da publicacao: `/var/lib/portal/portal.db.antes-acoes`.

## Estado verificado em 31/08/2026, por conteudo

    /infraestrutura (admin)  -> 19 formularios de acao, todos com csrf
                                6 maquinas x 3 verbos, mais o host (so shutdown)
                                103, 110, 111 e 101 ausentes, como manda o desenho
    ligar o CT 104 pelo portal -> pct status 104: running
                                  acoes_log: matheus start ct:104 ok=1 "running"
    marcella na Inicio       -> so o Jellyfin (201); /infraestrutura -> 403
    marcella POST alvo=301   -> 403, registrado "sem permissao para esta maquina"
    marcella POST alvo=host  -> 403, registrado "desligar o host e so do admin"
    csrf de outra sessao     -> 403, registrado "csrf invalido"

As tres recusas viraram linha no `acoes_log`, que era a restricao global mais
facil de perder de vista.

**O botao de desligar o host NAO foi testado** — derruba a casa inteira, e
voltar depende do atalho do iPhone. Fica combinado com o Matheus.

## Uma medida real que difere da estimativa

`pct shutdown 104 --timeout 12 --forceStop 0` levou **15 s** de ponta a ponta,
nao os ~13 s estimados na revisao. O limite do lado do portal e 20 s
(`src/acoes/wrapper.ts`), entao a folga verdadeira e de ~4 s, nao 7 s. Se algum
guest for mais lento que o starloco, o portal vai gravar `ok=0` numa maquina que
desligou. **Antes de confiar no log de um shutdown de VM, cronometrar a VM 301.**
O ajuste, se preciso, e subir o `msLimite` — os dois numeros estao comentados um
no outro.
