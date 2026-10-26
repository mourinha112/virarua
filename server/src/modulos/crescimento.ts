/* Crescimento: guerra de cidades, caça ao tesouro, ofensiva, enfeites da casa e bônus do link de vizinho.
   Rotas públicas:  GET /api/guerra?ibge=  · GET /api/tesouro · GET /api/enfeites?ibge=1,2
   Rotas logadas:   POST /api/tesouro/cavar {ibge} · GET/POST /api/decor/eu
   Admin:           GET /api/admin/divulgar (baú da semana com as dicas + ultrapassagens com legenda pronta)
   Pontos da guerra (semana seg→dom): 10 por casa nova na cidade + todo XP ganho pelos moradores na semana. */
import type { App } from '../http/app';
import { exigirLogin, ErroHttp, limite } from '../http/app';
import { q, q1, tx, db, type Exec } from '../db/db';
import { conceder } from './recompensas/ledger';
import { diaJogo, semanaJogo, somarDias } from './recompensas/regras';
import { ofensivaDe } from './recompensas/ofensiva';
import { exigirArea } from './admin/auth';

const REGIAO: Record<string, string> = {
  AC: 'Norte', AM: 'Norte', AP: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
  AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste', PE: 'Nordeste', PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
  DF: 'Centro-Oeste', GO: 'Centro-Oeste', MS: 'Centro-Oeste', MT: 'Centro-Oeste',
  ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste', PR: 'Sul', RS: 'Sul', SC: 'Sul',
};

/* ---------------- guerra de cidades ---------------- */
type LinhaGuerra = { ibge: number; nome: string; uf: string; pts: number; casas_novas: number; xp: number; moradores: number };
let cacheGuerra: { semana: string; em: number; cidades: LinhaGuerra[]; estados: { uf: string; pts: number; cidades: number }[] } | null = null;

export async function placarSemana(ex?: Exec, semana = semanaJogo()) {
  const cidades = await q<LinhaGuerra>(
    `with casas as (select p.ibge, count(*)::int n from houses h join plots p on p.id = h.plot_id
                     where h.principal and h.status in ('reservada','reivindicada') and h.criada_em >= ($1::date)::timestamp at time zone 'America/Sao_Paulo' group by 1),
          xp as (select p.ibge, sum(l.quantidade)::int n from reward_ledger l
                   join houses h on h.dono_user_id = l.user_id and h.principal and h.status = 'reivindicada' join plots p on p.id = h.plot_id
                  where l.sistema = 'xp' and l.dia >= $1::date group by 1),
          mor as (select p.ibge, count(*)::int n from houses h join plots p on p.id = h.plot_id where h.principal and h.status in ('reservada','reivindicada') group by 1)
     select m.ibge, m.nome, m.uf, (coalesce(c.n, 0) * 10 + coalesce(x.n, 0))::int pts, coalesce(c.n, 0) casas_novas, coalesce(x.n, 0) xp, mor.n moradores
       from mor join municipios m on m.ibge = mor.ibge left join casas c on c.ibge = mor.ibge left join xp x on x.ibge = mor.ibge
      order by pts desc, mor.n desc, m.nome`, [semana], ex);
  const porUf = new Map<string, { uf: string; pts: number; cidades: number }>();
  for (const c of cidades) { const e = porUf.get(c.uf) || { uf: c.uf, pts: 0, cidades: 0 }; e.pts += c.pts; e.cidades++; porUf.set(c.uf, e); }
  const estados = [...porUf.values()].sort((a, b) => b.pts - a.pts || b.cidades - a.cidades || a.uf.localeCompare(b.uf));
  return { cidades, estados };
}

