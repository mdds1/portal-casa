# Firewall do Proxmox

Antes deste trabalho nao havia NENHUMA regra: os servicos `pve-firewall` e
`proxmox-firewall` rodavam, mas `/etc/pve/firewall/` estava vazio e nao existia
`cluster.fw`. As flags `firewall=1` nas interfaces dos CTs 101 e 102 nao tinham
efeito nenhum.

## O desenho

Politica de entrada padrao **DROP** no datacenter. Sobre ela, quatro permissoes:

| Regra | Origem | Porta | Por que |
|-------|--------|-------|---------|
| SSH | 100.64.0.0/10 (Tailscale) | tcp 22 | administracao nunca pela internet |
| Interface PVE | 100.64.0.0/10 (Tailscale) | tcp 8006 | idem |
| LAN da casa | 192.168.15.0/24 | todas | as maquinas da casa falam com o host |
| Tailscale | qualquer | udp 41641 | a propria Tailscale precisa entrar |

A regra da LAN e ampla de proposito nesta primeira versao: a casa inteira
continua falando com o host como antes. Estreita-la e trabalho de outro plano —
e e justamente o que trancaria o Home Assistant para fora se feito sem cuidado.

O trafego de jogo (7171/7172 do FloripaOT, 450/5555 do Dofus) chega **nas VMs e
containers**, nao no host, e o firewall por maquina continua desligado. Logo esse
trafego nao passa por regra nenhuma daqui.

## A armadilha que quase trancou tudo

**`pvesh create /cluster/firewall/rules` cria a regra DESATIVADA por padrao.**
Sem `--enable 1` ela nasce com `enable: 0` e aparece no `cluster.fw` com uma
**barra vertical no comeco da linha**:

    |IN ACCEPT -source 100.64.0.0/10 -p tcp -dport 22 # SSH pela Tailscale
    ^ esta barra significa "desativada"

Isso aconteceu de verdade em 30/08/2026. O firewall ficou ligado com quatro
permissoes que nao valiam nada. Se a politica tivesse virado DROP naquele
momento, SSH, interface do Proxmox e Tailscale seriam bloqueados de uma vez.

**Verificacao obrigatoria antes de fechar a politica:**

    cat /etc/pve/firewall/cluster.fw

Nenhuma linha de regra pode comecar com `|`.

## A ordem importa

Aplicado nesta ordem, e repetir exige a mesma:

1. criar as regras de ACCEPT **com `--enable 1`**
2. conferir que nenhuma esta com `|` no `cluster.fw`
3. habilitar com `policy_in ACCEPT` — ensaio, nada bloqueia ainda
4. verificar que tudo responde
5. so entao `policy_in DROP`
6. verificar de novo

Inverter isso tranca o administrador para fora.

## Rede de seguranca

Durante a aplicacao foi armado um interruptor de homem morto — um
`systemd-run --on-active=10min` que desligaria o firewall sozinho se a
verificacao nao o cancelasse a tempo:

    cat > /root/resgate-firewall.sh <<'X'
    #!/bin/sh
    pvesh set /cluster/firewall/options --enable 0
    X
    chmod 700 /root/resgate-firewall.sh
    systemctl stop resgate-firewall.timer 2>/dev/null
    systemctl reset-failed resgate-firewall 2>/dev/null
    systemd-run --on-active=10min --unit=resgate-firewall /root/resgate-firewall.sh

Rearmar exige limpar a unidade antiga antes: o systemd recusa recriar uma
unidade que ainda esteja carregada.

Ultimo recurso, pelo console fisico da maquina:

    pvesh set /cluster/firewall/options --enable 0

## Verificacao aprovada em 30/08/2026

Com `policy_in: DROP` ativo, todos responderam:

- SSH pela Tailscale
- https://100.71.204.68:8006 (Tailscale) -> 200
- https://192.168.15.200:8006 (LAN) -> 200
- FloripaOT 7171 e 7172
- Home Assistant http://192.168.15.8/ -> 200
  (endereco de 30/08; o HA passou a 192.168.15.10 em 19/09/2026 --
  ver infra/host/renumeracao-20260919.md. A regra da LAN e por faixa
  /24, entao a renumeracao nao mexeu no firewall.)

## O que NAO foi feito

O firewall por VM/container continua desligado. Liga-lo e outro trabalho: cada
maquina precisa das proprias regras antes, ou fica sem rede.
