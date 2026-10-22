# A renumeracao da LAN — 19/09/2026

A casa mudou de endereco fisico. Roteador novo, LAN nova: **quase todo IP de
maquina mudou de dono**, e varias coisas quebraram caladas, porque IP de LAN
nao avisa quando passa a apontar para outra maquina.

Este documento e o retrato conferido da rede depois da mudanca, e a lista do que
quebrou por causa dela.

## O retrato de hoje

Conferido em 19/09/2026 **maquina por maquina**, por MAC na tabela ARP e por
chave SSH — nao deduzido do documento anterior, que estava errado em quase toda
linha. A faixa `.2-.199` e DHCP; `.200-.202` sao fixos de infraestrutura.

| Maquina | MAC | Antes | **Agora** | Tailnet |
|---|---|---|---|---|
| pve (host) | `10:FF:E0:F0:75:D2` | .200 | **.200** | `pve` |
| VM 110 tfs-server (bancada) | `BC:24:11:48:E7:59` | .10 | **.7** | `floripaot-server` |
| VM 111 home-assistant | `BC:24:11:83:51:A4` | .8 | **.10** | `homeassistant` |
| VM 301 floripaot (producao) | `BC:24:11:F4:DA:C3` | .11 | **.11** | `floripaot` |
| CT 102 Docker (midia) | `BC:24:11:26:C0:F0` | .102 | **.201** | `docker-media-pve` |
| CT 103 portal | `BC:24:11:64:A3:BD` | .14 | **.14** | `portal` |
| CT 104 starloco | `BC:24:11:41:06:83` | .16 | **.13** | *nao esta na tailnet* |
| CT 201 jellyfin | `BC:24:11:C0:32:06` | .15 | **.202** | `jellyfin-pve` |
| VM 120 gamebox-batocera | `BC:24:11:C1:8E:BC` | .13 | *DHCP, desconhecido* | *nao esta na tailnet* |

Tres trocas sao especialmente traicoeiras, porque o IP nao ficou vago — **mudou
de dono**:

- **`.10`** era a bancada, hoje e o **Home Assistant**.
- **`.13`** era o Batocera, hoje e o **starloco**.
- **`.15`** nao e mais o Jellyfin: hoje responde um aparelho qualquer da casa,
  com MAC `bc:35:1e:b6:e4:4a` — fora do prefixo `bc:24:11:*` do Proxmox. Um
  script que ainda aponte para `.15` **acerta uma maquina viva e errada**, que e
  o pior caso possivel.

## A regra que sai disto

**Nao fixe IP de LAN em coisa nova.** Use o nome de MagicDNS da Tailscale: ele
acompanha a maquina, o IP de LAN pertence ao roteador, e o roteador muda.

As excecoes existem e sao poucas — registre a razao junto quando usar uma:

- **starloco (CT 104) e Batocera (VM 120)** nao estao na tailnet. Nao ha nome.
- **Proxmox** por `192.168.15.200`: o certificado tem `IP Address:192.168.15.200`
  como unico SAN, e abrir por nome daria aviso de certificado.
- **Ingress publico do cloudflared** para a VM 301 por `.11`: e o caminho da
  internet para o site, e nao deve depender do tailscaled do CT 103.

Para maquina sem tailnet, prefira **resolver pelo MAC** a cravar o IP — foi a
saida adotada no `ha-pve-power` (abaixo). O MAC nao muda; a reserva de DHCP, sim.

## O que quebrou, e o conserto

### 1. Portal: a integracao com o Home Assistant, fora do ar

`/etc/portal.env` no CT 103 tinha `PORTAL_HA_URL=http://192.168.15.8` — o IP
velho. O `.8` nao responde mais nada, entao a tela de Midia e os estados do HA
vinham vazios.

    PORTAL_HA_URL=http://homeassistant

Conferido pelos dois caminhos antes de trocar: `.10` e `homeassistant` devolvem
as mesmas 170 entidades em `/api/states`. Copia em
`/etc/portal.env.bak-renumeracao-20260919`.

### 2. Portal: a semente apontava 15 dos 18 servicos para IP morto

