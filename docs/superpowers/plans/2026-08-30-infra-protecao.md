# Infraestrutura — Plano 2: Proteção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar o backup do alcance da rede da casa, tornar visível quando ele falhar, e dar ao Proxmox um firewall — sem tirar nada do ar.

**Architecture:** Três frentes. A primeira estreita o ponto de montagem do CT 100 para que ele veja apenas as pastas da família, e não o disco inteiro onde vivem os backups. A segunda torna a idade do backup mais recente um dado consultável, para que uma falha silenciosa deixe de ser silenciosa. A terceira liga o firewall do Proxmox com política de entrada fechada, administração só pela Tailscale, e uma regra de resgate aplicada antes de qualquer coisa.

**Tech Stack:** Proxmox VE 9.2.4 (`pct`, `pvesh`, firewall nativo), Samba em LXC, shell POSIX, git.

**Spec:** `docs/superpowers/specs/2026-08-30-infra-proxmox-design.md`
**Plano anterior:** `2026-08-30-infra-fundacao.md` (backup criado e provado)

## Global Constraints

- **O FloripaOT continua no ar durante todo este plano.** Portas 7171 e 7172 nunca fecham. Verificação: `nc -z -w5 192.168.15.10 7171`.
- **O Home Assistant continua no ar.** Verificação: `curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 http://192.168.15.8/` → `200`. Porta 80, não 8123.
- **O acesso administrativo não pode ser perdido.** A Tarefa 3 liga um firewall; se a regra de resgate não estiver ativa e verificada, ela não avança.
- Nenhuma VM ou container é apagado.
- Nenhum arquivo das pastas da família (`marcella`, `familia`, `matheus`) é apagado. Mover é permitido; apagar não.
- Senhas e tokens nunca em arquivo versionado. `$PVE_PASS` só na variável de ambiente: `read -rsp "senha do PVE: " PVE_PASS && export PVE_PASS && echo`
- Host Proxmox: `root@100.71.204.68` (Tailscale) e `192.168.15.200` (LAN). Repositório: `~/projetos/portal-casa`.
- Rede da casa: `192.168.15.0/24`, gateway `192.168.15.1`. Rede Tailscale: `100.64.0.0/10`.

---

### Task 1: Tirar o backup do alcance do compartilhamento

Hoje `mp0: /mnt/drive,mp=/dados` dá ao CT 100 o disco inteiro, e o destino de backup `/mnt/drive/dump` fica dentro da árvore que ele exporta por SMB. O diretório pai pertence ao root do container com modo 775 — e apagar um diretório depende de permissão no **pai**, não nele. O root do container, ou qualquer coisa que chegue nele pela rede, apaga o único backup da casa.

A correção estreita o ponto de montagem. Os caminhos **dentro** do container não mudam, então o Samba e todos os clientes continuam iguais.

**Files:**
- Modify (no host): `/etc/pve/lxc/100.conf` — via `pct set`, nunca à mão
- Create: `~/projetos/portal-casa/infra/backup/destino-protegido.md`

- [ ] **Step 1: Provar o risco antes de corrigir**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pct config 100 | grep -E "mp0|unprivileged"; ls -lan /mnt/drive/; ls -ld /mnt/drive/dump'
```

Esperado: `mp0: /mnt/drive,mp=/dados`; `/mnt/drive` com dono `101000` e modo `drwxrwxr-x`; `dump` dentro dele.

- [ ] **Step 2: Confirmar que o CT 100 está parado**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'pct status 100'
```

Esperado: `status: stopped`. **Se estiver rodando, pare-o** com `pct stop 100` e espere — mover diretórios com o Samba servindo em cima é pedir corrupção.

