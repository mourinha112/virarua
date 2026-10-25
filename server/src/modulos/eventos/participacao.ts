/* Participação em instâncias: inscrição, desafio do motor e ação validada. Pontuação só após conclusão comprovada
   e única (participante + chave idempotente do ledger); eventos coletivos pagam só na resolução, se a edição valer. */
import type { Exec } from '../../db/db';
import { emitir } from '../../db/db';
import { config } from '../../config';
import { ErroHttp } from '../../http/app';
import { conceder } from '../recompensas/ledger';
import { moradia, type Moradia } from '../recompensas/obras';
import { diaJogo, REGRAS } from '../recompensas/regras';
import { IMPL, amizadesDisponiveis } from './motores';
import { configuracao, refRecompensa } from './orquestrador';
import type { EventDefinition } from './tipos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pausado() { if (config.kill.eventos) throw new ErroHttp(503, 'eventos pausados pela operação; o resto do jogo segue normal'); }

async function instancia(c: Exec, id: string, lock = false) {
  if (!UUID.test(id)) throw new ErroHttp(404, 'evento não encontrado');
  const i = (await c.query(`select * from event_instances where id = $1 ${lock ? 'for share' : ''}`, [id])).rows[0];
  if (!i) throw new ErroHttp(404, 'evento não encontrado');
  return i;
}

/** acesso por escopo + pré-requisitos do usuário */
async function checarAcesso(c: Exec, inst: any, def: EventDefinition, mor: Moradia | null) {
  for (const p of def.prerequisites) {
    if (p.tipo === 'casa_reivindicada' && !mor) throw new ErroHttp(403, 'reivindique a sua casa para participar');
    if (p.tipo === 'membro_de_rua' && !mor?.streetId) throw new ErroHttp(403, 'entre numa rua para participar');
    if (p.tipo === 'amizades_disponiveis' && !(await amizadesDisponiveis(c))) throw new ErroHttp(409, 'indisponível: amizades ainda não estão ativas neste servidor');
  }
  if ((inst.escopo === 'cidade' || inst.escopo === 'rua') && inst.ibge && mor?.ibge !== inst.ibge) throw new ErroHttp(403, 'evento dos moradores de outra cidade');
}

async function garantirParticipante(c: Exec, inst: any, def: EventDefinition, userId: string, explicito: boolean) {
  const ja = (await c.query(`select * from event_participants where instance_id = $1 and user_id = $2 for update`, [inst.id, userId])).rows[0];
  if (ja) return ja;
  if (def.enrollment === 'opt_in' && !explicito) throw new ErroHttp(409, 'inscreva-se no evento primeiro');
  if (!inst.permanente) {
    const cfg = await configuracao(c);
    const n = (await c.query(`select count(*)::int n from event_participants p join event_instances i on i.id = p.instance_id where p.user_id = $1 and p.estado = 'inscrito' and not i.permanente and i.estado in ('enrolling','active')`, [userId])).rows[0].n;
    if (n >= cfg.max_inscricoes_usuario) throw new ErroHttp(409, `limite de ${cfg.max_inscricoes_usuario} eventos ao mesmo tempo: conclua um antes`);
  }
  await c.query(`insert into event_participants (instance_id, user_id) values ($1, $2) on conflict do nothing`, [inst.id, userId]);
  return (await c.query(`select * from event_participants where instance_id = $1 and user_id = $2 for update`, [inst.id, userId])).rows[0];
}

export async function inscrever(c: Exec, userId: string, instId: string) {
  pausado();
  const inst = await instancia(c, instId, true); const def: EventDefinition = inst.regras;
  if (!['enrolling', 'active'].includes(inst.estado)) throw new ErroHttp(409, 'inscrições fechadas para este evento');
  await checarAcesso(c, inst, def, await moradia(c, userId));
  const p = await garantirParticipante(c, inst, def, userId, true);
  return { estado: p.estado };
}

export async function desafioEvento(c: Exec, userId: string, instId: string, acao: any, agora = new Date()) {
  pausado();
  const inst = await instancia(c, instId, true); const def: EventDefinition = inst.regras;
  if (inst.estado !== 'active') throw new ErroHttp(409, 'o evento não está acontecendo agora');
  const mor = await moradia(c, userId); await checarAcesso(c, inst, def, mor);
  const motor = IMPL[def.mechanic.motor];
  if (!motor.desafio) throw new ErroHttp(400, 'este evento não usa desafio: envie a ação direto');
  const part = await garantirParticipante(c, inst, def, userId, false);
  if (part.estado === 'concluido' && !podeSeguir(def, part)) throw new ErroHttp(409, 'você já concluiu este evento');
  return motor.desafio({ c, def, inst, userId, mor, progresso: part.progresso || {}, acao: acao || {}, agora });
}

/** contribuições extras (até o limite da edição) continuam valendo para a meta, sem nova recompensa */
const podeSeguir = (def: EventDefinition, part: any) => def.mechanic.motor === 'contribuicao' && def.completion_rule.tipo === 'contribuicoes_min' && (part.progresso?.n || 0) < def.limits.por_usuario_edicao;

