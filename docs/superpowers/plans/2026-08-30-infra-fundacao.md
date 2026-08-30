# Infraestrutura — Plano 1: Fundação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o parque restaurável e recuperar espaço, sem tirar nenhum serviço do ar.

**Architecture:** Três frentes em sequência. Primeiro um destino de backup dedicado no `sdc` com trabalho agendado e retenção dimensionada, provado por uma restauração real. Depois a recuperação de espaço — os ~10 GB de material recriável na VM 110, os 35 GB do disco órfão e os 20 GB de dumps de julho. Por fim os ajustes pequenos que hoje são omissão e não decisão: `onboot` explícito, sensores, DNS dinâmico generalizado, limpeza de `/usr/local/sbin`.

**Tech Stack:** Proxmox VE 9.2.4 (`pvesh`, `pvesm`, `vzdump`, `qmrestore`, `pct`), systemd timers, shell POSIX, git.

**Spec:** `docs/superpowers/specs/2026-08-30-infra-proxmox-design.md`

## Global Constraints

- **O FloripaOT continua no ar durante todo este plano.** Nenhuma tarefa aqui para o `canary.service`, reinicia a VM 110 ou toca em 7171/7172. Se alguma parecer exigir isso, ela para e volta para discussão.
- **O Home Assistant continua no ar.** A VM 111 não é reiniciada por nenhuma tarefa deste plano.
- Nenhuma porta nova é exposta à internet.
- Nenhuma VM ou container existente é apagado. As únicas destruições permitidas são: a máquina de teste temporária criada na Tarefa 3 (ID 199) e arquivos explicitamente nomeados nas Tarefas 5 e 6.
- Nenhuma alteração de rede, bridge ou endereçamento do host.
- Senhas e tokens nunca entram em arquivo versionado.
- Host Proxmox: `root@100.71.204.68` (Tailscale). Repositório de trabalho: `~/projetos/portal-casa` na VM 110.
- Retenção de backup: **3 diários + 2 semanais + 1 mensal**.
- Máquinas no trabalho de backup: **100, 101, 102, 104, 111, 120**. A **110 fica fora** (bancada, recriável, ~15 GB por cópia).

---

### Task 1: Destino de backup dedicado no `sdc`

O storage `drive` já aponta para `/mnt/drive` e já aceita `backup`, mas também aceita `iso` e `vztmpl`, que ele não usa. Restringir o conteúdo ao papel real evita que ISO e template voltem a se acumular ali.

**Files:**
- Modify (no host): `/etc/pve/storage.cfg` — via `pvesm set`, nunca editando à mão
- Create: `~/projetos/portal-casa/infra/backup/README.md`

**Interfaces:**
- Produces: o storage `drive` como único destino de backup, consumido pela Tarefa 2.

- [ ] **Step 1: Provar que o storage aceita conteúdo que não é seu**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pvesm status --storage drive; grep -A4 "^dir: drive" /etc/pve/storage.cfg'
```

Esperado: a linha `content` traz `iso,backup,vztmpl`.

- [ ] **Step 2: Confirmar que não há ISO nem template no disco**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'ls -la /mnt/drive/template/ /mnt/drive/template/cache/ 2>&1; find /mnt/drive -name "*.iso" -o -name "*.tar.zst" -o -name "*.tar.gz" 2>/dev/null'
```

Esperado: nenhum `.iso` e nenhum template. **Se aparecer algum, pare** — mover o arquivo é uma decisão do Matheus, não deste plano.

- [ ] **Step 3: Restringir o conteúdo a backup**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pvesm set drive --content backup'
```

- [ ] **Step 4: Verificar**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pvesm status --storage drive; grep -A4 "^dir: drive" /etc/pve/storage.cfg; df -h /mnt/drive'
```

Esperado: `content backup` apenas; storage `active`; 450 GB disponíveis.

- [ ] **Step 5: Registrar a decisão**

