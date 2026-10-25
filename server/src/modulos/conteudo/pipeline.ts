/* Pipeline de conteúdo: evento de domínio → candidata → snapshot reconciliado → render (fila do estúdio) →
   revisão/aprovação → agenda (teto diário) → publicação (publicador.ts) → funil.
   Nada aqui escreve em tabelas do jogo (votos, pontos, casas): só lê. Erros do pipeline nunca sobem para o jogo. */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../../config';
import { db, q, q1, tx, type Exec } from '../../db/db';
import { enfileirar } from '../../jobs/fila';
import { redigir } from '../../seguranca/cripto';
import { conteudoConfig } from './config';
import { CONTRATO_VERSAO, TEMPLATES, validarRenderInput, type EleicaoStatus, type Metrica, type RenderInput, type TemplateId } from './contrato';
import { MOLDES, legenda } from './copy';
import { consultarFonte, perfisPermitidos } from './fontes';

export class ErroConteudo extends Error { constructor(msg: string, public status = 400) { super(msg); } }

// ---------------------------------------------------------------- eventos → candidatas
export type Escopo = { tipo: RenderInput['scope']['tipo']; nome: string; uf?: string; ibge?: number; street_id?: string; eleicao_id?: string };
export type Candidata = {
  template_id: TemplateId; chave: string; escopo: Escopo; fatos?: Record<string, any>; perfis_user_ids?: string[];
  election_status?: EleicaoStatus; categoria: string; prioridade?: number; campanha?: string | null; demo?: boolean; valido_ate?: string | null;
};

/** traduz um domain_event em candidata (ou null). Contrato dos eventos em README do módulo. */
export function candidataDeEvento(tipo: string, d: any, evId: number): Candidata | null {
  const base = { fatos: d, demo: !!d?.demo, campanha: d?.campanha ?? null, perfis_user_ids: Array.isArray(d?.perfis_user_ids) ? d.perfis_user_ids : [] };
  switch (tipo) {
    case 'conteudo.fato': {
      if (!TEMPLATES[d?.tipo as TemplateId] || !d?.escopo?.nome) throw new Error('conteudo.fato sem tipo/escopo válido');
      return { ...base, template_id: d.tipo, chave: d.chave || `fato:${evId}`, escopo: d.escopo, election_status: d.election_status || 'nao_aplica', categoria: d.categoria || d.tipo, prioridade: d.prioridade, valido_ate: d.valido_ate };
    }
    case 'cidade.marco':
      return { ...base, template_id: 'casa', chave: `cidade.marco:${d.ibge}:${d.marco}`, escopo: { tipo: 'cidade', nome: d.nome, uf: d.uf, ibge: d.ibge }, categoria: 'crescimento', prioridade: 40 };
    case 'rua.convite_aberto':
      return { ...base, template_id: 'convite', chave: `rua.convite:${d.street_id}:${d.dia || evId}`, escopo: { tipo: 'rua', nome: d.nome, uf: d.uf, ibge: d.ibge, street_id: d.street_id }, categoria: 'convite', prioridade: 45 };
    case 'rua.obra_inaugurada':
      return { ...base, template_id: 'obra', chave: `rua.obra:${d.obra_id || evId}`, escopo: { tipo: 'rua', nome: d.nome, uf: d.uf, ibge: d.ibge, street_id: d.street_id }, categoria: 'obra', prioridade: 60 };
    case 'eleicao.parcial': {
      // placar provisório: no máximo "disputa apertada" ou "virada". NUNCA resultado/posse.
      const escopo = { tipo: 'eleicao' as const, nome: d.nome, uf: d.uf, ibge: d.ibge, eleicao_id: String(d.eleicao_id) };
      if (d.lider_mudou) return { ...base, template_id: 'virada', chave: `eleicao.virada:${d.eleicao_id}:${d.rodada ?? evId}`, escopo, election_status: 'em_andamento', categoria: 'eleicao', prioridade: 80, valido_ate: d.prazo };
      if (d.diferenca_publicavel && Number(d.diferenca_votos) <= Number(d.limite_apertada ?? 10)) return { ...base, template_id: 'votacao', chave: `eleicao.apertada:${d.eleicao_id}:${d.rodada ?? evId}`, escopo, election_status: 'em_andamento', categoria: 'eleicao', prioridade: 70, valido_ate: d.prazo };
      return null;
    }
    case 'eleicao.apurada': {
      if (d.oficial !== true) return null;   // apuração não oficial não vira vídeo de resultado
      return { ...base, template_id: 'resultado', chave: `eleicao.resultado:${d.eleicao_id}`, escopo: { tipo: 'eleicao', nome: d.nome, uf: d.uf, ibge: d.ibge, eleicao_id: String(d.eleicao_id) }, election_status: 'oficial', categoria: 'eleicao', prioridade: 90, perfis_user_ids: d.vencedor_user_id ? [d.vencedor_user_id] : [] };
    }
    case 'estabelecimento.inaugurado':
      if (d.aprovado !== true) return null;
      return { ...base, template_id: 'inauguracao', chave: `loja.inauguracao:${d.estabelecimento_id || evId}`, escopo: { tipo: 'estabelecimento', nome: d.cidade_nome || d.nome, uf: d.uf, ibge: d.ibge }, categoria: 'patrocinado', prioridade: 50, valido_ate: d.horario };
    case 'evento.agendado':
      return { ...base, template_id: 'agenda', chave: `evento.agenda:${d.evento_id || evId}`, escopo: d.escopo, categoria: d.categoria || 'evento', prioridade: 45, valido_ate: d.inicio };
    default: return null;
  }
}

