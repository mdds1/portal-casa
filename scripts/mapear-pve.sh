#!/bin/bash
# Levantamento SOMENTE LEITURA do host Proxmox.
# Nao altera nada: so pvesh get, pct/qm config, e leitura de arquivos.
set -u
S() { echo; echo "===== $* ====="; }

S "versao e no"
pveversion; hostname; uptime

S "recursos do cluster"
pvesh get /cluster/resources --output-format json

S "config de cada VM"
for id in $(qm list | awk 'NR>1{print $1}'); do
  echo "--- VM $id ---"; qm config "$id"
done

S "config de cada CT"
for id in $(pct list | awk 'NR>1{print $1}'); do
  echo "--- CT $id ---"; pct config "$id"
done

S "storages"
pvesm status; echo; cat /etc/pve/storage.cfg

S "discos e uso"
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT; echo; df -h; echo
command -v zpool >/dev/null && zpool list && zfs list

S "memoria e cpu"
free -h; lscpu | head -20

S "rede"
ip -br a; echo; cat /etc/network/interfaces

S "firewall"
cat /etc/pve/firewall/cluster.fw 2>/dev/null || echo "(sem cluster.fw)"
ls -la /etc/pve/firewall/ 2>/dev/null

S "autostart e ordem de boot"
grep -H "onboot\|startup\|order" /etc/pve/qemu-server/*.conf /etc/pve/lxc/*.conf 2>/dev/null

S "usuarios, papeis e tokens da API"
pveum user list; echo; pveum token list --userid root@pam 2>/dev/null
for u in $(pveum user list --output-format json | grep -o '"userid":"[^"]*"' | cut -d'"' -f4); do
  echo "--- tokens de $u ---"; pveum user token list "$u" 2>/dev/null
done
echo; pveum acl list

S "backups configurados"
cat /etc/pve/jobs.cfg 2>/dev/null || echo "(sem jobs.cfg)"
ls -la /etc/pve/vzdump.cron 2>/dev/null; cat /etc/pve/vzdump.cron 2>/dev/null

S "wrappers de acao ja existentes"
ls -la /usr/local/sbin/ 2>/dev/null

S "servicos do host"
systemctl list-units --type=service --state=running --no-pager | head -40

S "temperatura"
command -v sensors >/dev/null && sensors || echo "(lm-sensors nao instalado)"

S "tarefas recentes"
pvesh get /nodes/$(hostname)/tasks --limit 20 --output-format json 2>/dev/null