```bash
mkdir -p ~/projetos/portal-casa/infra/backup
cat > ~/projetos/portal-casa/infra/backup/README.md <<'EOF'
# Backup do parque

Destino: storage `drive` (`/mnt/drive`, disco `sdc`, 458 GB).

Por que o sdc e nao o sdd:
- Nenhum disco de maquina mora no sdc — backup e origem em discos diferentes.
- O sdd guarda midia e tem o Jellyfin escrevendo nele; backup nao divide
  disco com carga de trabalho.
- O sdc tambem serve os arquivos da familia por SMB (CT 100). Ele nao e
  exclusivo de backup, mas tem 450 GB livres.

Conteudo do storage restrito a `backup`: ISO e template nao voltam a
se acumular ali.

Retencao: 3 diarios + 2 semanais + 1 mensal — seis pontos cobrindo ~1 mes,
cerca de 220 GB. Dimensionado com dado medido, nao estimado: os vzdumps de
julho em /mnt/media/dump deram VM 110 = 9,9 GB e CT 100 = 10,4 GB
comprimidos. Armazenamento de diretorio nao deduplica.

A VM 110 (bancada) fica fora do trabalho automatico: ~15 GB por copia de
ambiente recriavel, cujo conteudo que importa ja esta no git. Copia manual
antes de mudanca arriscada.
EOF
cd ~/projetos/portal-casa && git add infra/backup/README.md && \
  git commit -m "infra: storage drive restrito a backup"
```

---

### Task 2: Trabalho de backup agendado

**Files:**
- Modify (no host): `/etc/pve/jobs.cfg` — via `pvesh create`, nunca à mão
- Create: `~/projetos/portal-casa/infra/backup/job.md`

**Interfaces:**
- Consumes: storage `drive` restrito a backup (Tarefa 1).
- Produces: dumps em `/mnt/drive/dump/`, consumidos pela Tarefa 3.

- [ ] **Step 1: Provar que não existe backup nenhum**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pvesh get /cluster/backup --output-format json; ls -la /mnt/drive/dump/'
```

Esperado: lista vazia (`[]`) e diretório vazio. **É este o buraco que o plano fecha.**

- [ ] **Step 2: Criar o trabalho**

Às 03:00, antes dos backups de aplicação que já rodam às 04:00 e 04:20 na VM 110 — assim os dois não disputam disco.

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pvesh create /cluster/backup \
     --id casa-diario \
     --schedule "03:00" \
     --storage drive \
     --vmid 100,101,102,104,111,120 \
     --mode snapshot \
     --compress zstd \
     --prune-backups "keep-daily=3,keep-weekly=2,keep-monthly=1" \
     --notes-template "{{guestname}} — {{node}}" \
     --enabled 1 \
     --comment "Parque da casa. VM 110 (bancada) fora de proposito."'
```

`mode snapshot` mantém tudo rodando durante a cópia: `local-lvm` e `vg-canary` são LVM-thin e suportam snapshot.

- [ ] **Step 3: Verificar o registro do trabalho**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pvesh get /cluster/backup --output-format json | python3 -m json.tool; cat /etc/pve/jobs.cfg'
```

Esperado: um trabalho `casa-diario`, `enabled: 1`, sem a VM 110 na lista.

- [ ] **Step 4: Rodar uma vez à mão, na menor máquina, para provar que funciona**

O CT 102 está parado e é pequeno — é o teste mais barato.

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'vzdump 102 --storage drive --mode snapshot --compress zstd 2>&1 | tail -20'
```

Esperado: termina em `INFO: Backup job finished successfully`.

- [ ] **Step 5: Confirmar o arquivo no disco**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'ls -lh /mnt/drive/dump/; df -h /mnt/drive'
```

Esperado: um `vzdump-lxc-102-*.tar.zst` com tamanho plausível (não zero).

- [ ] **Step 6: Confirmar que nada saiu do ar**

```bash
nc -z -w5 192.168.15.14 7171 && echo "FloripaOT OK"
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'qm status 110; qm status 111'
```

Esperado: `FloripaOT OK` e ambas `status: running`.

- [ ] **Step 7: Commit**

```bash
cat > ~/projetos/portal-casa/infra/backup/job.md <<'EOF'
# Trabalho `casa-diario`