export async function registrarCandidata(c: Candidata, eventIds: number[], ex: Exec = db()) {
  const r = await q1<{ id: string }>(
    `insert into content_candidates (template_id, chave, event_ids, escopo, fatos, perfis_user_ids, election_status, categoria, prioridade, campanha, demo, valido_ate)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (chave) do nothing returning id`,
    [c.template_id, c.chave, eventIds, JSON.stringify(c.escopo), JSON.stringify(c.fatos || {}), c.perfis_user_ids || [], c.election_status || 'nao_aplica', c.categoria, c.prioridade ?? 50, c.campanha ?? null, !!c.demo, c.valido_ate ?? null], ex);
  return r?.id ?? (await q1<{ id: string }>(`select id from content_candidates where chave = $1`, [c.chave], ex))!.id;
}

/** eleição apurada: pautas de disputa/virada da mesma eleição perdem a validade (e seus posts pendentes são cancelados) */
export async function encerrarPautasDaEleicao(eleicaoId: string) {
  const cands = await q<{ id: string }>(`update content_candidates set estado = 'expirada', motivo = 'votação encerrada' where escopo->>'eleicao_id' = $1 and template_id in ('votacao','virada') and estado in ('nova','selecionada') returning id`, [eleicaoId]);
  const pubs = await q<{ id: string }>(`select p.id from publication_jobs p join content_snapshots s on s.id = p.snapshot_id where s.candidate_id = any($1::uuid[]) and p.estado in ('draft','rendering','rendered','review','approved','scheduled')`, [cands.map((c) => c.id)]);
  for (const p of pubs) await cancelarPublicacao(p.id, 'votação encerrada: placar parcial perdeu a validade');
  return pubs.length;
}

