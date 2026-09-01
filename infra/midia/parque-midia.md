# Parque de midia — runbook

CT 201 `jellyfin` e CT 102 `Docker` (media-stack), no host `pve`.
Levantado e corrigido em 01/09/2026.

## O que o backup do Jellyfin guarda

543 MB comprimidos, semanalmente, no storage `drive`:

- `jellyfin.db` — **contas, senhas, progresso de reproducao, favoritos, playlists**
- `/etc/jellyfin` — configuracao, bibliotecas cadastradas, transcodificacao
- metadados e capas ja baixados, plugins instalados
- o sistema e o Jellyfin em si

**Nao guarda `/mnt/media`.** O `vzdump` exclui sozinho (`excluding bind mount
point mp0 ... (not a volume)`) e isso e deliberado: sao 60 GB que engordariam o
backup sem necessidade. Filmes, series e animes **nao tem copia nenhuma**, por
decisao do dono em 01/09.

## Como restaurar

    pct restore <vmid> /mnt/drive/dump/vzdump-lxc-201-<data>.tar.zst --storage local-lvm

**Duas armadilhas, as duas medidas na restauracao de teste de 01/09:**

1. **O restaurado herda o MAC do original.** Se voce ligar os dois juntos, os
   dois somem da rede — foi exatamente a colisao que o CT 101 causava. Antes de
   `pct start`, troque:

       pct set <vmid> --net0 name=eth0,bridge=vmbr0,hwaddr=<MAC NOVO>,ip=dhcp,type=veth

2. **O bind mount `mp0` volta apontando para `/mnt/media`.** Num restauro de
   teste, remova (`pct set <vmid> --delete mp0`) para nao mexer na biblioteca
   real.

Restauracao verificada em 01/09/2026: o Jellyfin subiu do arquivo com as duas
contas (`Diniz`, `marcellalucc`) intactas.

## Por que os 4K travavam

**Nao era disco.** Era transcodificacao.

Das 48 sessoes registradas ate 01/09, **30 foram transcodificacao completa**. O
log do ffmpeg mostra o que acontecia:

    Stream #0:0: Video: hevc (Main 10), yuv420p10le      <- o arquivo
    scale=...min(1620,1080*a)...                         <- reduzindo para 1080p
    Stream #0:0: Video: h264, yuv420p                    <- o que saia
    Audio: eac3 (Dolby Digital Plus + Dolby Atmos)

E o log de sessao mostra a causa:

    reported by app "Jellyfin Web" 10.11.11              <- TODAS as reproducoes

Assistia-se pelo navegador nos tres aparelhos. Navegador nao decodifica HEVC 10
bits nem E-AC3 Atmos, entao o servidor reescrevia cada quadro em tempo real.

**Numeros que descartam o disco:** o HD entrega perto de 100 MB/s; um 4K a 100
Mbps pede 12 MB/s. E nao havia espaco de SSD para encenar arquivo: os dois SSDs
de 112 GB estao inteiramente comprometidos, sobram ~36 GB fisicos — menos que um
unico 4K.

**Se alguem propuser comprar SSD para resolver travamento, releia este trecho.**

### O que usar em cada aparelho

    iPhone         app Jellyfin, na App Store
    PC             Jellyfin Media Player (o app de desktop, NAO o site)
    TV do quarto   canal Jellyfin na loja do Roku (Philco)
    TV da sala     Samsung UN55AU7700 (Tizen) — sem app de loja

Para a TV da sala, em ordem de recomendacao: um Fire TV Stick 4K (app oficial,
resolve de vez); sideload do app Tizen (funciona, mas expira a cada 60 dias e
voce vai esquecer); ou manter o navegador so nela, aceitando conversao naquele
aparelho — com 6 nucleos, uma conversao sozinha e viavel.

### Nao ha aceleracao por hardware

A GTX 760 esta dedicada a VM 120 (Batocera). **Mesmo livre nao ajudaria**: e
Kepler — nao decodifica HEVC nem codifica HEVC. Nao procure `/dev/dri`: ele nao
existe no host.

## Como conferir se a transcodificacao parou

    pct exec 201 -- sh -c 'ls /var/log/jellyfin/ | grep -oE "^FFmpeg\.[A-Za-z]+" | sort | uniq -c'

Linha de base de 01/09, antes dos apps nativos:

    15 FFmpeg.DirectStream
     3 FFmpeg.Remux
    30 FFmpeg.Transcode

"Ficou fluido?" nao serve como prova: nao distingue melhora real de rede boa
naquele minuto.

## Como atualizar a stack de midia

    pct exec 102 -- /usr/local/sbin/media-stack-update

Anota a imagem que cada container esta rodando, puxa as novas, sobe e testa cada
servico pela porta. Se algum nao responder em 90 segundos, **volta sozinho** para
as versoes anotadas e sai com codigo 1.

O relatorio semanal de atualizacoes pendentes (sextas 01:00, com recuperacao de
execucao perdida) fica em `/var/lib/portal/atualizacoes.txt` e aparece no Home
Assistant como `sensor.atualizacoes_pendentes`.

**O verificador nao baixa nada.** A primeira versao usava `docker pull` para
detectar diferenca — e com isso aplicava metade da atualizacao sozinha, de
madrugada, sem teste: exatamente o risco do Watchtower que este mecanismo existe
para evitar. Hoje compara o `Id` local com o `config.digest` que vem em base64
no campo `Raw` do `docker manifest inspect -v` da entrada amd64.

**Armadilha de digests**, que custou uma volta: `RepoDigests` local guarda o
digest da LISTA de manifestos, e `docker manifest inspect -v` devolve o digest de
cada manifesto POR PLATAFORMA. Sao coisas diferentes e nunca batem — comparar os
dois marca toda imagem como desatualizada, inclusive as recem-atualizadas.

## O compose e versionado

`/opt/media-stack` e repositorio Git local desde 01/09. Ficam **fora** do
versionamento o `.env` (segredos do RomM) e `config/` (bancos e estado). Nao ha
remoto: publicar exigiria credencial de Git dentro do container.

As cinco copias manuais anteriores (`*.bak*`, `*.before-*`, `*.broken-seerr*`)
foram para `/root/arquivo/media-stack/`.

Para desfazer uma edicao ruim no compose:

    pct exec 102 -- sh -c 'cd /opt/media-stack && git checkout -- compose.yaml && docker compose up -d'