Diario as 03:00, storage `drive`, modo snapshot, compressao zstd.
Maquinas: 100, 101, 102, 104, 111, 120. A 110 fica fora (ver README).

03:00 e antes dos backups de aplicacao da VM 110 (04:00 FloripaOT,
04:20 StarLoco) para os dois nao disputarem disco.

Modo snapshot mantem tudo rodando: local-lvm e vg-canary sao LVM-thin.

Alterar sempre por `pvesh create/set /cluster/backup`, nunca editando
/etc/pve/jobs.cfg a mao.
EOF
cd ~/projetos/portal-casa && git add infra/backup/job.md && \
  git commit -m "infra: trabalho de backup diario do parque"
```

---

### Task 3: Provar a restauração

Um backup nunca testado não é backup. Esta tarefa restaura o Home Assistant — o ativo sem nenhuma outra cópia — sob um ID descartável, **com a rede desligada** para não haver dois HA disputando a mesma identidade.

**Files:**
- Create: `~/projetos/portal-casa/infra/backup/restauracao-testada.md`

**Interfaces:**
- Consumes: os dumps produzidos pela Tarefa 2.

- [ ] **Step 1: Gerar o dump do Home Assistant**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'vzdump 111 --storage drive --mode snapshot --compress zstd 2>&1 | tail -20'
```

Esperado: `Backup job finished successfully`. A VM 111 **continua rodando** — snapshot não a derruba.

- [ ] **Step 2: Confirmar que o HA não piscou**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'qm status 111'
curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 http://192.168.15.111:8123/
```

Esperado: `status: running` e um código HTTP (`200` ou `302`), não timeout.

- [ ] **Step 3: Confirmar que o ID 199 está livre**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'qm status 199 2>&1; pct status 199 2>&1'
```

Esperado: erro de "does not exist" nos dois. **Se qualquer um existir, pare** e escolha outro ID.

- [ ] **Step 4: Restaurar sob o ID 199, sem ligar**

```bash
DUMP=$(sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'ls -t /mnt/drive/dump/vzdump-qemu-111-*.vma.zst | head -1')
echo "restaurando de: $DUMP"
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  "qmrestore '$DUMP' 199 --storage local-lvm --unique 1 2>&1 | tail -15"
```

`--unique 1` gera MAC novo, para não haver dois endereços iguais na rede.

- [ ] **Step 5: Desligar a rede da cópia antes de ligá-la**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'qm set 199 --net0 "$(qm config 199 | sed -n "s/^net0: //p"),link_down=1" && qm config 199 | grep net0'
```

Esperado: a linha `net0` termina com `link_down=1`. **Este passo não é opcional** — um segundo Home Assistant na rede briga por entidades e integrações com o que está em produção.

- [ ] **Step 6: Ligar e confirmar que arranca**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'qm start 199'
sleep 90
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'qm status 199; qm guest cmd 199 ping 2>&1 | head -3'
```

Esperado: `status: running`. O `guest cmd` pode falhar sem que seja problema — o que se prova aqui é que a imagem restaurada dá boot.

- [ ] **Step 7: Confirmar que a produção continuou intocada**

```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 http://192.168.15.111:8123/
nc -z -w5 192.168.15.14 7171 && echo "FloripaOT OK"
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'free -h'
```

Esperado: HA responde, FloripaOT responde, e a memória livre não está no chão.

- [ ] **Step 8: Destruir a cópia de teste**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'qm stop 199 && sleep 10 && qm destroy 199 --purge 1 && echo destruida'
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'qm status 199 2>&1'
```

Esperado: `destruida`, e depois "does not exist". **Confira o número 199 antes de rodar** — este é o único `destroy` autorizado neste plano.

- [ ] **Step 9: Registrar o resultado**

```bash
cat > ~/projetos/portal-casa/infra/backup/restauracao-testada.md <<'EOF'
# Restauracao testada