// ---------------------------------------------------------------- snapshot reconciliado
type Def = { chave: string; rotulo: string; fonte?: (e: Escopo) => [string, Record<string, any>]; unidade?: string };
const DEFS: Record<TemplateId, Def[]> = {
  casa: [{ chave: 'moradores_reivindicados', rotulo: 'casas reivindicadas', fonte: (e) => ['cidade.moradores_reivindicados', { ibge: e.ibge }] }],
  avatar: [{ chave: 'avatares_salvos', rotulo: 'avatares montados', fonte: () => ['pais.avatares_salvos', {}] }],
  convite: [{ chave: 'vagas', rotulo: 'vagas livres', fonte: (e) => ['rua.vagas', { street_id: e.street_id }] }, { chave: 'moradores', rotulo: 'moradores', fonte: (e) => ['rua.moradores', { street_id: e.street_id }] }],
  obra: [{ chave: 'casas_antes', rotulo: 'casas antes' }, { chave: 'casas_depois', rotulo: 'casas depois' }],
  exploracao: [{ chave: 'cidades_com_casas', rotulo: 'cidades com casas', fonte: () => ['pais.cidades_com_casas', {}] }, { chave: 'visitas_semana', rotulo: 'visitas na semana' }],
  desafio: [{ chave: 'meta', rotulo: 'meta' }, { chave: 'progresso', rotulo: 'feito' }, { chave: 'prazo', rotulo: 'prazo' }],
  votacao: [{ chave: 'diferenca_votos', rotulo: 'votos de diferença' }, { chave: 'candidaturas', rotulo: 'candidaturas' }, { chave: 'prazo', rotulo: 'fecha' }],
  virada: [{ chave: 'diferenca_votos', rotulo: 'votos de diferença' }, { chave: 'prazo', rotulo: 'fecha' }],
  resultado: [{ chave: 'cargo', rotulo: 'cargo' }, { chave: 'vencedor', rotulo: 'eleito' }, { chave: 'mandato_dias', rotulo: 'dias de mandato' }],
  inauguracao: [{ chave: 'local', rotulo: 'local' }, { chave: 'horario', rotulo: 'horário' }],
  agenda: [{ chave: 'evento', rotulo: 'evento' }, { chave: 'inicio', rotulo: 'começa' }],
  retrospectiva: [{ chave: 'casas_reivindicadas', rotulo: 'casas reivindicadas', fonte: (e) => e.ibge ? ['cidade.moradores_reivindicados', { ibge: e.ibge }] : ['pais.moradores_reivindicados', {}] },
    { chave: 'ruas_ativas', rotulo: 'ruas ativas', fonte: (e) => e.ibge ? ['cidade.ruas_ativas', { ibge: e.ibge }] : ['pais.ruas_ativas', {}] }, { chave: 'obras_concluidas', rotulo: 'obras concluídas' }],
};
/** fundo de cada template: captura do jogo real (video-studio/assets/capturas, ver manifesto.json) */
const FUNDO: Record<TemplateId, string> = {
  casa: 'casa-perto', avatar: 'casa-perto', convite: 'rua-perto', obra: 'rua-perto', exploracao: 'brasil', desafio: 'cidade-vitoria',
  votacao: 'cidade-sp', virada: 'cidade-noite', resultado: 'cidade-rj', inauguracao: 'loja-pet', agenda: 'cidade-sp', retrospectiva: 'brasil',
};

