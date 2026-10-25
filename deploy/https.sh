#!/usr/bin/env bash
# Liga o HTTPS (Let's Encrypt) no site e ajusta o endereço público do jogo.
# Uso: sudo bash deploy/https.sh 2-29-29-134.sslip.io      (ou o seu domínio, quando tiver)
set -euo pipefail
D="${1:?informe o endereço, ex.: 2-29-29-134.sslip.io}"
C=/etc/nginx/sites-available/seumundonovo
sed -i "s/^\s*server_name .*/  server_name $D;/" "$C"
nginx -t
systemctl reload nginx
apt-get install -y certbot python3-certbot-nginx > /dev/null
certbot --nginx -d "$D" --non-interactive --agree-tos --register-unsafely-without-email --redirect
E=/srv/seumundonovo/.env
if grep -q '^SMN_URL_PUBLICA=' "$E"; then sed -i "s#^SMN_URL_PUBLICA=.*#SMN_URL_PUBLICA=https://$D#" "$E"; else echo "SMN_URL_PUBLICA=https://$D" >> "$E"; fi
systemctl restart seumundonovo
sleep 4
curl -fsS "https://$D/api/saude" && echo "  <- HTTPS no ar: https://$D"