Data do teste: (preencher com a data em que a Tarefa 3 rodou)

O que foi provado: o dump da VM 111 (Home Assistant) restaura sob outro ID
e da boot. E o unico ativo do parque sem nenhuma outra copia, por isso e ele
que se testa.

Procedimento, para repetir:
1. vzdump 111 --storage drive --mode snapshot --compress zstd
2. qmrestore <dump> 199 --storage local-lvm --unique 1
3. qm set 199 --net0 <net0>,link_down=1     <-- obrigatorio
4. qm start 199, esperar ~90s, qm status 199
5. qm stop 199 && qm destroy 199 --purge 1

Por que link_down=1: dois Home Assistant na mesma rede disputam entidades e
integracoes com o que esta em producao. A copia de teste nunca fala na rede.

Repetir a cada mudanca grande de infraestrutura.
EOF
cd ~/projetos/portal-casa && git add infra/backup/restauracao-testada.md && \
  git commit -m "infra: restauracao do Home Assistant provada"
```

---

### Task 4: Recuperar os ~10 GB da VM 110

Só material recriável. **Nada aqui toca no binário do servidor, no datapack, no banco ou no `canary.service`.**

**Files:**
- Create: `~/projetos/portal-casa/infra/bancada/limpeza.sh`

- [ ] **Step 1: Registrar o ponto de partida**

```bash
df -h / | tail -1
du -xh --max-depth=1 /home/matheus /opt 2>/dev/null | sort -rh | head -12
```

Esperado: `/` em torno de 97%.

- [ ] **Step 2: Confirmar que o servidor está de pé antes de mexer**

```bash
systemctl is-active canary.service mariadb.service
nc -z -w5 127.0.0.1 7171 && echo "FloripaOT OK"
```

Esperado: `active`, `active`, `FloripaOT OK`.

- [ ] **Step 3: Escrever o script de limpeza**

```bash
mkdir -p ~/projetos/portal-casa/infra/bancada
cat > ~/projetos/portal-casa/infra/bancada/limpeza.sh <<'EOF'
#!/bin/bash
# Recupera espaco na bancada (VM 110). SO material recriavel.
# NAO toca em: binario do canary, datapack, banco, canary.service, /var/lib/mysql.
set -u

antes=$(df --output=avail -k / | tail -1)

# Build do Canary — recriavel com uma compilacao.
rm -rf /opt/canary-1511-clean/build

# Caches de gerenciadores de pacote — recriaveis por download.
rm -rf "$HOME/.cache/uv" "$HOME/.cache/vscode-cpptools" "$HOME/.cache/pip"
npm cache clean --force 2>/dev/null || true

# vcpkg: downloads e pacotes intermediarios. Mantem o binary-cache,
# que e justamente o que evita recompilar tudo depois.
rm -rf "$HOME/vcpkg/downloads" "$HOME/vcpkg/packages" "$HOME/.cache/vcpkg"

# Versoes antigas do vscode-server; a em uso e recriada na proxima conexao.
find "$HOME/.vscode-server/cli" -maxdepth 2 -name "*.tar.gz" -delete 2>/dev/null || true

# Compacta o historico do git — nao perde nenhum commit.
git -C /opt/canary-1511-clean gc --prune=now --quiet 2>/dev/null || true

# Logs antigos do journal.
journalctl --vacuum-time=14d >/dev/null 2>&1 || true

depois=$(df --output=avail -k / | tail -1)
echo "Recuperado: $(( (depois - antes) / 1024 )) MB"
df -h /
EOF
chmod +x ~/projetos/portal-casa/infra/bancada/limpeza.sh
```

- [ ] **Step 4: Rodar**

```bash
~/projetos/portal-casa/infra/bancada/limpeza.sh
```

Esperado: alguns GB recuperados e `/` bem abaixo de 90%.

- [ ] **Step 5: Confirmar que o servidor não sentiu nada**

```bash
systemctl is-active canary.service mariadb.service
nc -z -w5 127.0.0.1 7171 && echo "FloripaOT OK"
ls -la /opt/canary-1511-clean/canary 2>/dev/null || echo "binario nao esta na raiz do repo"
```

Esperado: ambos `active` e `FloripaOT OK`.

- [ ] **Step 6: Commit**

```bash
cd ~/projetos/portal-casa && git add infra/bancada/limpeza.sh && \
  git commit -m "infra: limpeza do material recriavel da bancada"