- [ ] **Step 3: Guardar a configuração atual**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'cp /etc/pve/lxc/100.conf /root/arquivo/100.conf.antes-de-estreitar-mp0 && cat /root/arquivo/100.conf.antes-de-estreitar-mp0'
```

- [ ] **Step 4: Criar a subpasta e mover as pastas da família, preservando dono e permissão**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  mkdir -p /mnt/drive/compartilhado
  chown 101000:101000 /mnt/drive/compartilhado
  chmod 775 /mnt/drive/compartilhado
  mv /mnt/drive/matheus /mnt/drive/marcella /mnt/drive/familia /mnt/drive/compartilhado/
  ls -lan /mnt/drive/ /mnt/drive/compartilhado/'
```

`mv` dentro do mesmo sistema de arquivos preserva dono, grupo e permissão, e não copia dado — é instantâneo mesmo com os 3,3 GB da Marcella.

- [ ] **Step 5: Apontar o ponto de montagem para a subpasta**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pct set 100 --mp0 /mnt/drive/compartilhado,mp=/dados && pct config 100 | grep mp0'
```

Esperado: `mp0: /mnt/drive/compartilhado,mp=/dados`.

- [ ] **Step 6: Provar que o container não enxerga mais os backups**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  pct start 100 && sleep 10
  echo "--- o que o container ve em /dados ---"
  pct exec 100 -- ls -la /dados
  echo "--- o dump esta visivel? (esperado: nao) ---"
  pct exec 100 -- ls -la /dados/dump 2>&1 | head -2'
```

Esperado: `/dados` mostra `matheus`, `marcella`, `familia` — e **`ls /dados/dump` falha com "No such file or directory"**. Esse erro é o objetivo da tarefa.

- [ ] **Step 7: Provar que o compartilhamento continua funcionando**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  pct exec 100 -- sh -c "grep -E \"path|^\\[\" /etc/samba/smb.conf | tail -12"
  pct exec 100 -- ls -la /dados/marcella /dados/familia /dados/matheus 2>&1 | head -20
  pct exec 100 -- systemctl is-active smbd'
```

Esperado: os três caminhos existem com o conteúdo de antes, e o `smbd` está `active`. **Se algum caminho sumiu, pare** — os clientes da casa quebrariam.

- [ ] **Step 8: Devolver o CT 100 ao estado em que estava**

Ele estava parado (`onboot: 0`, sobe sob demanda).

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'pct stop 100 && sleep 5 && pct status 100'
```

Esperado: `status: stopped`.

- [ ] **Step 9: Confirmar que os backups continuam lá e intactos**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'ls -lh /mnt/drive/dump/; pvesm status --storage drive'
```

Esperado: os dumps do CT 102 e da VM 111 presentes, storage `active`.

- [ ] **Step 10: Confirmar que nada saiu do ar**

```bash
nc -z -w5 192.168.15.10 7171 && echo "FloripaOT OK"
curl -s -o /dev/null -w "HA %{http_code}\n" --max-time 10 http://192.168.15.8/
```

- [ ] **Step 11: Registrar**

```bash
cat > ~/projetos/portal-casa/infra/backup/destino-protegido.md <<'EOF'
# O backup fora do alcance do compartilhamento

## O risco que existia

O CT 100 montava o disco inteiro (`mp0: /mnt/drive,mp=/dados`) e exporta essa
arvore por SMB. O destino de backup `/mnt/drive/dump` ficava dentro dela.

`/mnt/drive` pertencia ao root do container (uid 101000 no host) com modo 775.
Em Unix, apagar um diretorio depende de permissao no PAI, nao nele. Logo o root
do CT 100 — e qualquer coisa que chegasse nele pela rede — conseguia apagar o
unico backup da casa. O cenario concreto: ransomware num PC da casa com o
compartilhamento mapeado.

## A correcao

O ponto de montagem passou a ser `/mnt/drive/compartilhado`, e as pastas da
familia (`matheus`, `marcella`, `familia`) foram movidas para dentro dela.

Dentro do container os caminhos continuam `/dados/matheus`, `/dados/marcella`,
`/dados/familia` — identicos. **O smb.conf nao mudou e nenhum cliente da casa
precisou ser reconfigurado.**

`/mnt/drive/dump` ficou fora do que o container enxerga. Provado: dentro do CT
100, `ls /dados/dump` falha com "No such file or directory".

