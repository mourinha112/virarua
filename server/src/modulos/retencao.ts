/* Retenção: o que faz a pessoa voltar todo dia.
   - Baú diário: 1 por dia, sequência de 7 dias (5, 10, 10, 15, 15, 20, 50 XP). Pulou um dia: volta pro dia 1.
   - Pet que sente falta: comida 1x por dia (+5 XP). Sem comida há 24h fica com fome; há 48h fica triste.
   - Chuva de baús: todo dia das 20h às 20h15 (Brasília) aparecem baús dourados nas cidades; cada baú vale +5 XP,
     até MAX_CHUVA_DIA por pessoa. As posições saem do layout público da cidade (o cliente calcula), o servidor
     só confere janela, índice, limite e repetição.
   Rotas (logado): GET /api/bau-diario · POST /api/bau-diario/abrir · POST /api/pets/eu/alimentar · POST /api/chuva/pegar
   Público: GET /api/chuva (janela e quantos baús por cidade). */
import type { App } from '../http/app';
import { exigirLogin, ErroHttp, limite } from '../http/app';
import { q1, tx, type Exec } from '../db/db';
import { conceder } from './recompensas/ledger';
import { diaJogo } from './recompensas/regras';

export const PREMIOS_BAU = [5, 10, 10, 15, 15, 20, 50];
export const MAX_CHUVA_DIA = 5;
export const BAUS_POR_CIDADE = 6;
export const CHUVA = { hora: 20, minutos: 15 };

const ontem = (dia: string) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

/* ---------- baú diário ---------- */
export async function estadoBau(userId: string, agora = new Date(), ex?: Exec) {
  const hoje = diaJogo(agora);
  const u = await q1<{ dia: string; seq: number }>(`select dia::text dia, seq from daily_chests where user_id = $1 order by dia desc limit 1`, [userId], ex);
  const aberto = u?.dia === hoje;
  const emDia = !!u && (aberto || u.dia === ontem(hoje));
  const seq = emDia ? u!.seq : 0;                                    // dias seguidos até agora
  const proximo = aberto ? (seq % 7) + 1 : emDia ? (seq % 7) + 1 : 1;  // o que o próximo baú vai dar (hoje ou amanhã)
  return { hoje, aberto, seq, proximo, perdeu: !!u && !emDia, premios: PREMIOS_BAU };
}
export async function abrirBau(userId: string, agora = new Date()) {
  return tx(async (t) => {
    await t.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, ['bau:' + userId]);
    const st = await estadoBau(userId, agora, t);
    if (st.aberto) throw new ErroHttp(409, 'o baú de hoje já foi aberto · volta amanhã!');
    const seq = st.proximo;
    const r = await conceder(t, { userId, regraId: `bau_d${seq}@1`, eventoRef: st.hoje, origem: 'bau', agora, dados: { seq } });
    await t.query(`insert into daily_chests (user_id, dia, seq, xp) values ($1, $2, $3, $4)`, [userId, st.hoje, seq, r.quantidade]);
    return { seq, xp: r.quantidade, pedida: PREMIOS_BAU[seq - 1], amanha: PREMIOS_BAU[seq % 7], premios: PREMIOS_BAU };
  });
}

/* ---------- pet com fome ---------- */
export function humorPet(alimentadoEm: Date | string | null, agora = new Date()) {
  const h = alimentadoEm ? (agora.getTime() - new Date(alimentadoEm).getTime()) / 3600_000 : 999;
  return h < 24 ? 'feliz' : h < 48 ? 'fome' : 'triste';
}
export async function alimentarPet(userId: string, agora = new Date()) {
  return tx(async (t) => {
    const p = await q1<{ nome: string; alimentado_em: Date }>(`select nome, alimentado_em from pets where user_id = $1 for update`, [userId], t);
    if (!p) throw new ErroHttp(404, 'você ainda não tem pet');
    const hoje = diaJogo(agora);
    const ja = await q1(`select 1 from reward_ledger where user_id = $1 and regra_id = 'xp5_pet@1' and evento_ref = $2`, [userId, hoje], t);
    if (ja) throw new ErroHttp(409, `${p.nome} já comeu hoje · volta amanhã!`);
    await t.query(`update pets set alimentado_em = $2 where user_id = $1`, [userId, agora]);
    const r = await conceder(t, { userId, regraId: 'xp5_pet@1', eventoRef: hoje, origem: 'pet', agora });
    return { nome: p.nome, humor: 'feliz' as const, xp: r.quantidade };
  });
}