/** compara com a última posição gravada e registra quem passou quem (cidades do top 30 e estados) */
async function registrarUltrapassagens(semana: string, tipo: 'cidade' | 'estado', lista: { chave: string; pts: number }[]) {
  if (!lista.length) return;
  const antes = new Map((await q<{ chave: string; pos: number }>(`select chave, pos from city_war_positions where semana = $1 and tipo = $2`, [semana, tipo])).map((r) => [r.chave, r.pos]));
  await tx(async (c) => {
    for (let i = 0; i < lista.length; i++) {
      const pos = i + 1, it = lista[i], era = antes.get(it.chave);
      if (era !== undefined && pos < era && pos <= 30 && it.pts > 0) {
        // passou todo mundo que estava entre a posição nova e a antiga
        for (let k = i + 1; k < lista.length && k < i + 4; k++) {
          const o = lista[k], eraO = antes.get(o.chave);
          if (eraO !== undefined && eraO < era) await c.query(`insert into city_war_events (semana, tipo, chave, passou, pos) values ($1, $2, $3, $4, $5) on conflict do nothing`, [semana, tipo, it.chave, o.chave, pos]);
        }
      }
      await c.query(`insert into city_war_positions (semana, tipo, chave, pos, pts) values ($1, $2, $3, $4, $5) on conflict (semana, tipo, chave) do update set pos = excluded.pos, pts = excluded.pts`, [semana, tipo, it.chave, pos, it.pts]);
    }
  });
}

export async function guerra(forcar = false) {
  const semana = semanaJogo();
  if (!forcar && cacheGuerra && cacheGuerra.semana === semana && Date.now() - cacheGuerra.em < 120_000) return cacheGuerra;
  const p = await placarSemana(undefined, semana);
  cacheGuerra = { semana, em: Date.now(), ...p };
  await registrarUltrapassagens(semana, 'cidade', p.cidades.slice(0, 200).map((c) => ({ chave: String(c.ibge), pts: c.pts })));
  await registrarUltrapassagens(semana, 'estado', p.estados.map((e) => ({ chave: e.uf, pts: e.pts })));
  return cacheGuerra;
}

async function eventosGuerra(limite = 20) {
  const ev = await q<{ tipo: string; chave: string; passou: string; pos: number; criado_em: Date }>(`select tipo, chave, passou, pos, criado_em from city_war_events order by criado_em desc limit $1`, [limite]);
  const ibges = [...new Set(ev.filter((e) => e.tipo === 'cidade').flatMap((e) => [Number(e.chave), Number(e.passou)]))];
  const nomes = new Map((await q<{ ibge: number; nome: string; uf: string }>(`select ibge, nome, uf from municipios where ibge = any($1::int[])`, [ibges])).map((m) => [String(m.ibge), `${m.nome}-${m.uf}`]));
  return ev.map((e) => {
    const a = e.tipo === 'cidade' ? nomes.get(e.chave) || e.chave : e.chave, b = e.tipo === 'cidade' ? nomes.get(e.passou) || e.passou : e.passou;
    return { tipo: e.tipo, a, b, pos: e.pos, quando: e.criado_em,
      legenda: `🔥 ${a} passou ${b} na guerra de ${e.tipo === 'cidade' ? 'cidades' : 'estados'} e agora é #${e.pos} da semana! Comenta a sua cidade e UF aqui e ajuda ela a subir 👇` };
  });
}

/* ---------------- caça ao tesouro ---------------- */
const MAX_CAVADAS_DIA = 5;
const calor = (km: number) => (km === 0 ? 'achou' : km < 60 ? 'fervendo' : km < 200 ? 'quente' : km < 600 ? 'morno' : 'frio');

async function bauDaSemana(semana = semanaJogo()) {
  let h = await q1<{ ibge: number }>(`select ibge from treasure_hunts where semana = $1`, [semana]);
  if (!h) {
    // sorteia entre as cidades que já têm casa (dá para chegar lá pelo mapa); sem nenhuma, uma cidade grande
    const alvo = (await q1<{ ibge: number }>(`select p.ibge from houses h join plots p on p.id = h.plot_id where h.status in ('reservada','reivindicada') group by 1 order by random() limit 1`))
      || (await q1<{ ibge: number }>(`select ibge from municipios where pop > 100000 order by random() limit 1`));
    await q(`insert into treasure_hunts (semana, ibge) values ($1, $2) on conflict do nothing`, [semana, alvo!.ibge]);
    h = await q1<{ ibge: number }>(`select ibge from treasure_hunts where semana = $1`, [semana]);
  }
  const m = (await q1<{ ibge: number; nome: string; uf: string; x: number; y: number; casas: number }>(
    `select m.ibge, m.nome, m.uf, m.x, m.y, (select count(*)::int from houses h join plots p on p.id = h.plot_id where p.ibge = m.ibge and h.status in ('reservada','reivindicada')) casas
       from municipios m where m.ibge = $1`, [h!.ibge]))!;
  return m;
}

