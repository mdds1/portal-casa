# Infraestrutura — Plano 3: Migração do FloripaOT

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover o FloripaOT para uma VM nova e limpa, deixando a VM 110 como bancada de desenvolvimento — sem o servidor sair do ar mais que alguns segundos.

**Architecture:** Uma VM nova (ID 301, faixa de jogos) nasce de imagem cloud do Debian 13, com o mínimo: MariaDB e mais nada. O binário do Canary depende apenas de `libc`, `libstdc++`, `libgcc` e `libm` — todo o resto está estático — então nenhum compilador, editor ou agente de IA precisa existir lá. Binário, datapack e configuração são copiados; o banco vai por dump com o servidor parado. As duas cópias coexistem até a nova aceitar login de jogador de verdade; só então a antiga é desligada.

**Tech Stack:** Proxmox VE 9.2.4 (`qm`, `qm importdisk`, cloud-init), Debian 13 (trixie), MariaDB, systemd, Tailscale, git.

**Spec:** `docs/superpowers/specs/2026-08-30-infra-proxmox-design.md` §3.1 e §7
**Planos anteriores:** `2026-08-30-infra-fundacao.md`, `2026-08-30-infra-protecao.md`

## Global Constraints

- **O FloripaOT continua no ar durante todo o plano.** A única parada permitida é o dump do banco, medida em segundos, e apenas com ninguém online. Verificação: `nc -z -w5 192.168.15.10 7171`.
- **Em nenhum momento existe só uma cópia.** A VM 110 fica servindo até a 301 aceitar login real. Só depois o `canary.service` da 110 é desligado — e mesmo assim ele fica instalado, apenas parado, até a 301 acumular alguns dias de uso.
- **O Home Assistant continua no ar.** `curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 http://192.168.15.8/` → `200`.
- **Antes de qualquer passo destrutivo existe backup.** O parque já tem o job `casa-diario` com restauração provada.
- Nenhuma VM ou container existente é apagado.
- Nenhuma porta nova exposta à internet. O mundo do jogo hoje é alcançado pela Tailscale (`config.lua` traz `ip = "100.91.91.40"`); esta migração **preserva esse comportamento**, trocando apenas o endereço. Expor à internet é projeto próprio.
- Senhas e tokens nunca em arquivo versionado. `$PVE_PASS` só em variável de ambiente. **A senha do MySQL do Canary nunca é impressa, nem em relatório.**
- Host: `root@100.71.204.68`. Bancada: VM 110, `192.168.15.10`. Repositório: `~/projetos/portal-casa`.

## Estado medido em 30/08/2026

| | |
|---|---|
| Binário | `/opt/canary-1511-clean/canary`, 160 MB, ELF dinâmico |
| Bibliotecas de sistema exigidas | `libc.so.6`, `libstdc++.so.6`, `libgcc_s.so.1`, `libm.so.6` — nada além |
| Datapack | `data-otservbr-global` 391 MB, `data` 13 MB, `data-canary` 20 MB |
| Banco | 2,9 MB — 18 personagens, 7 contas, 993 casas, 0 guildas |
| SO da bancada | Debian 13 (trixie) |
| Usuário do serviço | `matheus`, WorkingDirectory `/opt/canary-1511-clean` |
| Portas | login 7171, jogo 7172, status 7171 |
| ID livre para a nova | **301** (faixa `3xx` = jogos, conforme o spec §4.2) |

---

### Task 1: Criar a VM 301 a partir de imagem cloud

Não há ISO no host, e instalação interativa não é automatizável. A imagem cloud oficial do Debian resolve: ela já vem instalada, e o cloud-init cuida de usuário, chave e rede na primeira inicialização.

**Files:**
- Create (no host): VM 301
- Create: `~/projetos/portal-casa/infra/producao/vm-301.md`

**Interfaces:**
- Produces: VM 301, Debian 13, alcançável por SSH. Consumida por todas as tarefas seguintes.

- [ ] **Step 1: Confirmar que o ID 301 está livre e há espaço**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'qm status 301 2>&1; pct status 301 2>&1; pvesm status --storage vg-canary; free -h | sed -n 2p'
```

Esperado: "does not exist" nos dois; `vg-canary` com ~60 GB livres; ao menos 4,3 GB de RAM disponível. **Se o 301 existir, pare.**

- [ ] **Step 2: Baixar a imagem cloud do Debian 13**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  cd /var/lib/vz/template/iso
  test -f debian-13-genericcloud-amd64.qcow2 || \
    wget -q --show-progress https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2
  ls -lh debian-13-genericcloud-amd64.qcow2'
```