## Regra daqui em diante

Nenhum container monta `/mnt/drive` inteiro. Quem precisa de arquivo da familia
monta `/mnt/drive/compartilhado`. O `dump/` fica fora do alcance de qualquer
coisa que fale com a rede.

Config anterior guardada em /root/arquivo/100.conf.antes-de-estreitar-mp0.
EOF
cd ~/projetos/portal-casa && git add infra/backup/destino-protegido.md && \
  git commit -m "infra: backup fora do alcance do compartilhamento da casa"
```

---

### Task 2: Tornar visível quando o backup falhar

Não existe `notifications.cfg`, nem `mailto` no trabalho, nem alias de root no postfix. Se o trabalho das 03:00 falhar, o aviso morre em `/var/mail/root` e ninguém lê — o backup pode estar quebrado por semanas.

Em vez de montar uma cadeia de e-mail, esta tarefa torna a **idade do backup mais recente** consultável pelo mesmo caminho que o Home Assistant já usa para falar com o Proxmox: um verbo somente-leitura no wrapper de lista fechada.

**Files:**
- Modify (no host): `/usr/local/sbin/ha-pve-power`
- Create: `~/projetos/portal-casa/infra/backup/monitoramento.md`

**Interfaces:**
- Produces: o verbo `backup_age`, que devolve a idade em horas do dump mais recente. Consumido depois pelo Home Assistant e pelo portal.

- [ ] **Step 1: Ler o wrapper e entender a estrutura antes de tocar**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'cat /usr/local/sbin/ha-pve-power; echo "--- md5 antes ---"; md5sum /usr/local/sbin/ha-pve-power'
```

Anote o md5. Anote como o script recebe o comando (`SSH_ORIGINAL_COMMAND`, não argv) e como valida verbo e alvo.

- [ ] **Step 2: Guardar cópia**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'cp /usr/local/sbin/ha-pve-power /root/arquivo/ha-pve-power.antes-do-backup-age && echo guardado'
```

- [ ] **Step 3: Provar que o verbo ainda não existe**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'SSH_ORIGINAL_COMMAND="backup_age" /usr/local/sbin/ha-pve-power; echo "saida: $?"'
```

Esperado: recusa, porque o verbo não está na lista.

- [ ] **Step 4: Acrescentar o verbo, sem alterar nada do que já existe**

O verbo é somente leitura: encontra o dump mais recente em `/mnt/drive/dump/` e imprime a idade em horas inteiras. Sem dump nenhum, imprime `-1` — que o consumidor trata como "nunca houve backup", diferente de "backup velho".

Preserve a estrutura do script existente: acrescente `backup_age` à validação de verbos e o bloco que o executa, no mesmo estilo do que já está lá. **Não altere nenhum verbo ou alvo existente.**

Lógica a implementar:

```sh
# backup_age: idade em horas do dump mais recente; -1 se nao houver nenhum.
recente=$(ls -t /mnt/drive/dump/*.vma.zst /mnt/drive/dump/*.tar.zst 2>/dev/null | head -1)
if [ -z "$recente" ]; then
  echo -1
else
  echo $(( ( $(date +%s) - $(stat -c %Y "$recente") ) / 3600 ))
fi
```

- [ ] **Step 5: Checar a sintaxe antes de executar**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'sh -n /usr/local/sbin/ha-pve-power && echo "sintaxe OK"; ls -la /usr/local/sbin/ha-pve-power'
```

Esperado: `sintaxe OK`. Permissão e dono inalterados.

- [ ] **Step 6: Provar que o verbo novo funciona**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'SSH_ORIGINAL_COMMAND="backup_age" /usr/local/sbin/ha-pve-power; echo "saida: $?"'
```

Esperado: um número de horas (hoje algo pequeno, os dumps são de hoje) e saída `0`.

