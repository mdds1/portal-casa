# Infraestrutura Proxmox — retrato, padrões e reorganização

Data: 2026-08-30
Estado: desenho em revisão
Documento irmão: `2026-08-30-portal-casa-design.md`

Este documento trata do servidor em si. O portal consome o inventário descrito
aqui; os dois avançam juntos, mas nenhum depende do outro para começar.

## 1. Retrato de hoje

Levantamento somente leitura feito em 2026-08-30 no host `pve` (PVE 9.2.4).

**Máquina:** AMD Ryzen 5 1600, 12 threads, 15 GiB de RAM utilizável, swap de
7,7 GiB (961 MiB já em uso). Há 32 GiB de memória disponíveis fisicamente, mas os
pentes não rodam juntos e a troca ainda não foi testada; o desenho trabalha com
16 GiB.

**Discos — quatro, sem nenhuma redundância:**

| Disco | Tamanho | Papel atual | Uso |
|---|---|---|---|
| `sda` | 112 GB | `vg-canary` — VM 110, VM 111 | 45% |
| `sdb` | 112 GB | root do Proxmox **e** `local-lvm` — CT 100, 101, 102, 104 | 40% / 31% |
| `sdc` | 466 GB | `/mnt/drive` | 1% |
| `sdd` | 932 GB | `/mnt/media` | 14% |

**Máquinas:**

| ID | Nome | Tipo | RAM | Estado | onboot |
|---|---|---|---|---|---|
| 100 | drive | LXC | 1 GB | parado | 0 |
| 101 | Jellyfin | LXC | 2 GB | parado | *ausente* |
| 102 | Docker | LXC | 2 GB | parado | *ausente* |
| 104 | starloco | LXC | 4 GB | parado | 0 |
| 110 | tfs-server | VM | 8 GB | rodando | *ausente* |
| 111 | home-assistant | VM | 2 GB | rodando | 1 |
| 120 | gamebox-batocera | VM | 4 GB | parado | 0 |

A soma de memória alocada é de **23 GiB para 15 GiB de RAM**. Hoje nada estoura
porque na prática nunca sobe tudo junto — mas isso é hábito, não regra escrita, e
nada no sistema impede o estouro.

## 2. Os problemas encontrados

### 2.1 Não existe backup de VM ou container

`vzdump.cron` está vazio e não há `jobs.cfg`. O FloripaOT e o StarLoco têm backup
de aplicação enviado ao Drive; o **Home Assistant não tem backup nenhum, em lugar
nenhum**. Todo o histórico, automações e dashboards vivem em uma cópia única, em
um disco sem redundância.

É a falha mais grave do parque e a mais barata de corrigir.

### 2.2 O disco da VM 110 vive em 97%

A causa não é crescimento de dados do servidor. A VM 110 é, ao mesmo tempo, o
servidor de produção e a bancada de desenvolvimento. Dos 34 GB ocupados:

| Item | Tamanho |
|---|---|
| `.vscode-server` | 6,8 GB |
| `build/` do Canary | 3,9 GB |
| vcpkg (três cópias) | 3,4 GB |
| `.git` do Canary | 1,4 GB |
| caches de npm, uv, cpptools | 3,1 GB |
| `.claude` e `.codex` | 1,1 GB |
| ambiente gráfico em `/usr` | 7,0 GB |
| **o servidor de jogo em si** | **~400 MB mais o banco** |

O servidor ocupa cerca de 1% do que enche o disco dele.

### 2.3 O `sdb` é ponto único de falha duplo

O root do Proxmox e o `local-lvm` estão no mesmo disco físico. Ele falhando leva
o hypervisor e os quatro containers na mesma queda.

### 2.4 O CT 101 é privilegiado

É o único do parque sem `unprivileged: 1` — e é justamente o que processa arquivo
de mídia vindo de fora. Root dentro dele é, na prática, root no host.

### 2.5 Não existe uma única regra de firewall

Os serviços `pve-firewall` e `proxmox-firewall` rodam, mas `/etc/pve/firewall/`
está vazio e não há `cluster.fw`. Os `firewall=1` nos CTs 101 e 102 não têm
efeito nenhum sem regras.

### 2.6 Menores

- Disco órfão `media:110/vm-110-disk-0.raw` ainda alocado como `unused0`.
- Cinco cópias de `ha-pve-power` largadas em `/usr/local/sbin`, duas executáveis.
- `lm-sensors` não instalado: não há hoje de onde ler temperatura.
- `onboot` ausente em quatro máquinas — ausência não é decisão, é esquecimento.
- Só o CT 102 tem IP fixo, e configurado por dentro.
- Nomes sem padrão: `drive`, `Jellyfin`, `Docker`, `starloco`, `tfs-server`.
- `ddclient` deixado pela metade no host, redundante (ver 2.7).

