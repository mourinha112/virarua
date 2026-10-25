/* Obra comunitária da rua: etapas visuais persistentes, progresso só por contribuição validada no servidor.
   Limites: no máximo `limite_dia_usuario` contribuições por pessoa/dia e no máximo `limite_parcela` (50%) da meta por
   pessoa — ninguém conclui a obra sozinho, e não existe caminho de pagamento. A obra nunca é apagada pela competição:
   perder a semana não desfaz etapa nenhuma; obra concluída fica no histórico da rua. */
import type { Exec } from '../../db/db';
import { emitir } from '../../db/db';
import { diaJogo } from './regras';

export const MODELOS = [
  { modelo: 'jardim', titulo: 'Jardim da rua', etapas: ['preparar a terra', 'plantar as mudas', 'cercar e regar'] },
  { modelo: 'banco', titulo: 'Banco da amizade', etapas: ['base de madeira', 'assento e encosto', 'pintura e placa'] },
  { modelo: 'praca_luz', titulo: 'Praça iluminada', etapas: ['postes', 'fiação decorativa', 'luzes acesas'] },
  { modelo: 'skate', titulo: 'Pista de skate', etapas: ['terraplenagem', 'rampas', 'acabamento'] },
  { modelo: 'biblioteca', titulo: 'Biblioteca virtual', etapas: ['estantes', 'acervo', 'cantinho de leitura'] },
] as const;

export type Moradia = { houseId: string; streetId: string | null; ibge: number; uf: string };
/** casa principal reivindicada do usuário e rua atual (membership aberta) */
export async function moradia(c: Exec, userId: string): Promise<Moradia | null> {
  const r = (await c.query(
    `select h.id house_id, sm.street_id, p.ibge, m.uf from houses h join plots p on p.id = h.plot_id join municipios m on m.ibge = p.ibge
       left join street_memberships sm on sm.house_id = h.id and sm.saiu_em is null
      where h.dono_user_id = $1 and h.principal and h.status = 'reivindicada' limit 1`, [userId])).rows[0];
  return r ? { houseId: r.house_id, streetId: r.street_id, ibge: r.ibge, uf: r.uf } : null;
}

async function membrosAtivos(c: Exec, streetId: string) {
  return (await c.query(`select count(*)::int n from street_memberships sm join houses h on h.id = sm.house_id where sm.street_id = $1 and sm.saiu_em is null and h.status = 'reivindicada'`, [streetId])).rows[0].n as number;
}

/** obra em andamento da rua (cria a próxima do rodízio se não houver) */
export async function obraAtual(c: Exec, streetId: string, criar = true) {
  let p = (await c.query(`select * from community_projects where street_id = $1 and status = 'em_obra'`, [streetId])).rows[0];
  if (p || !criar) return p || null;
  const feitas = (await c.query(`select count(*)::int n from community_projects where street_id = $1`, [streetId])).rows[0].n as number;
  const m = MODELOS[feitas % MODELOS.length];
  const meta = Math.max(30, Math.ceil((await membrosAtivos(c, streetId)) * 6 / 3) * 3);
  const etapas = m.etapas.map((nome, i) => ({ nome, ate: Math.round((meta * (i + 1)) / m.etapas.length) }));
  await c.query(
    `insert into community_projects (street_id, modelo, titulo, etapas, meta_total) values ($1,$2,$3,$4,$5) on conflict do nothing`,
    [streetId, m.modelo, m.titulo, JSON.stringify(etapas), meta]);
  p = (await c.query(`select * from community_projects where street_id = $1 and status = 'em_obra'`, [streetId])).rows[0];
  return p;
}

const etapaDe = (etapas: { ate: number }[], progresso: number) => etapas.filter((e) => progresso >= e.ate).length;

export type ResultadoObra = { ok: true; quantidade: number; progresso: number; meta: number; etapa: number; concluida: boolean; duplicado?: boolean } | { ok: false; motivo: string };

