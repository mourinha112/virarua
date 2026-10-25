/* Amizade: pedido aceito pelos dois lados; recusar, cancelar, remover; bloqueio unilateral (impede pedido,
   visita a casa e emote direcionado). Sem mensagens privadas: só emotes/frases predefinidas. */
import { q, q1, emitir, type Exec, type Tx } from '../../db/db';
import { ErroHttp } from '../../http/app';
import { SQL_HANDLE } from './comum';
import { estadoPresencaSql } from './presenca';

export async function bloqueado(a: string, b: string, ex: Exec) {
  return !!(await q1(`select 1 from user_blocks where (user_id = $1 and bloqueado_id = $2) or (user_id = $2 and bloqueado_id = $1)`, [a, b], ex));
}
export async function saoAmigos(a: string, b: string, ex: Exec) {
  return !!(await q1(`select 1 from friendships where estado = 'aceita' and least(solicitante_id, destinatario_id) = least($1::uuid, $2::uuid) and greatest(solicitante_id, destinatario_id) = greatest($1::uuid, $2::uuid)`, [a, b], ex));
}

/** resolve o alvo por userId ou por @ (username atual da identidade ativa) */
export async function resolverUsuario(d: { userId?: unknown; handle?: unknown }, ex: Exec): Promise<string> {
  if (typeof d.userId === 'string' && /^[0-9a-f-]{36}$/i.test(d.userId)) {
    const u = await q1<{ id: string }>(`select id from users where id = $1 and status = 'ativo'`, [d.userId], ex); if (u) return u.id;
  }
  if (typeof d.handle === 'string') {
    const h = d.handle.trim().replace(/^@/, '').toLowerCase().slice(0, 40);
    const u = await q1<{ id: string }>(`select u.id from external_identities ei join users u on u.id = ei.user_id where lower(ei.username) = $1 and ei.revogado_em is null and u.status = 'ativo' limit 1`, [h], ex);
    if (u) return u.id;
  }
  throw new ErroHttp(404, 'pessoa não encontrada');
}

export async function pedirAmizade(c: Tx, userId: string, alvo: string) {
  if (alvo === userId) throw new ErroHttp(400, 'você não pode pedir amizade para você mesmo');
  if (await bloqueado(userId, alvo, c)) throw new ErroHttp(403, 'não é possível enviar pedido para essa pessoa');
  const pend = (await q1<{ n: number }>(`select count(*)::int n from friendships where solicitante_id = $1 and estado = 'pendente'`, [userId], c))!.n;
  if (pend >= 50) throw new ErroHttp(429, 'muitos pedidos pendentes: espere responderem');
  const atual = await q1<{ id: string; solicitante_id: string; estado: string }>(
    `select id, solicitante_id, estado from friendships where estado in ('pendente','aceita') and least(solicitante_id, destinatario_id) = least($1::uuid, $2::uuid) and greatest(solicitante_id, destinatario_id) = greatest($1::uuid, $2::uuid) for update`, [userId, alvo], c);
  if (atual?.estado === 'aceita') return { id: atual.id, estado: 'aceita' as const };
  if (atual && atual.solicitante_id === alvo) {          // o outro já tinha pedido: os dois lados querem → aceita
    await c.query(`update friendships set estado = 'aceita', respondido_em = now() where id = $1`, [atual.id]);
    await emitir(c, 'amizade.aceita', { id: atual.id, a: alvo, b: userId });
    return { id: atual.id, estado: 'aceita' as const };
  }
  if (atual) return { id: atual.id, estado: 'pendente' as const };
  const r = await q1<{ id: string }>(`insert into friendships (solicitante_id, destinatario_id) values ($1, $2) on conflict do nothing returning id`, [userId, alvo], c);
  if (!r) { const x = (await q1<{ id: string; estado: string }>(`select id, estado from friendships where estado in ('pendente','aceita') and least(solicitante_id, destinatario_id) = least($1::uuid, $2::uuid) and greatest(solicitante_id, destinatario_id) = greatest($1::uuid, $2::uuid)`, [userId, alvo], c))!; return { id: x.id, estado: x.estado as 'pendente' | 'aceita' }; }
  await emitir(c, 'amizade.pedido', { id: r.id, de: userId, para: alvo });
  return { id: r.id, estado: 'pendente' as const };
}

