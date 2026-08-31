#!/bin/sh
# Exercita a barreira do portal-acao SEM executar qm/pct de verdade: poe stubs
# no PATH que so imprimem o que teriam feito.
# Uso, no host:  sh test/portal-acao.test.sh /usr/local/sbin/portal-acao
set -eu
ALVO=${1:-infra/portal/portal-acao}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
for f in qm pct shutdown; do
  printf '#!/bin/sh\necho "STUB $0 $*" >> %s/chamadas\nexit 0\n' "$TMP" > "$TMP/$f"
  chmod +x "$TMP/$f"
done
printf '#!/bin/sh\necho "id status running"\n' > "$TMP/qm"; chmod +x "$TMP/qm"
printf '#!/bin/sh\necho "id status running"\n' > "$TMP/pct"; chmod +x "$TMP/pct"
export PATH="$TMP:$PATH"

falhas=0
recusa() {
  if SSH_ORIGINAL_COMMAND="$1" sh "$ALVO" >/dev/null 2>&1; then
    echo "FALHOU: '$1' deveria ter sido recusado"; falhas=$((falhas+1))
  else
    echo "ok, recusado: $1"
  fi
}
aceita() {
  if SSH_ORIGINAL_COMMAND="$1" sh "$ALVO" >/dev/null 2>&1; then
    echo "ok, aceito: $1"
  else
    echo "FALHOU: '$1' deveria ter sido aceito"; falhas=$((falhas+1))
  fi
}

recusa "ct shutdown 103"          # o proprio portal
recusa "vm shutdown 111"          # Home Assistant
recusa "vm shutdown 110"          # a bancada
recusa "ct destroy 201"           # verbo fora da lista
recusa "vm start 999"             # alvo inexistente
recusa "host reboot"              # no host so shutdown
recusa "ct shutdown"              # sem id
recusa ""                         # vazio
aceita "ct shutdown 201"
aceita "vm start 301"

echo "---"
[ "$falhas" -eq 0 ] && echo "TODOS OS CASOS PASSARAM" || { echo "$falhas falha(s)"; exit 1; }