Esperado: arquivo de algumas centenas de MB. **Se o download falhar**, o firewall de saída não é o problema (a política `DROP` vale só para entrada) — verifique a URL na página `cloud.debian.org/images/cloud/trixie/latest/`.

- [ ] **Step 3: Criar a VM e importar o disco**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  qm create 301 --name floripaot --memory 4096 --cores 2 --cpu host \
    --net0 virtio,bridge=vmbr0 --ostype l26 --scsihw virtio-scsi-single \
    --description "Servidor FloripaOT (producao). Binario + datapack + MariaDB, nada mais."
  qm importdisk 301 /var/lib/vz/template/iso/debian-13-genericcloud-amd64.qcow2 vg-canary
  qm set 301 --scsi0 vg-canary:vm-301-disk-0,discard=on,iothread=1
  qm set 301 --boot order=scsi0
  qm resize 301 scsi0 20G
  qm config 301'
```

- [ ] **Step 4: Configurar o cloud-init**

A imagem cloud não tem senha nem usuário. O cloud-init cria ambos na primeira inicialização.

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  qm set 301 --ide2 vg-canary:cloudinit
  qm set 301 --ciuser matheus --cipassword "TROCAR_NA_EXECUCAO"
  qm set 301 --ipconfig0 ip=dhcp
  qm set 301 --agent enabled=1
  qm set 301 --onboot 0
  qm config 301'
```

**A senha do cloud-init é definida na hora da execução, escolhida pelo operador, e nunca escrita em arquivo versionado nem em relatório.** Ela é temporária: a Task 2 instala a chave SSH e ela deixa de importar.

`onboot 0` acompanha a decisão registrada para o FloripaOT enquanto ele for área de testes. **Quando virar produção para jogadores, esta é a linha que muda** — e é nesta VM, não na 110.

- [ ] **Step 5: Ligar e esperar o primeiro boot**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'qm start 301'
sleep 60
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'qm status 301; qm guest cmd 301 network-get-interfaces 2>&1 | grep -o "\"ip-address\" *: *\"192[0-9.]*\"" | head -2'
```

Esperado: `running` e um IP `192.168.15.x`. O agente pode demorar; se não responder de primeira, espere mais 60 s e repita. **Anote o IP** — as tarefas seguintes usam.

- [ ] **Step 6: Confirmar que a produção atual não sentiu nada**

```bash
nc -z -w5 192.168.15.10 7171 && echo "FloripaOT (110) OK"
curl -s -o /dev/null -w "HA %{http_code}\n" --max-time 10 http://192.168.15.8/
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'free -h | sed -n 2p'
```

- [ ] **Step 7: Registrar**

```bash
mkdir -p ~/projetos/portal-casa/infra/producao
cat > ~/projetos/portal-casa/infra/producao/vm-301.md <<'EOF'
# VM 301 — floripaot (producao)

Criada em 30/08/2026 a partir da imagem cloud oficial do Debian 13 (trixie).
Nao ha ISO no host e instalacao interativa nao e automatizavel; a imagem cloud
ja vem instalada e o cloud-init cuida de usuario, senha e rede no primeiro boot.

    ID .......... 301 (faixa 3xx = jogos, spec 4.2)
    RAM ......... 4096 MB   (a bancada usava 8192 para as duas funcoes juntas)
    CPU ......... 2 cores, tipo host
    Disco ....... 20 GB em vg-canary
    Rede ........ virtio em vmbr0, DHCP
    onboot ...... 0

## Por que VM e nao container

O servidor vai encarar a internet um dia. VM tem kernel proprio; container
compartilha o do host. O custo e ~300 MB de RAM, que sobram porque a producao
caiu de 8 GB para 4 GB ao largar a bancada.

## Por que ela pode ser minima

O binario do Canary depende apenas de libc, libstdc++, libgcc e libm — todo o
resto e estatico. Nenhum compilador, editor remoto, vcpkg ou agente de IA
precisa existir aqui. Essa e a diferenca principal para a VM 110, onde o
servidor ocupava ~1% do que enchia o disco.

