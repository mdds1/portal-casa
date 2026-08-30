# Backup da producao (VM 301)

Duas camadas, com propositos diferentes:

## 1. vzdump — a maquina inteira

A 301 foi acrescentada ao job `casa-diario`:

    vmid: 100,101,102,104,111,120,301   (diario as 03:00, storage drive)

Cobre disco de sistema inteiro. Fica no sdc, dentro de casa.

## 2. backup-floripaot.sh — banco e site, para fora de casa

MOVIDO da bancada para a 301 em 30/08/2026. Producao faz o proprio backup;
antes, se a bancada estivesse desligada, nao havia copia offsite nenhuma.

    /usr/local/bin/backup-floripaot.sh    no crontab do matheus na 301
    0  4 * * *   diario    banco + configs, ~90 KB, retencao 30 dias
    30 4 * * 0   semanal   site inteiro, ~260 MB, retencao 4 versoes

Envia para o Google Drive criptografado (rclone crypt, remote `floripa:`).
A configuracao do rclone foi copiada para ~/.config/rclone/rclone.conf na 301,
modo 600.

As duas linhas foram REMOVIDAS do crontab da bancada. La sobrou so o
backup-starloco.sh, que e de outro servidor.

## Duas armadilhas da imagem cloud minima

1. **Nao vem com `cron`.** `crontab` respondia "command not found" e o
   agendamento falhava em silencio. Instalado a parte.
2. **Vem em UTC.** Agendar 04:00 sem corrigir faria o backup rodar 01:00 no
   horario de Brasilia. Fuso ajustado para America/Sao_Paulo, e o servidor de
   jogo reiniciado depois — eventos diarios do mundo usam a hora do servidor.
