/* Motores reutilizáveis dos eventos. Cada motor valida a ação no servidor e devolve o progresso; nenhum aceita
   "estive aqui" sem ação significativa (desafio verificado, configuração válida, alvo real distinto, etc.).
   Falha de validação NÃO lança: volta {ok:false} para a tentativa ser gravada (commit) e a rota responder 422. */
import type { Exec } from '../../db/db';
import { emitir } from '../../db/db';
import { emitirDesafio, verificarDesafio, revelarCelula, EMOTES } from '../recompensas/desafios';
import { contribuirObra, type Moradia, moradia } from '../recompensas/obras';
import { diaJogo } from '../recompensas/regras';
import type { EventDefinition, Motor } from './tipos';

export type CtxMotor = { c: Exec; def: EventDefinition; inst: any; userId: string; mor: Moradia | null; progresso: any; acao: any; agora: Date };
export type RespostaMotor = { ok: true; progresso: any; concluido: boolean; info?: any } | { ok: false; motivo: string; progresso?: any };
export type MotorImpl = { desafio?(x: CtxMotor): Promise<any>; agir(x: CtxMotor): Promise<RespostaMotor> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REGIAO: Record<string, string> = {
  AC: 'N', AP: 'N', AM: 'N', PA: 'N', RO: 'N', RR: 'N', TO: 'N',
  AL: 'NE', BA: 'NE', CE: 'NE', MA: 'NE', PB: 'NE', PE: 'NE', PI: 'NE', RN: 'NE', SE: 'NE',
  DF: 'CO', GO: 'CO', MT: 'CO', MS: 'CO', ES: 'SE', MG: 'SE', RJ: 'SE', SP: 'SE', PR: 'S', RS: 'S', SC: 'S',
};
const ctxDe = (x: CtxMotor, extra = '') => `evento:${x.inst.id}${extra}`;
const falha = (motivo: string, progresso?: any): RespostaMotor => ({ ok: false, motivo, progresso });

async function existeTabela(c: Exec, nome: string) { return !!(await c.query(`select to_regclass($1) r`, ['public.' + nome])).rows[0].r; }
export async function amizadesDisponiveis(c: Exec) { return existeTabela(c, 'friendships'); }

/* ---------- exploração / viagem ---------- */
const exploracao: MotorImpl = {
  async desafio(x) {
    const p = x.def.mechanic.params;
    if (p.modo === 'simbolos') return emitirDesafio(x.c, { userId: x.userId, contexto: ctxDe(x), tipo: 'simbolos', params: p, agora: x.agora });
    const ibge = Number(x.acao?.ibge);
    if (!Number.isInteger(ibge)) return { erro: 'informe a cidade de destino' };
    return emitirDesafio(x.c, { userId: x.userId, contexto: ctxDe(x, ':' + ibge), tipo: 'conta', agora: x.agora });
  },
  async agir(x) {
    const p = x.def.mechanic.params; const prog = { cidades: [] as { ibge: number; uf: string }[], ...x.progresso };
    if (p.modo === 'simbolos') {
      const r = await revelarCelula(x.c, { id: x.acao?.desafio_id, userId: x.userId, contexto: ctxDe(x), celula: x.acao?.celula, agora: x.agora });
      if (!r.ok) return falha(r.motivo, prog);
      prog.achados = r.achados;
      if (!r.completo) return { ok: true, progresso: prog, concluido: false, info: r };
      const v = await verificarDesafio(x.c, { id: x.acao.desafio_id, userId: x.userId, contexto: ctxDe(x), resposta: null, minMs: 0, agora: x.agora });
      return v.ok ? { ok: true, progresso: prog, concluido: true, info: r } : falha(v.motivo, prog);
    }
    const ibge = Number(x.acao?.ibge);
    const mun = Number.isInteger(ibge) ? (await x.c.query(`select ibge, uf from municipios where ibge = $1`, [ibge])).rows[0] : null;
    if (!mun) return falha('cidade de destino inválida', prog);
    if (p.fora_de_casa && x.mor && x.mor.ibge === ibge) return falha('a viagem precisa ser para outra cidade', prog);
    if (prog.cidades.some((cd: { ibge: number }) => cd.ibge === ibge)) return falha('essa cidade já conta no seu passaporte', prog);
    const v = await verificarDesafio(x.c, { id: x.acao?.desafio_id, userId: x.userId, contexto: ctxDe(x, ':' + ibge), resposta: x.acao?.resposta, minMs: 1500, agora: x.agora });
    if (!v.ok) return falha(v.motivo, prog);
    prog.cidades.push({ ibge, uf: mun.uf });
    const porRegiao = new Map<string, number>(); for (const cd of prog.cidades) porRegiao.set(REGIAO[cd.uf], (porRegiao.get(REGIAO[cd.uf]) || 0) + 1);
    const n = p.mesma_regiao ? Math.max(...porRegiao.values()) : prog.cidades.length;
    const concluido = n >= (p.min_cidades || 1) && porRegiao.size >= (p.min_regioes || 1);
    return { ok: true, progresso: prog, concluido };
  },
};

/* ---------- contribuição (obra da rua ou meta coletiva da instância) ---------- */
const contribuicao: MotorImpl = {
  async desafio(x) { return emitirDesafio(x.c, { userId: x.userId, contexto: ctxDe(x), tipo: 'peca', agora: x.agora }); },
  async agir(x) {
    const p = x.def.mechanic.params; const prog = { n: 0, ...x.progresso };
    if (x.def.completion_rule.tipo === 'obra_concluida_contribuida') {
      const ok = x.mor?.streetId && (await x.c.query(
        `select 1 from community_contributions cc join community_projects cp on cp.id = cc.project_id where cp.street_id = $1 and cp.status = 'concluida' and cc.user_id = $2 limit 1`, [x.mor.streetId, x.userId])).rows[0];
      return ok ? { ok: true, progresso: prog, concluido: true } : falha('só quem ajudou uma obra concluída da rua recebe a lembrança', prog);
    }
    if (prog.n >= x.def.limits.por_usuario_edicao) return falha('você já deu todas as contribuições desta edição', prog);
    const v = await verificarDesafio(x.c, { id: x.acao?.desafio_id, userId: x.userId, contexto: ctxDe(x), resposta: x.acao?.resposta, minMs: 1500, agora: x.agora });
    if (!v.ok) return falha(v.motivo, prog);
    const u = Number(p.unidade || 10);
    if (p.alvo === 'obra_rua') {
      if (!x.mor?.streetId) return falha('entre numa rua para ajudar a obra', prog);
      const r = await contribuirObra(x.c, { userId: x.userId, streetId: x.mor.streetId, origem: 'evento:' + x.inst.id, chave: `evento:${x.inst.id}:${x.userId}:${prog.n + 1}`, quantidade: u, agora: x.agora });
      if (!r.ok) return falha(r.motivo, prog);
      prog.n++; prog.obra = { progresso: r.progresso, meta: r.meta };
    } else {
      const r = (await x.c.query(
        `update event_instances set progresso = progresso || jsonb_build_object('total', least((progresso->>'meta')::int, coalesce((progresso->>'total')::int, 0) + $2)), atualizado_em = now()
          where id = $1 and coalesce((progresso->>'total')::int, 0) < (progresso->>'meta')::int returning progresso`, [x.inst.id, u])).rows[0];
      if (!r) return falha('a meta coletiva já foi alcançada', prog);
      prog.n++; prog.meta = { total: r.progresso.total, meta: r.progresso.meta };
    }
    return { ok: true, progresso: prog, concluido: prog.n >= (x.def.completion_rule.n || 1) };
  },
};

/* ---------- quiz (banco revisado; uma tentativa por desafio; até 3 desafios por dia) ---------- */
const quiz: MotorImpl = {
  async desafio(x) {
    const n = (await x.c.query(`select count(*)::int n from server_challenges where user_id = $1 and contexto = $2 and (criado_em at time zone 'America/Sao_Paulo')::date = $3::date`, [x.userId, ctxDe(x), diaJogo(x.agora)])).rows[0].n;
    if (n >= 3) return { erro: 'limite de 3 quizzes por dia neste evento' };
    return emitirDesafio(x.c, { userId: x.userId, contexto: ctxDe(x), tipo: 'quiz', params: x.def.mechanic.params, agora: x.agora });
  },
  async agir(x) {
    const v = await verificarDesafio(x.c, { id: x.acao?.desafio_id, userId: x.userId, contexto: ctxDe(x), resposta: x.acao?.respostas, minMs: 2000, agora: x.agora });
    if (!v.ok) return falha(v.motivo, x.progresso);
    return { ok: true, progresso: { ...x.progresso, acertos: v.acertos, total: v.total }, concluido: true };
  },
};

/* ---------- decoração / visual (configuração válida e confirmada; ou escolha entre opções aprovadas) ---------- */
const decoracao: MotorImpl = {
  async agir(x) {
    const p = x.def.mechanic.params;
    if (p.modo === 'escolha') {
      const esc = x.acao?.escolha && typeof x.acao.escolha === 'object' ? x.acao.escolha : null;
      const [slot, valor] = esc ? (Object.entries(esc)[0] || []) : [];
      if (!slot || !p.opcoes[slot]?.includes(valor)) return falha('escolha fora das opções aprovadas', x.progresso);
      await x.c.query(
        `update event_instances set progresso = progresso || jsonb_build_object('votos', coalesce(progresso->'votos', '{}'::jsonb) || jsonb_build_object($2::text, coalesce((progresso->'votos'->>$2::text)::int, 0) + 1)), atualizado_em = now() where id = $1`,
        [x.inst.id, `${slot}=${valor}`]);
      return { ok: true, progresso: { escolha: { [slot]: valor } }, concluido: true };
    }
    const cfg = x.acao?.config && typeof x.acao.config === 'object' ? x.acao.config as Record<string, unknown> : null;
    if (!cfg) return falha('envie a configuração', x.progresso);
    if (x.acao?.confirmar !== true) return falha('confirme a configuração para concluir', x.progresso);
    const entradas = Object.entries(cfg);
    if (p.opcoes === 'avatar_catalog') {
      for (const [slot, item] of entradas) {
        const ok = typeof item === 'string' && (await x.c.query(`select 1 from avatar_catalog where item_id = $1 and slot = $2 and ativo`, [item, slot])).rows[0];
        if (!ok) return falha(`item inválido para ${slot}`, x.progresso);
      }
    } else for (const [slot, item] of entradas) if (!p.opcoes[slot]?.includes(item)) return falha(`opção inválida para ${slot}`, x.progresso);
    if (entradas.length < (p.min_slots || 1)) return falha(`configure pelo menos ${p.min_slots} itens`, x.progresso);
    await emitir(x.c, 'casa.decoracao_evento', { user_id: x.userId, evento: x.def.id, instancia: x.inst.id, config: cfg }, `decor:${x.inst.id}:${x.userId}`);
    return { ok: true, progresso: { config: cfg }, concluido: true };
  },
};

/* ---------- reação / emote (sequência sorteada pelo servidor) ---------- */
const reacao: MotorImpl = {
  async desafio(x) { return emitirDesafio(x.c, { userId: x.userId, contexto: ctxDe(x), tipo: 'sequencia', params: { tamanho: x.def.mechanic.params.tamanho || 3 }, agora: x.agora }); },
  async agir(x) {
    const v = await verificarDesafio(x.c, { id: x.acao?.desafio_id, userId: x.userId, contexto: ctxDe(x), resposta: x.acao?.sequencia, minMs: 2000, agora: x.agora });
    return v.ok ? { ok: true, progresso: { ...x.progresso, sequencia: true }, concluido: true } : falha(v.motivo, x.progresso);
  },
};

/* ---------- presença com ação significativa: check-in só abre o desafio; vale a ação feita depois de N segundos ---------- */
const presenca: MotorImpl = {
  async agir(x) {
    const p = x.def.mechanic.params; const prog = { locais: [] as string[], ...x.progresso };
    const local = String(x.acao?.local || '');
    if (!p.locais.includes(local)) return falha('local inválido para este evento', prog);
    if (prog.locais.includes(local)) return falha('você já fez a atividade deste local', prog);
    if (x.acao?.tipo === 'checkin') {
      const d = await emitirDesafio(x.c, { userId: x.userId, contexto: ctxDe(x, ':local:' + local), tipo: 'sequencia', params: { tamanho: 2 }, agora: x.agora });
      return { ok: true, progresso: prog, concluido: false, info: { desafio: d, aguarde_segundos: p.min_segundos || 5 } };
    }
    const v = await verificarDesafio(x.c, { id: x.acao?.desafio_id, userId: x.userId, contexto: ctxDe(x, ':local:' + local), resposta: x.acao?.resposta, minMs: (p.min_segundos || 5) * 1000, agora: x.agora });
    if (!v.ok) return falha(v.motivo, prog);
    prog.locais.push(local); if (x.mor) prog.ibge = x.mor.ibge;
    return { ok: true, progresso: prog, concluido: prog.locais.length >= (p.min_locais || 1) };
  },
};

/* ---------- social: interação com outra conta reivindicada real (sem autoindicação) ---------- */
const social: MotorImpl = {
  async agir(x) {
    const p = x.def.mechanic.params; const prog = { alvos: [] as string[], ...x.progresso };
    const alvo = String(x.acao?.alvo_user_id || ''); const emote = x.acao?.emote;
    if (!UUID.test(alvo)) return falha('escolha com quem interagir', prog);
    if (alvo === x.userId) return falha('a interação precisa ser com outra pessoa', prog);
    if (!(EMOTES as readonly string[]).includes(emote)) return falha('emote inválido', prog);
    if (prog.alvos.includes(alvo)) return falha('você já interagiu com essa pessoa neste evento', prog);
    const u = (await x.c.query(`select status, verificado_em from users where id = $1`, [alvo])).rows[0];
    const morAlvo = u?.status === 'ativo' ? await moradia(x.c, alvo) : null;
    if (!morAlvo) return falha('a outra pessoa precisa ter casa reivindicada', prog);
    if (await existeTabela(x.c, 'user_blocks')) {
      const b = (await x.c.query(`select 1 from user_blocks where (user_id = $1 and bloqueado_id = $2) or (user_id = $2 and bloqueado_id = $1)`, [x.userId, alvo])).rows[0];
      if (b) return falha('interação indisponível com essa pessoa', prog);
    }
    if (p.exigir_amizade) {
      if (!(await amizadesDisponiveis(x.c))) return falha('amizades ainda não estão disponíveis neste servidor', prog);
      const f = (await x.c.query(`select 1 from friendships where estado = 'aceita' and ((solicitante_id = $1 and destinatario_id = $2) or (solicitante_id = $2 and destinatario_id = $1))`, [x.userId, alvo])).rows[0];
      if (!f) return falha('vale só com amizade aceita pelas duas contas', prog);
    }
    if (p.alvo === 'casa_visitavel') {
      const pv = (await x.c.query(`select visita from privacy_preferences where user_id = $1`, [alvo])).rows[0];
      if (pv && pv.visita !== 'publica') return falha('essa casa não está aberta a visitas', prog);
    }
    if (p.mesma_cidade_rua_diferente && (!x.mor || morAlvo.ibge !== x.mor.ibge || !morAlvo.streetId || morAlvo.streetId === x.mor.streetId)) return falha('vale com morador de OUTRA rua da sua cidade', prog);
    if (p.mesma_cidade && (!x.mor || morAlvo.ibge !== x.mor.ibge)) return falha('vale com morador da sua cidade', prog);
    if (p.alvo_novato_dias && !(u.verificado_em && new Date(u.verificado_em).getTime() > x.agora.getTime() - p.alvo_novato_dias * 86400_000)) return falha(`vale com quem chegou nos últimos ${p.alvo_novato_dias} dias`, prog);
    prog.alvos.push(alvo);
    await emitir(x.c, 'social.interacao_evento', { de: x.userId, para: alvo, emote, evento: x.def.id, instancia: x.inst.id }, `social:${x.inst.id}:${x.userId}:${alvo}`);
    return { ok: true, progresso: prog, concluido: prog.alvos.length >= (x.def.completion_rule.n || 1) };
  },
};

/* ---------- calendário / editorial (fato real já verificado no planejamento; participação = confirmação) ---------- */
const calendario: MotorImpl = {
  async agir(x) {
    if (x.acao?.tipo !== 'confirmar') return falha('confirme a participação', x.progresso);
    return { ok: true, progresso: { confirmado: true }, concluido: true };
  },
};

export const IMPL: Record<Motor, MotorImpl> = { exploracao, contribuicao, quiz, decoracao, reacao, presenca, social, calendario };
