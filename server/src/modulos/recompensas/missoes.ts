/* Missões diárias (até três): cada uma exige um desafio curto emitido e verificado pelo servidor.
   Uma conclusão paga por missão/usuário/dia (unique em mission_completions + chave do ledger). A contribuição
   competitiva só vai para a rua do elenco snapshot e só enquanto o morador continua nela. */
import type { Exec } from '../../db/db';
import { emitir } from '../../db/db';
import { ErroHttp } from '../../http/app';
import { emitirDesafio, verificarDesafio } from './desafios';
import { conceder, resumoUsuario } from './ledger';
import { contribuirObra, moradia } from './obras';
import { garantirTemporada } from './competicao';
import { diaJogo } from './regras';

const ctxMissao = (id: string, dia: string) => `missao:${id}:${dia}`;

export async function missoesDoDia(c: Exec, userId: string, agora = new Date()) {
  const dia = diaJogo(agora);
  const ms = (await c.query(
    `select m.id, m.titulo, m.descricao, m.tipo_desafio, mc.criado_em concluida_em, mc.contribuiu, mc.motivo_sem_ponto
       from missions m left join mission_completions mc on mc.mission_id = m.id and mc.user_id = $1 and mc.dia = $2
      where m.ativa order by m.ordem`, [userId, dia])).rows;
  const mor = await moradia(c, userId);
  return {
    dia, morador: !!mor, rua: mor?.streetId ?? null,
    missoes: ms.map((m) => ({ id: m.id, titulo: m.titulo, descricao: m.descricao, desafio: m.tipo_desafio, concluida: !!m.concluida_em, pontuou_rua: !!m.contribuiu, motivo_sem_ponto: m.motivo_sem_ponto })),
    resumo: await resumoUsuario(c, userId, agora),
  };
}

async function missaoAtiva(c: Exec, id: string) {
  const m = (await c.query(`select * from missions where id = $1 and ativa`, [id])).rows[0];
  if (!m) throw new ErroHttp(404, 'missão não encontrada');
  return m;
}

export async function desafioMissao(c: Exec, userId: string, missionId: string, agora = new Date()) {
  const m = await missaoAtiva(c, missionId); const dia = diaJogo(agora);
  const mor = await moradia(c, userId);
  if (!mor) throw new ErroHttp(403, 'reivindique a sua casa para fazer missões');
  if (m.id.startsWith('obra.') && !mor.streetId) throw new ErroHttp(409, 'entre numa rua para ajudar a obra');
  const feita = (await c.query(`select 1 from mission_completions where user_id = $1 and mission_id = $2 and dia = $3`, [userId, m.id, dia])).rows[0];
  if (feita) throw new ErroHttp(409, 'missão de hoje já concluída: volte amanhã');
  return emitirDesafio(c, { userId, contexto: ctxMissao(m.id, dia), tipo: m.tipo_desafio, params: m.params || {}, agora });
}

export async function concluirMissao(c: Exec, userId: string, missionId: string, prova: { desafio_id?: unknown; resposta?: unknown }, agora = new Date()) {
  const m = await missaoAtiva(c, missionId); const dia = diaJogo(agora);
  const mor = await moradia(c, userId);
  if (!mor) throw new ErroHttp(403, 'reivindique a sua casa para fazer missões');
  const ja = (await c.query(`select contribuiu, motivo_sem_ponto from mission_completions where user_id = $1 and mission_id = $2 and dia = $3`, [userId, m.id, dia])).rows[0];
  if (ja) return { ja_concluida: true, recompensas: [], contribuiu: ja.contribuiu, motivo_sem_ponto: ja.motivo_sem_ponto };
  const v = await verificarDesafio(c, { id: prova.desafio_id, userId, contexto: ctxMissao(m.id, dia), resposta: prova.resposta, minMs: m.min_ms, agora });
  // erro de resposta NÃO lança: a tentativa contada precisa ser gravada (commit) — a rota responde 422
  if (!v.ok) return { erro: v.motivo } as const;
  const ins = (await c.query(
    `insert into mission_completions (user_id, mission_id, dia, desafio_id, street_id) values ($1,$2,$3,$4,$5) on conflict do nothing returning id`,
    [userId, m.id, dia, prova.desafio_id, mor.streetId])).rows[0];
  if (!ins) return { ja_concluida: true, recompensas: [] };

  let obra: any = null;
  if (m.id.startsWith('obra.') && mor.streetId) obra = await contribuirObra(c, { userId, streetId: mor.streetId, origem: 'missao:' + m.id, chave: `missao:${m.id}:${dia}:${userId}`, agora });

  const temporada = await garantirTemporada(c, agora);
  const elenco = (await c.query(`select street_id from competition_roster where season_id = $1 and user_id = $2`, [temporada.id, userId])).rows[0];
  const ref = `missao:${m.id}:${dia}`;
  let contribuicao = null as null | Awaited<ReturnType<typeof conceder>>; let motivo: string | null = null;
  if (!elenco) motivo = 'fora_do_elenco';
  else if (elenco.street_id !== mor.streetId) motivo = 'mudou_de_rua';
  else {
    contribuicao = await conceder(c, { userId, regraId: m.regra_contribuicao, eventoRef: ref, origem: 'missao', streetId: elenco.street_id, seasonId: temporada.id, agora });
    if (contribuicao.quantidade === 0) motivo = 'teto_diario';
  }
  const xp = await conceder(c, { userId, regraId: m.regra_xp, eventoRef: ref, origem: 'missao', agora });
  await c.query(`update mission_completions set contribuiu = $2, motivo_sem_ponto = $3 where id = $1`, [ins.id, !!contribuicao && contribuicao.quantidade > 0, motivo]);
  await emitir(c, 'missao.concluida', { user_id: userId, mission_id: m.id, dia, ibge: mor.ibge, street_id: mor.streetId }, `missao:${userId}:${m.id}:${dia}`);
  return {
    ja_concluida: false, contribuiu: !!contribuicao && contribuicao.quantidade > 0, motivo_sem_ponto: motivo,
    recompensas: [{ sistema: 'xp', quantidade: xp.quantidade, limitado: xp.limitado }, ...(contribuicao ? [{ sistema: 'contribuicao', quantidade: contribuicao.quantidade, limitado: contribuicao.limitado }] : [])],
    obra,
  };
}