- [ ] **Step 7: Provar que os verbos antigos continuam funcionando**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  SSH_ORIGINAL_COMMAND="status ct:100" /usr/local/sbin/ha-pve-power; echo "status ct:100 -> $?"
  SSH_ORIGINAL_COMMAND="status vm:110" /usr/local/sbin/ha-pve-power; echo "status vm:110 -> $?"
  SSH_ORIGINAL_COMMAND="rm -rf /"      /usr/local/sbin/ha-pve-power; echo "comando invalido -> $? (esperado: recusa)"'
```

Esperado: os dois `status` respondem; o comando inválido é **recusado**. Se ele não for recusado, isso é falha grave — reverta com a cópia do Step 2 e reporte.

- [ ] **Step 8: Confirmar que nada saiu do ar**

```bash
nc -z -w5 192.168.15.10 7171 && echo "FloripaOT OK"
curl -s -o /dev/null -w "HA %{http_code}\n" --max-time 10 http://192.168.15.8/
```

- [ ] **Step 9: Registrar**

```bash
cat > ~/projetos/portal-casa/infra/backup/monitoramento.md <<'EOF'
# Como se sabe que o backup falhou

O problema: nao ha notificacao de falha. Sem `notifications.cfg`, sem `mailto`
no job, e o postfix sem alias de root — um job que falha as 03:00 escreve em
/var/mail/root e ninguem le. O backup pode estar quebrado por semanas.

A solucao nao foi montar cadeia de e-mail, e sim tornar o dado consultavel pelo
caminho que o Home Assistant ja usa: um verbo somente-leitura no wrapper de
lista fechada.

## O verbo

    SSH_ORIGINAL_COMMAND="backup_age" /usr/local/sbin/ha-pve-power

Devolve a idade, em horas inteiras, do dump mais recente em /mnt/drive/dump/.
Devolve **-1** quando nao existe dump nenhum — que e diferente de "backup
velho" e o consumidor precisa tratar separado.

## Como consumir

O job roda diariamente as 03:00. Portanto:

- idade <= 30h  -> saudavel
- idade  > 30h  -> o job falhou ou nao rodou; investigar
- idade == -1   -> nunca houve backup; grave

O Home Assistant e o portal leem por aqui. Nao ha necessidade de servidor de
e-mail em lugar nenhum.

Copia do wrapper anterior em /root/arquivo/ha-pve-power.antes-do-backup-age.
EOF
cd ~/projetos/portal-casa && git add infra/backup/monitoramento.md && \
  git commit -m "infra: idade do backup consultavel pelo wrapper"
```

---

### Task 3: Firewall com regra de resgate

Hoje não existe nenhuma regra. Esta é a tarefa mais perigosa dos dois planos: firewall mal aplicado tranca o administrador para fora do próprio host.

A ordem é deliberada e **não pode ser alterada**: as regras de permissão entram **antes** de a política de entrada virar `DROP`, e o firewall do datacenter só é habilitado depois de as regras estarem escritas e conferidas.

**Files:**
- Create (no host): `/etc/pve/firewall/cluster.fw` — via `pvesh`, nunca à mão
- Create: `~/projetos/portal-casa/infra/host/firewall.md`

- [ ] **Step 1: Registrar o estado atual e o caminho de resgate**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  echo "--- firewall hoje ---"; ls -la /etc/pve/firewall/ 2>&1; cat /etc/pve/firewall/cluster.fw 2>&1
  echo "--- de onde eu falo com o host ---"; ip -br a | grep -E "vmbr0|tailscale"
  echo "--- quem esta conectado agora ---"; who; ss -tnp state established "( sport = :22 )" 2>/dev/null | head'
```

Esperado: nenhum `cluster.fw`, diretório vazio. Anote os endereços: o host é `192.168.15.200` na LAN e `100.71.204.68` na Tailscale.

- [ ] **Step 2: Armar o interruptor de homem morto**

