/* módulo conteudo (Fase 6): ouvintes de domain_events, jobs e rotas.
   - /api/conteudo/admin/*  painel editorial (sessão + papel editor_conteudo/admin_tecnico; CSRF do app)
   - /interno/conteudo/*    API do worker do video-studio (Bearer CONTEUDO_TOKEN_ESTUDIO; fora de /api: não exposta pelo
                            proxy do Vite; em produção o proxy reverso NÃO deve publicar /interno)
   Nenhuma renderização pesada roda num request HTTP: o request só enfileira. */
import type { Context } from 'hono';
import { z } from './validar';
import type { App } from '../../http/app';
import { exigirLogin, ErroHttp } from '../../http/app';
import { q, q1 } from '../../db/db';
import { aoEvento, registrarJob } from '../../jobs/fila';
import { iguais, sha256, redigir } from '../../seguranca/cripto';
import { conteudoConfig } from './config';
import {
  aprovar, agendar, cancelarPublicacao, candidataDeEvento, concluirRender, criarPauta, encerrarPautasDaEleicao, ErroConteudo,
  registrarCandidata, registrarFunil, reivindicarRender, relatorioFunil, revogarAutorizacaoPromocional, selecionarPautas, type Etapa,
} from './pipeline';
import { publicarJob } from './publicador';

/** eventos consumidos (contrato no README do módulo). O ouvinte NUNCA lança: erro vira linha em content_event_errors,
    para não travar a outbox do jogo (votos, casas e webhooks continuam). */
export const EVENTOS_CONTEUDO = ['conteudo.fato', 'cidade.marco', 'rua.convite_aberto', 'rua.obra_inaugurada', 'eleicao.parcial', 'eleicao.apurada', 'estabelecimento.inaugurado', 'evento.agendado'];
const ETAPAS_FUNIL: Record<string, Etapa> = {
  'instagram.comentario_recebido': 'comentario', 'cidade.resolvida': 'cidade_resolvida', 'casa.reservada': 'reserva', 'acesso.entregue': 'acesso_entregue',
  'casa.reivindicada': 'reivindicacao', 'avatar.salvo': 'avatar_salvo', 'jogo.primeira_acao': 'primeira_acao', 'jogo.retorno_d1': 'retorno_d1', 'jogo.retorno_d7': 'retorno_d7',
  'convite.enviado': 'convite', 'convite.aceito': 'amigo_ativado', 'eleicao.voto_registrado': 'participacao', 'rua.participacao': 'participacao',
};

async function seguro(tipo: string, evId: number, f: () => Promise<unknown>) {
  try { await f(); }
  catch (e: any) { try { await q(`insert into content_event_errors (evento_id, tipo, erro) values ($1,$2,$3)`, [evId, tipo, redigir(String(e?.message || e)).slice(0, 1000)]); } catch { /* nunca propaga */ } }
}

export async function consumirEvento(tipo: string, dados: any, evId: number) {
  await seguro(tipo, evId, async () => {
    if (tipo === 'eleicao.apurada' && dados?.oficial === true && dados?.eleicao_id != null) await encerrarPautasDaEleicao(String(dados.eleicao_id));
    const c = candidataDeEvento(tipo, dados, evId);
    if (c) await registrarCandidata(c, [evId]);
  });
}

function admin() {
  return async (c: Context<any>) => {
    const u = exigirLogin(c);
    const ok = await q1(`select 1 from admin_roles where user_id = $1 and papel in ('editor_conteudo','admin_tecnico')`, [u.id]);
    if (!ok) throw new ErroHttp(403, 'sem permissão editorial');
    return u;
  };
}
function interno(c: Context<any>) {
  const t = conteudoConfig.tokenEstudio, h = c.req.header('authorization') || '';
  if (!t || !h.startsWith('Bearer ') || !iguais(sha256(h.slice(7)), sha256(t))) throw new ErroHttp(401, 'não autorizado');
}
const pid = (c: Context<any>) => { const v = c.req.param('id'); if (!v || !/^[0-9a-f-]{36}$/i.test(v)) throw new ErroHttp(400, 'id inválido'); return v; };
const embrulhar = (f: (c: Context<any>) => Promise<Response>) => async (c: Context<any>) => {
  try { return await f(c); } catch (e) { if (e instanceof ErroConteudo) throw new ErroHttp(e.status, e.message); throw e; }
};

