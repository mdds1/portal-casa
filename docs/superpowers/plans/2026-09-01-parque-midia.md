# Melhorias no parque de midia — plano de implementacao

> **Para trabalhadores agenticos:** SUB-SKILL OBRIGATORIA: use
> superpowers:subagent-driven-development (recomendado) ou
> superpowers:executing-plans para implementar tarefa a tarefa. Os passos usam
> caixas (`- [ ]`) para acompanhamento.

**Objetivo:** garantir que o Jellyfin tenha backup, que o backup semanal nao falhe
em silencio, que as atualizacoes do Proxmox sejam vistas, e que os 4K parem de
travar.

**Arquitetura:** scripts POSIX shell no host Proxmox, disparados por systemd timers
com `Persistent=true` (o host fica desligado em horarios irregulares e nada pode
depender dele estar ligado num instante especifico). Os scripts vivem versionados em
`infra/host/` no repositorio e sao copiados para `/usr/local/sbin/` no host. O Home
Assistant le resultados pelo wrapper de lista fechada que ja existe.

**Ferramentas:** shell POSIX (`/bin/sh`, o host tem dash), systemd, `pvesh`,
`vzdump`, `pct`, `qm`, Docker Compose v2, `command_line` do Home Assistant.

## Restricoes globais

- Alterar o job de backup **sempre** por `pvesh create/set /cluster/backup`, nunca
  editando `/etc/pve/jobs.cfg` a mao. (Regra herdada de `infra/backup/job.md`.)
- Nenhum script usa `|| true` para engolir codigo de saida. `|| true` ja escondeu
  falha de acao no portal.
- Todo script falha com codigo diferente de zero e mensagem em stderr dizendo o que
  faltou.
- Copia nova de script vai para `/root/arquivo/`, **nunca** para o PATH de root.
  (Regra herdada de `infra/host/usr-local-sbin.md`.)
- A VM 110 fica fora do backup por decisao registrada: e bancada, sem proposito de
  producao.
- Identidade do Git: `mdds.kd@gmail.com`, nome `Matheus`.
- Nenhuma tarefa faz backup de `/mnt/media`. Decisao do dono, registrada no spec.
- Acesso ao host: `sshpass -e ssh root@100.71.204.68` com `SSHPASS` no ambiente.

## Estrutura de arquivos

    infra/host/verifica-backup              script: quem esta fora do backup
    infra/host/verifica-backup.excecoes     lista de exclusoes deliberadas
    infra/host/backup-casa                  script: dispara o vzdump semanal
    infra/host/backup-casa.service          unidade systemd
    infra/host/backup-casa.timer            timer sexta 01:00, Persistent=true
    infra/host/verifica-atualizacoes        script: pacotes do host, dos guests, imagens
    infra/host/verifica-atualizacoes.service
    infra/host/verifica-atualizacoes.timer  timer sexta 01:00, Persistent=true
    infra/host/ha-pve-power                 wrapper (MODIFICAR: verbo updates, tirar ct:101)
    infra/midia/media-stack-update          script: atualiza a stack com rollback
    infra/midia/compose-gitignore           conteudo do .gitignore do media-stack
    infra/midia/parque-midia.md             runbook
    infra/backup/job.md                     (MODIFICAR: diario -> semanal)
    infra/host/usr-local-sbin.md            (MODIFICAR: lista de scripts e alvos)

---

### Tarefa 1: Verificador de cobertura de backup

**Arquivos:**
- Criar: `infra/host/verifica-backup`
- Criar: `infra/host/verifica-backup.excecoes`

**Interfaces:**
- Produz: `/usr/local/sbin/verifica-backup`. Sem argumentos. Codigo 0 e saida vazia
  quando todo guest esta coberto; codigo 1 e uma linha por guest descoberto no
  formato `<vmid> <nome> sem backup` quando falta alguem. Le exclusoes de
  `/etc/verifica-backup.excecoes`.

- [ ] **Passo 1: escrever o script**

Criar `infra/host/verifica-backup`:

```sh
#!/bin/sh
# Reporta guests do Proxmox que nao estao em nenhum trabalho de backup.
#
# Por que existe: a lista `vmid` do job e estatica. Em 30/08/2026 o Jellyfin
# migrou do CT 101 para o CT 201 e o job continuou apontando para o 101 — o
# container vivo ficou dois dias sem backup e nada avisou.
#
# Exclusoes deliberadas vivem em /etc/verifica-backup.excecoes, um vmid por
# linha, `#` comenta. Sem esse arquivo o alerta viraria ruido permanente por
# causa da VM 110 (bancada), e ruido permanente se aprende a ignorar.
set -eu

EXCECOES=${EXCECOES:-/etc/verifica-backup.excecoes}

# vmids cobertos por qualquer trabalho de backup, um por linha.
cobertos() {
  pvesh get /cluster/backup --output-format json 2>/dev/null \
    | tr ',' '\n' \
    | sed -n 's/.*"vmid" *: *"\([0-9,]*\)".*/\1/p' \
    | tr ',' '\n' \
    | grep -E '^[0-9]+$' || true
}