```

---

### Task 5: Remover o disco órfão e os dumps de julho

35 GB de um disco desanexado da VM 110 e 20 GB de vzdumps de 16/07, ambos em `/mnt/media`.

- [ ] **Step 1: Provar que o disco está desanexado e é órfão**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'qm config 110 | grep -E "^(unused|virtio|scsi|ide|sata)"; ls -la /mnt/media/images/110/'
```

Esperado: o disco em uso é `virtio0: vg-canary:vm-110-disk-0`; o de `/mnt/media` aparece **apenas** como `unused0`. **Se ele aparecer em qualquer linha que não seja `unused`, pare.**

- [ ] **Step 2: Guardar a configuração atual da VM antes de mexer**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'cp /etc/pve/qemu-server/110.conf /root/110.conf.antes-de-remover-unused0 && cat /root/110.conf.antes-de-remover-unused0'
```

- [ ] **Step 3: Remover o disco órfão**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'qm set 110 --delete unused0 && qm config 110 | grep -c unused; df -h /mnt/media'
```

Esperado: `0` linhas `unused` e ~35 GB a mais livres em `/mnt/media`.

- [ ] **Step 4: Confirmar que a VM 110 nem percebeu**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'qm status 110'
nc -z -w5 192.168.15.14 7171 && echo "FloripaOT OK"
```

Esperado: `status: running` e `FloripaOT OK`. Remover um disco `unused` não reinicia a máquina.

- [ ] **Step 5: Remover os dumps de julho**

Substituídos pelos backups da Tarefa 2, que são recentes e testados.

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'ls -lh /mnt/drive/dump/'
```

**Só siga se houver dumps novos em `/mnt/drive/dump/`.** Então:

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'rm -f /mnt/media/dump/vzdump-lxc-100-2026_07_16-19_44_08.* \
         /mnt/media/dump/vzdump-qemu-110-2026_07_16-18_41_02.* && \
   ls -la /mnt/media/dump/; df -h /mnt/media'
```

- [ ] **Step 6: Registrar**

```bash
cat > ~/projetos/portal-casa/infra/bancada/espaco-recuperado.md <<'EOF'
# Espaco recuperado no /mnt/media

- Disco orfao da VM 110 (`media:110/vm-110-disk-0.raw`, ~35 GB):
  estava apenas como `unused0`, removido com `qm set 110 --delete unused0`.
  Copia da config anterior em /root/110.conf.antes-de-remover-unused0 no host.
- vzdumps de 16/07/2026 da VM 110 e do CT 100 (~20 GB): substituidos pelo
  trabalho `casa-diario`, que e recente e teve restauracao provada.

O storage `media` continua aceitando `rootdir,images,iso,backup,vztmpl`.
Restringi-lo ao papel de biblioteca de midia depende de confirmar que nada
mais grava ali — fica para o plano seguinte.
EOF
cd ~/projetos/portal-casa && git add infra/bancada/espaco-recuperado.md && \
  git commit -m "infra: remove disco orfao e dumps de julho"
```

---

### Task 6: Recolher as cópias de `ha-pve-power`

Cinco cópias em `/usr/local/sbin`, duas executáveis. É onde mora o wrapper que o Home Assistant chama; deixar variantes executáveis ali é convite a rodar a errada.

- [ ] **Step 1: Ver o que existe e qual é a de verdade**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'ls -la /usr/local/sbin/; echo "--- em uso pelo HA ---"; grep -rl ha-pve-power /root/.ssh/authorized_keys /etc/ssh/ 2>/dev/null'
```

