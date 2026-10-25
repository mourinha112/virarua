/* Acesso ao Postgres. Todo comando de domínio roda em transação; conflitos de serialização/deadlock são repetidos. */
import pg from 'pg';
import { config } from '../config';

pg.types.setTypeParser(20, (v) => Number(v)); // bigint → number (contadores cabem em 2^53)

export type Tx = pg.PoolClient;
export type Exec = Pick<pg.PoolClient, 'query'>;

let pool: pg.Pool | null = null;
export function db(url = config.databaseUrl) {
  if (!pool) pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 10_000 });
  return pool;
}
export async function fecharDb() { if (pool) { const p = pool; pool = null; await p.end(); } }
export function usarPool(p: pg.Pool) { pool = p; }

export async function q<T = any>(sql: string, params: unknown[] = [], ex: Exec = db()): Promise<T[]> {
  const r = await ex.query(sql, params as any[]);
  return r.rows as T[];
}
export async function q1<T = any>(sql: string, params: unknown[] = [], ex: Exec = db()): Promise<T | null> {
  const r = await q<T>(sql, params, ex); return r[0] ?? null;
}

/** Executa fn numa transação. Repete até 4x em serialização (40001) ou deadlock (40P01). */
export async function tx<T>(fn: (c: Tx) => Promise<T>, nivel: 'read committed' | 'repeatable read' | 'serializable' = 'read committed'): Promise<T> {
  for (let tent = 0; ; tent++) {
    const c = await db().connect();
    try {
      await c.query(`begin isolation level ${nivel}`);
      const r = await fn(c);
      await c.query('commit');
      return r;
    } catch (e: any) {
      try { await c.query('rollback'); } catch { /* conexão pode ter caído */ }
      if ((e?.code === '40001' || e?.code === '40P01') && tent < 4) { await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * (tent + 1))); continue; }
      throw e;
    } finally { c.release(); }
  }
}

/** Grava evento de domínio na outbox (mesma transação do comando). Publicado após commit pelo worker. */
export async function emitir(c: Exec, tipo: string, dados: Record<string, unknown>, chave?: string) {
  await c.query(
    `insert into domain_events (tipo, dados, chave_idempotencia) values ($1, $2, $3) on conflict (chave_idempotencia) do nothing`,
    [tipo, JSON.stringify(dados), chave ?? null],
  );
}

/** Auditoria administrativa (ações sensíveis). */
export async function auditar(c: Exec, ator: string | null, acao: string, alvo: string, motivo: string | null, dados: Record<string, unknown> = {}) {
  await c.query(`insert into admin_audit_logs (ator_user_id, acao, alvo, motivo, dados) values ($1, $2, $3, $4, $5)`, [ator, acao, alvo, motivo, JSON.stringify(dados)]);
}