const canon = (v: unknown): string => Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ':' + canon((v as any)[k])).join(',')}}` : JSON.stringify(v);
/** hash do input para cache: ignora ids e horários de apuração (mesmos fatos no mesmo dia = mesmo vídeo) */
export const hashInput = (i: RenderInput) => {
  const { snapshot_id, content_id, data_timestamp, background_asset, ...resto } = i;
  const semHora = { ...resto, dia: data_timestamp.slice(0, 10), fundo: background_asset?.src ?? null, metrics: resto.metrics.map((m) => ({ ...m, origem: { tipo: m.origem.tipo, ref: m.origem.ref } })) };
  return createHash('sha256').update(canon(semHora)).digest('hex');
};

/** monta o RenderInput a partir dos fatos (consultas re-executáveis + evento), valida e grava o snapshot.
    Devolve o snapshot existente se o mesmo input já foi gerado (cache). */
export async function construirSnapshot(candidateId: string, ex: Exec = db()) {
  const c = await q1<any>(`select * from content_candidates where id = $1`, [candidateId], ex);
  if (!c) throw new ErroConteudo('candidata não encontrada', 404);
  if (c.estado === 'expirada' || c.estado === 'descartada') throw new ErroConteudo(`candidata ${c.estado}: não gera vídeo`);
  if (c.valido_ate && Date.parse(c.valido_ate) <= Date.now()) throw new ErroConteudo('fato expirado: não gera vídeo');
  const t = TEMPLATES[c.template_id as TemplateId], escopo: Escopo = c.escopo, fatos = c.fatos || {};
  const agora = new Date().toISOString();
  const metricas: Metrica[] = [], fontes: any[] = [], valores: Record<string, number | string> = {};
  const evRef = c.event_ids?.length ? `domain_events:${c.event_ids.join(',')}` : 'demo:fixture';
  const perfis = await perfisPermitidos(c.perfis_user_ids || [], ex);
  for (const d of DEFS[c.template_id as TemplateId]) {
    let valor: number | string, origem: Metrica['origem'];
    if (d.chave === 'vencedor') {
      // nome de pessoa só com consentimento: vencedor sem aparecer_em_video vira "a candidatura vencedora"
      valor = perfis.length ? perfis[0].nome_publico : 'A candidatura vencedora';
      origem = { tipo: c.demo ? 'demo' : 'evento', ref: evRef, apurado_em: fatos.apurado_em || agora };
    } else if (d.fonte) {
      const [fonte, parametros] = d.fonte(escopo);
      valor = await consultarFonte(fonte, parametros, ex);
      origem = { tipo: 'consulta', ref: `${fonte}(${canon(parametros)})`, apurado_em: agora };
      fontes.push({ chave: d.chave, fonte, parametros, valor, apurado_em: agora });
    } else {
      const v = fatos.metricas?.[d.chave] ?? fatos[d.chave];
      if (v === undefined || v === null || v === '') throw new ErroConteudo(`fato sem a métrica ${d.chave} (origem: ${evRef})`);
      valor = v; origem = { tipo: c.demo ? 'demo' : 'evento', ref: evRef, apurado_em: fatos.apurado_em || agora };
    }
    valores[d.chave] = valor; metricas.push({ chave: d.chave, rotulo: d.rotulo, valor, origem, ...(d.unidade ? { unidade: d.unidade } : {}) });
  }
  const m = MOLDES[c.template_id as TemplateId]({ nome: escopo.nome, uf: escopo.uf }, valores);
  const ba = fatos.antes_depois;
  const fundo = escopo.ibge && existsSync(resolve(conteudoConfig.dirCapturas, `cidade-${escopo.ibge}.png`)) ? `cidade-${escopo.ibge}` : FUNDO[c.template_id as TemplateId];
  const input: Omit<RenderInput, 'snapshot_id'> & { snapshot_id: string } = {
    content_id: c.id, template_id: c.template_id, template_version: t.versao, event_ids: (c.event_ids || []).map(Number), snapshot_id: 'pendente',
    scope: { tipo: escopo.tipo, nome: escopo.nome, ...(escopo.uf ? { uf: escopo.uf } : {}), ...(escopo.ibge ? { ibge: escopo.ibge } : {}) },
    title: m.title, lines: { gancho: m.gancho, evidencia: m.evidencia, acao: m.acao }, metrics: metricas,
    before_after_assets: ba ? { antes: ba.antes, depois: ba.depois } : null,
    background_asset: { src: `assets/capturas/${fundo}.png`, data: agora, rotulo: 'captura do jogo' },
    permitted_public_profiles: perfis.map((p) => ({ nome_publico: p.nome_publico, handle: p.handle, ...(p.avatar ? { avatar: p.avatar } : {}) })),
    cta: c.template_id === 'casa' || c.template_id === 'retrospectiva' ? { ...m.cta, aceita_comentario_cidade: fatos.aceita_comentario_cidade !== false } : m.cta,
    election_status: c.election_status, data_timestamp: agora, sponsorship_label: fatos.patrocinio_label ?? null,
    locale: 'pt-BR', demo: !!c.demo, duration_s: t.duracao,
  };
  if (input.cta.tipo === 'comentar_cidade' && !input.cta.aceita_comentario_cidade) input.cta = { texto: 'Abra o jogo pelo link da bio', tipo: t.ctaTipos.includes('abrir_jogo') ? 'abrir_jogo' : t.ctaTipos[0], aceita_comentario_cidade: false };
  const v = validarRenderInput(input);
  if (!v.ok) throw new ErroConteudo('snapshot inválido: ' + v.erros.join('; '));
  const hash = hashInput(input);
  const ja = await q1<any>(`select * from content_snapshots where hash = $1`, [hash], ex);
  if (ja) return ja;
  const validoAte = c.valido_ate || new Date(Date.now() + conteudoConfig.validadeFatoH * 3600_000).toISOString();
  const s = await q1<any>(
    `insert into content_snapshots (candidate_id, template_id, template_version, contrato_versao, hash, dados, fontes, perfis_user_ids, demo, valido_ate)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [c.id, c.template_id, t.versao, CONTRATO_VERSAO, hash, JSON.stringify(input), JSON.stringify(fontes), perfis.map((p) => p.user_id), !!c.demo, validoAte], ex);
  // o snapshot_id do input é o id da linha (rastreável no vídeo/manifesto)
  input.snapshot_id = s.id;
  return (await q1<any>(`update content_snapshots set dados = $2 where id = $1 returning *`, [s.id, JSON.stringify(input)], ex))!;
}