- [ ] **Step 2: Guardar as cópias fora do caminho de execução**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'mkdir -p /root/arquivo/ha-pve-power && \
   mv /usr/local/sbin/ha-pve-power.bak* /root/arquivo/ha-pve-power/ && \
   ls -la /usr/local/sbin/ /root/arquivo/ha-pve-power/'
```

Esperado: em `/usr/local/sbin` sobram apenas `ha-pve-power` e `noip-update.sh`.

- [ ] **Step 3: Confirmar que o wrapper ainda funciona**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  '/usr/local/sbin/ha-pve-power status ct:104; echo "saida: $?"'
```

Esperado: responde o estado do CT 104 sem erro.

- [ ] **Step 4: Commit**

```bash
cat > ~/projetos/portal-casa/infra/host/usr-local-sbin.md <<'EOF'
# /usr/local/sbin no host

Deve conter apenas:
- ha-pve-power    — wrapper de acoes com lista fechada, chamado pelo HA
- noip-update.sh  — atualizador de DNS dinamico (timer noip-ddns)

Cinco copias `.bak*` de ha-pve-power, duas delas executaveis, foram movidas
para /root/arquivo/ha-pve-power/. Variante executavel no PATH de root e
convite a rodar a errada.

Copia nova daqui em diante vai para /root/arquivo/, nunca para o PATH.
EOF
mkdir -p ~/projetos/portal-casa/infra/host
cd ~/projetos/portal-casa && git add infra/host/usr-local-sbin.md && \
  git commit -m "infra: recolhe copias antigas do wrapper de acoes"
```

---

### Task 7: Instalar sensores de temperatura

Hoje não existe de onde ler temperatura — e o painel promete mostrar.

- [ ] **Step 1: Provar que não há leitura disponível**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'sensors 2>&1 | head -3'
```

Esperado: comando não encontrado.

- [ ] **Step 2: Instalar**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'apt-get update -qq && apt-get install -y lm-sensors 2>&1 | tail -5'
```

- [ ] **Step 3: Detectar os sensores**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'yes | sensors-detect --auto 2>&1 | tail -20'
```

- [ ] **Step 4: Ler a temperatura**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'sensors; echo "--- json ---"; sensors -j 2>/dev/null | head -30'
```

Esperado: temperaturas do Ryzen (`k10temp`, campo `Tctl`). **Se não aparecer nada, registre isso** — em placa antiga pode não haver sensor exposto, e o painel precisa saber que esse dado não existe em vez de mostrar campo vazio.

- [ ] **Step 5: Commit**

```bash
cat > ~/projetos/portal-casa/infra/host/sensores.md <<'EOF'
# Temperatura do host

lm-sensors instalado no host `pve`. Leitura por `sensors -j`, em JSON.

O Ryzen 5 1600 expoe `k10temp`; o campo que interessa e `Tctl`.

O portal le esta saida. Se `sensors -j` nao trouxer k10temp, o cartao de
temperatura deve dizer "sem sensor" — nunca mostrar campo vazio ou zero.
EOF
cd ~/projetos/portal-casa && git add infra/host/sensores.md && \
  git commit -m "infra: sensores de temperatura no host"
```

---

### Task 8: `onboot` explícito em todas as máquinas

Quatro máquinas não têm a linha. Ausência não é decisão.

**Decisões a gravar:** 111 sobe (`1`, já está). 110 **não sobe** — bancada, por opção. 100, 101, 102, 104, 120 não sobem, sob demanda.

- [ ] **Step 1: Ver o estado atual**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'for f in /etc/pve/qemu-server/*.conf /etc/pve/lxc/*.conf; do
     printf "%s: %s\n" "$f" "$(grep -c ^onboot "$f")"; done'
```

Esperado: `0` em 100.conf? não — em 101, 102, 110 e 120 conforme o levantamento; confira e anote quais.

- [ ] **Step 2: Tornar explícito**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  qm set 110 --onboot 0
  qm set 111 --onboot 1
  qm set 120 --onboot 0
  pct set 100 --onboot 0
  pct set 101 --onboot 0
  pct set 102 --onboot 0
  pct set 104 --onboot 0
'
```