# vmids excluidos de proposito, um por linha.
excluidos() {
  [ -f "$EXCECOES" ] || return 0
  sed 's/#.*//' "$EXCECOES" | grep -E '^[0-9]+$' || true
}

lista_cobertos=$(cobertos)
lista_excluidos=$(excluidos)
faltando=0

pvesh get /cluster/resources --type vm --output-format json 2>/dev/null \
  | tr '{' '\n' \
  | while IFS= read -r linha; do
      vmid=$(printf '%s' "$linha" | sed -n 's/.*"vmid" *: *\([0-9]*\).*/\1/p')
      [ -n "$vmid" ] || continue
      nome=$(printf '%s' "$linha" | sed -n 's/.*"name" *: *"\([^"]*\)".*/\1/p')
      printf '%s\t%s\n' "$vmid" "${nome:-sem-nome}"
    done > /tmp/verifica-backup.guests.$$

while IFS="$(printf '\t')" read -r vmid nome; do
  if printf '%s\n' "$lista_cobertos" | grep -qx "$vmid"; then continue; fi
  if printf '%s\n' "$lista_excluidos" | grep -qx "$vmid"; then continue; fi
  echo "$vmid $nome sem backup"
  faltando=1
done < /tmp/verifica-backup.guests.$$

rm -f /tmp/verifica-backup.guests.$$
exit $faltando
```

- [ ] **Passo 2: escrever o arquivo de excecoes**

Criar `infra/host/verifica-backup.excecoes`:

```
# Guests deliberadamente fora do backup. Um vmid por linha.
# Cada linha precisa de um motivo — excecao sem motivo vira excecao esquecida.

# VM 110 (tfs-server): bancada de desenvolvimento, sem proposito de producao.
# A producao do FloripaOT e a VM 301, que esta coberta.
110
```

- [ ] **Passo 3: instalar no host**

```bash
export SSHPASS='<senha do root do pve>'
H="sshpass -e ssh -o StrictHostKeyChecking=no root@100.71.204.68"
sshpass -e scp -o StrictHostKeyChecking=no infra/host/verifica-backup root@100.71.204.68:/usr/local/sbin/verifica-backup
sshpass -e scp -o StrictHostKeyChecking=no infra/host/verifica-backup.excecoes root@100.71.204.68:/etc/verifica-backup.excecoes
$H "chmod 750 /usr/local/sbin/verifica-backup"
```

- [ ] **Passo 4: verificar que ele nao acusa nada agora**

```bash
$H "/usr/local/sbin/verifica-backup; echo codigo=\$?"
```

Esperado: saida vazia e `codigo=0` **depois** que a Tarefa 2 incluir o 201. Antes
dela, esperado: `201 jellyfin sem backup` e `codigo=1`. Essa e a primeira prova de
que ele funciona — ele precisa acusar o defeito que ja existe.

- [ ] **Passo 5: provar que ele acusa uma maquina nova (teste por mutacao)**

```bash
$H "pct create 999 local:vztmpl/\$(ls /var/lib/vz/template/cache | head -1) \
      --hostname teste-verificador --rootfs local-lvm:1 --memory 256 --unprivileged 1"
$H "/usr/local/sbin/verifica-backup; echo codigo=\$?"
```

Esperado: `999 teste-verificador sem backup` e `codigo=1`.

Se sair vazio, o verificador nao serve: ele so sabe concordar. Nesse caso, depurar
antes de seguir.

- [ ] **Passo 6: limpar o teste**

```bash
$H "pct destroy 999 --purge 1"
$H "/usr/local/sbin/verifica-backup; echo codigo=\$?"
```

Esperado: volta ao resultado do Passo 4.

- [ ] **Passo 7: provar que a excecao funciona**

```bash
$H "sed -i 's/^110$/# 110 desativada para teste/' /etc/verifica-backup.excecoes"
$H "/usr/local/sbin/verifica-backup; echo codigo=\$?"
```

Esperado: `110 tfs-server sem backup` e `codigo=1` — a excecao e o que a silencia.

```bash
$H "sed -i 's/^# 110 desativada para teste$/110/' /etc/verifica-backup.excecoes"
```

- [ ] **Passo 8: commit**

```bash
git add infra/host/verifica-backup infra/host/verifica-backup.excecoes
git commit -m "infra: verificador de cobertura de backup"
```

---

### Tarefa 2: Backup semanal que sobrevive a maquina desligada

**Arquivos:**
- Criar: `infra/host/backup-casa`
- Criar: `infra/host/backup-casa.service`
- Criar: `infra/host/backup-casa.timer`
- Modificar: `infra/backup/job.md`

**Interfaces:**
- Consome: `/usr/local/sbin/verifica-backup` da Tarefa 1.
- Produz: `/usr/local/sbin/backup-casa`, sem argumentos, codigo 0 quando o vzdump
  termina bem. Timer `backup-casa.timer` em `Fri 01:00` com `Persistent=true`.

**Contexto que o implementador precisa:** o agendador interno do Proxmox nao
recupera execucao perdida. O host ficou desligado 03:26-12:23 em 01/09,
00:03-18:40 em 28/08 e 23:47-07:14 em 26/08, sem agendamento — e desligamento
manual. Um backup semanal no agendador do Proxmox poderia passar semanas sem rodar
e ninguem veria. `Persistent=true` do systemd resolve: a tarefa perdida roda no
boot seguinte.

- [ ] **Passo 1: desativar o agendamento interno, mantendo a definicao**

O job continua existindo (e dele que sai a lista `vmid` e a retencao), mas deixa de
disparar sozinho:

```bash
$H "pvesh set /cluster/backup/casa-diario --enabled 0"
$H "pvesh get /cluster/backup --output-format text"
```

Esperado: o job aparece com `enabled: 0`.

- [ ] **Passo 2: incluir o 201 e ajustar a retencao para semanal**

```bash
$H "pvesh set /cluster/backup/casa-diario \
     --vmid 100,102,104,111,120,201,301 \
     --prune-backups keep-weekly=4,keep-monthly=2 \
     --comment 'Parque da casa. Disparado por backup-casa.timer, nao pelo agendador do PVE. VM 110 (bancada) fora de proposito.'"
