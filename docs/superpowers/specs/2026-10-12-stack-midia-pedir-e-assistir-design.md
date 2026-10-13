# Stack de midia: pedir e assistir — desenho

**Data:** 12/10/2026
**Escopo:** CT 102 (media-stack Docker, `/opt/media-stack`) e sua ligacao com o
CT 201 (jellyfin) e o Home Assistant.
**Antecede:** `2026-09-01-parque-midia-design.md` (backup, atualizacao, 4K).

## Objetivo

O Matheus ou a Marcella pedem um filme ou serie no Seerr e ele aparece no
Jellyfin, sem abrir outra ferramenta. Painel de administracao fica fora.

## Decisoes do dono (12/10/2026)

| Tema | Decisao |
|---|---|
| Idioma | Tanto faz; pega o primeiro disponivel, **preferindo dublado** |
| Resolucao | **Teto 1080p**. Rejeitar 4K e HEVC 10 bits (causa do travamento no navegador) |
| Energia | CT 102 e CT 201 **sob demanda**, ligados so quando ele quiser |
| Como ligar | **Um botao "Midia"** no HA liga os dois, espera Seerr e Jellyfin, avisa; outro desliga |
| Indexadores | Publicos **mais trackers brasileiros de cadastro gratuito**; as contas sao criadas por ele |
| Metodo | **Configuracao declarativa versionada** no Git de `/opt/media-stack` |

## Retrato de 12/10/2026 (levantado so por leitura)

- 9 containers no ar: qbittorrent, prowlarr, sonarr 4.0.19, radarr 6.3.0, bazarr,
  seerr, flaresolverr, romm, romm-db.
- CT 102: 2 cores, 2 GB (89 MB livres, swap em uso), raiz 12 GB a 76%,
  2,4 GB de imagens recuperaveis. **`onboot: 1`**, contrariando a decisao de energia.
- Prowlarr: 11 indexadores publicos, so o BeTor e brasileiro. AnimeTosho falhando
  ha mais de 6h, Magnet Cat desligado. **Nenhuma tag existe, entao o proxy
  FlareSolverr nao se aplica a indexador nenhum.**
- Sonarr `renameEpisodes: False`; Radarr renomeia. Perfis de fabrica mais dois a mao,
  sem formatos personalizados.
- Seerr aponta o Jellyfin em `100.85.166.41:8096`: **IP Tailscale do proprio CT 201,
  correto**. So parece morto porque o 201 esta desligado. Nao trocar por IP de LAN
  (regra de `infra/host/renumeracao-20260919.md`); o MagicDNS nao resolve de dentro
  do CT 102, cujo DNS e o roteador.

### Por que nada baixa

O qBittorrent tem 11 torrents com a fila ligada no padrao de **3 downloads
ativos**. As tres vagas estao com torrents que nao andam: dois episodios de Nanatsu
no Taizai do HorribleSubs (grupo extinto; 5 de 568 MB e 0 de 338 MB) e um magnet
`95a6b1ea...` que nunca obteve metadados. Os outros 8 ficam em `queued` com tamanho
0. Os 97 itens da fila do Sonarr sao esses torrents contados por episodio.

**Hipotese, a confirmar pela API do qBittorrent antes de agir.**

Quatro itens da fila violam o teto novo: Lucifer S01, S05, S06 e Toy Story 5 sao
HEVC 10 bits.

## Etapas

Cada uma com desenho proprio aprovado antes de executar. So a etapa 1 esta
desenhada aqui.

1. **Fazer funcionar** (abaixo).
2. **Indexadores:** tag do FlareSolverr, AnimeTosho, troca dos fracos, brasileiros
   com cadastro.
3. **Perfis e nomes:** Recyclarr (container que roda e sai) aplicando um
   `recyclarr.yml` versionado, base TRaSH Guides: prefere dublado, aceita qualquer
   idioma, ate 1080p, rejeita HEVC 10 bits e 4K. Renomeacao ligada no Sonarr.
4. **Botao "Midia"** no Home Assistant.

## Etapa 1 — fazer funcionar

### 1.1 Destravar a fila

- Confirmar o estado de cada torrent pela API do qBittorrent.
- Remover os tres parados **pelo Sonarr, com lista de bloqueio**, para nao
  voltarem.
- Downloads ativos de 3 para 5; ligar "nao contar torrents lentos" na fila.

### 1.2 Tirar o HEVC 10 bits da fila

Remover e bloquear Lucifer S01/S05/S06 e Toy Story 5. **Nao rebuscar agora**:
a nova busca acontece depois da etapa 3, com os perfis que rejeitam o formato.

### 1.3 Seerr e Jellyfin

Nenhuma troca de endereco. Verificar, com o CT 201 ligado, que o Seerr alcanca
`100.85.166.41:8096` e enxerga as bibliotecas. So se falhar, investigar a rota do
container ate a tailnet.

### 1.4 Recursos do CT 102

- `pct set 102 --onboot 0`.
- `docker image prune` das imagens sem container (~2,4 GB).
- Remover `config/watchtower`, orfa.
- Atualizar por `/usr/local/sbin/media-stack-update` (rollback automatico).
- RAM permanece 2 GB; reavaliar ao fim das quatro etapas.

### 1.5 Criterio de pronto

Um pedido real feito no Seerr (filme pequeno, 1080p H.264, bem semeado) aparece no
Jellyfin. Se nao aparecer, a etapa nao terminou, mesmo com todas as telas certas.

### Fora da etapa 1

Indexadores, perfis de qualidade, Recyclarr e o botao do HA.

## Riscos

- **Remover pelo qBittorrent em vez do Sonarr** deixa o Sonarr rebuscando o mesmo
  release. Sempre remover pela fila do Sonarr/Radarr com bloqueio.
- **Atualizacao quebrar um servico:** coberto pelo rollback do `media-stack-update`.
- **Mexer com o CT 201 desligado:** a verificacao do 1.3 e do 1.5 exige ligar o 201
  (`pct start 201`) e desliga-lo ao fim, respeitando a decisao de energia.