`src/db/semente.ts` checava servico por IP de LAN. Com a renumeracao, a checagem
de porta falhou em bloco: **o painel ficou todo vermelho sem nada estar fora do
ar** — que e exatamente o tipo de alarme que ensina a ignorar alarme.

Os `host_checagem` passaram a usar nome de MagicDNS. Isso nao acrescenta
dependencia: o `/etc/resolv.conf` do CT 103 ja aponta so para `100.100.100.100`
(Tailscale), e o portal so e alcancavel pela tailnet — se o tailscaled cair,
ninguem chega ao portal de qualquer jeito.

Os 15 alvos foram testados um a um **de dentro do CT 103** antes da troca.

Guarda nova em `test/consistencia.test.ts`: IP de LAN na semente reprova, a nao
ser que esteja na lista de excecoes justificadas. Verificada por mutacao.

### 3. Host: o botao "sair do console" apontava para a maquina errada

`/usr/local/sbin/ha-pve-power` tinha `root@192.168.15.13` cravado para o
Batocera. Com o `.13` sendo hoje o starloco, o botao do Home Assistant abriria
SSH **no servidor de Dofus** e rodaria comandos de emulador nele.

O que salvou foi acidente: o `known_hosts` do root tem a chave do Batocera
fixada para o `.13`, entao o SSH falharia por chave divergente em vez de
executar. Rede de protecao que ninguem planejou — nao conte com ela de novo.

O bloco passou a resolver o Batocera **pelo MAC** na hora da chamada, e a falhar
com mensagem se nao achar, em vez de abrir SSH para quem estiver no IP de
ontem. Copia em `/root/arquivo/ha-pve-power.antes-da-renumeracao-20260919`.

Conferido depois da troca: alvo fora da lista continua `denied`, `backup_age`
continua respondendo, e `gamebox exit_console` com a VM desligada devolve
`gamebox nao encontrado na rede (MAC bc:24:11:c1:8e:bc); esta ligada?`.

### 4. Backup do starloco: quebrado havia semanas, em silencio

`~/bin/backup-starloco.sh` na bancada apontava para `192.168.15.14`, que hoje e
o **portal**. O script passou dias tentando dumpar o banco do container errado:

    29/08 16:53   ultimo backup bem-sucedido
    04-07/09      4 execucoes, todas com "root@192.168.15.14: Permission denied"
    08-19/09      nao rodou — a bancada estava desligada

O cron mandava a saida para `/dev/null`, entao **nada avisou**. Ver
`infra/backup/monitoramento.md`.

### 5. Tunel Cloudflare: so a linha comentada

O ingress vivo aponta para a VM 301 em `.11`, que nao mudou — o site publico
nunca caiu. Mas a entrada aposentada do Home Assistant guardava o `.8` morto e
enganaria quem fosse reverter; passou a `http://homeassistant:80`. Copia em
`/etc/cloudflared/config.yml.bak-renumeracao-20260919`.

### 6. Nao quebrou (conferido, nao suposto)

- **nginx do CT 103** — ja corrigido para `.10` antes desta sessao;
  `https://ha.dinizismo.com.br` devolve 200.
- **`trusted_proxies` do HA** confia em `192.168.15.14/32`, o IP de LAN do
  CT 103, que **nao mudou**.
- **`PORTAL_PVE_URL`** e **`PORTAL_HOST_ACAO`** usam `.200`, que nao mudou.
- **Site publico** `https://floripaot.dinizismo.com.br` -> 200.

## O que continua pendente

- **VM 120 (Batocera) nao tem IP conhecido.** Esta desligada e pega DHCP. Vale
  fazer reserva por MAC (`BC:24:11:C1:8E:BC`) na Vivo Box, como as outras.
- **starloco fora da tailnet.** Enquanto estiver, depende de reserva de DHCP e
  volta a quebrar na proxima mudanca de roteador. Instalar o Tailscale nele
  resolve a classe inteira do problema.
- **A porta 7171 da VM 301 nao esta escutando** — ver
  `infra/producao/vm-301.md`. Isto nao e efeito da renumeracao, mas foi
  encontrado na varredura.
