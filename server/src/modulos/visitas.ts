/* Visita na casa e "online agora".
   GET  /api/casa-social/:handle            contadores da casa (campainha hoje, curtidas, adesivos) + o que eu já fiz
   POST /api/casa-social/:handle/campainha  { adesivo }  1 por visitante por casa por dia · +1 XP pro dono
   POST /api/casa-social/:handle/curtir                   1 vez por visitante por casa · +1 XP pro dono
   POST /api/online { v }                   ping anônimo (id aleatório do aparelho, só em memória) → quantos online
   O dono ganha XP só com a casa reivindicada, nunca de si mesmo, até MAX_XP_VISITA por dia. */
import type { App } from '../http/app';
import { exigirLogin, ErroHttp, limite } from '../http/app';
import { q, q1, tx, type Exec } from '../db/db';
import { conceder } from './recompensas/ledger';
import { diaJogo } from './recompensas/regras';
import { notificar } from './notificacoes';

export const ADESIVOS = ['fogo', 'mao', 'coracao', 'estrela', 'festa'] as const;
export const MAX_XP_VISITA = 20;
const ADESIVO_EMOJI: Record<string, string> = { fogo: '🔥', mao: '👋', coracao: '❤️', estrela: '⭐', festa: '🎉' };
const CURTIDA_DIA = '2000-01-01';   // curtida é uma vez só: dia fixo na chave única

type Casa = { id: string; dono: string | null; status: string; handle: string };
async function casaDo(handle: string, ex?: Exec): Promise<Casa> {
  const h = handle.replace(/^@+/, '').trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(h)) throw new ErroHttp(400, '@ inválido');
  const c = await q1<Casa>(`select h.id, h.dono_user_id dono, h.status, ei.username handle from houses h join external_identities ei on ei.id = h.dono_identity_id
                             where lower(ei.username) = $1 and h.status in ('reservada','reivindicada') order by h.principal desc, h.criada_em limit 1`, [h], ex);
  if (!c) throw new ErroHttp(404, 'casa não encontrada');
  return c;
}

export async function estadoSocial(handle: string, viewer: string | null, ex?: Exec) {
  const c = await casaDo(handle, ex), dia = diaJogo();
  const [cont, ades, meu] = await Promise.all([
    q1<{ hoje: number; curtidas: number; total: number }>(`select count(*) filter (where tipo = 'campainha' and dia = $2)::int hoje, count(*) filter (where tipo = 'curtida')::int curtidas,
                                                count(*) filter (where tipo = 'campainha')::int total from house_kudos where house_id = $1`, [c.id, dia], ex),
    q<{ adesivo: string; n: number }>(`select adesivo, count(*)::int n from house_kudos where house_id = $1 and tipo = 'campainha' and adesivo is not null group by adesivo`, [c.id], ex),
    viewer ? q<{ tipo: string; dia: string }>(`select tipo, dia::text dia from house_kudos where house_id = $1 and visitante_user_id = $2 and (tipo = 'curtida' or dia = $3)`, [c.id, viewer, dia], ex) : Promise.resolve([]),
  ]);
  return {
    casa: { handle: c.handle, reivindicada: c.status === 'reivindicada', minha: !!viewer && c.dono === viewer },
    campainhaHoje: cont!.hoje, campainhaTotal: cont!.total, curtidas: cont!.curtidas,
    adesivos: Object.fromEntries(ades.map((a) => [a.adesivo, a.n])),
    eu: { tocouHoje: meu.some((m) => m.tipo === 'campainha'), curtiu: meu.some((m) => m.tipo === 'curtida') },
  };
}