### 2.7 O que já está certo

O No-IP **funciona**: um `noip-ddns.timer` roda a cada 30 minutos, responde
`nochg 191.35.241.115`, e `dinizismo.ddns.net` resolve corretamente. O `ddclient`
configurado pela metade é redundante e deve ser removido.

Também já está certo o padrão de acesso que o portal vai reusar: usuário
`ha-monitor@pve` com papel `PVEAuditor` para leitura, e `/usr/local/sbin/ha-pve-power`
como wrapper de ações com lista fechada.

## 3. Arquitetura alvo

### 3.1 Separação de produção e bancada

A mudança estruturante: **o servidor de jogo sai da VM 110 para uma VM nova e
limpa, e a 110 passa a ser exclusivamente a bancada de desenvolvimento e de IA.**

Move-se o lado pequeno. O servidor é o binário, o datapack e o banco — menos de
1 GB. A bancada são 20 GB de ambiente frágil, com caminhos absolutos, chaves e
configuração de editor; movê-la custaria semanas e quebraria coisas em silêncio.

Consequências:

- **Produção** passa a caber em 4 GB, com disco de ~20 GB, e sobe limpa: sem
  desktop, sem CUPS, sem ModemManager, sem editor remoto, sem chave de agente de
  IA. Quando for exposta a jogadores, o que existe lá dentro é o jogo e o banco.
  Isso vale mais que várias regras de firewall.
- **Bancada** mantém os 8 GB e só sobe quando há trabalho. Compilar, encher de
  cache e reinstalar toolchain deixa de afetar qualquer jogador.
- O consumo de produção cai de 8 GB para 4 GB.

### 3.2 Papéis por máquina

Cada máquina tem uma função e só uma. Funções extras que hoje moram de carona
saem para máquinas próprias conforme forem tocadas.

| Função | Onde |
|---|---|
| Automação da casa | VM Home Assistant |
| Portal da casa | LXC novo, ~512 MB |
| Arquivos / SMB | LXC drive |
| Mídia | LXC Jellyfin |
| Serviços em contêiner | LXC Docker |
| Jogo — Tibia (produção) | **VM nova** |
| Jogo — Dofus | LXC starloco |
| Emulação | VM gamebox |
| **Bancada de desenvolvimento e IA** | **VM 110** |

## 4. Padrões

### 4.1 Nomes

Minúsculas, com hífen, descrevendo a função e não a tecnologia quando as duas
divergirem. `Jellyfin` → `jellyfin`, `Docker` → `docker-apps`, `tfs-server` →
`bancada-ia`. Renomear hostname é barato e não recria máquina.

### 4.2 Faixas de ID

- `1xx` — infraestrutura e casa
- `2xx` — mídia e arquivos
- `3xx` — jogos
- `9xx` — bancada e laboratório

**Renumerar máquina existente exige restaurá-la sob outro ID, e o ganho é
estético.** Portanto: a faixa vale para máquinas novas e para as que já vão ser
reconstruídas por outro motivo. As demais mantêm o ID atual, e o inventário
registra a função — que é o que realmente importa para achar as coisas.

### 4.3 Autostart

`onboot` e `startup` **explícitos em todas as máquinas**, inclusive nas que devem
ficar em `0`. O FloripaOT fica em `onboot: 0` **por decisão registrada**, não por
omissão; quando virar produção para jogadores, é uma linha para mudar.

### 4.4 Papel de cada storage

| Storage | Só para |
|---|---|
| `local-lvm`, `vg-canary` | disco de máquina |
| `media` (`sdd`) | biblioteca de mídia |
| `drive` (`sdc`) | **backup, e nada mais** |
| `local` | ISO e templates |

Hoje o `media` aceita `rootdir,images,iso,backup,vztmpl` — tudo — e por isso
acumula sobra. O conteúdo permitido passa a refletir o papel.

### 4.5 Backup

Destino único no `sdc`, que hoje está com 1% de uso e não tem outra função. O
`sdd` fica de fora porque guarda mídia e tem o Jellyfin escrevendo nele: backup e
carga de trabalho em discos diferentes.

- vzdump de todas as VMs e containers, com retenção definida.
- Cópia do `/etc/pve` (configuração do cluster) junto.
- Os backups de aplicação que já existem (FloripaOT, StarLoco) continuam indo
  para o Drive — nuvem cobre o caso de perder a casa inteira, disco local cobre o
  caso de perder um disco. Os dois são necessários.