## onboot

Fica em 0 enquanto o FloripaOT for area de testes. Quando virar producao para
jogadores, e esta VM que passa a 1 — nunca a 110, que e a bancada.
EOF
cd ~/projetos/portal-casa && git add infra/producao/vm-301.md && \
  git commit -m "infra: VM 301 de producao do FloripaOT"
```

---

### Task 2: Preparar a máquina — acesso, Tailscale e MariaDB

**Files:**
- Modify (na VM 301): pacotes, chave SSH, Tailscale, MariaDB
- Create: `~/projetos/portal-casa/infra/producao/preparacao.md`

**Interfaces:**
- Consumes: a VM 301 da Task 1 e o IP anotado.
- Produces: SSH por chave a partir da bancada; MariaDB com banco `canary` vazio; endereço Tailscale da 301 — que a Task 3 grava no `config.lua`.

- [ ] **Step 1: Instalar a chave SSH da bancada**

```bash
test -f ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
ssh-copy-id -o StrictHostKeyChecking=no matheus@<IP_DA_301>
ssh -o BatchMode=yes matheus@<IP_DA_301> 'echo "chave OK"; . /etc/os-release; echo $PRETTY_NAME'
```

Esperado: `chave OK` e `Debian GNU/Linux 13 (trixie)`. A partir daqui a senha do cloud-init não é mais usada.

- [ ] **Step 2: Instalar o mínimo**

```bash
ssh matheus@<IP_DA_301> 'sudo apt-get update -qq && \
  sudo apt-get install -y --no-install-recommends mariadb-server qemu-guest-agent 2>&1 | tail -5'
```

`--no-install-recommends` é deliberado: mantém a máquina magra. **Não instale compilador, git, vcpkg nem editor.** Se algum passo adiante parecer exigir isso, pare — significa que o binário não está tão estático quanto medimos.

- [ ] **Step 3: Confirmar que as bibliotecas exigidas existem**

```bash
ssh matheus@<IP_DA_301> 'ls -la /lib/x86_64-linux-gnu/libstdc++.so.6 /lib/x86_64-linux-gnu/libc.so.6 /lib/x86_64-linux-gnu/libgcc_s.so.1 /lib/x86_64-linux-gnu/libm.so.6'
```

Esperado: as quatro presentes. Se `libstdc++.so.6` faltar, instale `libstdc++6` — e **só** ele.

- [ ] **Step 4: Criar o banco e o usuário**

A senha tem de ser **a mesma** que está no `config.lua` da bancada, para o arquivo copiar sem edição desse campo.

```bash
PW=$(grep -E '^mysqlPass' /opt/canary-1511-clean/config.lua | sed 's/.*= *"\(.*\)"/\1/')
ssh matheus@<IP_DA_301> "sudo mariadb -e \"
  CREATE DATABASE IF NOT EXISTS canary CHARACTER SET utf8mb4;
  CREATE USER IF NOT EXISTS 'canary'@'127.0.0.1' IDENTIFIED BY '\$(printf %s "$PW")';
  GRANT ALL PRIVILEGES ON canary.* TO 'canary'@'127.0.0.1';
  FLUSH PRIVILEGES;\""
unset PW
```

**A senha nunca aparece na saída nem no relatório.** Confirme apenas o efeito:

```bash
ssh matheus@<IP_DA_301> 'sudo mariadb -e "SELECT user,host FROM mysql.user WHERE user=\"canary\"; SHOW DATABASES;"'
```

- [ ] **Step 5: Amarrar o MariaDB ao loopback**

Ele não deve escutar na rede. É o mesmo endurecimento já aplicado ao StarLoco.

```bash
ssh matheus@<IP_DA_301> 'sudo grep -rn "^bind-address" /etc/mysql/ ; sudo ss -tlnp | grep 3306'
```

Esperado: `bind-address = 127.0.0.1` e a porta escutando **apenas** em `127.0.0.1`. Se estiver em `0.0.0.0`, ajuste o `bind-address` e reinicie o serviço.

- [ ] **Step 6: Entrar na Tailscale**

```bash
ssh matheus@<IP_DA_301> 'curl -fsSL https://tailscale.com/install.sh | sudo sh'
```

Depois, autentique. O comando imprime uma URL que precisa ser aberta no navegador — **este passo é do Matheus**, não automatizável:

```bash
ssh -t matheus@<IP_DA_301> 'sudo tailscale up'
```

- [ ] **Step 7: Anotar o endereço Tailscale — é o dado mais importante do plano**

```bash
ssh matheus@<IP_DA_301> 'tailscale ip -4'
```

**Anote.** Este endereço vai no `config.lua` da Task 3. Se ele ficar errado, o jogador loga e não entra no mundo — o sintoma clássico de migração de servidor de Tibia mal feita.

- [ ] **Step 8: Confirmar que a produção atual não sentiu nada**

```bash
nc -z -w5 192.168.15.10 7171 && echo "FloripaOT (110) OK"
curl -s -o /dev/null -w "HA %{http_code}\n" --max-time 10 http://192.168.15.8/
```

- [ ] **Step 9: Registrar**

```bash
cat > ~/projetos/portal-casa/infra/producao/preparacao.md <<'EOF'
# Preparacao da VM 301