/** dicas: uma nova por dia da semana (seg = 1ª) */
function dicasDe(m: { nome: string; uf: string; casas: number }) {
  const letras = m.nome.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const escondido = m.nome.split('').map((ch, i) => (/[A-Za-zÀ-ÿ]/.test(ch) && i % 3 !== 0 ? '_' : ch)).join(' ');
  return [
    `fica na região ${REGIAO[m.uf] || 'do Brasil'}`,
    `o estado é ${m.uf}`,
    `o nome começa com "${m.nome[0]}"`,
    `o nome tem ${letras.length} letras${m.nome.includes(' ') ? ` e ${m.nome.split(' ').length} palavras` : ''}`,
    `a cidade tem ${m.casas} ${m.casas === 1 ? 'casa' : 'casas'} no mapa`,
    `o nome termina com "${m.nome.slice(-1)}"`,
    `quase lá: ${escondido}`,
  ];
}
const diaDaSemana = (semana: string) => { const hoje = diaJogo(); let i = 0; while (i < 6 && somarDias(semana, i + 1) <= hoje) i++; return i; };

async function estadoTesouro(userId: string | null) {
  const semana = semanaJogo(), m = await bauDaSemana(semana);
  const dicas = dicasDe(m).slice(0, diaDaSemana(semana) + 1);
  const achados = await q<{ ordem: number; nome: string }>(
    `select f.ordem, coalesce(ei.username, u.nome_publico) nome from treasure_finds f join users u on u.id = f.user_id
       left join external_identities ei on ei.user_id = u.id and ei.revogado_em is null where f.semana = $1 order by f.ordem limit 10`, [semana]);
  let eu: any = null;
  if (userId) {
    const cav = await q<{ ibge: number; nome: string; uf: string; km: number; dia: string }>(
      `select d.ibge, m.nome, m.uf, d.km, to_char(d.dia, 'YYYY-MM-DD') dia from treasure_digs d join municipios m on m.ibge = d.ibge where d.semana = $1 and d.user_id = $2 order by d.criado_em desc`, [semana, userId]);
    const achou = await q1(`select ordem from treasure_finds where semana = $1 and user_id = $2`, [semana, userId]);
    const hoje = diaJogo();
    eu = { cavadas: cav.map((x) => ({ ...x, calor: calor(x.km) })), restam: Math.max(0, MAX_CAVADAS_DIA - cav.filter((x) => x.dia === hoje).length), achou: !!achou, ordem: achou?.ordem ?? null };
  }
  return { semana, fecha: somarDias(semana, 7), dicas, total_dicas: 7, achados, max_dia: MAX_CAVADAS_DIA, eu, ...(eu?.achou ? { cidade: `${m.nome}-${m.uf}` } : {}) };
}