/* ---------- chuva de baús ---------- */
export function janelaChuva(agora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(agora).map((x) => [x.type, x.value]));
  const min = Number(p.hour) * 60 + Number(p.minute), ini = CHUVA.hora * 60;
  const sempre = process.env.SMN_CHUVA_SEMPRE === '1';
  return { ativa: sempre || (min >= ini && min < ini + CHUVA.minutos), faltaMin: min < ini ? ini - min : 24 * 60 - min + ini, restaMin: sempre ? CHUVA.minutos : Math.max(0, ini + CHUVA.minutos - min) };
}
export async function pegarBau(userId: string, ibge: number, idx: number, agora = new Date()) {
  const j = janelaChuva(agora), graca = janelaChuva(new Date(agora.getTime() - 60_000));
  if (!j.ativa && !graca.ativa) throw new ErroHttp(409, 'a chuva de baús é todo dia às 20h (Brasília)');
  if (!Number.isInteger(ibge) || ibge <= 0 || !Number.isInteger(idx) || idx < 0 || idx >= BAUS_POR_CIDADE) throw new ErroHttp(400, 'baú inválido');
  return tx(async (t) => {
    await t.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, ['chuva:' + userId]);
    const dia = diaJogo(agora);
    const n = (await q1<{ n: number }>(`select count(*)::int n from rain_picks where user_id = $1 and dia = $2`, [userId, dia], t))!.n;
    if (n >= MAX_CHUVA_DIA) throw new ErroHttp(409, `você já pegou ${MAX_CHUVA_DIA} baús hoje · amanhã tem mais às 20h!`);
    const ok = await q1(`insert into rain_picks (user_id, dia, ibge, idx) values ($1, $2, $3, $4) on conflict do nothing returning 1`, [userId, dia, ibge, idx], t);
    if (!ok) throw new ErroHttp(409, 'você já pegou esse baú');
    const r = await conceder(t, { userId, regraId: 'xp5_chuva@1', eventoRef: `${dia}:${ibge}:${idx}`, origem: 'chuva', agora });
    return { xp: r.quantidade, pegos: n + 1, max: MAX_CHUVA_DIA };
  });
}

export function registrarRetencao(app: App) {
  app.get('/api/bau-diario', async (c) => { const u = exigirLogin(c); return c.json({ ok: true, ...(await estadoBau(u.id)) }); });
  app.post('/api/bau-diario/abrir', limite(20), async (c) => { const u = exigirLogin(c); return c.json({ ok: true, ...(await abrirBau(u.id)) }); });
  app.post('/api/pets/eu/alimentar', limite(20), async (c) => { const u = exigirLogin(c); return c.json({ ok: true, ...(await alimentarPet(u.id)) }); });
  app.get('/api/chuva', limite(120), async (c) => {
    const u = c.get('usuario');
    const pegos = u ? (await q1<{ n: number }>(`select count(*)::int n from rain_picks where user_id = $1 and dia = $2`, [u.id, diaJogo()]))!.n : 0;
    const meus = u ? (await q1<{ l: string[] }>(`select coalesce(array_agg(ibge || ':' || idx), '{}') l from rain_picks where user_id = $1 and dia = $2`, [u.id, diaJogo()]))!.l : [];
    return c.json({ ok: true, ...janelaChuva(), dia: diaJogo(), porCidade: BAUS_POR_CIDADE, max: MAX_CHUVA_DIA, pegos, meus });
  });
  app.post('/api/chuva/pegar', limite(60), async (c) => {
    const u = exigirLogin(c);
    const b = await c.req.json().catch(() => ({} as any));
    return c.json({ ok: true, ...(await pegarBau(u.id, Number(b.ibge), Number(b.idx))) });
  });
}