- [ ] **Step 3: Verificar que todas têm a linha**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'grep -H ^onboot /etc/pve/qemu-server/*.conf /etc/pve/lxc/*.conf'
```

Esperado: sete linhas, uma por máquina. Só a 111 com `1`.

- [ ] **Step 4: Confirmar que nada reiniciou**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'qm status 110; qm status 111'
nc -z -w5 192.168.15.14 7171 && echo "FloripaOT OK"
```

Esperado: ambas `running` e `FloripaOT OK`. `onboot` só vale no próximo boot do host.

- [ ] **Step 5: Commit**

```bash
cat > ~/projetos/portal-casa/infra/host/autostart.md <<'EOF'
# Autostart do parque

| ID  | Maquina          | onboot | Por que                                   |
|-----|------------------|--------|-------------------------------------------|
| 100 | drive            | 0      | sob demanda                               |
| 101 | Jellyfin         | 0      | sob demanda; nao gastar RAM sem uso       |
| 102 | Docker           | 0      | sob demanda; nao gastar RAM sem uso       |
| 104 | starloco         | 0      | sob demanda                               |
| 110 | bancada (tfs)    | 0      | POR OPCAO do Matheus, nao por esquecimento|
| 111 | home-assistant   | 1      | sustenta a rotina da casa                 |
| 120 | gamebox-batocera | 0      | sob demanda                               |

Explicito em todas: ausencia da linha e esquecimento, nao decisao.

Quando o FloripaOT virar producao para jogadores, ele passa a onboot 1 —
mas na VM nova de producao, nao na 110, que fica sendo a bancada.
EOF
cd ~/projetos/portal-casa && git add infra/host/autostart.md && \
  git commit -m "infra: onboot explicito em todas as maquinas"
```

---

### Task 9: DNS dinâmico para vários nomes, e remover o `ddclient`

O `noip-update.sh` funciona mas atende um nome só. O `ddclient` ficou pela metade e é redundante.

**Files:**
- Modify (no host): `/usr/local/sbin/noip-update.sh`, `/etc/noip-ddns/noip.env`
- Create: `~/projetos/portal-casa/infra/host/dns-dinamico.md`

- [ ] **Step 1: Confirmar o que funciona e o que sobra**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'journalctl -t noip-ddns -n 3 --no-pager; systemctl is-enabled noip-ddns.timer; systemctl is-enabled ddclient 2>&1; systemctl is-active ddclient 2>&1'
```

Esperado: `nochg <ip>` recente, timer `enabled`, `ddclient` `disabled` e `inactive`.

- [ ] **Step 2: Guardar cópia do que funciona**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'cp /usr/local/sbin/noip-update.sh /root/arquivo/noip-update.sh.antes-da-lista && echo guardado'
```

- [ ] **Step 3: Reescrever para percorrer uma lista**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 "cat > /usr/local/sbin/noip-update.sh <<'EOF'
#!/bin/sh
# Atualiza no No-IP todos os nomes de NOIP_HOSTS.
#
# O No-IP aponta nome para o IP PUBLICO da casa, que e um so. Nao existe
# \"o IP de cada maquina\". Varios nomes apontam para o mesmo IP publico, e
# quem separa qual maquina responde e o redirecionamento de porta na Vivo Box.
#
# Para acrescentar um nome: crie no site do No-IP e adicione em NOIP_HOSTS
# (separados por espaco) em /etc/noip-ddns/noip.env.
set -u
. /etc/noip-ddns/noip.env

case \"\$NOIP_USER:\$NOIP_PASS\" in
  *COLE_AQUI*) echo 'Configure /etc/noip-ddns/noip.env first' >&2; exit 2 ;;
esac

