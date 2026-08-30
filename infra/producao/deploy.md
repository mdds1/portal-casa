# O que vive na VM 301

Copiado da bancada por rsync, e so isto (588 MB no total):

    canary                  binario, 153 MB — md5 conferido dos dois lados
    config.lua              configuracao
    schema.sql              esquema do banco
    key.pem                 chave do protocolo
    data-otservbr-global    datapack ativo, 391 MB
    data                    13 MB
    data-canary             20 MB

## O que NAO vem, e por que

build/, .git, vcpkg_installed, src, nexus-sprites, os .zip de cliente e os
config.lua.bak*. Nada disso e lido em execucao — e e exatamente o entulho que
levou o disco da VM 110 a 97%.

## Como atualizar o servidor daqui em diante

Compila na bancada (VM 110), copia o binario para ca. **A producao nunca
compila.** Conferir o md5 dos dois lados depois de copiar: binario truncado nao
da erro claro, so nao sobe.

## A unica edicao no config.lua

O campo `ip`. Ele e o endereco que o servidor ANUNCIA ao cliente depois do
login, e precisa ser o Tailscale DESTA VM. Na bancada era 100.91.91.40.

Errar isso faz o jogador logar e travar na entrada do mundo, sem mensagem de
erro util. E o modo de falha classico de migracao de servidor de Tibia.