### 4.6 Orçamento de memória

Os conjuntos que podem subir juntos ficam escritos no inventário, e o portal
confere o orçamento antes de ligar qualquer coisa. Deixa de ser hábito e passa a
ser regra verificada.

### 4.7 Endereçamento

Reserva de DHCP por MAC na Vivo Box. Cada máquina continua pedindo DHCP e sempre
recebe o mesmo endereço, decidido em um lugar só. Nada de IP estático por dentro
do sistema convidado — são dois lugares para errar e conflito garantido. O CT
102, hoje o único com IP fixo interno, volta para DHCP com reserva.

### 4.8 DNS dinâmico

Correção de premissa: o No-IP aponta nome para o **IP público da casa**, que é um
só. Não existe "o IP de cada máquina" no No-IP.

O que atende à necessidade: **vários nomes apontando para o mesmo IP público**,
com o redirecionamento de porta na Vivo Box decidindo qual máquina responde. O
`noip-update.sh`, que já funciona, passa a percorrer uma lista de nomes; criar um
nome novo no site e acrescentá-lo à lista basta.

## 5. Segurança

### 5.1 Firewall

Hoje não há nenhuma regra. O desenho:

- Política de entrada padrão **DROP** no datacenter.
- **Administração só pela Tailscale** — SSH e a interface 8006 nunca pela
  internet, e nem abertas para a LAN inteira.
- Cada serviço libera só a sua porta e só da origem que precisa: Jellyfin e
  Samba apenas da LAN; 7171/7172 e 450/5555 da internet, porque são jogo.
- Container que não atende ninguém de fora não recebe regra de entrada alguma.

**Risco:** ligar o firewall errado tranca o administrador para fora do host. A
execução exige regra de resgate pela Tailscale, janela de teste e um caminho de
reversão pronto antes de aplicar.

### 5.2 Privilégio dos containers

O CT 101 passa a não-privilegiado, como os outros quatro. Isso altera o
mapeamento de UID do `/mnt/media` — a mesma armadilha que já custou tempo no CT
100 com o SMB. Exige backup antes e mapeamento explícito.

### 5.3 Credenciais

A senha de root do PVE não entra em portal, script versionado ou arquivo de
configuração de aplicação. O acesso programático usa token com o menor papel que
resolve. Nada de senha, token, chave ou certificado privado no git.

## 6. Ordem de execução

A ordem é deliberada: cada passo reduz o risco do seguinte.

1. **Backup primeiro.** Destino no `sdc`, vzdump de tudo, `/etc/pve` junto,
   retenção definida, e uma restauração de teste para provar que presta. Nada
   mais começa antes disto: é o que torna todo o resto reversível.
2. **Limpeza da VM 110.** Recuperar os ~10 GB de material recriável (`build/`,
   caches de vcpkg, npm, uv, cpptools, versões velhas do vscode-server, `git gc`).
   Tira o disco da zona vermelha e dá espaço para trabalhar.
3. **VM nova de produção do FloripaOT** e migração — detalhada em §7.
4. **Firewall**, com regra de resgate e janela de teste.
5. **CT 101 para não-privilegiado.**
6. **Menores:** remover o disco órfão, recolher as cópias de `ha-pve-power`,
   instalar `lm-sensors`, tornar `onboot` explícito, remover o `ddclient`,
   generalizar o `noip-update.sh`, padronizar nomes, aplicar as reservas de DHCP.

## 7. Migração do FloripaOT

- O banco vai por dump, **com o servidor parado**, para não capturar estado pela
  metade.
- `backup-floripaot.sh` e a linha de cron apontam para caminhos da 110: vão junto
  e precisam ser reapontados.
- MAC novo significa **reserva de DHCP nova** e **redirecionamento de 7171/7172
  refeito** na Vivo Box.
- Tailscale precisa ser registrado na máquina nova.
- A VM 110 fica de pé com o servidor parado até a nova estar provada. Só depois
  se desliga o `canary.service` de lá. Em nenhum momento existe só uma cópia.

## 8. Fora de escopo

- Redundância de disco de verdade. Sem comprar hardware não há como: `sda` e
  `sdb` têm 112 GB cada e ambos já estão em uso; espelhar exigiria esvaziar um.
  Com o backup do item 1 no lugar, perder o `sdb` vira uma tarde de restauração
  em vez de uma perda. Um SSD de 120 GB resolve de fato, quando for a hora.
- A troca dos pentes de memória, até haver tempo de testar.
- Exposição do FloripaOT à internet para jogadores — projeto próprio.
- Alexa própria via Cloudflare Tunnel e o cancelamento do Nabu Casa.