# Compatibilidade: aceita o NOIP_HOST antigo se NOIP_HOSTS nao existir.
hosts=\"\${NOIP_HOSTS:-\${NOIP_HOST:-}}\"
if [ -z \"\$hosts\" ]; then
  echo 'Nem NOIP_HOSTS nem NOIP_HOST definidos' >&2; exit 2
fi

falhou=0
for h in \$hosts; do
  resp=\$(curl -fsS --max-time 20 -u \"\$NOIP_USER:\$NOIP_PASS\" \\
    \"https://dynupdate.no-ip.com/nic/update?hostname=\$h\" || true)
  case \"\$resp\" in
    good*|nochg*) logger -t noip-ddns \"\$h: \$resp\"; echo \"\$h: \$resp\" ;;
    *)            logger -t noip-ddns \"\$h: FALHOU (\$resp)\"
                  echo \"\$h: FALHOU (\$resp)\" >&2; falhou=1 ;;
  esac
done
exit \$falhou
EOF
chmod 700 /usr/local/sbin/noip-update.sh && ls -la /usr/local/sbin/noip-update.sh"
```

Um nome falhando não impede os outros de atualizarem, e a saída diz qual falhou.

- [ ] **Step 4: Declarar a lista**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'grep -q "^NOIP_HOSTS=" /etc/noip-ddns/noip.env || \
     echo "NOIP_HOSTS=\"dinizismo.ddns.net\"" >> /etc/noip-ddns/noip.env
   chmod 600 /etc/noip-ddns/noip.env
   grep -o "^NOIP_HOSTS=.*" /etc/noip-ddns/noip.env; ls -la /etc/noip-ddns/noip.env'
```

Esperado: `NOIP_HOSTS="dinizismo.ddns.net"` e modo `600`.

- [ ] **Step 5: Rodar e conferir**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  '/usr/local/sbin/noip-update.sh; echo "saida: $?"; getent hosts dinizismo.ddns.net'
```

Esperado: `dinizismo.ddns.net: nochg <ip>`, saída `0`, e o nome resolvendo para o IP público.

- [ ] **Step 6: Confirmar que o Dofus continua alcançável pelo nome**

```bash
nc -z -w8 dinizismo.ddns.net 450 && echo "porta 450 OK (se o CT 104 estiver ligado)"
```

Se o CT 104 estiver parado, a porta não responde — e isso é esperado, não uma falha desta tarefa.

- [ ] **Step 7: Remover o `ddclient` redundante**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'systemctl is-active ddclient'
```

**Só siga se a resposta for `inactive`.** Então:

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'mv /etc/ddclient.conf /root/arquivo/ddclient.conf.removido 2>/dev/null
   apt-get remove -y ddclient 2>&1 | tail -3
   systemctl is-active noip-ddns.timer'
```

Esperado: `ddclient` removido e o timer do No-IP ainda `active`.

- [ ] **Step 8: Commit**

```bash
cat > ~/projetos/portal-casa/infra/host/dns-dinamico.md <<'EOF'
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
EOF
cd ~/projetos/portal-casa && git add infra/host/dns-dinamico.md && \
  git commit -m "infra: DNS dinamico para varios nomes; remove ddclient"
```

---

## O que este plano deliberadamente NÃO faz

- **Não migra o FloripaOT.** Plano próprio, apoiado no backup que este cria.
- **Não liga firewall.** Plano próprio, com regra de resgate e janela de teste — é o passo que pode trancar o administrador para fora.
- **Não converte o CT 101** para não-privilegiado: mexe no mapeamento de UID do `/mnt/media`, a mesma armadilha que já custou tempo no CT 100 com SMB. Vai junto do plano do firewall.
- **Não renumera IDs** nem renomeia máquinas: renumerar exige restaurar cada uma sob outro ID e o ganho é estético. A faixa nova vale para máquinas novas e para as que já forem reconstruídas por outro motivo.
- **Não restringe o storage `media`**: depende de confirmar que nada mais grava ali.
- **Não aplica reservas de DHCP**: exige acesso à interface da Vivo Box, que é trabalho manual do Matheus, não de script.
