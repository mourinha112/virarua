/* Pontos que vêm do Instagram (fora das missões):
   - comentar num post do jogo: +5 XP, 1 por post por dia (só para quem já tem conta);
   - marcar um @amigo no comentário: +50 XP quando esse amigo ganha a casa e confirma.
     Vale só para quem marcou primeiro e só se o amigo ainda não tinha casa quando foi marcado.
   - marcar o @ de uma loja patrocinada do mapa no comentário: +10 XP, 1 vez por loja.
   Seguir loja NÃO dá ponto: o Instagram não deixa conferir quem segue uma conta. */
import type { Tx } from '../../db/db';
import { q, q1 } from '../../db/db';
import { conceder } from '../recompensas/ledger';
import { diaJogo } from '../recompensas/regras';
import { lojasParaMapa } from '../estabelecimentos/exportar';

const CONTA_OFICIAL = 'viraruajogo';
const RE_MENCAO = /(?:^|[^\w.])@([A-Za-z0-9._]{1,30})/g;
export const MAX_MENCOES = 5;

/** roda dentro de um savepoint: se os pontos falharem, a casa e o comentário seguem normais */
export async function isolado(c: Tx, nome: string, f: () => Promise<unknown>) {
  await c.query(`savepoint ${nome}`);
  try { await f(); await c.query(`release savepoint ${nome}`); }
  catch (e) { await c.query(`rollback to savepoint ${nome}`); console.error(`[${nome}]`, (e as Error)?.message || e); }
}

export function mencoes(texto: string, autor: string | null): string[] {
  const eu = (autor || '').toLowerCase(); const vistos = new Set<string>();
  for (const m of texto.matchAll(RE_MENCAO)) {
    const h = m[1].toLowerCase().replace(/\.+$/, '');
    if (!h || h === eu || h === CONTA_OFICIAL || !/^[a-z0-9._]{1,30}$/.test(h)) continue;
    vistos.add(h); if (vistos.size >= MAX_MENCOES) break;
  }
  return [...vistos];
}

/** chamado para todo comentário válido de autor conhecido (from.id), num post do jogo */
export async function pontosDoComentario(c: Tx, a: { escopo: string; externalId: string; username: string | null; mediaId: string | null; commentId: string; texto: string }) {
  const ms = mencoes(a.texto, a.username);
  const lojas = ms.length ? new Set((await lojasParaMapa({ ex: c })).map((l) => l.ig).filter(Boolean) as string[]) : new Set<string>();
  // as marcações de amigo ficam guardadas mesmo se quem marcou ainda não tem conta (paga quando tiver)
  for (const h of ms) {
    if (lojas.has(h)) continue;
    await c.query(`insert into ig_indicacoes (escopo, autor_external_id, indicado_username, comment_id) values ($1, $2, $3, $4) on conflict do nothing`,
      [a.escopo, a.externalId, h, a.commentId]);
  }
  const u = await q1<{ user_id: string }>(`select user_id from external_identities where provedor = 'instagram' and escopo = $1 and external_id = $2 and user_id is not null and revogado_em is null`, [a.escopo, a.externalId], c);
  if (!u) return;
  if (a.mediaId) await conceder(c, { userId: u.user_id, regraId: 'xp5_comentario@1', eventoRef: `ig:${a.mediaId}:${diaJogo()}`, origem: 'instagram', dados: { comentario: a.commentId } });
  // @ de loja patrocinada do mapa marcado no comentário: +10 XP, 1 vez por loja
  for (const h of ms) if (lojas.has(h)) await conceder(c, { userId: u.user_id, regraId: 'xp10_loja@1', eventoRef: 'loja:' + h, origem: 'instagram', dados: { comentario: a.commentId } });
}

/** chamado quando uma casa é reivindicada: liga o amigo a quem o marcou primeiro e paga o que der */
export async function pagarIndicacoes(c: Tx, identityId: string) {
  const eu = await q1<{ username: string | null; escopo: string; external_id: string; criada_em: Date | null }>(
    `select ei.username, ei.escopo, ei.external_id, h.criada_em from external_identities ei
       left join houses h on h.dono_identity_id = ei.id and h.principal and h.status = 'reivindicada' where ei.id = $1`, [identityId], c);
  if (!eu) return;
  // 1) eu fui marcado antes de ter casa? vale a marcação mais antiga de outra pessoa
  if (eu.username && eu.criada_em) {
    await c.query(
      `update ig_indicacoes set indicado_identity_id = $1 where id = (
         select id from ig_indicacoes where indicado_username = $2 and escopo = $3 and autor_external_id <> $4 and indicado_identity_id is null and criado_em <= $5
          and not exists (select 1 from ig_indicacoes x where x.indicado_identity_id = $1) order by criado_em limit 1)`,
      [identityId, eu.username.toLowerCase(), eu.escopo, eu.external_id, eu.criada_em]);
  }
  // 2) paga todas as ligadas e ainda não pagas em que eu sou o amigo ou quem marcou (os dois precisam ter conta e casa confirmada)
  const pend = await q<{ id: string; user_id: string; indicado_identity_id: string; indicado: string }>(
    `select i.id, a.user_id, i.indicado_identity_id, i.indicado_username indicado from ig_indicacoes i
       join external_identities a on a.provedor = 'instagram' and a.escopo = i.escopo and a.external_id = i.autor_external_id and a.user_id is not null and a.revogado_em is null
       join houses hi on hi.dono_identity_id = i.indicado_identity_id and hi.principal and hi.status = 'reivindicada'
      where i.pago_em is null and (i.indicado_identity_id = $1 or (a.id = $1))`, [identityId], c);
  for (const p of pend) {
    await conceder(c, { userId: p.user_id, regraId: 'xp50_amigo@1', eventoRef: 'amigo:' + p.indicado_identity_id, origem: 'instagram', dados: { amigo: p.indicado } });
    await c.query(`update ig_indicacoes set pago_em = now() where id = $1`, [p.id]);
  }
}

/** para a tela de pontos: amigos marcados e quanto rendeu */
export async function resumoIndicacoes(userId: string) {
  return q<{ amigo: string; estado: 'pago' | 'esperando' }>(
    `select i.indicado_username amigo, case when i.pago_em is not null then 'pago' else 'esperando' end estado
       from ig_indicacoes i join external_identities a on a.provedor = 'instagram' and a.escopo = i.escopo and a.external_id = i.autor_external_id
      where a.user_id = $1 order by i.pago_em desc nulls last, i.criado_em desc limit 30`, [userId]);
}