Instalado, e so isto:

    mariadb-server        banco do jogo
    qemu-guest-agent      para o Proxmox enxergar a VM por dentro
    tailscale             como o mundo do jogo e alcancado hoje

Instalado com --no-install-recommends de proposito. NAO ha compilador, git,
vcpkg nem editor remoto nesta maquina, e nao deve haver. Se algum trabalho
futuro parecer exigir isso, o certo e compilar na bancada (VM 110) e copiar o
binario para ca.

## Banco

Banco `canary`, usuario `canary@127.0.0.1`, mesma senha do config.lua da
bancada — assim o arquivo copia sem editar esse campo. MariaDB amarrado a
127.0.0.1: nao escuta na rede.

## Tailscale

O `tailscale up` exige abrir uma URL no navegador. E passo manual do Matheus,
nao automatizavel.

O endereco Tailscale desta VM e o que vai no campo `ip` do config.lua. E o dado
que o servidor ANUNCIA ao cliente depois do login. Errado ali, o jogador loga e
trava na entrada do mundo.
EOF
cd ~/projetos/portal-casa && git add infra/producao/preparacao.md && \
  git commit -m "infra: preparacao minima da VM 301"
```

---

### Task 3: Copiar binário, datapack e configuração

Ainda sem tocar no banco e sem parar nada. Ao fim desta tarefa a VM 301 tem tudo menos os dados.

**Files:**
- Create (na VM 301): `/opt/canary-1511-clean/`, `/etc/systemd/system/canary.service`
- Create: `~/projetos/portal-casa/infra/producao/deploy.md`

- [ ] **Step 1: Criar o destino com o dono certo**

```bash
ssh matheus@<IP_DA_301> 'sudo mkdir -p /opt/canary-1511-clean && sudo chown matheus:matheus /opt/canary-1511-clean && ls -ld /opt/canary-1511-clean'
```

- [ ] **Step 2: Copiar o que o servidor precisa em tempo de execução — e só isso**

```bash
cd /opt/canary-1511-clean
rsync -av --info=progress2 \
  canary config.lua schema.sql key.pem \
  data-otservbr-global data data-canary \
  matheus@<IP_DA_301>:/opt/canary-1511-clean/ 2>&1 | tail -5