// ---------------------------------------------------------------- render (fila do estúdio)
export async function solicitarRender(snapshotId: string, ex: Exec = db()) {
  const s = await q1<any>(`select id, hash, template_id, template_version from content_snapshots where id = $1`, [snapshotId], ex);
  if (!s) throw new ErroConteudo('snapshot não encontrado', 404);
  const cacheKey = createHash('sha256').update(`${s.hash}|${s.template_version}|${conteudoConfig.renderRuntime}`).digest('hex');
  await q(`insert into render_jobs (snapshot_id, template_id, template_version, cache_key) values ($1,$2,$3,$4) on conflict (cache_key) do nothing`, [s.id, s.template_id, s.template_version, cacheKey], ex);
  return (await q1<any>(`select * from render_jobs where cache_key = $1`, [cacheKey], ex))!;
}

/** o worker do estúdio pede o próximo render. Respeita kill switch e o limite de renders simultâneos. */
export async function reivindicarRender(worker: string) {
  if (config.kill.render) return null;
  return tx(async (c) => {
    await c.query(`select pg_advisory_xact_lock(728350)`);
    const rodando = (await c.query(`select count(*)::int n from render_jobs where estado = 'rodando' and travado_ate > now()`)).rows[0].n;
    if (rodando >= conteudoConfig.renderMaxSimultaneos) return null;
    const j = (await c.query(
      `select r.* from render_jobs r where (r.estado in ('pendente','erro') and r.disponivel_em <= now()) or (r.estado = 'rodando' and r.travado_ate <= now())
        order by r.prioridade, r.criado_em limit 1 for update skip locked`)).rows[0];
    if (!j) return null;
    const r = (await c.query(`update render_jobs set estado = 'rodando', tentativas = tentativas + 1, worker = $2, travado_ate = now() + make_interval(mins => $3) where id = $1 returning *`, [j.id, worker.slice(0, 80), conteudoConfig.renderLeaseMin])).rows[0];
    const s = (await c.query(`select dados from content_snapshots where id = $1`, [j.snapshot_id])).rows[0];
    return { job: r, input: s.dados as RenderInput };
  });
}

export type ResultadoRender = { ok: true; mp4: string; thumb: string; inspecao: { ok: boolean; [k: string]: unknown } } | { ok: false; erro: string };

