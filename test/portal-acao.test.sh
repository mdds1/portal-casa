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
recusa "ct status 201"            # status e leitura interna, nao verbo pedido
recusa "vm start 999"             # alvo inexistente
recusa "host reboot"              # no host so shutdown
recusa "ct shutdown"              # sem id
recusa ""                         # vazio
aceita "ct shutdown 201"
aceita "vm start 301"

# --- Fase 2: a ferramenta falha de verdade ---------------------------------
# Um guest que se recusa a desligar faz o qm/pct sair diferente de zero. O
# portal-acao NAO pode engolir isso: se sair 0, o portal grava ok=1 numa acao
# que nao aconteceu, e o acoes_log -- a unica testemunha -- mente.
FALHO=$(mktemp -d)
trap 'rm -rf "$TMP" "$FALHO" "$REC"' EXIT
for f in qm pct; do
  cat > "$FALHO/$f" <<'EOF'
#!/bin/sh
# status sempre responde; qualquer acao falha, como um guest travado.
case "$1" in
  status) echo "id status running"; exit 0 ;;
  *) echo "guest nao respondeu" >&2; exit 1 ;;
esac
EOF
  chmod +x "$FALHO/$f"
done

falha_propagada() {
  saida=$(PATH="$FALHO:$PATH" SSH_ORIGINAL_COMMAND="$1" sh "$ALVO" 2>&1) && {
    echo "FALHOU: '$1' devolveu sucesso com a ferramenta falhando"; falhas=$((falhas+1)); return
  }
  case "$saida" in
    *falhou*) echo "ok, falha propagada: $1 -> $saida" ;;
    *) echo "FALHOU: '$1' saiu diferente de zero mas sem dizer 'falhou': $saida"
       falhas=$((falhas+1)) ;;
  esac
}

falha_propagada "ct shutdown 201"
falha_propagada "vm start 301"
falha_propagada "vm reboot 120"

# --- Fase 3: o shutdown/reboot precisa ter limite proprio ------------------
# O SSH do portal desiste em 20 s (src/acoes/wrapper.ts). Um "qm shutdown" sem
# --timeout bloqueia ate 180 s esperando o guest: o portal mataria o ssh e
# gravaria ok=0 numa acao que talvez tenha dado certo. O limite tem que vir
# daqui, menor que a janela do SSH.
REC=$(mktemp -d)
for f in qm pct; do
  printf '#!/bin/sh\necho "$*" >> %s/chamadas\necho "id status running"\nexit 0\n' "$REC" > "$REC/$f"
  chmod +x "$REC/$f"
done
: > "$REC/chamadas"
for cmd in "ct shutdown 201" "vm shutdown 301" "vm reboot 120"; do
  PATH="$REC:$PATH" SSH_ORIGINAL_COMMAND="$cmd" sh "$ALVO" >/dev/null 2>&1 || true
done
for esperado in "shutdown 201" "shutdown 301" "reboot 120"; do
  if grep -q -- "$esperado --timeout" "$REC/chamadas"; then
    echo "ok, com limite proprio: $esperado"
  else
    echo "FALHOU: '$esperado' foi chamado sem --timeout"; falhas=$((falhas+1))
  fi
done

echo "---"
[ "$falhas" -eq 0 ] && echo "TODOS OS CASOS PASSARAM" || { echo "$falhas falha(s)"; exit 1; }