```

Se `key.pem` não existir na bancada, ignore-o — nem toda instalação usa. **Não copie** `build/`, `.git`, `vcpkg_installed`, `src`, `nexus-sprites`, os `.zip` de cliente nem os `config.lua.bak*`: nada disso é usado em execução, e é justamente o entulho que encheu o disco da 110.

- [ ] **Step 3: Conferir que chegou inteiro**

```bash
md5sum /opt/canary-1511-clean/canary
ssh matheus@<IP_DA_301> 'md5sum /opt/canary-1511-clean/canary; du -sh /opt/canary-1511-clean/*'
```

Esperado: **md5 idêntico** nos dois lados. Se divergir, refaça a cópia — binário truncado não dá erro claro, só não sobe.

- [ ] **Step 4: Provar que o binário roda na máquina limpa**

```bash
ssh matheus@<IP_DA_301> 'ldd /opt/canary-1511-clean/canary | grep -c "not found"; ldd /opt/canary-1511-clean/canary'
```

Esperado: **`0`** bibliotecas faltando. Se alguma faltar, instale **apenas** o pacote dela e registre no relatório — é informação que contradiz a medição do plano e importa.

- [ ] **Step 5: Corrigir o endereço anunciado — o passo que decide a migração**

```bash
ssh matheus@<IP_DA_301> 'grep -n "^ip = " /opt/canary-1511-clean/config.lua'
ssh matheus@<IP_DA_301> 'sed -i "s|^ip = .*|ip = \"<TAILSCALE_DA_301>\"|" /opt/canary-1511-clean/config.lua && grep -n "^ip = " /opt/canary-1511-clean/config.lua'
```

Esperado: o campo passa a trazer o endereço Tailscale **da 301**, anotado na Task 2 Step 7 — não o `100.91.91.40` da bancada.

- [ ] **Step 6: Instalar o serviço**

Mesma unidade da bancada, que já está correta.

```bash
sudo systemctl cat canary.service | grep -v "^#" > /tmp/canary.service
scp /tmp/canary.service matheus@<IP_DA_301>:/tmp/
ssh matheus@<IP_DA_301> 'sudo mv /tmp/canary.service /etc/systemd/system/canary.service && \
  sudo systemctl daemon-reload && sudo systemctl cat canary.service | head -20'
```

**Não habilite nem inicie ainda** — o banco está vazio. Isso é a Task 4.

- [ ] **Step 7: Confirmar que a produção atual não sentiu nada**

```bash
nc -z -w5 192.168.15.10 7171 && echo "FloripaOT (110) OK"
systemctl is-active canary.service
```

- [ ] **Step 8: Registrar**

```bash
cat > ~/projetos/portal-casa/infra/producao/deploy.md <<'EOF'
# O que vive na VM 301

Copiado da bancada, e so isto:

    canary                  binario, 160 MB
    config.lua              configuracao
    schema.sql              esquema do banco
    key.pem                 se existir
    data-otservbr-global    datapack ativo, 391 MB
    data                    13 MB
    data-canary             20 MB

## O que NAO vem, e por que

build/, .git, vcpkg_installed, src, nexus-sprites, os .zip de cliente e os
config.lua.bak*. Nada disso e lido em execucao — e e exatamente o entulho que
levou o disco da VM 110 a 97%.

## Como atualizar o servidor daqui em diante

Compila na bancada (VM 110), copia o binario para ca. A producao nunca compila.

## A unica edicao no config.lua

O campo `ip`. Ele e o endereco que o servidor ANUNCIA ao cliente depois do
login, e precisa ser o Tailscale DESTA VM. Na bancada era 100.91.91.40.
Errar isso faz o jogador logar e travar na entrada do mundo — sem mensagem de
erro util.
EOF
cd ~/projetos/portal-casa && git add infra/producao/deploy.md && \
  git commit -m "infra: binario e datapack na VM 301"
