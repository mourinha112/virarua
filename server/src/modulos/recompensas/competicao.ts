/* Competição semanal de ruas (cap. 10) — independente de cargos: ruas disputam troféu; pessoas disputam cargos.
   - snapshot do elenco quando a temporada abre (competition_roster: uma rua por pessoa por temporada);
   - elegível com >= 3 membros ativos; divisões por tamanho do elenco: 3–8, 9–16, 17–24 (acima de 24 fica na 17–24);
   - score = soma das contribuições validadas do elenco snapshot naquela rua (ledger); quem sai não leva pontos e
     quem entra depois só pontua na próxima temporada;
   - grupo (cidade+divisão) com menos de 2 ruas elegíveis = modo cooperativo (meta local) + comparação opcional
     rotulada como liga regional, que não dá controle sobre outra cidade; divisões nunca são juntadas;
   - empate = colocação compartilhada e prêmio igual; prêmios são troféu/faixa/decoração, nunca dinheiro. */
import type { Exec } from '../../db/db';
import { emitir } from '../../db/db';
import { instanteLocal, semanaJogo, somarDias } from './regras';

export const MIN_ATIVOS = 3;
export const META_COOP_POR_MEMBRO = 60;
export const EXPLICACAO = 'Ruas disputam troféu e destaque no cenário; pessoas disputam cargos. Vencer o ranking não elege ninguém.';
export const REGRAS_TEXTO = [
  'temporada de segunda a domingo (horário de Brasília); o elenco é congelado quando a temporada abre',
  'rua elegível tem pelo menos 3 moradores ativos no início; divisões: 3–8, 9–16 e 17–24 moradores',
  'cada morador dá até 30 pontos por dia: 3 missões válidas de 10, uma por missão',
  'quem muda de rua não leva pontos; quem chega depois pontua a partir da próxima temporada',
  'sem adversário na cidade e divisão, a rua joga a meta cooperativa (e pode se comparar na liga regional, só como comparação)',
  'empate divide a colocação e o prêmio; prêmio é troféu, faixa e decoração — nada de dinheiro',
];

export function divisaoDe(n: number): string | null { return n < MIN_ATIVOS ? null : n <= 8 ? '3-8' : n <= 16 ? '9-16' : '17-24'; }

/** temporada da semana de `agora`; quem cria tira o snapshot na mesma transação */
export async function garantirTemporada(c: Exec, agora = new Date()) {
  const semana = semanaJogo(agora);
  const ins = (await c.query(
    `insert into competition_seasons (semana, inicio, fim, snapshot_em) values ($1, $2, $3, $4) on conflict (semana) do nothing returning *`,
    [semana, instanteLocal(semana), instanteLocal(somarDias(semana, 7)), agora])).rows[0];
  if (ins) { await snapshot(c, ins.id); return ins; }
  return (await c.query(`select * from competition_seasons where semana = $1`, [semana])).rows[0];
}

async function snapshot(c: Exec, seasonId: string) {
  // elenco: membros atuais de ruas ativas/em fundação, casa reivindicada, conta ativa
  await c.query(
    `insert into competition_roster (season_id, user_id, street_id, house_id)
     select distinct on (h.dono_user_id) $1, h.dono_user_id, sm.street_id, h.id
       from street_memberships sm join houses h on h.id = sm.house_id join users u on u.id = h.dono_user_id
       join virtual_streets vs on vs.id = sm.street_id
      where sm.saiu_em is null and h.status = 'reivindicada' and u.status = 'ativo' and vs.status in ('ativa','fundacao')
      order by h.dono_user_id, h.principal desc
     on conflict do nothing`, [seasonId]);
  await c.query(
    `insert into competition_entries (season_id, street_id, ibge, uf, elenco_n, elegivel, divisao, modo, meta_cooperativa)
     select $1, r.street_id, vs.ibge, m.uf, count(*)::int, count(*) >= ${MIN_ATIVOS},
            case when count(*) < ${MIN_ATIVOS} then null when count(*) <= 8 then '3-8' when count(*) <= 16 then '9-16' else '17-24' end,
            'cooperativo', count(*)::int * ${META_COOP_POR_MEMBRO}
       from competition_roster r join virtual_streets vs on vs.id = r.street_id join municipios m on m.ibge = vs.ibge
      where r.season_id = $1 group by r.street_id, vs.ibge, m.uf
     on conflict do nothing`, [seasonId]);
  // competitivo só onde há pelo menos duas ruas elegíveis na mesma cidade e divisão (nunca juntar divisões)
  await c.query(
    `update competition_entries e set modo = 'competitivo', meta_cooperativa = null
       from (select ibge, divisao from competition_entries where season_id = $1 and elegivel group by ibge, divisao having count(*) >= 2) g
      where e.season_id = $1 and e.elegivel and e.ibge = g.ibge and e.divisao = g.divisao`, [seasonId]);
  await c.query(
    `insert into competition_groups (season_id, ibge, divisao) select distinct season_id, ibge, divisao from competition_entries where season_id = $1 and modo = 'competitivo' on conflict do nothing`, [seasonId]);
  const cidades = (await c.query(`select ibge, count(*)::int ruas, count(*) filter (where modo = 'competitivo')::int competitivas from competition_entries where season_id = $1 and elegivel group by ibge`, [seasonId])).rows;
  for (const cid of cidades) await emitir(c, 'competicao.temporada_aberta', { season_id: seasonId, ibge: cid.ibge, ruas_elegiveis: cid.ruas, competitivas: cid.competitivas }, `comp:${seasonId}:aberta:${cid.ibge}`);
}