/** contribui para a obra da rua do usuário (chamado por missão ou motor de contribuição, já com prova validada) */
export async function contribuirObra(c: Exec, p: { userId: string; streetId: string; origem: string; chave: string; quantidade?: number; agora?: Date }): Promise<ResultadoObra> {
  const agora = p.agora || new Date(); const dia = diaJogo(agora);
  const mor = await moradia(c, p.userId);
  if (!mor || mor.streetId !== p.streetId) return { ok: false, motivo: 'só moradores da rua ajudam a obra' };
  await obraAtual(c, p.streetId);
  const proj = (await c.query(`select * from community_projects where street_id = $1 and status = 'em_obra' for update`, [p.streetId])).rows[0];
  if (!proj) return { ok: false, motivo: 'obra indisponível' };
  const dup = (await c.query(`select quantidade from community_contributions where chave = $1`, [p.chave])).rows[0];
  if (dup) return { ok: true, quantidade: 0, progresso: proj.progresso, meta: proj.meta_total, etapa: etapaDe(proj.etapas, proj.progresso), concluida: false, duplicado: true };
  const minhas = (await c.query(
    `select coalesce(sum(quantidade), 0)::int total, count(*) filter (where dia = $3)::int hoje from community_contributions where project_id = $1 and user_id = $2`,
    [proj.id, p.userId, dia])).rows[0];
  if (minhas.hoje >= proj.limite_dia_usuario) return { ok: false, motivo: `limite de ${proj.limite_dia_usuario} ajudas por dia nesta obra` };
  const teto = Math.floor(proj.meta_total * Number(proj.limite_parcela));
  const q = Math.min(p.quantidade ?? 10, teto - minhas.total, proj.meta_total - proj.progresso);
  if (q <= 0) return { ok: false, motivo: 'você já deu a sua parte desta obra: agora é a vez dos vizinhos' };
  await c.query(`insert into community_contributions (project_id, user_id, quantidade, dia, origem, chave) values ($1,$2,$3,$4,$5,$6)`, [proj.id, p.userId, q, dia, p.origem, p.chave]);
  const novo = proj.progresso + q, antes = etapaDe(proj.etapas, proj.progresso), depois = etapaDe(proj.etapas, novo), concluida = novo >= proj.meta_total;
  await c.query(`update community_projects set progresso = $2, status = case when $3 then 'concluida' else status end, concluida_em = case when $3 then $4::timestamptz end where id = $1`, [proj.id, novo, concluida, agora]);
  const ibge = (await c.query(`select ibge from virtual_streets where id = $1`, [p.streetId])).rows[0]?.ibge;
  for (let i = antes; i < depois; i++) await emitir(c, 'obra.etapa_concluida', { project_id: proj.id, street_id: p.streetId, ibge, modelo: proj.modelo, etapa: i + 1, nome: proj.etapas[i].nome }, `obra:${proj.id}:etapa:${i + 1}`);
  if (concluida) await emitir(c, 'obra.concluida', { project_id: proj.id, street_id: p.streetId, ibge, modelo: proj.modelo, titulo: proj.titulo }, `obra:${proj.id}:concluida`);
  return { ok: true, quantidade: q, progresso: novo, meta: proj.meta_total, etapa: depois, concluida };
}

/** visão da obra para a UI (inclui a parte do usuário e as obras já concluídas, que nunca somem) */
export async function obraParaUI(c: Exec, streetId: string, userId?: string | null) {
  const p = await obraAtual(c, streetId);
  const minhas = userId ? (await c.query(`select coalesce(sum(quantidade), 0)::int total from community_contributions where project_id = $1 and user_id = $2`, [p.id, userId])).rows[0].total : 0;
  const ajudantes = (await c.query(`select count(distinct user_id)::int n from community_contributions where project_id = $1`, [p.id])).rows[0].n;
  const concluidas = (await c.query(`select id, modelo, titulo, concluida_em from community_projects where street_id = $1 and status = 'concluida' order by concluida_em desc limit 20`, [streetId])).rows;
  return {
    id: p.id, modelo: p.modelo, titulo: p.titulo, status: p.status, progresso: p.progresso, meta: p.meta_total,
    etapas: (p.etapas as { nome: string; ate: number }[]).map((e) => ({ ...e, concluida: p.progresso >= e.ate })),
    etapa_atual: etapaDe(p.etapas, p.progresso), ajudantes, minha_parte: minhas,
    meu_limite: Math.floor(p.meta_total * Number(p.limite_parcela)), limite_dia: p.limite_dia_usuario,
    regras: `cada ajuda vale 10; até ${p.limite_dia_usuario} ajudas por dia (uma por missão de obra); ninguém faz mais da metade da obra; não existe compra de etapa`,
    concluidas,
  };
}
