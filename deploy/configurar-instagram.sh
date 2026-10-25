#!/usr/bin/env bash
# Grava as chaves do Instagram no .env SEM mostrar na tela, salva o token cifrado no banco e confere a conta.
# Uso: sudo bash deploy/configurar-instagram.sh
set -euo pipefail
E=/srv/seumundonovo/.env
put() {
  local k="$1" v="$2"
  { grep -v "^$k=" "$E" || true; printf '%s=%s\n' "$k" "$v"; } > "$E.tmp"
  cat "$E.tmp" > "$E"; rm -f "$E.tmp"
}
read -rp "ID da conta do Instagram (só números): " CONTA
# o terminal pode quebrar texto longo ao colar: lê várias linhas até uma linha vazia e junta tudo sem espaços
ler_oculto() {
  local rotulo="$1" linha junto=""
  echo "$rotulo" >&2
  while IFS= read -rs linha; do
    [ -z "${linha//[[:space:]]/}" ] && [ -n "$junto" ] && break
    junto+="${linha//[[:space:]]/}"
  done
  printf '%s' "$junto"
}
SEGREDO=$(ler_oculto "Cole a chave secreta do app do Instagram e aperte Enter DUAS vezes (não aparece):")
TOKEN=$(ler_oculto "Cole o token do Instagram (começa com IG) e aperte Enter DUAS vezes (não aparece):")
echo "chave: ${#SEGREDO} caracteres · token: ${#TOKEN} caracteres"
VT=$(grep '^IG_VERIFY_TOKEN=' "$E" | cut -d= -f2- || true)
[ -n "$VT" ] || VT=$(openssl rand -hex 16)
put IG_CONTA_ID "$CONTA"
put IG_APP_SECRET "$SEGREDO"
put IG_TOKEN "$TOKEN"
put IG_VERIFY_TOKEN "$VT"
put IG_GRAPH_VERSAO v26.0
put IG_ADAPTADOR oficial
chown smn:smn "$E"; chmod 600 "$E"
cd /srv/seumundonovo/app
sudo -u smn bash deploy/cli.sh conectar-ig
systemctl restart seumundonovo
echo
echo "Verify token para colar na Meta (campo Verificar token): $VT"
