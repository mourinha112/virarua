#!/usr/bin/env bash
# Espera o DNS do domínio apontar para este servidor e então liga o HTTPS (deploy/https.sh).
# O endereço sslip.io continua no certificado, então o webhook da Meta segue funcionando sem mexer.
# Uso: sudo bash deploy/dominio.sh            (padrão: virarua.com.br + www)
set -euo pipefail
D=${1:-virarua.com.br}
IP=${2:-2.29.29.134}
cd "$(dirname "$0")/.."
ok() { getent ahostsv4 "$1" | awk '{print $1}' | grep -qx "$IP"; }
echo "esperando $D e www.$D apontarem para $IP (confere a cada 30s; Ctrl+C para parar)..."
until ok "$D" && ok "www.$D"; do sleep 30; printf '.'; done
echo; echo "DNS pronto, ligando o HTTPS..."
bash deploy/https.sh "$D" "www.$D" "$(echo "$IP" | tr . -).sslip.io"