/** pontos de cada rua: só contribuições do elenco snapshot daquela rua na temporada */
const SQL_PONTOS = `
  select e.*, coalesce(p.pontos, 0)::int pontos, coalesce(p.pontuaram, 0)::int pontuaram
    from competition_entries e
    left join lateral (
      select sum(l.quantidade) pontos, count(distinct l.user_id) filter (where l.quantidade > 0) pontuaram
        from reward_ledger l join competition_roster r on r.season_id = l.season_id and r.user_id = l.user_id and r.street_id = l.street_id
       where l.sistema = 'contribuicao' and l.season_id = e.season_id and l.street_id = e.street_id) p on true`;

export async function placarGrupo(c: Exec, seasonId: string, ibge: number, divisao: string) {
  return (await c.query(
    `select x.*, vs.nome, rank() over (order by x.pontos desc)::int colocacao_atual from (${SQL_PONTOS}) x join virtual_streets vs on vs.id = x.street_id
      where x.season_id = $1 and x.ibge = $2 and x.divisao = $3 and x.modo = 'competitivo' order by x.pontos desc, vs.nome`, [seasonId, ibge, divisao])).rows;
}

/** visão da competição para a UI (GET /api/ruas/:id/competicao) */
export async function competicaoDaRua(c: Exec, streetId: string, userId: string | null, agora = new Date()) {
  const s = await garantirTemporada(c, agora);
  const base = { temporada: { id: s.id, semana: s.semana, inicio: s.inicio, fim: s.fim, estado: s.estado }, explicacao: EXPLICACAO, regras: REGRAS_TEXTO, elege_cargo: false };
  const trofeus = (await c.query(`select a.tipo, a.colocacao, a.valido_ate, cs.semana from competition_awards a join competition_seasons cs on cs.id = a.season_id where a.street_id = $1 and (a.valido_ate is null or a.valido_ate > $2) order by a.criado_em desc limit 30`, [streetId, agora])).rows;
  let eu: any = null;
  if (userId) {
    const r = (await c.query(`select street_id from competition_roster where season_id = $1 and user_id = $2`, [s.id, userId])).rows[0];
    const ms = (await c.query(`select sm.street_id from houses h join street_memberships sm on sm.house_id = h.id and sm.saiu_em is null where h.dono_user_id = $1 and h.principal and h.status = 'reivindicada'`, [userId])).rows[0];
    eu = { no_elenco: !!r && r.street_id === streetId, pontua_agora: !!r && !!ms && r.street_id === ms.street_id && r.street_id === streetId,
      aviso: !r ? 'você entrou depois do início: pontua no competitivo a partir da próxima temporada (obra e XP valem já)' : r.street_id !== streetId ? 'seus pontos desta temporada ficam com a rua do seu elenco' : null };
  }
  const e = (await c.query(`select x.* from (${SQL_PONTOS}) x where x.season_id = $1 and x.street_id = $2`, [s.id, streetId])).rows[0];
  if (!e) return { ...base, participa: false, motivo: 'a rua não tinha elenco quando a temporada abriu: entra na próxima', trofeus, eu };
  const participacao = e.elenco_n ? Math.round((100 * e.pontuaram) / e.elenco_n) : 0;
  const entrada = { modo: e.modo, elegivel: e.elegivel, divisao: e.divisao, elenco: e.elenco_n, pontos: e.pontos, participacao_pct: participacao, colocacao_final: e.colocacao, pontos_final: e.pontos_final };
  if (e.modo === 'competitivo') {
    const ranking = (await placarGrupo(c, s.id, e.ibge, e.divisao)).map((x) => ({ street_id: x.street_id, nome: x.nome, pontos: x.pontos, colocacao: x.colocacao, colocacao_atual: x.colocacao_atual, elenco: x.elenco_n, participacao_pct: x.elenco_n ? Math.round((100 * x.pontuaram) / x.elenco_n) : 0 }));
    return { ...base, participa: true, entrada, ranking, trofeus, eu };
  }
  const motivo = !e.elegivel ? `a rua precisa de ${MIN_ATIVOS} moradores ativos no início da temporada para disputar; nesta semana joga a meta cooperativa` : 'não há outra rua elegível da mesma divisão nesta cidade: meta cooperativa (sem adversário inventado)';
  const regional = e.elegivel ? (await c.query(
    `select x.street_id, vs.nome, mu.nome cidade, x.pontos, x.elenco_n elenco from (${SQL_PONTOS}) x join virtual_streets vs on vs.id = x.street_id join municipios mu on mu.ibge = x.ibge
      where x.season_id = $1 and x.uf = $2 and x.divisao = $3 and x.elegivel order by x.pontos desc, vs.nome limit 10`, [s.id, e.uf, e.divisao])).rows : [];
  return {
    ...base, participa: true, entrada, trofeus, eu,
    cooperativo: { motivo, meta: e.meta_cooperativa, pontos: e.pontos, pct: Math.min(100, Math.round((100 * e.pontos) / Math.max(1, e.meta_cooperativa))) },
    liga_regional: regional.length > 1 ? { rotulo: `liga regional ${e.uf} · divisão ${e.divisao} — só comparação, não dá controle sobre outra cidade`, ruas: regional } : null,
  };
}