$H "grep -E 'vmid|prune|enabled' /etc/pve/jobs.cfg"
```

Esperado: `vmid 100,102,104,111,120,201,301`, `prune-backups keep-weekly=4,keep-monthly=2`,
`enabled 0`.

- [ ] **Passo 3: confirmar que o verificador ficou satisfeito**

```bash
$H "/usr/local/sbin/verifica-backup; echo codigo=\$?"
```

Esperado: saida vazia, `codigo=0`. Esta e a prova de que a Tarefa 1 media a coisa
certa.

- [ ] **Passo 4: escrever o script de backup**

Criar `infra/host/backup-casa`:

```sh
#!/bin/sh
# Executa o trabalho de backup `casa-diario` e reporta o resultado.
#
# Por que nao usamos o agendador do Proxmox: ele nao recupera execucao
# perdida, e este host fica desligado em horarios irregulares. Com backup
# semanal isso significaria semanas sem copia, em silencio. O systemd timer
# que chama este script usa Persistent=true e roda no boot seguinte.
set -eu

RELATORIO=/var/lib/portal/backup-casa.txt
mkdir -p "$(dirname "$RELATORIO")"

inicio=$(date '+%Y-%m-%d %H:%M:%S')

if vzdump --job-id casa-diario >/tmp/backup-casa.log 2>&1; then
  resultado=ok
  codigo=0
else
  codigo=$?
  resultado="FALHOU (codigo $codigo)"
fi

{
  echo "ultima execucao: $inicio"
  echo "resultado: $resultado"
  echo "--- ultimas linhas ---"
  tail -n 20 /tmp/backup-casa.log
} > "$RELATORIO"

# Guests sem cobertura entram no mesmo relatorio: backup que roda direito mas
# esquece uma maquina falha do mesmo jeito, so que sem erro.
if descobertos=$(/usr/local/sbin/verifica-backup); then
  :
else
  {
    echo "--- guests SEM backup ---"
    printf '%s\n' "$descobertos"
  } >> "$RELATORIO"
fi

exit "$codigo"
```

- [ ] **Passo 5: escrever a unidade systemd**

Criar `infra/host/backup-casa.service`:

```ini
[Unit]
Description=Backup semanal do parque da casa
After=pve-guests.service network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/backup-casa
```

Criar `infra/host/backup-casa.timer`:

```ini
[Unit]
Description=Backup semanal — sexta 01:00, ou no proximo boot se a maquina estava desligada

