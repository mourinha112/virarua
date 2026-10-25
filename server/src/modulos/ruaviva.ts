/* Rua ao vivo: quem está online na minha rua (com avatar e lote), acenos entre vizinhos, chamada da eleição da rua
   (turnout e quorum, nunca em quem votou) e ruas campeãs da cidade (troféu/faixa) para o mapa. */
import type { App } from '../http/app';
import { exigirLogin, ErroHttp, limite } from '../http/app';
import { q, q1 } from '../db/db';

async function minhaCasa(userId: string) {
  return q1<{ house_id: string; street_id: string; ibge: number; lote_index: number; rua: string }>(
    `select h.id house_id, sm.street_id, p.ibge, p.lote_index, vs.nome rua from houses h join plots p on p.id = h.plot_id
       join street_memberships sm on sm.house_id = h.id and sm.saiu_em is null join virtual_streets vs on vs.id = sm.street_id
      where h.dono_user_id = $1 and h.principal and h.status = 'reivindicada'`, [userId]);
}

export function registrarRuaViva(app: App) {
  app.get('/api/rua-viva', async (c) => {
    const u = exigirLogin(c); const m = await minhaCasa(u.id);
    if (!m) return c.json({ ok: true, rua: null });
    const moradores = await q<any>(
      `select h.dono_user_id user_id, p.lote_index, coalesce(ei.username, '') handle, a.config avatar,
              case when ps.expira_em > now() and coalesce(pp.presenca, 'visivel') <> 'invisivel' then ps.estado else 'offline' end estado
         from street_memberships sm join houses h on h.id = sm.house_id join plots p on p.id = h.plot_id
         left join external_identities ei on ei.user_id = h.dono_user_id and ei.revogado_em is null
         left join avatars a on a.house_id = h.id and a.ativo
         left join presence_sessions ps on ps.user_id = h.dono_user_id
         left join privacy_preferences pp on pp.user_id = h.dono_user_id
        where sm.street_id = $1 and sm.saiu_em is null and h.status = 'reivindicada'`, [m.street_id]);
    const acenos = await q<any>(`select w.id, w.de_user, coalesce(ei.username, '') handle, w.criado_em from street_waves w left join external_identities ei on ei.user_id = w.de_user and ei.revogado_em is null where w.para_user = $1 and w.criado_em > now() - interval '10 minutes' order by w.id desc limit 10`, [u.id]);
    const el = await q1<any>(`select e.id, e.estado, e.eleitorado, e.quorum, e.votacao_fecha, (select count(*)::int from votes v where v.election_id = e.id) votaram,
        (select count(*)::int from candidates k where k.election_id = e.id and k.estado = 'inscrito') candidatos
       from elections e where e.cargo = 'lider' and e.escopo_id = $1 order by e.criada_em desc limit 1`, [m.street_id]).catch(() => null);
    const campeas = await q<any>(`select vs.id street_id, vs.nome, a.tipo, array_agg(p.lote_index order by p.lote_index) lotes
        from competition_awards a join virtual_streets vs on vs.id = a.street_id join plots p on p.street_id = vs.id
       where vs.ibge = $1 and (a.valido_ate is null or a.valido_ate > now()) and a.tipo in ('trofeu','faixa')
       group by vs.id, vs.nome, a.tipo`, [m.ibge]).catch(() => []);
    return c.json({ ok: true, eu: u.id, rua: { id: m.street_id, nome: m.rua, ibge: m.ibge }, moradores, acenos, eleicao: el, campeas });
  });

  app.post('/api/rua-viva/acenar', limite(30), async (c) => {
    const u = exigirLogin(c); const b = await c.req.json().catch(() => ({} as any));
    const para = String(b.para || ''); if (!/^[0-9a-f-]{36}$/.test(para)) throw new ErroHttp(400, 'vizinho inválido');
    const m = await minhaCasa(u.id); if (!m) throw new ErroHttp(403, 'reivindique sua casa para acenar');
    const viz = await q1(`select 1 from street_memberships sm join houses h on h.id = sm.house_id where sm.street_id = $1 and sm.saiu_em is null and h.dono_user_id = $2`, [m.street_id, para]);
    if (!viz) throw new ErroHttp(403, 'só dá para acenar para vizinhos da sua rua');
    const rec = await q1<{ n: number }>(`select count(*)::int n from street_waves where de_user = $1 and para_user = $2 and criado_em > now() - interval '1 minute'`, [u.id, para]);
    if (rec!.n > 0) return c.json({ ok: true, repetido: true });
    await q(`insert into street_waves (street_id, de_user, para_user) values ($1, $2, $3)`, [m.street_id, u.id, para]);
    return c.json({ ok: true });
  });
}
