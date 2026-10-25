#!/usr/bin/env bash
# Postgres local do projeto (cluster próprio em server/.pgdata, porta 54329, só 127.0.0.1, auth trust). Não mexe no serviço do sistema.
set -e
PG="${PG_BIN:-C:/Program Files/PostgreSQL/18/bin}"
cd "$(dirname "$0")/.."
[ -d server/.pgdata ] || "$PG/initdb.exe" -D server/.pgdata -U smn -A trust -E UTF8 --locale=C
"$PG/pg_ctl.exe" -D server/.pgdata -o "-p 54329 -c listen_addresses=127.0.0.1" -l server/.pgdata/log.txt status >/dev/null 2>&1 || "$PG/pg_ctl.exe" -D server/.pgdata -o "-p 54329 -c listen_addresses=127.0.0.1" -l server/.pgdata/log.txt start
for d in smn_dev smn_test; do "$PG/psql.exe" -h 127.0.0.1 -p 54329 -U smn -d postgres -tAc "select 1 from pg_database where datname='$d'" | grep -q 1 || "$PG/psql.exe" -h 127.0.0.1 -p 54329 -U smn -d postgres -c "create database $d"; done
echo "postgres local pronto em 127.0.0.1:54329 (smn_dev, smn_test)"
