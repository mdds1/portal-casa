# CT 201 — jellyfin nao-privilegiado

Feito em 30/08/2026.

O CT 101 era o **unico container privilegiado do parque**, e justamente o que
processa arquivo de midia vindo de fora. Root nele era, na pratica, root no host.

Container privilegiado nao se converte no lugar: o caminho e vzdump e restaurar
com `--unprivileged 1`. Por isso existe um ID novo.

    101 (privilegiado, PARADO, mantido)  ->  201 (nao-privilegiado)

ID 201 segue a faixa 2xx = midia (spec 4.2); nome minusculo segue 4.1.

## A conversao falhou na primeira tentativa

    tar: ./var/spool/postfix/dev/urandom: Cannot mknod: Operation not permitted

O container privilegiado tinha **nos de dispositivo** dentro dele — o chroot do
Postfix cria /var/spool/postfix/dev/{random,urandom}. Container nao-privilegiado
nao pode criar dispositivo, entao a restauracao aborta.

A saida foi remover o Postfix inteiro do container de midia. Ele estava ativo e
habilitado, instalado por reflexo do Debian; um servidor de midia nao precisa de
MTA, e so o `reportbug` o referenciava, como alternativa. Menos uma coisa
exposta.

Para converter outro container privilegiado, procure primeiro:

    find / -xdev \( -type c -o -type b \) -not -path "/dev/*"

## O mapeamento de UID nao deu problema

Era o risco principal — em container nao-privilegiado o root interno vira 100000
no host, e bind mount de root:root deixa de ser legivel. Nao aconteceu porque
`/mnt/media` esta `drwxrwxrwx`, e parte das pastas ja pertencia ao uid 165534
(marca do CT 102, que ja era nao-privilegiado).

Verificado no 201, nao suposto:

    ls /mnt/media          -> lista todas as pastas
    head -c 100 <video>    -> le conteudo
    touch /mnt/media/...   -> ESCREVE (o Jellyfin grava metadados)
    systemctl is-active jellyfin -> active
    http://192.168.15.15:8096/   -> 302

E o Matheus confirmou no navegador: biblioteca aparece e filme toca.

## O botao no Home Assistant

`configuration.yaml` linhas 107-110 apontavam para `ct 101`. Trocadas para
`ct 201`. O `unique_id` foi MANTIDO como `proxmox_ct_101_jellyfin_power` de
proposito: troca-lo criaria entidade nova e deixaria a atual orfa, quebrando o
cartao do painel. Copia em configuration.yaml.bak-ct201-20260830.

## A lista fechada do wrapper cresceu

`/usr/local/sbin/ha-pve-power` passou de

    vm:110|vm:120|ct:100|ct:101|ct:102

para

    vm:110|vm:120|vm:301|ct:100|ct:101|ct:102|ct:104|ct:201

Entraram a VM 301 (producao nova), o CT 201 (este) e o CT 104 (starloco), que
era pendencia conhecida desde o spec do portal. Verificado que os alvos novos
respondem e que comando fora da lista continua sendo recusado (`denied`).
Copia em /root/arquivo/ha-pve-power.antes-do-201-301-104.

## O 101 continua existindo

Parado, como rede de seguranca, junto com o vzdump de 544 MB tirado ANTES de
qualquer alteracao. Apagar so depois de o 201 rodar alguns dias, e so por
decisao do Matheus.

---

## 31/08/2026 — o 201 foi apagado por engano e restaurado

As 11:47 houve um desligamento geral da casa; as 11:58, no religamento, alguem
subiu o **CT 101** em vez do 201, pela interface do Proxmox. Nenhuma automacao
teve culpa: o Home Assistant aponta corretamente para `ct 201` (o `101` no
`unique_id` e so identificador interno), e nenhum dos dois tem `onboot`.

A armadilha era o **nome**: `101 Jellyfin` e `201 jellyfin` diferiam por uma
maiuscula, e o obsoleto aparecia primeiro na lista.

Com o 101 no ar e o 201 parado, o quadro ficou invertido, e a leitura obvia —
"o parado e nao-privilegiado, logo a migracao ficou pela metade" — e o oposto
da verdade. Foi a leitura que eu (Claude) fiz, e apaguei o 201.

Recuperado do `vzdump` tirado minutos antes de destruir. O 101 foi desligado, o
201 subiu, e foi verificado por conteudo: `/mnt/media` lista as 5 pastas,
escrita funciona (o Jellyfin grava metadados), `192.168.15.15:8096` devolve 302.

**O 101 foi renomeado para `jellyfin-antigo-nao-ligar`**, com descricao dizendo
que compartilha o MAC do 201. Se um dia ele for apagado, o backup de 30/08
continua sendo a rede de seguranca.

### O que evita a repeticao

Dois containers com o mesmo MAC nunca podem estar ligados juntos, e nada no
Proxmox impede isso — a unica protecao e o nome. Ao migrar container por
vzdump/restore, renomeie o antigo **no mesmo dia**, antes que a memoria de qual
e qual dependa de alguem lembrar.

E ao encontrar dois containers parecidos, um ligado e outro parado: leia o
`infra/host/` antes de concluir qual e o bom. O estado de hoje pode ser um
acidente de ontem.