async function cavar(userId: string, ibge: number) {
  const semana = semanaJogo(), alvo = await bauDaSemana(semana), hoje = diaJogo();
  return tx(async (c) => {
    await c.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, ['tesouro:' + userId]);
    const casa = await q1(`select 1 from houses where dono_user_id = $1 and principal and status = 'reivindicada'`, [userId], c);
    if (!casa) throw new ErroHttp(403, 'confirme a sua casa para cavar');
    if (await q1(`select 1 from treasure_finds where semana = $1 and user_id = $2`, [semana, userId], c)) throw new ErroHttp(409, 'você já achou o baú desta semana');
    const n = (await q1<{ n: number }>(`select count(*)::int n from treasure_digs where semana = $1 and user_id = $2 and dia = $3`, [semana, userId, hoje], c))!.n;
    if (n >= MAX_CAVADAS_DIA) throw new ErroHttp(429, `suas ${MAX_CAVADAS_DIA} pás de hoje acabaram: volte amanhã (sai dica nova)`);
    const m = await q1<{ x: number; y: number; nome: string; uf: string }>(`select x, y, nome, uf from municipios where ibge = $1`, [ibge], c);
    if (!m) throw new ErroHttp(404, 'cidade não encontrada');
    const km = ibge === alvo.ibge ? 0 : Math.max(1, Math.round(Math.hypot(m.x - alvo.x, m.y - alvo.y)));
    await c.query(`insert into treasure_digs (semana, user_id, dia, ibge, km) values ($1, $2, $3, $4, $5)`, [semana, userId, hoje, ibge, km]);
    let premio = null as null | { ordem: number; xp: number };
    if (km === 0) {
      await c.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, ['tesouro-ordem:' + semana]);
      const ordem = (await q1<{ n: number }>(`select count(*)::int + 1 n from treasure_finds where semana = $1`, [semana], c))!.n;
      await c.query(`insert into treasure_finds (semana, user_id, ordem) values ($1, $2, $3)`, [semana, userId, ordem]);
      const r = await conceder(c, { userId, regraId: ordem === 1 ? 'xp50_tesouro@1' : 'xp20_tesouro@1', eventoRef: 'tesouro:' + semana, origem: 'tesouro' });
      premio = { ordem, xp: r.quantidade };
    }
    return { cidade: `${m.nome}-${m.uf}`, km, calor: calor(km), premio, restam: MAX_CAVADAS_DIA - n - 1 };
  });
}

/* ---------------- enfeites da casa ---------------- */
export const ENFEITES: { id: string; nome: string; meta: number }[] = [
  { id: 'horta', nome: 'horta', meta: 20 }, { id: 'bandeira', nome: 'bandeira do time', meta: 40 },
  { id: 'carro', nome: 'carro na garagem', meta: 80 }, { id: 'piscina', nome: 'piscina', meta: 150 },
];
const RE_BANDEIRA = /^#[0-9a-f]{6}-#[0-9a-f]{6}$/;
const xpDe = async (userId: string) => (await q1<{ s: number }>(`select coalesce(sum(quantidade), 0)::int s from reward_ledger where user_id = $1 and sistema = 'xp'`, [userId]))!.s;
const nivelChama = (dias: number) => (dias >= 30 ? 3 : dias >= 7 ? 2 : dias >= 3 ? 1 : 0);