/** worker devolve o resultado. Falha de render só afeta o conteúdo (vira 'failed' após o limite), nunca o jogo. */
export async function concluirRender(id: string, r: ResultadoRender) {
  const j = await q1<any>(`select * from render_jobs where id = $1`, [id]);
  if (!j) throw new ErroConteudo('render não encontrado', 404);
  if (j.estado === 'cancelado') return { estado: 'cancelado' };
  if (j.estado !== 'rodando') throw new ErroConteudo(`render em estado ${j.estado}`, 409);
  if (r.ok && r.inspecao?.ok) {
    await q(`update render_jobs set estado = 'feito', saida_mp4 = $2, saida_thumb = $3, inspecao = $4, erro = null, terminado_em = now(), travado_ate = null where id = $1`, [id, r.mp4, r.thumb, JSON.stringify(r.inspecao)]);
    const pubs = await q<{ id: string }>(`update publication_jobs set estado = 'review', atualizado_em = now() where render_job_id = $1 and estado in ('rendering','rendered') returning id`, [id]);
    for (const p of pubs) await talvezAutopublicar(p.id);
    return { estado: 'feito' };
  }
  const erro = redigir(r.ok ? 'inspeção reprovou o vídeo: ' + JSON.stringify(r.inspecao).slice(0, 500) : r.erro).slice(0, 2000);
  const morto = j.tentativas >= j.max_tentativas;
  await q(`update render_jobs set estado = $2, erro = $3, travado_ate = null, disponivel_em = now() + make_interval(secs => $4) where id = $1`, [id, morto ? 'morto' : 'erro', erro, 30 * 2 ** j.tentativas]);
  if (morto) await q(`update publication_jobs set estado = 'failed', motivo = 'render falhou: ' || $2, atualizado_em = now() where render_job_id = $1 and estado in ('draft','rendering')`, [id, erro.slice(0, 300)]);
  return { estado: morto ? 'morto' : 'erro' };
}

export async function cancelarRender(id: string, motivo: string) {
  await q(`update render_jobs set estado = 'cancelado', erro = $2, travado_ate = null where id = $1 and estado in ('pendente','erro','rodando')`, [id, motivo]);
}

// ---------------------------------------------------------------- publicação (estados editoriais)
const ATIVOS = ['draft', 'rendering', 'rendered', 'review', 'approved', 'scheduled'];

/** cria a pauta: snapshot → publicação 'draft' → render (ou cache) → 'rendering'/'review'. Idempotente. */
export async function criarPauta(candidateId: string, opts: { campanha?: string | null; tipo?: 'organico' | 'patrocinado' } = {}) {
  const snap = await construirSnapshot(candidateId);
  const campanha = opts.campanha ?? (await q1<{ campanha: string | null }>(`select campanha from content_candidates where id = $1`, [candidateId]))!.campanha;
  if (snap.demo && campanha && !campanha.startsWith('demo')) throw new ErroConteudo('dado de demonstração não entra em campanha real');
  const tipo = opts.tipo ?? (snap.dados.sponsorship_label ? 'patrocinado' : 'organico');
  const chave = `${snap.hash}:${campanha || 'organico'}`;
  const leg = legenda(snap.dados);
  let pub = await q1<any>(
    `insert into publication_jobs (snapshot_id, template_id, campanha, tipo, legenda, chave_idempotencia, demo) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (chave_idempotencia) do nothing returning *`, [snap.id, snap.template_id, campanha, tipo, leg, chave, snap.demo]);
  if (!pub) return (await q1<any>(`select * from publication_jobs where chave_idempotencia = $1`, [chave]))!;
  await q(`update content_candidates set estado = 'selecionada' where id = $1 and estado = 'nova'`, [candidateId]);
  const r = await solicitarRender(snap.id);
  const estado = r.estado === 'feito' ? 'review' : r.estado === 'cancelado' || r.estado === 'morto' ? 'failed' : 'rendering';
  pub = await q1<any>(`update publication_jobs set render_job_id = $2, estado = $3, motivo = $4, atualizado_em = now() where id = $1 returning *`, [pub.id, r.id, estado, estado === 'failed' ? `render ${r.estado}` : null]);
  if (estado === 'review') await talvezAutopublicar(pub.id);
  return pub;
}

/** autopublish: desligado por padrão. Exige config.publicacao.autopublish + storyboard aprovado + flag do template + não-demo. */
export async function talvezAutopublicar(pubId: string) {
  if (!config.publicacao.autopublish) return false;
  const p = await q1<any>(`select p.*, a.autopublish, a.storyboard_aprovado_em from publication_jobs p join content_snapshots s on s.id = p.snapshot_id
     left join content_template_approvals a on a.template_version = s.template_version where p.id = $1`, [pubId]);
  if (!p || p.demo || !p.autopublish || !p.storyboard_aprovado_em || p.estado !== 'review') return false;
  await aprovar(pubId, null); await agendar(pubId); return true;
}