Esta é a proteção que torna a tarefa segura: um trabalho agendado que **desliga o firewall sozinho** dali a 10 minutos. Se algo trancar o acesso, o problema se desfaz sem ninguém precisar chegar na máquina física.

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  cat > /root/resgate-firewall.sh <<"EOF"
#!/bin/sh
# Desliga o firewall do datacenter. Interruptor de homem morto:
# se a verificacao pos-mudanca nao cancelar este timer a tempo, ele dispara.
pvesh set /cluster/firewall/options --enable 0
logger -t resgate-firewall "firewall desligado pelo interruptor de homem morto"
EOF
  chmod 700 /root/resgate-firewall.sh
  systemd-run --on-active=10min --unit=resgate-firewall /root/resgate-firewall.sh
  systemctl list-timers resgate-firewall.timer --no-pager'
```

Esperado: o timer aparece, disparando em ~10 minutos.

**Se o `systemd-run` falhar, pare a tarefa.** Sem o interruptor armado, não se mexe no firewall.

O caminho de último recurso continua sendo o console físico da máquina, com `pvesh set /cluster/firewall/options --enable 0` — mas com o interruptor armado ele não deve ser necessário.

- [ ] **Step 3: Criar as regras de entrada ANTES de fechar a política**

Ordem obrigatória: primeiro tudo que é permissão, depois o fechamento.

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  # Administracao apenas pela Tailscale
  pvesh create /cluster/firewall/rules --type in --action ACCEPT --source 100.64.0.0/10 --dest 192.168.15.200 --proto tcp --dport 22   --comment "SSH pela Tailscale"
  pvesh create /cluster/firewall/rules --type in --action ACCEPT --source 100.64.0.0/10 --dest 192.168.15.200 --proto tcp --dport 8006 --comment "Interface do Proxmox pela Tailscale"
  # Trafego interno da casa entre maquinas
  pvesh create /cluster/firewall/rules --type in --action ACCEPT --source 192.168.15.0/24 --comment "LAN da casa"
  # Tailscale precisa falar consigo mesma
  pvesh create /cluster/firewall/rules --type in --action ACCEPT --proto udp --dport 41641 --comment "Tailscale"
  pvesh get /cluster/firewall/rules --output-format json'
```

**Confira a saída antes de seguir.** Se as quatro regras não estiverem lá, **pare**.

- [ ] **Step 4: Habilitar o firewall com a política ainda aberta**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pvesh set /cluster/firewall/options --enable 1 --policy_in ACCEPT && pvesh get /cluster/firewall/options --output-format json'
```

Com `policy_in ACCEPT` o firewall passa a valer sem bloquear nada. É o ensaio.

- [ ] **Step 5: Confirmar que TUDO continua acessível com o firewall ligado**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'echo "SSH pela Tailscale ainda funciona"'
nc -z -w5 192.168.15.10 7171 && echo "FloripaOT OK"
curl -s -o /dev/null -w "HA %{http_code}\n" --max-time 10 http://192.168.15.8/
curl -s -o /dev/null -w "Interface do Proxmox %{http_code}\n" -k --max-time 10 https://100.71.204.68:8006/
```

**Se qualquer um falhar, desligue o firewall imediatamente** (`pvesh set /cluster/firewall/options --enable 0`) e reporte.

- [ ] **Step 6: Fechar a política de entrada**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pvesh set /cluster/firewall/options --policy_in DROP && pvesh get /cluster/firewall/options --output-format json'
```

- [ ] **Step 7: A verificação que decide se isto fica de pé**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'echo "SSH pela Tailscale: OK"'
curl -s -o /dev/null -w "Proxmox pela Tailscale: %{http_code}\n" -k --max-time 10 https://100.71.204.68:8006/
nc -z -w5 192.168.15.10 7171 && echo "FloripaOT: OK"
nc -z -w5 192.168.15.10 7172 && echo "FloripaOT 7172: OK"
curl -s -o /dev/null -w "HA: %{http_code}\n" --max-time 10 http://192.168.15.8/
```

**Todos precisam passar.** Qualquer falha: `pvesh set /cluster/firewall/options --policy_in ACCEPT` na hora, e reporte — ou simplesmente deixe o interruptor de homem morto disparar.

