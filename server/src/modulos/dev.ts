/* SÓ DESENVOLVIMENTO (SMN_AMBIENTE=dev): "entrar como teste" para experimentar o jogo logado sem o Instagram.
   Cria (ou reaproveita) uma conta de teste com casa reivindicada numa cidade, avatar e 5 vizinhos fictícios na mesma
   rua (para a eleição de líder da rua ter eleitores). Nunca é registrado em teste nem em produção. */
import type { App } from '../http/app';
import { criarSessao, ErroHttp } from '../http/app';
import { config } from '../config';
import { q1, tx } from '../db/db';
import { provisionar } from './mundo/provisionar';
import { garantirEleicao } from './eleicoes/dominio';

const ESCOPO = 'dev-teste';

async function casaReivindicada(c: any, externalId: string, username: string, ibge: number, nome: string, diasVerificado: number) {
  const r = await provisionar(c, { escopo: ESCOPO, externalId, username, ibge, origem: 'dev', provedor: 'instagram' });
  const idt = await q1<{ id: string; user_id: string | null }>(`select id, user_id from external_identities where id = $1`, [r.identityId], c);
  let userId = idt!.user_id;
  if (!userId) {
    userId = (await q1<{ id: string }>(`insert into users (nome_publico, verificado_em, faixa_etaria) values ($1, now() - make_interval(days => $2), 'adulto') returning id`, [nome, diasVerificado], c))!.id;
    await c.query(`update external_identities set user_id = $2 where id = $1`, [r.identityId, userId]);
  }
  await c.query(`update houses set dono_user_id = $2, status = 'reivindicada', reivindicada_em = coalesce(reivindicada_em, now()), expira_em = null where dono_identity_id = $1 and principal and status in ('reservada','reivindicada')`, [r.identityId, userId]);
  await c.query(`insert into onboarding (identity_id, estado) values ($1, 'onboarding_complete') on conflict (identity_id) do update set estado = 'onboarding_complete', atualizado_em = now()`, [r.identityId]);
  return userId;
}

export function registrarDev(app: App) {
  if (config.ambiente !== 'dev') return;
  app.post('/api/dev/entrar', async (c) => {
    if (config.ambiente !== 'dev') throw new ErroHttp(404, 'não encontrado');
    const b = await c.req.json().catch(() => ({} as any));
    const ibge = Number(b.ibge) || 3304557;
    const apelido = String(b.apelido || 'voce_teste').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 24) || 'voce_teste';
    const m = await q1<{ nome: string }>(`select nome from municipios where ibge = $1`, [ibge]);
    if (!m) throw new ErroHttp(400, 'cidade inválida');
    const userId = await tx(async (t) => {
      const u = await casaReivindicada(t, 'dev:' + apelido, 'teste.' + apelido, ibge, 'Você (teste)', 3);
      for (let k = 1; k <= 5; k++) await casaReivindicada(t, `dev:vizinho:${ibge}:${k}`, `teste.vizinho${k}`, ibge, `Vizinho ${k} (teste)`, 3);
      // eleição de líder da rua pronta para testar: 2 vizinhos candidatos e eleitorado com toda a rua (SÓ DEV)
      const rua = await q1<{ street_id: string }>(`select sm.street_id from houses h join street_memberships sm on sm.house_id = h.id and sm.saiu_em is null where h.dono_user_id = $1 and h.principal`, [u], t);
      if (rua) {
        const e = await garantirEleicao(t, 'lider' as any, rua.street_id, new Date());
        const membros = await t.query(`select h.dono_user_id uid, h.id hid, p.ibge, u2.verificado_em, (select ei.external_id from external_identities ei where ei.user_id = h.dono_user_id limit 1) ext from street_memberships sm join houses h on h.id = sm.house_id join plots p on p.id = h.plot_id join users u2 on u2.id = h.dono_user_id where sm.street_id = $1 and sm.saiu_em is null and h.status = 'reivindicada'`, [rua.street_id]);
        for (const m of membros.rows) await t.query(`insert into eligibility_snapshots (election_id, user_id, house_id, street_id, ibge, verificado_em, congelado_em) values ($1,$2,$3,$4,$5,$6,now()) on conflict do nothing`, [e.id, m.uid, m.hid, rua.street_id, m.ibge, m.verificado_em]);
        const viz = membros.rows.filter((m: any) => m.uid !== u && String(m.ext || '').startsWith('dev:vizinho:')).slice(0, 2);
        for (const v of viz) await t.query(`insert into candidates (season_id, election_id, user_id, cargo, intencao) select $1, $2, $3, 'lider', 'quero ser líder da rua (teste)' where not exists (select 1 from candidates where election_id = $2 and user_id = $3)`, [e.season_id, e.id, v.uid]);
        const n = membros.rows.length;
        await t.query(`update elections set estado = 'votacao', eleitorado = $2, quorum = $3, congelada_em = coalesce(congelada_em, now()), votacao_abre = least(votacao_abre, now()), votacao_fecha = greatest(votacao_fecha, now() + interval '1 day'), publica_em = greatest(publica_em, now() + interval '1 day 1 hour'), modo = 'disputa' where id = $1`, [e.id, n, Math.ceil(n * 0.3)]);
      }
      return u;
    });
    await criarSessao(c, userId);
    return c.json({ ok: true, aviso: 'conta de TESTE local (só em dev)', cidade: m.nome });
  });
}