export async function aprovar(pubId: string, userId: string | null) {
  const p = await q1<any>(`update publication_jobs p set estado = 'approved', aprovado_por = $2, aprovado_em = now(), atualizado_em = now()
     from render_jobs r where p.id = $1 and r.id = p.render_job_id and r.estado = 'feito' and p.estado = 'review' returning p.*`, [pubId, userId]);
  if (!p) throw new ErroConteudo('só aprova publicação em revisão com render concluído', 409);
  return p;
}

/** agenda na próxima vaga do calendário (dia em America/Sao_Paulo; teto diário por tipo) e enfileira a publicação */
export async function agendar(pubId: string, aPartirDe = new Date()) {
  return tx(async (c) => {
    const p = (await c.query(`select * from publication_jobs where id = $1 for update`, [pubId])).rows[0];
    if (!p) throw new ErroConteudo('publicação não encontrada', 404);
    if (p.estado !== 'approved') throw new ErroConteudo('só agenda publicação aprovada', 409);
    const max = p.tipo === 'organico' ? config.publicacao.maxPostsDia : conteudoConfig.maxPatrocinadosDia;
    if (max < 1) throw new ErroConteudo('teto diário de posts é zero');
    await c.query(`select pg_advisory_xact_lock(728351)`);
    const hoje = (await c.query(`select (($1::timestamptz) at time zone 'America/Sao_Paulo')::date d`, [aPartirDe.toISOString()])).rows[0].d;
    for (let dia = 0; dia < 30; dia++) {
      for (let slot = 1; slot <= max; slot++) {
        const h = (await c.query(`select ((($1::date + $2::int) + make_interval(hours => $3, mins => $4)) at time zone 'America/Sao_Paulo') h`,
          [hoje, dia, conteudoConfig.horaPadrao, (slot - 1) * conteudoConfig.intervaloMinimoMin])).rows[0].h as Date;
        if (h.getTime() <= aPartirDe.getTime()) continue;
        const ok = (await c.query(`insert into editorial_calendar (data, tipo, slot, publication_job_id, horario) values ($1::date + $2::int, $3, $4, $5, $6) on conflict do nothing returning id`,
          [hoje, dia, p.tipo, slot, p.id, h])).rows[0];
        if (!ok) continue;
        await c.query(`update publication_jobs set estado = 'scheduled', agendado_para = $2, atualizado_em = now() where id = $1`, [p.id, h]);
        await enfileirar(c, 'conteudo.publicar', { id: p.id }, `conteudo.publicar:${p.id}`, Math.max(0, (h.getTime() - Date.now()) / 1000));
        return { id: p.id, agendado_para: h, slot };
      }
    }
    throw new ErroConteudo('calendário cheio nos próximos 30 dias');
  });
}

export async function cancelarPublicacao(pubId: string, motivo: string, estado: 'cancelled' | 'needs_correction' = 'cancelled') {
  const p = await q1<any>(`update publication_jobs set estado = $2, motivo = $3, atualizado_em = now() where id = $1 and (estado = any($4) or (estado = 'publishing' and publicar_enviado_em is null)) returning *`, [pubId, estado, motivo.slice(0, 500), ATIVOS]);
  if (!p) return null;
  await q(`update editorial_calendar set estado = 'liberado' where publication_job_id = $1 and estado = 'reservado'`, [pubId]);
  await q(`update processing_jobs set estado = 'cancelado' where chave = $1 and estado in ('pendente','erro')`, [`conteudo.publicar:${pubId}`]);
  // o render só é cancelado se nenhuma outra publicação ativa depende dele
  if (p.render_job_id) {
    const outro = await q1(`select 1 from publication_jobs where render_job_id = $1 and id <> $2 and estado = any($3)`, [p.render_job_id, pubId, ATIVOS]);
    if (!outro) await cancelarRender(p.render_job_id, motivo);
  }
  return p;
}