[Timer]
OnCalendar=Fri 01:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
```

`Persistent=true` e o motivo de tudo isto existir: sem ele, sexta-feira com a
maquina desligada e uma semana sem backup.

- [ ] **Passo 6: instalar e ativar**

```bash
sshpass -e scp -o StrictHostKeyChecking=no infra/host/backup-casa root@100.71.204.68:/usr/local/sbin/backup-casa
sshpass -e scp -o StrictHostKeyChecking=no infra/host/backup-casa.service infra/host/backup-casa.timer root@100.71.204.68:/etc/systemd/system/
$H "chmod 750 /usr/local/sbin/backup-casa && systemctl daemon-reload && systemctl enable --now backup-casa.timer"
$H "systemctl list-timers backup-casa.timer --all"
```

Esperado: o timer aparece com o proximo disparo numa sexta as 01:00.

- [ ] **Passo 7: rodar uma vez de verdade**

```bash
$H "systemctl start backup-casa.service && cat /var/lib/portal/backup-casa.txt"
```

Esperado: `resultado: ok` e nenhuma secao `guests SEM backup`.

- [ ] **Passo 8: provar a recuperacao de execucao perdida (teste por mutacao)**

Este e o passo que prova o ponto inteiro da tarefa. `Persistent=true` guarda a
ultima execucao num carimbo em disco; apagar o carimbo e recuar a data faz o systemd
acreditar que perdeu a janela.

```bash
$H "systemctl stop backup-casa.timer"
$H "rm -f /var/lib/systemd/timers/stamp-backup-casa.timer"
$H "systemctl start backup-casa.timer && systemctl list-timers backup-casa.timer --all"
```

Esperado: o campo `LEFT` mostra que ele quer disparar **imediatamente** (ou em
segundos), nao na proxima sexta — porque entende que perdeu a janela anterior.

Se ele mostrar a proxima sexta, `Persistent=true` nao esta valendo e a tarefa nao
cumpriu seu proposito. Depurar antes de seguir.

- [ ] **Passo 9: provar que a falha aparece no relatorio (teste por mutacao)**

```bash
$H "pvesh set /cluster/backup/casa-diario --storage inexistente" 2>&1 || echo "recusado pelo PVE, use o metodo alternativo abaixo"
```

Se o PVE recusar um storage invalido, force a falha desmontando o alvo:

```bash
$H "mv /mnt/drive/dump /mnt/drive/dump-teste && systemctl start backup-casa.service; echo codigo=\$?; cat /var/lib/portal/backup-casa.txt"
$H "mv /mnt/drive/dump-teste /mnt/drive/dump"
```

Esperado: `codigo` diferente de zero e `resultado: FALHOU` no relatorio. Um
relatorio que so sabe dizer `ok` nao vale nada.

- [ ] **Passo 10: atualizar a documentacao**

Em `infra/backup/job.md`, trocar o titulo e a descricao de diario para semanal,
registrar que o disparo saiu do agendador do PVE, e **remover das pendencias** os
dois itens que esta tarefa fechou: "Lista `vmid` e estatica" (Tarefa 1) e a parte
da notificacao coberta pelo relatorio. Manter a pendencia de notificacao ativa por
e-mail, que continua aberta.

- [ ] **Passo 11: commit**

```bash
git add infra/host/backup-casa infra/host/backup-casa.service infra/host/backup-casa.timer infra/backup/job.md
git commit -m "infra: backup semanal por systemd timer, com recuperacao de execucao perdida"
```

---

### Tarefa 3: IP fixo e mais nucleos para o Jellyfin

**Arquivos:**
- Modificar: configuracao do CT 201 no host (nao ha arquivo no repositorio)
- Modificar: `infra/host/ct-201-jellyfin.md`

**Interfaces:** nenhuma. Tarefa isolada.

- [ ] **Passo 1: registrar o estado atual**

```bash
$H "pct config 201 | grep -E 'net0|cores|memory'"
```

Esperado: `net0: ...,ip=dhcp,...` e `cores: 2`. Anotar a saida — e o ponto de volta.

- [ ] **Passo 2: fixar o IP**

O `.15` e o endereco que o DHCP ja vinha entregando, entao nada que aponta para ele
quebra:

```bash
$H "pct set 201 --net0 name=eth0,bridge=vmbr0,hwaddr=BC:24:11:C0:32:06,ip=192.168.15.15/24,gw=192.168.15.1,type=veth"
```

- [ ] **Passo 3: subir para 6 nucleos**

O host tem 12 nucleos e a memoria e que esta apertada (18,5 GB alocados para 15 GB
fisicos), por isso a RAM nao muda:

```bash
$H "pct set 201 --cores 6"
```

- [ ] **Passo 4: reiniciar e conferir**

```bash
$H "pct reboot 201"
$H "pct exec 201 -- sh -c 'ip -4 addr show eth0 | grep inet; nproc'"
```

Esperado: `inet 192.168.15.15/24` e `6`.

- [ ] **Passo 5: confirmar que o Jellyfin responde no endereco fixo**

```bash
$H "curl -s -o /dev/null -w '%{http_code}\n' -m 10 http://192.168.15.15:8096/health"
```

Esperado: `200`.

- [ ] **Passo 6: documentar**

Em `infra/host/ct-201-jellyfin.md`, acrescentar uma secao registrando o IP fixo, o
motivo (DHCP sem reserva ja quebrou o desligamento do PC da Marcella em silencio) e
os 6 nucleos com a justificativa de CPU x memoria.

- [ ] **Passo 7: commit**

```bash
git add infra/host/ct-201-jellyfin.md
git commit -m "infra: Jellyfin com IP fixo e 6 nucleos"
```

---

### Tarefa 4: Verificador de atualizacoes do Proxmox inteiro

**Arquivos:**
- Criar: `infra/host/verifica-atualizacoes`
- Criar: `infra/host/verifica-atualizacoes.service`
- Criar: `infra/host/verifica-atualizacoes.timer`
- Modificar: `infra/host/ha-pve-power`
- Modificar: `infra/host/usr-local-sbin.md`

**Interfaces:**
- Produz: `/usr/local/sbin/verifica-atualizacoes`, sem argumentos, escreve
  `/var/lib/portal/atualizacoes.txt` e sai com 0.
- Produz: verbo `updates` no wrapper, sem argumento, que imprime o relatorio.

- [ ] **Passo 1: escrever o verificador**

Criar `infra/host/verifica-atualizacoes`:

```sh
#!/bin/sh
# Relatorio de atualizacoes pendentes no parque inteiro: pacotes do host,
# pacotes de cada guest ligado, e imagens Docker do CT 102.
#
# Regra central: maquina desligada e reportada como "nao verificada", NUNCA
# como "sem atualizacoes". Silencio nao pode ser confundido com boa noticia —
# foi assim que o Jellyfin passou dois dias sem backup sem ninguem ver.
set -eu

