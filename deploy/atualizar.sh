#!/usr/bin/env bash
# Atualiza o jogo no servidor: puxa o código, instala, faz backup, migra o banco, gera o front e reinicia a API.
# Uso (no servidor):  sudo -u smn bash /srv/seumundonovo/app/deploy/atualizar.sh
set -euo pipefail
cd /srv/seumundonovo/app
set -a; . /srv/seumundonovo/.env; set +a
git pull --ff-only
npm ci
mkdir -p /srv/seumundonovo/backups
pg_dump -Fc "$DATABASE_URL" > "/srv/seumundonovo/backups/antes-$(date +%F-%H%M).dump"
npm run db:migrar
npm run db:semear
npm run build
sudo systemctl restart seumundonovo
sleep 3
curl -fsS http://127.0.0.1:8787/api/saude && echo "  <- API no ar"