/** remover autorização promocional: cancela renders/posts pendentes que mostram a pessoa; novos snapshots já a excluem */
export async function revogarAutorizacaoPromocional(userId: string, motivo = 'autorização promocional removida') {
  await q(`update privacy_preferences set aparecer_em_video = false, atualizado_em = now() where user_id = $1`, [userId]);
  const pubs = await q<{ id: string }>(`select p.id from publication_jobs p join content_snapshots s on s.id = p.snapshot_id
     where $1 = any(s.perfis_user_ids) and (p.estado = any($2) or (p.estado = 'publishing' and p.publicar_enviado_em is null))`, [userId, ATIVOS]);
  for (const p of pubs) await cancelarPublicacao(p.id, motivo);
  const renders = await q<{ id: string }>(`select r.id from render_jobs r join content_snapshots s on s.id = r.snapshot_id where $1 = any(s.perfis_user_ids) and r.estado in ('pendente','erro','rodando')`, [userId]);
  for (const r of renders) await cancelarRender(r.id, motivo);
  // candidatas ainda não pautadas deixam de citar a pessoa
  await q(`update content_candidates set perfis_user_ids = array_remove(perfis_user_ids, $1::uuid) where $1 = any(perfis_user_ids) and estado in ('nova','selecionada')`, [userId]);
  return { publicacoes: pubs.length, renders: renders.length };
}

// ---------------------------------------------------------------- seleção editorial
/** escolhe até `limite` candidatas novas (prioridade, rodízio 48 h por categoria/cidade, sem demo em campanha real) */
export async function selecionarPautas(limite = 1, incluirDemo = false) {
  await q(`update content_candidates set estado = 'expirada', motivo = 'fato expirado' where estado = 'nova' and valido_ate is not null and valido_ate <= now()`);
  const cands = await q<any>(
    `select c.* from content_candidates c where c.estado = 'nova' and ($2 or not c.demo)
       and (c.categoria = 'eleicao' or not exists (
         select 1 from content_candidates o where o.estado = 'selecionada' and o.categoria = c.categoria
            and coalesce(o.escopo->>'ibge','') = coalesce(c.escopo->>'ibge','') and o.criado_em > now() - make_interval(hours => $3) and o.id <> c.id))
     order by c.prioridade desc, c.criado_em limit $1`, [limite, incluirDemo, conteudoConfig.rodizioHoras]);
  const criadas = [];
  for (const c of cands) {
    try { criadas.push(await criarPauta(c.id)); }
    catch (e: any) { await q(`update content_candidates set estado = 'descartada', motivo = $2 where id = $1`, [c.id, String(e.message).slice(0, 300)]); }
  }
  return criadas;
}

// ---------------------------------------------------------------- funil
export type Etapa = 'comentario' | 'cidade_resolvida' | 'reserva' | 'acesso_entregue' | 'reivindicacao' | 'avatar_salvo' | 'primeira_acao' | 'retorno_d1' | 'retorno_d7' | 'convite' | 'amigo_ativado' | 'participacao' | 'clique' | 'compartilhamento';
export async function registrarFunil(e: { etapa: Etapa; chave: string; campanha?: string | null; template_id?: string | null; publication_job_id?: string | null; user_id?: string | null; identity_id?: string | null; demo?: boolean }, ex: Exec = db()) {
  await q(`insert into content_funnel_events (etapa, chave, campanha, template_id, publication_job_id, user_id, identity_id, demo) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (chave) do nothing`,
    [e.etapa, e.chave, e.campanha ?? null, e.template_id ?? null, e.publication_job_id ?? null, e.user_id ?? null, e.identity_id ?? null, !!e.demo], ex);
}
/** relatório por campanha/template; demo nunca entra */
export async function relatorioFunil() {
  return q(`select coalesce(campanha,'(sem campanha)') campanha, coalesce(template_id,'(sem template)') template_id, etapa, count(*)::int n
            from content_funnel_events where not demo group by 1,2,3 order by 1,2,3`);
}