```

---

### Task 4: Migrar o banco — a única parada do plano

O banco tem 2,9 MB e 18 personagens. O dump leva segundos. **Confirme que não há ninguém online antes.**

- [ ] **Step 1: Confirmar que ninguém está jogando**

```bash
cd /opt/canary-1511-clean
PW=$(grep -E '^mysqlPass' config.lua | sed 's/.*= *"\(.*\)"/\1/')
mysql -u canary -p"$PW" -N -e "SELECT COUNT(*) FROM players_online;" canary
```

Esperado: **`0`**. Se houver alguém online, **pare** e refaça em horário de pouco movimento. Derrubar jogador no meio de uma sessão perde progresso não salvo.

- [ ] **Step 2: Parar o servidor — começa a janela**

```bash
sudo systemctl stop canary.service
systemctl is-active canary.service
```

Esperado: `inactive`. A partir daqui o servidor está fora do ar. **Os próximos três passos são os únicos com pressa no plano inteiro.**

- [ ] **Step 3: Dump com o servidor parado**

```bash
cd /opt/canary-1511-clean
PW=$(grep -E '^mysqlPass' config.lua | sed 's/.*= *"\(.*\)"/\1/')
mysqldump -u canary -p"$PW" --single-transaction --routines --triggers canary > /tmp/canary-migracao.sql
ls -lh /tmp/canary-migracao.sql
grep -c "CREATE TABLE" /tmp/canary-migracao.sql
unset PW
```

Esperado: arquivo de alguns MB e várias dezenas de `CREATE TABLE`. **Se der zero tabelas, pare** — o dump está vazio e não serve.

- [ ] **Step 4: Religar a bancada imediatamente**

O dump já está na mão; não há motivo para o servidor seguir parado.

```bash
sudo systemctl start canary.service
sleep 15
systemctl is-active canary.service
nc -z -w5 127.0.0.1 7171 && echo "FloripaOT de volta"
```

**A janela fecha aqui.** Deve ter durado menos de um minuto.

- [ ] **Step 5: Restaurar na VM 301**

```bash
scp /tmp/canary-migracao.sql matheus@<IP_DA_301>:/tmp/
PW=$(grep -E '^mysqlPass' /opt/canary-1511-clean/config.lua | sed 's/.*= *"\(.*\)"/\1/')
ssh matheus@<IP_DA_301> "mysql -u canary -p'$PW' canary < /tmp/canary-migracao.sql"
unset PW
```

- [ ] **Step 6: Conferir que os dados chegaram completos**

```bash
ssh matheus@<IP_DA_301> 'sudo mariadb canary -e "SELECT CONCAT(\"players: \",(SELECT COUNT(*) FROM players),\" | accounts: \",(SELECT COUNT(*) FROM accounts),\" | houses: \",(SELECT COUNT(*) FROM houses));"'
```

Esperado, conforme medido em 30/08/2026: **18 personagens, 7 contas, 993 casas**. Divergência é falha — não siga.

- [ ] **Step 7: Apagar o dump temporário dos dois lados**

Ele contém dados de conta.

```bash
rm -f /tmp/canary-migracao.sql
ssh matheus@<IP_DA_301> 'rm -f /tmp/canary-migracao.sql'
```

---

### Task 5: Subir a 301 e provar com login de verdade

As duas máquinas ficam de pé ao mesmo tempo. **Elas não podem servir jogadores simultaneamente**, ou dois mundos divergem — mas para o teste isso é aceitável, porque ninguém está online e o teste é curto.

- [ ] **Step 1: Iniciar o servidor na 301**

```bash
ssh matheus@<IP_DA_301> 'sudo systemctl start canary.service; sleep 20; systemctl is-active canary.service'
ssh matheus@<IP_DA_301> 'sudo journalctl -u canary.service -n 40 --no-pager'
```

Esperado: `active`, e o log mostrando o servidor carregando o mapa e abrindo as portas. **Se cair em laço de reinício, pare e leia o log** — o motivo mais provável é banco ou `config.lua`.

- [ ] **Step 2: Confirmar que as portas respondem**

```bash
ssh matheus@<IP_DA_301> 'ss -tln | grep -E "7171|7172"'
nc -z -w5 <TAILSCALE_DA_301> 7171 && echo "301 login OK"
nc -z -w5 <TAILSCALE_DA_301> 7172 && echo "301 jogo OK"
```

- [ ] **Step 3: Confirmar que o `ip` anunciado está certo**

```bash
ssh matheus@<IP_DA_301> 'grep "^ip = " /opt/canary-1511-clean/config.lua; tailscale ip -4'
```

**Os dois têm de bater.** Este é o erro que só aparece quando um jogador tenta entrar.

- [ ] **Step 4: O teste que decide — login de jogador de verdade**

**Passo do Matheus, não automatizável.** Aponte o cliente para o endereço Tailscale da 301, entre com uma conta, e confirme que:

- a lista de personagens aparece
- o personagem entra no mundo
- ele está na posição e com o nível esperados
- movimento e conversa funcionam

**Nada avança sem isso.** Um servidor que sobe e aceita conexão TCP mas não deixa entrar no mundo é exatamente o modo de falha desta migração.

- [ ] **Step 5: Parar a 301 até a virada**

Enquanto a bancada ainda serve, as duas rodando ao mesmo tempo é convite a divergência.

```bash
ssh matheus@<IP_DA_301> 'sudo systemctl stop canary.service; systemctl is-active canary.service'
```

---

### Task 6: A virada

- [ ] **Step 1: Confirmar mais uma vez que ninguém está online na bancada**

```bash
cd /opt/canary-1511-clean
PW=$(grep -E '^mysqlPass' config.lua | sed 's/.*= *"\(.*\)"/\1/')
mysql -u canary -p"$PW" -N -e "SELECT COUNT(*) FROM players_online;" canary
unset PW
```

Esperado: `0`.

- [ ] **Step 2: Refazer o dump — a bancada acumulou uso desde a Task 4**

Repita a Task 4, Steps 2 a 7, com a bancada. É rápido e garante que nada jogado no intervalo se perca.

- [ ] **Step 3: Desligar o servidor na bancada, sem desinstalar**

```bash
sudo systemctl stop canary.service
sudo systemctl disable canary.service
systemctl is-enabled canary.service; systemctl is-active canary.service
```

Esperado: `disabled` e `inactive`. **Não remova a unidade nem os arquivos.** Eles ficam como rede de segurança até a 301 acumular alguns dias de uso.

- [ ] **Step 4: Subir a 301 em definitivo**

```bash
ssh matheus@<IP_DA_301> 'sudo systemctl enable --now canary.service; sleep 20; systemctl is-active canary.service'
nc -z -w5 <TAILSCALE_DA_301> 7171 && echo "producao nova no ar"
```

- [ ] **Step 5: Incluir a 301 no backup**

Ela é produção agora. Sem isto, nasce sem backup — a lacuna que o Plano 1 já identificou.

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pvesh set /cluster/backup/casa-diario --vmid 100,101,102,104,111,120,301 && pvesh get /cluster/backup --output-format json'
```

