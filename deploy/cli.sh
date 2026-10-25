#!/usr/bin/env bash
# Roda a CLI administrativa com o .env do servidor.
# Uso: sudo -u smn bash deploy/cli.sh criar-admin <login>
set -euo pipefail
cd /srv/seumundonovo/app
set -a; . /srv/seumundonovo/.env; set +a
exec npx tsx server/src/modulos/admin/cli.ts "$@"
