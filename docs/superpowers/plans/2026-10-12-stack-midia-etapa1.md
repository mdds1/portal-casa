# Stack de midia, etapa 1 (fazer funcionar) — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um pedido feito no Seerr chega ao Jellyfin, com a fila do qBittorrent andando e o CT 102 de volta a sob demanda.

**Architecture:** Tudo e operacao sobre o CT 102 (`pct exec 102`) a partir da bancada,
via `ssh root@192.168.15.200`, usando as APIs HTTP de Sonarr, Radarr, qBittorrent e
Seerr. Nao ha codigo novo. Cada tarefa mede o estado ruim antes, age, e mede de novo.

**Tech Stack:** Proxmox `pct`, Docker Compose, APIs v3 do Sonarr/Radarr, v2 do qBittorrent, v1 do Seerr.

**Spec:** `docs/superpowers/specs/2026-10-12-stack-midia-pedir-e-assistir-design.md`

## Global Constraints

- Teto **1080p**; nada de HEVC 10 bits nem 4K.
- CT 102 e CT 201 **sob demanda** (`onboot: 0`); o 201 e ligado so para verificar e desligado ao fim.
- **Nao trocar** o endereco do Jellyfin no Seerr (`100.85.166.41`, IP Tailscale do CT 201).
- Remover download **pela fila do Sonarr/Radarr com `blocklist=true`**, nunca so pelo qBittorrent.
- Atualizacao so pelo `/usr/local/sbin/media-stack-update` (tem rollback).

## Preambulo comum (colar no inicio de cada bloco executado dentro do CT)

```bash
cd /opt/media-stack/config
key(){ grep -oP "(?<=<ApiKey>)[^<]+" $1/config.xml; }
S=$(key sonarr); R=$(key radarr)
CRED=$(python3 -c 'import sqlite3,json;c=sqlite3.connect("file:sonarr/sonarr.db?mode=ro",uri=True);s=json.loads(c.execute("select Settings from DownloadClients where Implementation=\"QBittorrent\"").fetchone()[0]);print(s["username"]+"\t"+s["password"])')
QJ=$(mktemp); curl -s -c $QJ --data-urlencode "username=${CRED%%$'\t'*}" --data-urlencode "password=${CRED#*$'\t'}" localhost:8080/api/v2/auth/login >/dev/null
qb(){ curl -s -b $QJ "localhost:8080/api/v2/$@"; }
```

Executar com: `ssh root@192.168.15.200 'pct exec 102 -- bash -s' <<'EOF' ... EOF`.

---

### Task 1: Fila do qBittorrent nao trava mais

- [ ] **Step 1: Medir o estado ruim**

```bash
qb app/preferences | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["max_active_downloads"],d["dont_count_slow_torrents"])'
qb torrents/info | python3 -c 'import sys,json;[print(t["hash"][:8],t["state"]) for t in json.load(sys.stdin)]'
```
Esperado: `3 False`; `a1d2cae5`, `2f4345ff` em `stalledDL`, `95a6b1ea` em `metaDL`, o resto em `queuedDL`.

- [ ] **Step 2: Copia do conf e troca das preferencias**

```bash
cp qbittorrent/qBittorrent/qBittorrent.conf /root/arquivo/media-stack/qBittorrent.conf.bak-20261012
qb app/setPreferences --data-urlencode 'json={"max_active_downloads":5,"max_active_torrents":8,"dont_count_slow_torrents":true}'
```

- [ ] **Step 3: Remover os tres mortos pela fila do Sonarr, com bloqueio**

```bash
IDS=$(curl -s -H "X-Api-Key: $S" "localhost:8989/api/v3/queue?pageSize=500" | python3 -c 'import sys,json;print(json.dumps([r["id"] for r in json.load(sys.stdin)["records"] if (r.get("downloadId") or "").upper()[:8] in ("A1D2CAE5","2F4345FF","95A6B1EA")]))')
echo "$IDS"   # esperado: 3 ids
curl -s -X DELETE -H "X-Api-Key: $S" -H 'Content-Type: application/json' "localhost:8989/api/v3/queue/bulk?removeFromClient=true&blocklist=true&skipRedownload=true" -d "{\"ids\":$IDS}"
```
Se `IDS` nao tiver exatamente 3 elementos, parar sem apagar.

- [ ] **Step 4: Verificar**

Rodar o Step 1 de novo depois de 60 s. Esperado: `5 True`, os tres hashes sumiram, e pelo menos um Lucifer x264 (S02, S03 ou S04) saiu de `queuedDL` para `metaDL`/`downloading`.

---

### Task 2: HEVC 10 bits fora da fila

- [ ] **Step 1: Medir** — listar a fila e confirmar os quatro alvos: `9c0f1302` (S05), `bb9b6cad` (S06), `de15746c` (S01) no Sonarr e `390f7b51` (Toy Story 5) no Radarr.

- [ ] **Step 2: Remover com bloqueio, sem rebuscar**