- [ ] **Step 6: Reapontar o backup de aplicação**

`/usr/local/bin/backup-floripaot.sh` roda no cron da bancada às 04:00 e aponta para caminhos locais. Ele precisa passar a copiar o banco da 301.

```bash
sudo cat /usr/local/bin/backup-floripaot.sh | head -40
crontab -l | grep floripaot
```

Ajuste para acessar a 301 por SSH, no mesmo padrão do `~/bin/backup-starloco.sh`, que já faz exatamente isso com o CT 104. **Guarde cópia do original antes.**

- [ ] **Step 7: Verificar que o backup reapontado funciona**

```bash
/usr/local/bin/backup-floripaot.sh diario
ls -lht ~/backups* 2>/dev/null | head -5
```

Esperado: termina sem erro e produz arquivo novo, não vazio.

- [ ] **Step 8: Registrar a virada**

```bash
cat > ~/projetos/portal-casa/infra/producao/virada.md <<'EOF'
# A virada — FloripaOT sai da bancada

Data: (preencher)

A VM 110 deixou de servir o jogo. O `canary.service` dela foi parado e
desabilitado, mas NAO removido: binario, datapack e unidade continuam la como
rede de seguranca. Remove-los so depois de a 301 acumular alguns dias de uso.

## O que mudou de lugar

| | Antes | Depois |
|---|---|---|
| Servidor | VM 110 (junto com a bancada) | VM 301 (sozinho) |
| RAM de producao | 8 GB compartilhados | 4 GB dedicados |
| Backup de aplicacao | cron local na 110 | cron na 110 lendo a 301 por SSH |
| vzdump | a 110 estava fora do job | a 301 entrou no job |

## A VM 110 agora

E a bancada: compilacao, vscode-server, vcpkg, agentes de IA. Pode encher de
cache a vontade — nao encosta em jogador nenhum. Continua com onboot 0.

## Se precisar voltar atras

Na 110: `sudo systemctl enable --now canary.service`. O `config.lua` de la ainda
traz o `ip` antigo (100.91.91.40), entao ela volta a servir sozinha. Pare a 301
antes, ou os dois mundos divergem.
EOF
cd ~/projetos/portal-casa && git add infra/producao/virada.md && \
  git commit -m "infra: FloripaOT servindo da VM 301"
```

---

### Task 7: Converter o CT 101 para não-privilegiado

Pendência herdada do Plano 1. É o único container privilegiado do parque, e é o que processa arquivo de mídia vindo de fora.

**Atenção:** converter altera o mapeamento de UID do `/mnt/media`. É a mesma armadilha que já custou tempo no CT 100 com o SMB. Container não-privilegiado não pode ser convertido no lugar: o caminho é backup e restauração com a flag trocada.

- [ ] **Step 1: Registrar o estado e os donos atuais**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pct config 101; echo "--- donos no host ---"; ls -lan /mnt/media/ | head -10'
```

- [ ] **Step 2: Backup do container**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pct status 101; vzdump 101 --storage drive --mode stop --compress zstd 2>&1 | tail -10; ls -lh /mnt/drive/dump/ | tail -3'
```