export function registrarCrescimento(app: App) {
  app.get('/api/guerra', limite(120), async (c) => {
    const g = await guerra();
    const ibge = Number(c.req.query('ibge')) || 0;
    const i = ibge ? g.cidades.findIndex((x) => x.ibge === ibge) : -1;
    const minha = i >= 0 ? { pos: i + 1, ...g.cidades[i], acima: g.cidades[i - 1] || null, abaixo: g.cidades[i + 1] || null, falta: i > 0 ? g.cidades[i - 1].pts - g.cidades[i].pts + 1 : 0 } : null;
    const uf = minha?.uf, j = uf ? g.estados.findIndex((e) => e.uf === uf) : -1;
    return c.json({ ok: true, semana: g.semana, fecha: somarDias(g.semana, 7), cidades: g.cidades.slice(0, 30), total_cidades: g.cidades.length, estados: g.estados, minha,
      meu_estado: j >= 0 ? { pos: j + 1, ...g.estados[j] } : null, eventos: (await eventosGuerra(8)).map(({ legenda: _l, ...e }) => e) });
  });

  app.get('/api/tesouro', limite(120), async (c) => c.json({ ok: true, ...(await estadoTesouro(c.get('usuario')?.id ?? null)) }));
  app.post('/api/tesouro/cavar', limite(30), async (c) => {
    const u = exigirLogin(c);
    const b = await c.req.json().catch(() => ({} as any));
    const ibge = Number(b.ibge); if (!Number.isInteger(ibge) || ibge <= 0) throw new ErroHttp(400, 'escolha uma cidade');
    return c.json({ ok: true, ...(await cavar(u.id, ibge)) });
  });

  app.get('/api/decor/eu', async (c) => {
    const u = exigirLogin(c);
    const [xp, d, of] = await Promise.all([xpDe(u.id), q1<{ itens: string[]; bandeira: string | null }>(`select itens, bandeira from house_decor where user_id = $1`, [u.id]), ofensivaDe(db(), u.id)]);
    return c.json({ ok: true, xp, enfeites: ENFEITES.map((e) => ({ ...e, liberado: xp >= e.meta })), escolhidos: d?.itens || [], bandeira: d?.bandeira || null, ofensiva: { ...of, chama: nivelChama(of.dias) } });
  });
  app.post('/api/decor/eu', limite(30), async (c) => {
    const u = exigirLogin(c);
    const b = await c.req.json().catch(() => ({} as any));
    const xp = await xpDe(u.id);
    const pedidos = Array.isArray(b.itens) ? [...new Set(b.itens.map(String))] : [];
    for (const id of pedidos) {
      const e = ENFEITES.find((x) => x.id === id); if (!e) throw new ErroHttp(400, 'enfeite desconhecido');
      if (xp < e.meta) throw new ErroHttp(403, `${e.nome} libera com ${e.meta} XP`);
    }
    const bandeira = typeof b.bandeira === 'string' && RE_BANDEIRA.test(b.bandeira.toLowerCase()) ? b.bandeira.toLowerCase() : null;
    if (!(await q1(`select 1 from houses where dono_user_id = $1 and principal and status = 'reivindicada'`, [u.id]))) throw new ErroHttp(403, 'confirme a sua casa primeiro');
    await q(`insert into house_decor (user_id, itens, bandeira) values ($1, $2, $3) on conflict (user_id) do update set itens = excluded.itens, bandeira = excluded.bandeira, atualizado_em = now()`, [u.id, pedidos, bandeira]);
    return c.json({ ok: true, escolhidos: pedidos, bandeira });
  });

  // público, para o mapa: enfeites escolhidos + chama da ofensiva de cada casa das cidades pedidas
  app.get('/api/enfeites', limite(120), async (c) => {
    const ibges = String(c.req.query('ibge') || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 30);
    if (!ibges.length) return c.json({ ok: true, casas: [] });
    const casas = await q<{ user_id: string; ibge: number; lote: number; itens: string[] | null; bandeira: string | null; recente: boolean }>(
      `select h.dono_user_id user_id, p.ibge, p.lote_index lote, d.itens, d.bandeira,
              exists (select 1 from mission_completions mc where mc.user_id = h.dono_user_id and mc.dia >= (now() at time zone 'America/Sao_Paulo')::date - 1) recente
         from houses h join plots p on p.id = h.plot_id left join house_decor d on d.user_id = h.dono_user_id
        where p.ibge = any($1::int[]) and h.principal and h.status = 'reivindicada' limit 3000`, [ibges]);
    const out: { ibge: number; lote: number; itens: string[]; bandeira: string | null; chama: number }[] = [];
    let calculadas = 0;
    for (const h of casas) {
      let chama = 0;
      if (h.recente && calculadas < 300) { calculadas++; chama = nivelChama((await ofensivaDe(db(), h.user_id)).dias); }
      const itens = h.itens || [];
      if (itens.length || chama) out.push({ ibge: h.ibge, lote: h.lote, itens, bandeira: h.bandeira, chama });
    }
    return c.json({ ok: true, casas: out });
  });

  app.get('/api/admin/divulgar', async (c) => {
    await exigirArea(c, 'divulgar');
    const semana = semanaJogo(), m = await bauDaSemana(semana), dicas = dicasDe(m);
    const achados = (await q1<{ n: number }>(`select count(*)::int n from treasure_finds where semana = $1`, [semana]))!.n;
    const g = await guerra();
    return c.json({ ok: true,
      tesouro: { semana, cidade: `${m.nome}-${m.uf}`, achados, dicas: dicas.map((d, i) => ({ dia: somarDias(semana, i), texto: d, legenda: `🗝️ Caça ao tesouro do ViraRua · dica ${i + 1}: ${d}. Abre o mapa, escolhe a cidade e cava! Quem achar primeiro ganha +50 XP 🏆` })) },
      guerra: { semana, top: g.cidades.slice(0, 10), estados: g.estados.slice(0, 10), eventos: await eventosGuerra(30) } });
  });
}