async function registrarKudo(userId: string, handle: string, tipo: 'campainha' | 'curtida', adesivo: string | null) {
  return tx(async (t) => {
    const c = await casaDo(handle, t);
    if (c.dono === userId) throw new ErroHttp(409, tipo === 'curtida' ? 'não dá pra curtir a própria casa' : 'essa campainha é sua 😄');
    const dia = tipo === 'curtida' ? CURTIDA_DIA : diaJogo();
    const r = await q1<{ id: number }>(`insert into house_kudos (house_id, visitante_user_id, tipo, adesivo, dia) values ($1,$2,$3,$4,$5) on conflict do nothing returning id`, [c.id, userId, tipo, adesivo, dia], t);
    if (!r) throw new ErroHttp(409, tipo === 'curtida' ? 'você já curtiu essa casa' : 'você já tocou essa campainha hoje · volta amanhã');
    let xp = 0;
    if (c.dono) {
      const quem = (await q1<{ u: string }>(`select coalesce(username, '') u from external_identities where user_id = $1 and revogado_em is null order by criado_em limit 1`, [userId], t))?.u || '';
      const ic = ADESIVO_EMOJI[adesivo || ''] || '♥';
      await notificar(t, [c.dono], tipo === 'curtida'
        ? { tipo: 'visita', titulo: '♥ curtiram a sua casa', texto: `@${quem || 'alguém'} curtiu a sua casa · +1 pra você`, acao: quem ? 'u:' + quem : 'casa', chave: `kudo:${r.id}` }
        : { tipo: 'visita', titulo: '🔔 tocaram a sua campainha', texto: `@${quem || 'alguém'} deixou ${ic} na sua porta · visite de volta!`, acao: quem ? 'u:' + quem : 'casa', chave: `kudo:${r.id}` });
    }
    if (c.dono && c.status === 'reivindicada') {
      const ja = (await q1<{ s: number }>(`select coalesce(sum(quantidade), 0)::int s from reward_ledger where user_id = $1 and origem = 'visita' and dia = $2`, [c.dono, diaJogo()], t))!.s;
      if (ja < MAX_XP_VISITA) xp = (await conceder(t, { userId: c.dono, regraId: 'xp1_visita@1', eventoRef: `${tipo}:${r.id}`, origem: 'visita', dados: { de: userId, tipo, adesivo } })).quantidade;
    }
    return { xpDono: xp };
  });
}

/* ---------- online agora (só memória, sem IP e sem conta) ---------- */
const vistos = new Map<string, number>();
const JANELA_MS = 3 * 60_000;
export function pingOnline(v: string, agora = Date.now()) {
  if (/^[a-z0-9]{16,40}$/.test(v)) vistos.set(v, agora);
  if (vistos.size > 50_000) vistos.clear();
  let n = 0; for (const [k, t] of vistos) { if (agora - t > JANELA_MS) vistos.delete(k); else n++; }
  return Math.max(1, n);
}

export function registrarVisitas(app: App) {
  app.get('/api/casa-social/:handle', limite(240), async (c) => c.json({ ok: true, ...(await estadoSocial((c.req.param('handle') || ''), c.get('usuario')?.id ?? null)) }));
  app.post('/api/casa-social/:handle/campainha', limite(60), async (c) => {
    const u = exigirLogin(c);
    const b = await c.req.json().catch(() => ({} as any));
    const adesivo = ADESIVOS.includes(b.adesivo) ? b.adesivo : null;
    if (!adesivo) throw new ErroHttp(400, 'escolha um adesivo');
    const r = await registrarKudo(u.id, (c.req.param('handle') || ''), 'campainha', adesivo);
    return c.json({ ok: true, ...r, ...(await estadoSocial((c.req.param('handle') || ''), u.id)) });
  });
  app.post('/api/casa-social/:handle/curtir', limite(60), async (c) => {
    const u = exigirLogin(c);
    const r = await registrarKudo(u.id, (c.req.param('handle') || ''), 'curtida', null);
    return c.json({ ok: true, ...r, ...(await estadoSocial((c.req.param('handle') || ''), u.id)) });
  });
  app.post('/api/online', limite(30), async (c) => {
    const b = await c.req.json().catch(() => ({} as any));
    return c.json({ ok: true, online: pingOnline(String(b.v || '')) });
  });
}
