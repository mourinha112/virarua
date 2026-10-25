/* Executor de migrações. Arquivos server/migrations/NNN_nome.sql (sobe) e NNN_nome.down.sql (desce).
   Uso: npx tsx server/src/db/migrar.ts [up|down N|status] — cada migração roda numa transação. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

export function listarMigracoes() {
  return readdirSync(DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort().map((f) => ({ id: f.slice(0, 3), nome: f.replace(/\.sql$/, ''), arquivo: resolve(DIR, f), down: resolve(DIR, f.replace(/\.sql$/, '.down.sql')) }));
}

export async function migrar(url = config.databaseUrl, log = console.log) {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    await c.query(`create table if not exists schema_migrations (id text primary key, nome text not null, aplicada_em timestamptz not null default now())`);
    await c.query(`select pg_advisory_lock(728301)`);
    const feitas = new Set((await c.query('select id from schema_migrations')).rows.map((r) => r.id));
    for (const m of listarMigracoes()) {
      if (feitas.has(m.id)) continue;
      await c.query('begin');
      try { await c.query(readFileSync(m.arquivo, 'utf8')); await c.query('insert into schema_migrations (id, nome) values ($1, $2)', [m.id, m.nome]); await c.query('commit'); log('migração aplicada: ' + m.nome); }
      catch (e) { await c.query('rollback'); throw new Error(`falha na migração ${m.nome}: ${(e as Error).message}`); }
    }
  } finally { await c.query(`select pg_advisory_unlock(728301)`).catch(() => {}); await c.end(); }
}

export async function reverter(n = 1, url = config.databaseUrl, log = console.log) {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    const feitas = (await c.query('select id, nome from schema_migrations order by id desc limit $1', [n])).rows;
    for (const f of feitas) {
      const m = listarMigracoes().find((x) => x.id === f.id); if (!m) throw new Error('arquivo da migração ausente: ' + f.nome);
      await c.query('begin');
      try { await c.query(readFileSync(m.down, 'utf8')); await c.query('delete from schema_migrations where id = $1', [f.id]); await c.query('commit'); log('migração revertida: ' + f.nome); }
      catch (e) { await c.query('rollback'); throw e; }
    }
  } finally { await c.end(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const cmd = process.argv[2] || 'up';
  (cmd === 'down' ? reverter(Number(process.argv[3] || 1)) : migrar()).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
}
