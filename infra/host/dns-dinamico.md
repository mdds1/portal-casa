# DNS dinamico (No-IP)

Como funciona de verdade: o No-IP aponta nome para o IP PUBLICO da casa,
que e um so. Nao existe "o IP de cada maquina" no No-IP.

Varios nomes apontam para o mesmo IP publico; quem separa qual maquina
responde e o redirecionamento de porta na Vivo Box.

Para acrescentar um nome:
1. criar o nome no site do No-IP
2. acrescentar em NOIP_HOSTS (separados por espaco) em /etc/noip-ddns/noip.env
3. redirecionar a porta da maquina na Vivo Box

Atualizador: /usr/local/sbin/noip-update.sh, disparado por noip-ddns.timer
a cada 30 minutos. Um nome falhando nao impede os outros; a saida diz qual.

Credenciais em /etc/noip-ddns/noip.env, modo 600, fora do git.

ddclient foi removido: estava configurado pela metade e era redundante.
Copia da config em /root/arquivo/ddclient.conf.removido.
