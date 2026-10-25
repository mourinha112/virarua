#!/usr/bin/env bash
# Liga a ponte do ManyChat: gera a chave (se não existir), desliga as respostas do app oficial
# (o ManyChat responde no lugar) e reinicia a API. Mostra a chave para colar no ManyChat.
# Uso: sudo bash deploy/ponte-manychat.sh          (para desligar: sudo bash deploy/ponte-manychat.sh desligar)
set -euo pipefail
E=/srv/seumundonovo/.env
put() {
  local k="$1" v="$2"
  { grep -v "^$k=" "$E" || true; printf '%s=%s\n' "$k" "$v"; } > "$E.tmp"
  cat "$E.tmp" > "$E"; rm -f "$E.tmp"
}
if [ "${1:-}" = "desligar" ]; then
  put PONTE_MANYCHAT_CHAVE ""
  put IG_RESPONDER 1
  chown smn:smn "$E"; chmod 600 "$E"; systemctl restart seumundonovo
  echo "ponte desligada; o app oficial volta a responder"
  exit 0
fi
K=$(grep '^PONTE_MANYCHAT_CHAVE=' "$E" | cut -d= -f2- || true)
[ -n "$K" ] || K=$(openssl rand -hex 24)
put PONTE_MANYCHAT_CHAVE "$K"
put IG_RESPONDER 0
chown smn:smn "$E"; chmod 600 "$E"
systemctl restart seumundonovo
sleep 4
D=$(grep '^SMN_URL_PUBLICA=' "$E" | cut -d= -f2-)
echo
echo "URL para o ManyChat:  $D/api/ponte/manychat"
echo "Cabeçalho:            X-Ponte-Chave: $K"
