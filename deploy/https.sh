#!/usr/bin/env bash
# Liga o HTTPS (Let's Encrypt) para um ou mais endereços e ajusta o endereço público do jogo (o 1º da lista).
# Uso: sudo bash deploy/https.sh virarua.com.br www.virarua.com.br 2-29-29-134.sslip.io
set -euo pipefail
[ $# -ge 1 ] || { echo "informe os endereços, ex.: virarua.com.br www.virarua.com.br"; exit 1; }
C=/etc/nginx/sites-available/seumundonovo
sed -i "s/^\s*server_name .*/  server_name $*;/" "$C"
nginx -t
systemctl reload nginx
apt-get install -y certbot python3-certbot-nginx > /dev/null
ARGS=(); for d in "$@"; do ARGS+=(-d "$d"); done
certbot --nginx "${ARGS[@]}" --non-interactive --agree-tos --register-unsafely-without-email --redirect --expand
E=/srv/seumundonovo/.env
if grep -q '^SMN_URL_PUBLICA=' "$E"; then sed -i "s#^SMN_URL_PUBLICA=.*#SMN_URL_PUBLICA=https://$1#" "$E"; else echo "SMN_URL_PUBLICA=https://$1" >> "$E"; fi
systemctl restart seumundonovo
sleep 4
curl -fsS "https://$1/api/saude" && echo "  <- HTTPS no ar: https://$1"