/** placar horário: detecta virada real de liderança (fato para o orquestrador). Idempotente. */
export async function recalcularLideres(c: Exec, seasonId: string) {
  const grupos = (await c.query(`select * from competition_groups where season_id = $1 for update`, [seasonId])).rows;
  let viradas = 0;
  for (const g of grupos) {
    const pl = await placarGrupo(c, seasonId, g.ibge, g.divisao);
    const max = pl.length ? pl[0].pontos : 0;
    const lideres = max > 0 ? pl.filter((x) => x.pontos === max).map((x) => x.street_id as string).sort() : [];
    const antes = [...(g.lideres || [])].sort();
    if (lideres.join() === antes.join()) continue;
    const virou = antes.length > 0 && lideres.length > 0 && !lideres.some((l) => antes.includes(l));
    await c.query(`update competition_groups set lideres = $4, viradas = viradas + $5 where season_id = $1 and ibge = $2 and divisao = $3`, [seasonId, g.ibge, g.divisao, lideres, virou ? 1 : 0]);
    if (virou) { viradas++; await emitir(c, 'competicao.virada', { season_id: seasonId, ibge: g.ibge, divisao: g.divisao, lideres, antes }, `comp:${seasonId}:${g.ibge}:${g.divisao}:virada:${g.viradas + 1}`); }
  }
  return viradas;
}

/** apuração da temporada encerrada (idempotente: só a primeira chamada apura) */
export async function apurarTemporada(c: Exec, seasonId: string, agora = new Date()) {
  const s = (await c.query(`update competition_seasons set estado = 'apurada', apurada_em = $2 where id = $1 and estado = 'aberta' and fim <= $2 returning *`, [seasonId, agora])).rows[0];
  if (!s) return { apurada: false };
  const linhas = (await c.query(`select x.street_id, x.pontos from (${SQL_PONTOS}) x where x.season_id = $1`, [seasonId])).rows;
  for (const l of linhas) await c.query(`update competition_entries set pontos_final = $3 where season_id = $1 and street_id = $2`, [seasonId, l.street_id, l.pontos]);
  // colocação compartilhada: rank() (1,1,3...) por cidade+divisão, só no modo competitivo
  await c.query(
    `update competition_entries e set colocacao = r.col from (
       select street_id, rank() over (partition by ibge, divisao order by pontos_final desc)::int col from competition_entries where season_id = $1 and modo = 'competitivo') r
      where e.season_id = $1 and e.street_id = r.street_id`, [seasonId]);
  const faixaAte = new Date(new Date(s.fim).getTime() + 7 * 86400_000);
  const campeas = (await c.query(`select street_id, colocacao, ibge from competition_entries where season_id = $1 and modo = 'competitivo' and colocacao = 1 and pontos_final > 0`, [seasonId])).rows;
  for (const cp of campeas) {
    await c.query(`insert into competition_awards (season_id, street_id, tipo, colocacao, valido_ate) values ($1,$2,'trofeu',1,null),($1,$2,'faixa',1,$3),($1,$2,'decoracao',1,$3) on conflict do nothing`, [seasonId, cp.street_id, faixaAte]);
  }
  const coop = (await c.query(`select street_id from competition_entries where season_id = $1 and modo = 'cooperativo' and pontos_final >= meta_cooperativa and pontos_final > 0`, [seasonId])).rows;
  for (const cp of coop) await c.query(`insert into competition_awards (season_id, street_id, tipo, valido_ate) values ($1,$2,'meta_cooperativa',null),($1,$2,'decoracao',$3) on conflict do nothing`, [seasonId, cp.street_id, faixaAte]);
  const cidades = (await c.query(`select ibge, array_agg(street_id) filter (where colocacao = 1 and pontos_final > 0) campeas from competition_entries where season_id = $1 group by ibge`, [seasonId])).rows;
  for (const cid of cidades) await emitir(c, 'competicao.apurada', { season_id: seasonId, ibge: cid.ibge, campeas: cid.campeas || [] }, `comp:${seasonId}:apurada:${cid.ibge}`);
  return { apurada: true, campeas: campeas.length, cooperativas_concluidas: coop.length };
}
