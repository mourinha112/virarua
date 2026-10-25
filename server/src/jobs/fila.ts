/* Fila durável em Postgres (processing_jobs): enfileirar idempotente, worker com SKIP LOCKED, backoff com jitter,
   fila morta após max_tentativas e reprocessamento administrativo. Também publica a outbox (domain_events). */
import { db, q, type Exec } from '../db/db';
import { redigir } from '../seguranca/cripto';

export type Handler = (dados: any, job: { id: number; tentativas: number }) => Promise<void>;
const handlers = new Map<string, Handler>();
const ouvintes = new Map<string, ((dados: any, ev: { id: number }) => Promise<void>)[]>();

export function registrarJob(tipo: string, h: Handler) { handlers.set(tipo, h); }
/** consumidor de evento de domínio (rodado após o commit, pela outbox) */
export function aoEvento(tipo: string, f: (dados: any, ev: { id: number }) => Promise<void>) { (ouvintes.get(tipo) || ouvintes.set(tipo, []).get(tipo)!).push(f); }

export async function enfileirar(ex: Exec, tipo: string, dados: unknown, chave?: string, emSeg = 0) {
  const r = await q<{ id: number }>(
    `insert into processing_jobs (tipo, dados, chave, disponivel_em) values ($1, $2, $3, now() + make_interval(secs => $4))
     on conflict (chave) do nothing returning id`, [tipo, JSON.stringify(dados), chave ?? null, emSeg], ex);
  return r[0]?.id ?? null;
}

/** pega e processa até `max` jobs disponíveis. Devolve quantos rodou. */
export async function rodarFila(max = 20): Promise<number> {
  let n = 0;
  for (; n < max; n++) {
    const c = await db().connect();
    let job: any = null;
    try {
      await c.query('begin');
      job = (await c.query(`select * from processing_jobs where estado in ('pendente','erro') and disponivel_em <= now() order by id limit 1 for update skip locked`)).rows[0];
      if (!job) { await c.query('commit'); break; }
      await c.query(`update processing_jobs set estado = 'rodando', tentativas = tentativas + 1, travado_ate = now() + interval '5 minutes' where id = $1`, [job.id]);
      await c.query('commit');
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
    const h = handlers.get(job.tipo);
    try {
      if (!h) throw new Error('sem handler para ' + job.tipo);
      await h(job.dados, { id: job.id, tentativas: job.tentativas + 1 });
      await q(`update processing_jobs set estado = 'feito', feito_em = now(), erro = null where id = $1`, [job.id]);
    } catch (e: any) {
      const tent = job.tentativas + 1, morto = tent >= job.max_tentativas;
      const atraso = Math.min(3600, 2 ** tent * 5) * (0.75 + Math.random() * 0.5); // backoff exponencial com jitter
      await q(`update processing_jobs set estado = $2, erro = $3, disponivel_em = now() + make_interval(secs => $4) where id = $1`, [job.id, morto ? 'morto' : 'erro', redigir(String(e?.message || e)).slice(0, 2000), atraso]);
    }
  }
  return n;
}

/** publica eventos da outbox para os ouvintes (pelo menos uma vez; ouvintes devem ser idempotentes) */
export async function publicarOutbox(max = 100) {
  const evs = await q<{ id: number; tipo: string; dados: any }>(`select id, tipo, dados from domain_events where publicado_em is null order by id limit $1`, [max]);
  for (const ev of evs) {
    for (const f of ouvintes.get(ev.tipo) || []) await f(ev.dados, { id: ev.id });
    await q(`update domain_events set publicado_em = now() where id = $1`, [ev.id]);
  }
  return evs.length;
}

/** reprocessar job morto (ação administrativa auditada pelo chamador) */
export async function reprocessar(id: number) { await q(`update processing_jobs set estado = 'pendente', tentativas = 0, disponivel_em = now(), erro = null where id = $1 and estado in ('morto','erro')`, [id]); }

let timer: NodeJS.Timeout | null = null;
export function iniciarWorker(intervaloMs = 1000) {
  if (timer) return;
  const tick = async () => { try { await rodarFila(); await publicarOutbox(); } catch (e) { console.error('[worker]', redigir(String(e))); } finally { timer = setTimeout(tick, intervaloMs); } };
  timer = setTimeout(tick, intervaloMs);
}
export function pararWorker() { if (timer) clearTimeout(timer); timer = null; }
