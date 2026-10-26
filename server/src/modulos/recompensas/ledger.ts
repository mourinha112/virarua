/* Ledger de recompensas: único caminho que concede XP, contribuição competitiva ou item de coleção.
   - chave idempotente única (regra + evento + usuário): reexecutar não multiplica nada;
   - teto diário por usuário aplicado sob advisory lock (concorrência entre eventos/missões);
   - quantidades vêm SEMPRE da regra versionada do servidor, nunca do cliente. */
import type { Exec } from '../../db/db';
import { REGRAS, TETO_CONTRIBUICAO_DIA, TETO_XP_DIA, diaJogo, type Regra } from './regras';

export type Concessao = {
  userId: string;
  regraId: string;
  /** referência do fato que gerou (instância, missão do dia, definição de evento) — a chave final depende do escopo da regra */
  eventoRef: string;
  origem: 'missao' | 'evento' | 'obra' | 'competicao' | 'instagram' | 'convite' | 'tesouro' | 'ofensiva' | 'visita' | 'bau' | 'pet' | 'chuva';
  streetId?: string | null;
  seasonId?: string | null;
  agora?: Date;
  dados?: Record<string, unknown>;
};
export type ResultadoConcessao = { sistema: Regra['sistema']; quantidade: number; pedida: number; limitado: boolean; duplicado: boolean; chave: string | null; item?: string };

export function chaveDe(regra: Regra, eventoRef: string, userId: string) {
  // 'conta': a mesma conquista não renasce com a versão nova da regra (base sem @versão)
  const base = regra.escopo === 'conta' ? regra.id.split('@')[0] : regra.id;
  return `${base}|${eventoRef}|${userId}`;
}

export async function conceder(c: Exec, p: Concessao): Promise<ResultadoConcessao> {
  const regra = REGRAS[p.regraId];
  if (!regra) throw new Error('regra de recompensa desconhecida: ' + p.regraId);
  if (regra.sistema === 'nenhum') return { sistema: 'nenhum', quantidade: 0, pedida: 0, limitado: false, duplicado: false, chave: null };
  const chave = chaveDe(regra, p.eventoRef, p.userId);
  const dia = diaJogo(p.agora);
  // serializa as concessões do mesmo usuário (teto diário compartilhado entre todos os eventos e missões)
  await c.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, ['recompensa:' + p.userId]);
  const ja = (await c.query(`select sistema, quantidade, pedida, limitado, item from reward_ledger where chave = $1`, [chave])).rows[0];
  if (ja) return { sistema: ja.sistema, quantidade: ja.quantidade, pedida: ja.pedida, limitado: ja.limitado, duplicado: true, chave, item: ja.item ?? undefined };

  let pedida = 0, quantidade = 0, item: string | null = null;
  if (regra.sistema === 'colecao') { pedida = quantidade = 1; item = `${regra.item}:${p.eventoRef}`; }
  else {
    pedida = regra.quantidade;
    const teto = regra.sistema === 'xp' ? TETO_XP_DIA : TETO_CONTRIBUICAO_DIA;
    const soma = (await c.query(`select coalesce(sum(quantidade), 0)::int s from reward_ledger where user_id = $1 and dia = $2 and sistema = $3`, [p.userId, dia, regra.sistema])).rows[0].s as number;
    quantidade = Math.max(0, Math.min(pedida, teto - soma));
  }
  if (regra.sistema === 'contribuicao' && (!p.streetId || !p.seasonId)) throw new Error('contribuição exige rua e temporada do elenco snapshot');
  const r = await c.query(
    `insert into reward_ledger (user_id, sistema, regra_id, evento_ref, chave, quantidade, pedida, limitado, dia, origem, street_id, season_id, item, dados)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (chave) do nothing returning id`,
    [p.userId, regra.sistema, regra.id, p.eventoRef, chave, quantidade, pedida, quantidade < pedida, dia, p.origem,
      regra.sistema === 'contribuicao' ? p.streetId : null, regra.sistema === 'contribuicao' ? p.seasonId : null, item, JSON.stringify(p.dados || {})]);
  if (!r.rows[0]) return { sistema: regra.sistema, quantidade: 0, pedida, limitado: false, duplicado: true, chave };
  if (regra.sistema === 'xp' && quantidade > 0) {
    // XP permanente da casa principal (evolução da casa/avatar)
    await c.query(`update houses set xp = xp + $2 where dono_user_id = $1 and principal and status = 'reivindicada'`, [p.userId, quantidade]);
  }
  return { sistema: regra.sistema, quantidade, pedida, limitado: quantidade < pedida, duplicado: false, chave, item: item ?? undefined };
}

/** resumo do dia e totais do usuário (para o painel) */
export async function resumoUsuario(c: Exec, userId: string, agora = new Date()) {
  const dia = diaJogo(agora);
  const r = (await c.query(
    `select coalesce(sum(quantidade) filter (where sistema = 'xp'), 0)::int xp_total,
            coalesce(sum(quantidade) filter (where sistema = 'xp' and dia = $2), 0)::int xp_hoje,
            coalesce(sum(quantidade) filter (where sistema = 'contribuicao' and dia = $2), 0)::int contribuicao_hoje,
            count(*) filter (where sistema = 'colecao')::int itens
       from reward_ledger where user_id = $1`, [userId, dia])).rows[0];
  return { ...r, dia, teto_xp_dia: TETO_XP_DIA, teto_contribuicao_dia: TETO_CONTRIBUICAO_DIA };
}