RELATORIO=/var/lib/portal/atualizacoes.txt
mkdir -p "$(dirname "$RELATORIO")"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

echo "verificado em: $(date '+%Y-%m-%d %H:%M:%S')" > "$TMP"

# --- host ---
apt-get update -qq >/dev/null 2>&1 || echo "host pve: falha ao consultar repositorios" >> "$TMP"
n=$(apt-get -s upgrade 2>/dev/null | grep -c '^Inst ' || true)
echo "host pve: $n pacote(s)" >> "$TMP"

# --- guests ---
for vmid in $(pct list 2>/dev/null | awk 'NR>1 {print $1}'); do
  nome=$(pct config "$vmid" 2>/dev/null | sed -n 's/^hostname: //p')
  estado=$(pct status "$vmid" | awk '{print $2}')
  if [ "$estado" != "running" ]; then
    echo "ct $vmid ($nome): nao verificado (desligado)" >> "$TMP"
    continue
  fi
  if pct exec "$vmid" -- sh -c 'command -v apt-get' >/dev/null 2>&1; then
    pct exec "$vmid" -- apt-get update -qq >/dev/null 2>&1 || true
    n=$(pct exec "$vmid" -- sh -c "apt-get -s upgrade 2>/dev/null | grep -c '^Inst '" 2>/dev/null || echo 0)
    echo "ct $vmid ($nome): $n pacote(s)" >> "$TMP"
  else
    echo "ct $vmid ($nome): nao verificado (sem apt)" >> "$TMP"
  fi
done

for vmid in $(qm list 2>/dev/null | awk 'NR>1 {print $1}'); do
  nome=$(qm config "$vmid" 2>/dev/null | sed -n 's/^name: //p')
  estado=$(qm status "$vmid" | awk '{print $2}')
  if [ "$estado" != "running" ]; then
    echo "vm $vmid ($nome): nao verificado (desligado)" >> "$TMP"
  else
    echo "vm $vmid ($nome): nao verificado (sem canal de shell)" >> "$TMP"
  fi
done

# --- imagens Docker do CT 102 ---
if [ "$(pct status 102 | awk '{print $2}')" = "running" ]; then
  pendentes=0
  for img in $(pct exec 102 -- docker ps --format '{{.Image}}' 2>/dev/null | sort -u); do
    local_id=$(pct exec 102 -- docker image inspect --format '{{.Id}}' "$img" 2>/dev/null || echo "")
    pct exec 102 -- docker pull -q "$img" >/dev/null 2>&1 || continue
    novo_id=$(pct exec 102 -- docker image inspect --format '{{.Id}}' "$img" 2>/dev/null || echo "")
    if [ -n "$local_id" ] && [ -n "$novo_id" ] && [ "$local_id" != "$novo_id" ]; then
      echo "imagem $img: atualizacao disponivel" >> "$TMP"
      pendentes=$((pendentes + 1))
    fi
  done
  echo "imagens Docker: $pendentes com atualizacao" >> "$TMP"
else
  echo "imagens Docker: nao verificado (CT 102 desligado)" >> "$TMP"
fi

cp "$TMP" "$RELATORIO"
cat "$RELATORIO"
```

- [ ] **Passo 2: escrever as unidades systemd**

Criar `infra/host/verifica-atualizacoes.service`:

```ini
[Unit]
Description=Relatorio de atualizacoes pendentes no parque
After=pve-guests.service network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/verifica-atualizacoes
```

Criar `infra/host/verifica-atualizacoes.timer`:

```ini
[Unit]
Description=Verificacao semanal de atualizacoes — sexta 01:00, ou no proximo boot

[Timer]
OnCalendar=Fri 01:00
Persistent=true
RandomizedDelaySec=900

