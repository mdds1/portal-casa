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