`mode stop` porque ele já está parado. Esperado: `Backup job finished successfully`.

- [ ] **Step 3: Restaurar como não-privilegiado sob ID novo**

Restaurar sob ID novo, e não por cima, mantém o original intacto até o novo estar provado.

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  DUMP=$(ls -t /mnt/drive/dump/vzdump-lxc-101-*.tar.zst | head -1)
  echo "restaurando de: $DUMP"
  pct restore 201 "$DUMP" --storage local-lvm --unprivileged 1 --hostname jellyfin
  pct config 201'
```

ID **201** segue a faixa `2xx` (mídia) do spec §4.2, e a renomeação para `jellyfin` minúsculo segue §4.1.

- [ ] **Step 4: Reapontar o ponto de montagem**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 \
  'pct set 201 --mp0 /mnt/media,mp=/mnt/media && pct set 201 --onboot 0 && pct config 201'
```

- [ ] **Step 5: Ligar e verificar o que mais falha nessa conversão — as permissões**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 '
  pct start 201 && sleep 20
  pct status 201
  echo "--- ele le a midia? ---"; pct exec 201 -- ls -la /mnt/media | head -8
  echo "--- jellyfin subiu? ---"; pct exec 201 -- systemctl is-active jellyfin 2>&1
  echo "--- escutando? ---"; pct exec 201 -- sh -c "ss -tln | grep 8096"'
```

Esperado: lê `/mnt/media`, `jellyfin` `active`, porta 8096 escutando. **Se ele não conseguir ler a mídia, é o mapeamento de UID** — em container não-privilegiado o root interno vira 100000 no host. Registre o erro exato e pare; a correção é ajustar dono no host ou usar `lxc.idmap`, e merece decisão consciente.

- [ ] **Step 6: Testar o Jellyfin de verdade**

**Passo do Matheus.** Abra o Jellyfin no IP do CT 201, porta 8096, e confirme que a biblioteca aparece e um vídeo toca.

- [ ] **Step 7: Parar os dois e registrar**

```bash
sshpass -p "$PVE_PASS" ssh root@100.71.204.68 'pct stop 201; pct status 201; pct status 101'
```

O CT 101 **não é apagado** neste plano. Ele fica parado como rede de segurança. Apagá-lo é decisão do Matheus, depois de o 201 rodar por alguns dias.

```bash
cat > ~/projetos/portal-casa/infra/host/ct-201-jellyfin.md <<'EOF'
# CT 201 — jellyfin nao-privilegiado

O CT 101 era o unico container privilegiado do parque, e justamente o que
processa arquivo de midia vindo de fora. Root nele era, na pratica, root no host.

Container privilegiado nao se converte no lugar: o caminho e vzdump e restaurar
com --unprivileged 1. Por isso existe um ID novo.

    101 (privilegiado, parado, mantido)  ->  201 (nao-privilegiado)

ID 201 segue a faixa 2xx = midia (spec 4.2); nome minusculo segue 4.1.

## A armadilha

Em container nao-privilegiado o root interno e mapeado para 100000 no host.
Um bind mount cujo dono e root:root deixa de ser legivel de dentro. E a mesma
pegadinha que ja custou tempo no CT 100 com SMB.

## O 101 continua existindo

Parado, como rede de seguranca. Apagar so depois de o 201 rodar alguns dias, e
so por decisao do Matheus.
EOF
cd ~/projetos/portal-casa && git add infra/host/ct-201-jellyfin.md && \
  git commit -m "infra: Jellyfin nao-privilegiado no CT 201"
```

---

## O que este plano deliberadamente NÃO faz

- **Não apaga a VM 110 nem o CT 101.** Os dois ficam parados como rede de segurança.
- **Não expõe o FloripaOT à internet.** O mundo continua sendo alcançado pela Tailscale. Expor é projeto próprio, e depende do firewall por máquina.
- **Não mexe no Cloudflare.** Depende da propagação do `dinizismo.com.br`.
- **Não limpa a bancada** dos arquivos do servidor. Enquanto ela for a rede de segurança, eles ficam.
- **Não resolve a lista `vmid` estática** do job de backup — só acrescenta a 301 a ela.