[Install]
WantedBy=timers.target
```

`RandomizedDelaySec` maior que o do backup para os dois nao disputarem disco quando
caem no mesmo boot.

- [ ] **Passo 3: instalar e rodar uma vez**

```bash
sshpass -e scp -o StrictHostKeyChecking=no infra/host/verifica-atualizacoes root@100.71.204.68:/usr/local/sbin/verifica-atualizacoes
sshpass -e scp -o StrictHostKeyChecking=no infra/host/verifica-atualizacoes.service infra/host/verifica-atualizacoes.timer root@100.71.204.68:/etc/systemd/system/
$H "chmod 750 /usr/local/sbin/verifica-atualizacoes && systemctl daemon-reload && systemctl enable --now verifica-atualizacoes.timer"
$H "/usr/local/sbin/verifica-atualizacoes"
```

Esperado: uma linha por alvo, com contagens para os ligados e `nao verificado` para
os desligados.

- [ ] **Passo 4: provar a regra do silencio (teste por mutacao)**

```bash
$H "pct stop 102"
$H "/usr/local/sbin/verifica-atualizacoes | grep -E 'ct 102|imagens Docker'"
```

Esperado: `ct 102 (Docker): nao verificado (desligado)` e
`imagens Docker: nao verificado (CT 102 desligado)`.

Se aparecer `0 pacote(s)` ou `0 com atualizacao`, o script esta transformando
silencio em boa noticia — que e exatamente o defeito que ele existe para evitar.
Corrigir antes de seguir.

```bash
$H "pct start 102"
```

- [ ] **Passo 5: acrescentar o verbo ao wrapper**

Em `infra/host/ha-pve-power`, logo apos o bloco `backup_age` (que ja e o precedente
de verbo somente-leitura sem alvo), inserir:

```sh
# updates: relatorio de atualizacoes pendentes, gerado pelo timer semanal.
# Somente leitura, sem alvo -- tratado antes do parse de TYPE/ACTION/ID.
if [ "$ORIG" = "updates" ]; then
  if [ -f /var/lib/portal/atualizacoes.txt ]; then
    cat /var/lib/portal/atualizacoes.txt
  else
    echo "nunca verificado"
  fi
  exit 0
fi
```

Na mesma edicao, **remover `ct:101` da lista fechada** — o container foi destruido
em 01/09 e alvo inexistente na lista e convite a confusao. A linha passa de:

```sh
  vm:110|vm:120|vm:301|ct:100|ct:101|ct:102|ct:104|ct:201) ;;
```

para:

```sh
  vm:110|vm:120|vm:301|ct:100|ct:102|ct:104|ct:201) ;;
```

- [ ] **Passo 6: instalar o wrapper e testar pelos dois lados**

```bash
sshpass -e scp -o StrictHostKeyChecking=no infra/host/ha-pve-power root@100.71.204.68:/usr/local/sbin/ha-pve-power
$H "chmod 700 /usr/local/sbin/ha-pve-power"
$H "SSH_ORIGINAL_COMMAND=updates /usr/local/sbin/ha-pve-power | head -3"
$H "SSH_ORIGINAL_COMMAND='ct status 101' /usr/local/sbin/ha-pve-power; echo codigo=\$?"
```

Esperado: o primeiro imprime o relatorio; o segundo imprime `denied` com
`codigo=3`. O segundo prova que a lista fechada continua fechada depois da edicao —
mexer numa lista de permissao sem testar a recusa e como nao ter lista.

- [ ] **Passo 7: sensor no Home Assistant**

Fazer backup e acrescentar ao `command_line` do
`/mnt/data/supervisor/homeassistant/configuration.yaml`:

```yaml
  - sensor:
      name: "Atualizacoes pendentes"
      unique_id: parque_atualizacoes_pendentes
      command: 'ssh -i /config/.ssh/ha_proxmox_power -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/config/.ssh/known_hosts root@192.168.15.200 "updates" | grep -cE "pacote\(s\)|atualizacao disponivel" || echo 0'
      scan_interval: 21600
```

Rodar `ha core check` **antes** de `ha core restart`, sempre.

Testar o comando dentro do container do core, nao no shell do HA OS — sao ambientes
diferentes, e testar no lugar errado ja levou a descartar uma solucao correta:

```bash
$H "pct exec 111 -- true" 2>/dev/null || true
# o HA e VM: use o ha-exec do repositorio canary para o shell do HAOS
echo 'docker exec homeassistant sh -c "ssh -i /config/.ssh/ha_proxmox_power -o BatchMode=yes root@192.168.15.200 updates | head -3"' | ha-exec
```

- [ ] **Passo 8: documentar**

Em `infra/host/usr-local-sbin.md`, acrescentar `verifica-backup`, `backup-casa` e
`verifica-atualizacoes` a lista de scripts permitidos, registrar o verbo `updates`
na lista fechada e **corrigir a lista de alvos**, que ainda cita `ct:101`.

- [ ] **Passo 9: commit**

```bash
git add infra/host/verifica-atualizacoes infra/host/verifica-atualizacoes.service infra/host/verifica-atualizacoes.timer infra/host/ha-pve-power infra/host/usr-local-sbin.md
git commit -m "infra: verificacao semanal de atualizacoes do parque e verbo updates no wrapper"
```

---

### Tarefa 5: Atualizador da stack com rollback

**Arquivos:**
- Criar: `infra/midia/media-stack-update`

**Interfaces:**
- Produz: `/usr/local/sbin/media-stack-update` dentro do CT 102. Sem argumentos.
  Codigo 0 quando tudo subiu e respondeu; codigo 1 quando houve rollback.

- [ ] **Passo 1: escrever o script**

Criar `infra/midia/media-stack-update`:

```sh
#!/bin/sh
# Atualiza a stack de midia e desfaz sozinho se algum servico nao responder.
#
# Por que nao Watchtower: atualizacao automatica sem rollback quebra em
# silencio, e a descoberta acontece na hora de assistir. Aqui a atualizacao e
# disparada por uma pessoa e o rollback e automatico.
set -eu