export function registrar(app: App) {
  for (const t of EVENTOS_CONTEUDO) aoEvento(t, (d, ev) => consumirEvento(t, d, ev.id));
  aoEvento('privacidade.video_revogado', (d, ev) => seguro('privacidade.video_revogado', ev.id, () => revogarAutorizacaoPromocional(String(d.user_id))));
  for (const [t, etapa] of Object.entries(ETAPAS_FUNIL))
    aoEvento(t, (d, ev) => seguro(t, ev.id, async () => { if (d?.campanha || d?.publication_job_id) await registrarFunil({ etapa, chave: `${etapa}:${t}:${ev.id}`, campanha: d.campanha, template_id: d.template_id, publication_job_id: d.publication_job_id, user_id: d.user_id, identity_id: d.identity_id, demo: !!d.demo }); }));

  registrarJob('conteudo.publicar', async (d) => { await publicarJob(d.id); });   // erro → retry com backoff, que reconcilia
  registrarJob('conteudo.selecionar', async (d) => { await selecionarPautas(d?.limite ?? 1); });

  const ed = admin();
  app.get('/api/conteudo/admin/candidatas', embrulhar(async (c) => { await ed(c); return c.json({ ok: true, candidatas: await q(`select id, template_id, escopo, categoria, prioridade, estado, motivo, demo, campanha, valido_ate, criado_em from content_candidates order by criado_em desc limit 200`) }); }));
  app.post('/api/conteudo/admin/candidatas/:id/pauta', embrulhar(async (c) => {
    await ed(c); const b = z.objeto(await c.req.json().catch(() => ({})), { campanha: z.textoOpc(40) });
    return c.json({ ok: true, publicacao: await criarPauta(pid(c), { campanha: b.campanha ?? null }) });
  }));
  app.get('/api/conteudo/admin/publicacoes', embrulhar(async (c) => { await ed(c); return c.json({ ok: true, publicacoes: await q(`select p.id, p.template_id, p.campanha, p.estado, p.modo, p.tipo, p.agendado_para, p.motivo, p.demo, p.pacote_manual, r.estado render, r.saida_mp4, r.saida_thumb from publication_jobs p left join render_jobs r on r.id = p.render_job_id order by p.criado_em desc limit 200`) }); }));
  app.get('/api/conteudo/admin/publicacoes/:id', embrulhar(async (c) => {
    await ed(c);
    const p = await q1<any>(`select p.*, s.dados input, s.fontes, r.estado render, r.saida_mp4, r.saida_thumb, r.inspecao from publication_jobs p join content_snapshots s on s.id = p.snapshot_id left join render_jobs r on r.id = p.render_job_id where p.id = $1`, [pid(c)]);
    if (!p) throw new ErroHttp(404, 'não encontrada');
    const tentativas = await q(`select fase, resultado, detalhe, criado_em from publication_attempts where publication_job_id = $1 order by id`, [p.id]);
    return c.json({ ok: true, publicacao: p, tentativas });
  }));
  app.post('/api/conteudo/admin/publicacoes/:id/aprovar', embrulhar(async (c) => { const u = await ed(c); return c.json({ ok: true, publicacao: await aprovar(pid(c), u.id) }); }));
  app.post('/api/conteudo/admin/publicacoes/:id/agendar', embrulhar(async (c) => { await ed(c); return c.json({ ok: true, agenda: await agendar(pid(c)) }); }));
  app.post('/api/conteudo/admin/publicacoes/:id/cancelar', embrulhar(async (c) => {
    await ed(c); const b = z.objeto(await c.req.json().catch(() => ({})), { motivo: z.textoOpc(300) });
    const p = await cancelarPublicacao(pid(c), b.motivo || 'cancelado pelo editor');
    if (!p) throw new ErroHttp(409, 'publicação não pode mais ser cancelada');
    return c.json({ ok: true });
  }));
  app.post('/api/conteudo/admin/selecionar', embrulhar(async (c) => { await ed(c); return c.json({ ok: true, criadas: (await selecionarPautas(1)).length }); }));
  app.get('/api/conteudo/admin/funil', embrulhar(async (c) => { await ed(c); return c.json({ ok: true, funil: await relatorioFunil() }); }));
  app.get('/api/conteudo/admin/agenda', embrulhar(async (c) => { await ed(c); return c.json({ ok: true, agenda: await q(`select data, tipo, slot, horario, estado, publication_job_id from editorial_calendar where data >= current_date - 1 order by data, tipo, slot`) }); }));

  // ---- API interna do worker do estúdio
  app.post('/interno/conteudo/render/reivindicar', embrulhar(async (c) => {
    interno(c); const b = z.objeto(await c.req.json().catch(() => ({})), { worker: z.textoOpc(80) });
    const r = await reivindicarRender(b.worker || 'estudio');
    return c.json({ ok: true, job: r?.job ?? null, input: r?.input ?? null });
  }));
  app.get('/interno/conteudo/render/:id', embrulhar(async (c) => { interno(c); const r = await q1(`select id, estado from render_jobs where id = $1`, [pid(c)]); if (!r) throw new ErroHttp(404, 'não encontrado'); return c.json({ ok: true, ...r }); }));
  app.post('/interno/conteudo/render/:id/concluir', embrulhar(async (c) => {
    interno(c); const b: any = await c.req.json().catch(() => null);
    if (!b || typeof b.ok !== 'boolean') throw new ErroHttp(400, 'corpo inválido');
    const r = b.ok ? { ok: true as const, mp4: String(b.mp4), thumb: String(b.thumb), inspecao: b.inspecao || { ok: false } } : { ok: false as const, erro: String(b.erro || 'erro desconhecido') };
    return c.json({ ok: true, ...(await concluirRender(pid(c), r)) });
  }));
}