- [ ] **Step 7b: Desarmar o interruptor — só depois de tudo passar**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  systemctl stop resgate-firewall.timer 2>/dev/null
  systemctl reset-failed resgate-firewall.timer 2>/dev/null
  systemctl list-timers resgate-firewall.timer --no-pager
  rm -f /root/resgate-firewall.sh
  pvesh get /cluster/firewall/options --output-format json'
```

Esperado: nenhum timer `resgate-firewall` listado, e o firewall ainda `enable: 1` com `policy_in: DROP`.

**Não faça este passo antes do Step 7 passar inteiro.** Desarmar cedo é jogar fora a rede de segurança justamente na hora em que ela serve.

- [ ] **Step 8: Confirmar que o firewall das VMs continua desligado**

O firewall do datacenter é o que acabou de ser ligado. Cada VM e container tem o seu próprio, e ligá-los é outro trabalho — se ligarem sozinhos, as máquinas ficam sem rede.

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'grep -H "^firewall" /etc/pve/qemu-server/*.conf /etc/pve/lxc/*.conf 2>/dev/null; grep -H "firewall=" /etc/pve/qemu-server/*.conf /etc/pve/lxc/*.conf 2>/dev/null'
```

Anote quais têm `firewall=1` na interface de rede. Não altere nenhum nesta tarefa.

- [ ] **Step 9: Registrar**

```bash
cat > ~/projetos/portal-casa/infra/host/firewall.md <<'EOF'
# Firewall do Proxmox

Antes deste trabalho nao havia NENHUMA regra: os servicos rodavam e
/etc/pve/firewall/ estava vazio.

## O desenho

Politica de entrada padrao DROP no datacenter. Sobre ela:

| Regra | Origem | Porta | Por que |
|-------|--------|-------|---------|
| SSH | 100.64.0.0/10 (Tailscale) | 22 | administracao nunca pela internet |
| Interface PVE | 100.64.0.0/10 (Tailscale) | 8006 | idem |
| LAN da casa | 192.168.15.0/24 | todas | maquinas da casa falam entre si |
| Tailscale | qualquer | udp 41641 | a propria Tailscale precisa entrar |

O trafego de jogo (7171/7172 do FloripaOT, 450/5555 do Dofus) chega nas VMs e
containers, nao no host — e o firewall das maquinas continua desligado, entao
esse trafego nao passa por regra nenhuma aqui.

## A ordem importa

Foi aplicado nesta ordem, e repetir exige a mesma:

1. criar as regras de ACCEPT
2. habilitar o firewall com policy_in ACCEPT (ensaio, nada bloqueia)
3. verificar que tudo responde
4. so entao policy_in DROP
5. verificar de novo

Inverter isso tranca o administrador para fora.

## Resgate

Durante a aplicacao foi armado um interruptor de homem morto: um
`systemd-run --on-active=10min` que desligava o firewall sozinho se a
verificacao nao o cancelasse a tempo. Repetir este trabalho exige rearma-lo.

Ultimo recurso, pelo console fisico da maquina:

    pvesh set /cluster/firewall/options --enable 0

## O que NAO foi feito

O firewall por VM/container continua desligado. Liga-lo e outro trabalho: cada
maquina precisa das proprias regras antes, ou fica sem rede.
EOF
cd ~/projetos/portal-casa && git add infra/host/firewall.md && \
  git commit -m "infra: firewall do datacenter com administracao so pela Tailscale"
```

---

## O que este plano deliberadamente NÃO faz

- **Não liga o firewall por VM ou container.** Cada máquina precisa das próprias regras antes, ou perde a rede.
- **Não migra o FloripaOT** nem converte o CT 101 — Plano 3.
- **Não monta cadeia de e-mail.** A idade do backup fica consultável; quem alerta é o Home Assistant.
- **Não resolve a lista `vmid` estática** do trabalho de backup.
- **Não toca no Cloudflare.** Depende de um domínio que o dono ainda não registrou.
