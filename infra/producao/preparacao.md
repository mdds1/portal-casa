# Preparacao da VM 301

Instalado com --no-install-recommends, e so isto:

    mariadb-server      11.8.6 — mesma versao da bancada
    qemu-guest-agent    para o Proxmox enxergar a VM por dentro
    tailscale           1.102.3 — como o mundo do jogo e alcancado hoje

NAO ha compilador, git, vcpkg nem editor remoto aqui, e nao deve haver. Se algum
trabalho futuro parecer exigir isso, o certo e compilar na bancada (VM 110) e
copiar o binario para ca.

## Banco

Banco `canary`, usuario `canary@127.0.0.1`, com a MESMA senha do config.lua da
bancada — assim o arquivo copia sem editar esse campo. O MariaDB do Debian 13 ja
vem amarrado a 127.0.0.1 por padrao; confirmado com `ss -tlnp`, escuta so no
loopback.

## Tailscale

O `tailscale up` exige abrir uma URL no navegador — passo manual, nao
automatizavel. Hostname registrado: `floripaot`.

## Armadilha encontrada na execucao

Copiar a unidade systemd com `sudo systemctl cat canary.service > arquivo`
produziu arquivo VAZIO (o sudo nao devolveu saida). O systemd trata unidade
vazia como **masked**, e `systemctl is-enabled` responde "masked" em vez de
"disabled" — sintoma confuso.

O certo e `systemctl cat canary.service` SEM sudo, e conferir o tamanho do
arquivo gerado antes de transferir.