export async function responderPedido(c: Tx, userId: string, pedidoId: string, aceitar: boolean) {
  const p = await q1<{ id: string; solicitante_id: string; destinatario_id: string; estado: string }>(`select * from friendships where id = $1 for update`, [pedidoId], c);
  if (!p || p.destinatario_id !== userId) throw new ErroHttp(404, 'pedido não encontrado');
  if (p.estado !== 'pendente') throw new ErroHttp(409, 'esse pedido já foi respondido');
  await c.query(`update friendships set estado = $2, respondido_em = now() where id = $1`, [p.id, aceitar ? 'aceita' : 'recusada']);
  if (aceitar) await emitir(c, 'amizade.aceita', { id: p.id, a: p.solicitante_id, b: userId });
  return { estado: aceitar ? 'aceita' : 'recusada' };
}

/** remove amizade aceita ou cancela pedido pendente (qualquer lado) */
export async function removerAmizade(userId: string, outro: string, ex: Exec) {
  const r = await q(`update friendships set estado = case when estado = 'aceita' then 'removida' else 'cancelada' end, respondido_em = now()
                      where estado in ('pendente','aceita') and least(solicitante_id, destinatario_id) = least($1::uuid, $2::uuid) and greatest(solicitante_id, destinatario_id) = greatest($1::uuid, $2::uuid) returning id`, [userId, outro], ex);
  return r.length > 0;
}

export async function bloquear(c: Tx, userId: string, outro: string) {
  if (outro === userId) throw new ErroHttp(400, 'não dá para bloquear você mesmo');
  await c.query(`insert into user_blocks (user_id, bloqueado_id) values ($1, $2) on conflict do nothing`, [userId, outro]);
  await removerAmizade(userId, outro, c);
}
export async function desbloquear(userId: string, outro: string, ex: Exec) {
  await q(`delete from user_blocks where user_id = $1 and bloqueado_id = $2`, [userId, outro], ex);
}

export async function listarAmigos(userId: string, ex: Exec) {
  const base = (cond: string) => `
    select f.id, u.id "userId", u.nome_publico nome, ${SQL_HANDLE} handle, f.criado_em "desde", ${estadoPresencaSql('$1', 'u.id')} estado,
           case when ${estadoPresencaSql('$1', 'u.id')} in ('online','away') then ps.location_id end "destinoId",
           case when ${estadoPresencaSql('$1', 'u.id')} in ('online','away') then l.nome end "destinoNome",
           h.id "houseId", hp.ibge
      from friendships f join users u on u.id = case when f.solicitante_id = $1 then f.destinatario_id else f.solicitante_id end
      left join privacy_preferences pp on pp.user_id = u.id
      left join lateral (select ei.username from external_identities ei where ei.user_id = u.id and ei.revogado_em is null limit 1) ei on true
      left join presence_sessions ps on ps.user_id = u.id and ps.expira_em > now()
      left join locations l on l.id = ps.location_id
      left join houses h on h.dono_user_id = u.id and h.principal and h.status = 'reivindicada'
      left join plots hp on hp.id = h.plot_id
     where ${cond} order by u.nome_publico`;
  const amigos = await q(base(`f.estado = 'aceita' and $1 in (f.solicitante_id, f.destinatario_id)`), [userId], ex);
  const recebidos = await q(base(`f.estado = 'pendente' and f.destinatario_id = $1`), [userId], ex);
  const enviados = await q(base(`f.estado = 'pendente' and f.solicitante_id = $1`), [userId], ex);
  const bloqueados = await q(`select b.bloqueado_id "userId", u.nome_publico nome from user_blocks b join users u on u.id = b.bloqueado_id where b.user_id = $1`, [userId], ex);
  const limpa = (l: any[]) => l.map(({ id, ...r }) => ({ pedidoId: id, ...r }));
  return { amigos: limpa(amigos), recebidos: limpa(recebidos).map(({ estado, destinoId, destinoNome, ...r }: any) => r), enviados: limpa(enviados).map(({ estado, destinoId, destinoNome, ...r }: any) => r), bloqueados };
}