export async function participar(c: Exec, userId: string, instId: string, acao: any, agora = new Date()) {
  pausado();
  const inst = await instancia(c, instId, true); const def: EventDefinition = inst.regras;
  if (inst.estado !== 'active') throw new ErroHttp(409, 'o evento não está acontecendo agora');
  if (inst.fim && new Date(inst.fim) <= agora) throw new ErroHttp(409, 'o evento já terminou');
  const mor = await moradia(c, userId); await checarAcesso(c, inst, def, mor);
  const part = await garantirParticipante(c, inst, def, userId, false);
  const extra = part.estado === 'concluido' && podeSeguir(def, part);
  if (part.estado === 'concluido' && !extra) return { ja_concluido: true, recompensa: null };
  const prog = part.progresso || {};
  const hoje = diaJogo(agora);
  if (def.limits.por_usuario_dia && prog._ultimo_dia === hoje) return { erro: 'você já fez este evento hoje: volte amanhã' };

  const r = await IMPL[def.mechanic.motor].agir({ c, def, inst, userId, mor, progresso: prog, acao: acao || {}, agora });
  if (!r.ok) { if (r.progresso) await c.query(`update event_participants set progresso = $3 where instance_id = $1 and user_id = $2`, [inst.id, userId, JSON.stringify({ ...prog, ...r.progresso })]); return { erro: r.motivo }; }
  let novo = { ...prog, ...r.progresso };
  if (!r.concluido || extra) {
    await c.query(`update event_participants set progresso = $3 where instance_id = $1 and user_id = $2`, [inst.id, userId, JSON.stringify(novo)]);
    return { concluido: extra, progresso: novo, info: r.info ?? null, recompensa: null };
  }
  // conclusão comprovada: conta a edição; eventos repetíveis por dia reabrem no dia seguinte
  const conclusoes = (prog._conclusoes || 0) + 1;
  const final = conclusoes >= def.limits.por_usuario_edicao;
  novo = final ? { ...novo, _conclusoes: conclusoes, _ultimo_dia: hoje } : { _conclusoes: conclusoes, _ultimo_dia: hoje };
  await c.query(`update event_participants set progresso = $3, estado = $4, concluido_em = case when $4 = 'concluido' then $5::timestamptz else concluido_em end where instance_id = $1 and user_id = $2`,
    [inst.id, userId, JSON.stringify(novo), final ? 'concluido' : 'inscrito', agora]);
  let recompensa = null as any;
  if (def.min_participants <= 1) {
    recompensa = await conceder(c, { userId, regraId: def.reward_rule_id, eventoRef: refRecompensa(def, inst, agora), origem: 'evento', agora, dados: { evento: def.id, instancia: inst.id } });
  } else recompensa = { pendente: true, motivo: `paga quando o evento terminar com pelo menos ${def.min_participants} participantes` };
  await emitir(c, 'evento.participacao_concluida', { instancia: inst.id, evento: def.id, user_id: userId, ibge: mor?.ibge ?? null }, `evpart:${inst.id}:${userId}:${conclusoes}`);
  return { concluido: true, progresso: novo, info: r.info ?? null, recompensa, regra: REGRAS[def.reward_rule_id]?.descricao };
}

/** agenda visível para o usuário: instâncias anunciadas/abertas/ativas da cidade + nacionais/regionais + permanentes */
export async function agenda(c: Exec, userId: string | null, ibge: number | null) {
  const mor = userId ? await moradia(c, userId) : null;
  const cidade = ibge ?? mor?.ibge ?? null; const uf = mor?.uf ?? null;
  const rows = (await c.query(
    `select i.id, i.definicao_id, i.categoria, i.escopo, i.ibge, i.uf, i.estado, i.permanente, i.inicio, i.fim, i.textos, i.regras, i.progresso, i.resultado,
            p.estado meu_estado, p.progresso meu_progresso
       from event_instances i left join event_participants p on p.instance_id = i.id and p.user_id = $1
      where i.estado in ('announced','enrolling','active')
        and (i.permanente or i.escopo = 'nacional' or (i.escopo = 'regional' and i.uf = $3) or i.ibge = $2)
      order by i.permanente, i.inicio nulls first limit 100`, [userId, cidade, uf])).rows;
  return rows.map((r) => {
    const d: EventDefinition = r.regras; const p = { ...(r.meu_progresso || {}) };
    return {
      id: r.id, evento: r.definicao_id, categoria: r.categoria, escopo: r.escopo, estado: r.estado, permanente: r.permanente, inicio: r.inicio, fim: r.fim,
      titulo: r.textos?.titulo || d.title, chamada: r.textos?.chamada || '', descricao: d.description, motor: d.mechanic.motor, cta: d.cta,
      recompensa: REGRAS[d.reward_rule_id]?.descricao, min_participantes: d.min_participants, enrollment: d.enrollment,
      meta: r.progresso?.meta ? { total: r.progresso.total || 0, meta: r.progresso.meta } : null,
      meu: r.meu_estado ? { estado: r.meu_estado, progresso: p } : null,
    };
  });
}