```bash
IDS=$(curl -s -H "X-Api-Key: $S" "localhost:8989/api/v3/queue?pageSize=500" | python3 -c 'import sys,json;print(json.dumps([r["id"] for r in json.load(sys.stdin)["records"] if (r.get("downloadId") or "").upper()[:8] in ("9C0F1302","BB9B6CAD","DE15746C")]))')
curl -s -X DELETE -H "X-Api-Key: $S" -H 'Content-Type: application/json' "localhost:8989/api/v3/queue/bulk?removeFromClient=true&blocklist=true&skipRedownload=true" -d "{\"ids\":$IDS}"
IDR=$(curl -s -H "X-Api-Key: $R" "localhost:7878/api/v3/queue?pageSize=50" | python3 -c 'import sys,json;print(json.dumps([r["id"] for r in json.load(sys.stdin)["records"] if (r.get("downloadId") or "").upper()[:8]=="390F7B51"]))')
curl -s -X DELETE -H "X-Api-Key: $R" -H 'Content-Type: application/json' "localhost:7878/api/v3/queue/bulk?removeFromClient=true&blocklist=true&skipRedownload=true" -d "{\"ids\":$IDR}"
```
`IDR` deve ter 1 elemento; `IDS`, entre 3 e 39 (um por episodio).

- [ ] **Step 3: Verificar** — `qb torrents/info` nao mostra mais nenhum dos 4 hashes; `api/v3/blocklist` do Sonarr e do Radarr os contem.

---

### Task 3: CT 102 enxuto e atualizado

- [ ] **Step 1: Medir** — `pct config 102 | grep onboot` (esperado `1`), `docker system df` (2,4 GB recuperaveis), `ls config/watchtower`.

- [ ] **Step 2: Atualizar com rollback**

```bash
/usr/local/sbin/media-stack-update; echo "codigo=$?"
```
Esperado `codigo=0`. Se `1`, houve rollback: parar e investigar antes de seguir.

- [ ] **Step 3: Limpar** (depois do update, para levar junto as imagens que ele substituiu)

```bash
docker image prune -a -f
mkdir -p /root/arquivo/media-stack && mv /opt/media-stack/config/watchtower /root/arquivo/media-stack/watchtower-orfa
```
No host: `pct set 102 --onboot 0`.

- [ ] **Step 4: Verificar** — `onboot: 0`; `docker system df` sem recuperavel relevante; `df -h /` abaixo de 60%; os 9 containers `Up`; `git -C /opt/media-stack status --short` sem mudanca no `compose.yaml`.

---

### Task 4: Pedido real chega ao Jellyfin

- [ ] **Step 1: Ligar o Jellyfin** — no host, `pct start 201`; esperar `curl -s 100.85.166.41:8096/health` responder `Healthy` (testar de dentro do container: `docker exec seerr wget -qO- http://100.85.166.41:8096/health`).

- [ ] **Step 2: Seerr enxerga o Jellyfin**

```bash
SK=$(python3 -c 'import json;print(json.load(open("seerr/settings.json"))["main"]["apiKey"])')
curl -s -X POST -H "X-Api-Key: $SK" localhost:5055/api/v1/settings/jellyfin/sync -H 'Content-Type: application/json' -d '{"start":true}'
```
Se a rota do container ate a tailnet falhar, parar e investigar (spec 1.3).

- [ ] **Step 3: Pedir o filme de prova** — *Up (2009)*, TMDb 14160: 1080p H.264, pequeno, muito semeado.

```bash
curl -s -X POST -H "X-Api-Key: $SK" -H 'Content-Type: application/json' localhost:5055/api/v1/request -d '{"mediaType":"movie","mediaId":14160}'
```
Se o perfil `HD - 720p/1080p` aceitar um release HEVC 10 bits, rejeitar pela fila do Radarr com bloqueio e deixar ele escolher outro (a regra definitiva vem na etapa 3).

- [ ] **Step 4: Acompanhar ate o fim** — fila do Radarr ate importar; arquivo em `/mnt/media/Filmes/Up (2009)/`; no Jellyfin o filme aparece na biblioteca Filmes; no Seerr o pedido fica `Available`.

- [ ] **Step 5: Desligar** — `pct shutdown 201` e, se nada mais estiver baixando, `pct shutdown 102`.

---

### Task 5: Registro

- [ ] **Step 1:** Acrescentar ao `infra/midia/parque-midia.md` a secao "12/10/2026 — fila destravada", com o mecanismo das 3 vagas e o comando de remocao com bloqueio.
- [ ] **Step 2:** Commitar so esse arquivo e este plano:

```bash
git add infra/midia/parque-midia.md docs/superpowers/plans/2026-10-12-stack-midia-etapa1.md
git commit -m "docs(midia): etapa 1 executada, fila destravada" -- infra/midia/parque-midia.md docs/superpowers/plans/2026-10-12-stack-midia-etapa1.md
```