STACK=/opt/media-stack
ANOTACAO=/var/lib/media-stack-digests.txt

# nome:porta dos servicos com interface HTTP. flaresolverr e romm-db ficam de
# fora: o primeiro nao responde em / e o segundo nao fala HTTP.
SERVICOS="qbittorrent:8080 prowlarr:9696 sonarr:8989 radarr:7878 bazarr:6767 seerr:5055 romm:8080"

cd "$STACK"

echo "anotando versoes atuais..."
docker compose config --images | while read -r img; do
  id=$(docker image inspect --format '{{.Id}}' "$img" 2>/dev/null || echo "")
  [ -n "$id" ] && echo "$img $id"
done > "$ANOTACAO"

echo "puxando imagens novas..."
docker compose pull

echo "subindo..."
docker compose up -d

echo "esperando os servicos responderem..."
falhou=""
for par in $SERVICOS; do
  nome=${par%%:*}
  porta=${par##*:}
  ok=""
  i=0
  while [ $i -lt 30 ]; do
    if docker exec "$nome" sh -c "nc -z 127.0.0.1 $porta" >/dev/null 2>&1; then
      ok=sim
      break
    fi
    i=$((i + 1))
    sleep 2
  done
  if [ -z "$ok" ]; then
    echo "  $nome NAO respondeu na porta $porta" >&2
    falhou="$falhou $nome"
  else
    echo "  $nome ok"
  fi
done

if [ -z "$falhou" ]; then
  echo "atualizacao concluida."
  exit 0
fi

echo "REVERTENDO por causa de:$falhou" >&2
while read -r img id; do
  docker tag "$id" "$img" 2>/dev/null || echo "  nao consegui restaurar $img" >&2
done < "$ANOTACAO"
docker compose up -d
echo "revertido para as versoes anotadas em $ANOTACAO" >&2
exit 1
```

- [ ] **Passo 2: instalar**

```bash
sshpass -e scp -o StrictHostKeyChecking=no infra/midia/media-stack-update root@100.71.204.68:/tmp/media-stack-update
$H "pct push 102 /tmp/media-stack-update /usr/local/sbin/media-stack-update && pct exec 102 -- chmod 750 /usr/local/sbin/media-stack-update && rm -f /tmp/media-stack-update"
```

- [ ] **Passo 3: rodar de verdade**

```bash
$H "pct exec 102 -- /usr/local/sbin/media-stack-update; echo codigo=\$?"
```

Esperado: uma linha `ok` por servico e `codigo=0`.

- [ ] **Passo 4: provar o rollback (teste por mutacao)**

Quebrar um servico de proposito e confirmar que o script percebe e desfaz:

```bash
$H "pct exec 102 -- sh -c 'cd /opt/media-stack && cp compose.yaml /tmp/compose.bom && sed -i \"s/WEBUI_PORT=8080/WEBUI_PORT=9999/\" compose.yaml'"
$H "pct exec 102 -- /usr/local/sbin/media-stack-update; echo codigo=\$?"
```

Esperado: `qbittorrent NAO respondeu na porta 8080`, mensagem `REVERTENDO`, e
`codigo=1`.

Se o script terminar com `codigo=0`, o *health check* nao esta checando nada e a
tarefa nao entregou o que promete — o rollback e a unica coisa que separa isto do
Watchtower.

```bash
$H "pct exec 102 -- sh -c 'cd /opt/media-stack && cp /tmp/compose.bom compose.yaml && rm /tmp/compose.bom && docker compose up -d'"
```

- [ ] **Passo 5: confirmar que a stack voltou inteira**

```bash
$H "pct exec 102 -- docker ps --format '{{.Names}} {{.Status}}'"
```

Esperado: nove containers, todos `Up`.

- [ ] **Passo 6: commit**

```bash
git add infra/midia/media-stack-update
git commit -m "infra: atualizador da stack de midia com rollback automatico"
```

---

### Tarefa 6: O compose entra no Git

**Arquivos:**
- Criar: `infra/midia/compose-gitignore`

**Interfaces:** nenhuma. Tarefa isolada.

- [ ] **Passo 1: escrever o .gitignore**

Criar `infra/midia/compose-gitignore`:

```
# Segredos: chaves e senhas do RomM.
.env
.env.bak*

# Estado dos servicos: bancos, indices, caches. Sao GB, mudam a cada minuto e
# ja estao protegidos pelo backup semanal do CT 102.
config/

# Copias manuais anteriores ao Git. O historico substitui isso.
*.bak*
*.before-*
*.broken-*
media-stack-backup.tar.gz
```

- [ ] **Passo 2: guardar as copias antigas fora do caminho**

Antes de apagar, mover para um arquivo morto — o `.broken-seerr` pode conter a
unica pista de um problema passado:

```bash
$H "pct exec 102 -- sh -c 'mkdir -p /root/arquivo/media-stack && mv /opt/media-stack/*.bak* /opt/media-stack/*.before-* /opt/media-stack/*.broken-* /opt/media-stack/media-stack-backup.tar.gz /root/arquivo/media-stack/ && ls /root/arquivo/media-stack/'"
```

Esperado: os seis arquivos listados no destino.

- [ ] **Passo 3: iniciar o repositorio**

```bash
sshpass -e scp -o StrictHostKeyChecking=no infra/midia/compose-gitignore root@100.71.204.68:/tmp/gitignore
$H "pct push 102 /tmp/gitignore /opt/media-stack/.gitignore && rm -f /tmp/gitignore"
$H "pct exec 102 -- sh -c 'cd /opt/media-stack && git init -q && git config user.email mdds.kd@gmail.com && git config user.name Matheus && git add -A && git commit -q -m \"stack de midia: estado inicial versionado\"'"
```

- [ ] **Passo 4: provar que os segredos ficaram de fora**

```bash
$H "pct exec 102 -- sh -c 'cd /opt/media-stack && git ls-files'"
```

Esperado: **apenas** `.gitignore` e `compose.yaml`. Se `.env` aparecer, a senha do
banco do RomM entrou no historico e e preciso recomecar — nao basta apagar depois.

```bash
$H "pct exec 102 -- sh -c 'cd /opt/media-stack && git status --short'"
```

Esperado: saida vazia.

- [ ] **Passo 5: commit no repositorio do portal**

```bash
git add infra/midia/compose-gitignore
git commit -m "infra: compose da stack de midia versionado, com segredos fora"
```

---

### Tarefa 7: Parar de transcodificar

**Arquivos:**
- Criar: `infra/midia/parque-midia.md`

**Interfaces:** nenhuma. Depende de acao do dono nos aparelhos.

**Contexto:** das 48 sessoes registradas, 30 foram transcodificacao completa. O log
de sessao mostra `reported by app "Jellyfin Web"` em todas — assiste-se pelo
navegador, que nao decodifica HEVC 10 bits nem E-AC3 Atmos. O servidor entao
reescreve cada quadro em tempo real. **Nao e disco:** o HD entrega perto de 100 MB/s
e um 4K a 100 Mbps pede 12 MB/s.

- [ ] **Passo 1: medir a linha de base**

```bash
$H "pct exec 201 -- sh -c 'ls /var/log/jellyfin/ | grep -oE \"^FFmpeg\\.[A-Za-z]+\" | sort | uniq -c'"
```

Anotar os numeros. Sem linha de base nao ha como afirmar que melhorou.

- [ ] **Passo 2: escrever o runbook**

Criar `infra/midia/parque-midia.md` com, no minimo:

- **O que o backup do CT 201 contem**: contas, progresso de reproducao, favoritos,
  playlists, bibliotecas cadastradas, metadados e plugins — 543 MB comprimidos. E o
  que **nao** contem: `/mnt/media`, excluido por ser bind mount, por decisao.
- **Como restaurar**: `pct restore <vmid> /mnt/drive/dump/<arquivo>.tar.zst`,
  seguido de reconfigurar o bind mount `mp0: /mnt/media,mp=/mnt/media`, que nao
  volta do arquivo.
- **Por que nao ha aceleracao por hardware**: a GTX 760 esta dedicada a VM 120, e
  mesmo livre nao ajudaria — e Kepler, nao decodifica nem codifica HEVC.
- **Por que o SSD nao resolve travamento**: o gargalo e conversao de video, nao
  leitura de disco. Numeros do paragrafo de contexto acima.
- **Qual app usar em cada aparelho** (tabela do Passo 3).
- **Como atualizar a stack**: `pct exec 102 -- /usr/local/sbin/media-stack-update`.

- [ ] **Passo 3: instalar os apps nativos**

Esta parte e do dono, nao do implementador. Entregar a lista:

    iPhone         app Jellyfin, na App Store
    PC             Jellyfin Media Player (o app de desktop, nao o site)
    TV do quarto   canal Jellyfin na loja do Roku (Philco)
    TV da sala     Samsung AU7700 (Tizen) — sem app de loja; ver o runbook

Para a TV da sala, registrar as tres saidas no runbook: Fire TV Stick 4K (resolve de
vez, app oficial), sideload do app Tizen (grava, mas expira a cada 60 dias) ou
manter o navegador so nela, aceitando conversao naquele aparelho.

- [ ] **Passo 4: provar que a transcodificacao parou (teste por mutacao)**

Reproduzir o mesmo arquivo pelo app nativo e conferir no log:

```bash
$H "pct exec 201 -- sh -c 'ls -t /var/log/jellyfin/FFmpeg.* | head -3'"
```

Esperado: nenhum `FFmpeg.Transcode-` novo com carimbo posterior ao teste. Um
`FFmpeg.DirectStream` ou nenhum arquivo novo e o resultado bom.

"Ficou fluido?" nao serve como prova: nao distingue melhora real de rede boa naquele
minuto.

- [ ] **Passo 5: commit**

```bash
git add infra/midia/parque-midia.md
git commit -m "infra: runbook do parque de midia e a causa real do travamento"
```
