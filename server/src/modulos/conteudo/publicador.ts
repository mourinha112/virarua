/* Publicação. Padrão: DRY-RUN — gera pacote MP4 + thumbnail + legenda + manifesto para publicação MANUAL pelo operador.
   Modo oficial (InstagramPublisher, Graph API de Reels) só com TRÊS chaves explícitas: IG_ADAPTADOR=oficial,
   KILL_PUBLICACAO=0 e PUBLICACAO_OFICIAL=sim, além de conexão ativa e URL pública de mídia. Nesta fase nada é publicado.

   Fluxo oficial (docs Meta "Content Publishing", conferido em 24/10/2026):
     POST /<IG_ID>/media {media_type: REELS, video_url, caption}  → container
     GET  /<CONTAINER>?fields=status_code  → IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED
     POST /<IG_ID>/media_publish {creation_id}  → media id
   Idempotência: 1 publication_job por (snapshot, campanha); container_id salvo antes de esperar; publicar_enviado_em
   gravado ANTES de chamar media_publish. Se a chamada der timeout, o próximo retry RECONCILIA (status do container =
   PUBLISHED → busca a mídia; FINISHED → pode publicar; ERROR/EXPIRED → novo container) e nunca repete às cegas. */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../../config';
import { db, q, q1 } from '../../db/db';
import { decifrar, redigir } from '../../seguranca/cripto';
import { conteudoConfig } from './config';
import { PALAVRAS_POSSE, TEMPLATES, type TemplateId } from './contrato';
import { consultarFonte } from './fontes';
import { cancelarPublicacao } from './pipeline';

export type StatusContainer = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';
export interface GraphCliente {
  criarContainer(p: { videoUrl: string; legenda: string; capaUrl?: string }): Promise<string>;
  statusContainer(id: string): Promise<StatusContainer>;
  publicar(containerId: string): Promise<string>;
  /** reconciliação: procura nas mídias recentes da conta a que corresponde a este post (legenda idêntica) */
  buscarMidiaPublicada(legenda: string): Promise<{ id: string; permalink?: string } | null>;
}

/** cliente real da Graph API (Instagram Login → graph.instagram.com). Token nunca vai para log nem para URL de POST. */
export class InstagramGraphCliente implements GraphCliente {
  constructor(private igUserId: string, private token: string, private versao = config.instagram.graphVersao, private host = 'https://graph.instagram.com', private timeoutMs = 20000) {}
  private async chamar(metodo: 'GET' | 'POST', caminho: string, params: Record<string, string>) {
    const url = new URL(`${this.host}/${this.versao}/${caminho}`);
    const init: RequestInit = { method: metodo, signal: AbortSignal.timeout(this.timeoutMs) };
    if (metodo === 'GET') { for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v); url.searchParams.set('access_token', this.token); }
    else init.body = new URLSearchParams({ ...params, access_token: this.token });
    const r = await fetch(url, init); const j: any = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(redigir(`Graph ${metodo} ${caminho}: ${r.status} ${JSON.stringify(j.error || j).slice(0, 300)}`));
    return j;
  }
  async criarContainer(p: { videoUrl: string; legenda: string; capaUrl?: string }) { return (await this.chamar('POST', `${this.igUserId}/media`, { media_type: 'REELS', video_url: p.videoUrl, caption: p.legenda, ...(p.capaUrl ? { cover_url: p.capaUrl } : {}) })).id as string; }
  async statusContainer(id: string) { return (await this.chamar('GET', id, { fields: 'status_code' })).status_code as StatusContainer; }
  async publicar(containerId: string) { return (await this.chamar('POST', `${this.igUserId}/media_publish`, { creation_id: containerId })).id as string; }
  async buscarMidiaPublicada(legenda: string) {
    const j = await this.chamar('GET', `${this.igUserId}/media`, { fields: 'id,caption,permalink,timestamp', limit: '25' });
    const m = (j.data || []).find((x: any) => (x.caption || '').trim() === legenda.trim());
    return m ? { id: m.id, permalink: m.permalink } : null;
  }
}

export type Deps = { modo: 'dry_run' | 'oficial'; cliente?: GraphCliente; urlMidia?: (arquivo: string) => string | null };

/** decide o modo pelo ambiente. Qualquer chave faltando → dry-run (nunca envia). */
export async function depsPadrao(): Promise<Deps> {
  const habilitado = config.instagram.adaptador === 'oficial' && !config.kill.publicacao && process.env.PUBLICACAO_OFICIAL === 'sim' && !!process.env.CONTEUDO_URL_MIDIA;
  if (!habilitado) return { modo: 'dry_run' };
  const con = await q1<any>(`select * from instagram_connections where conta_id = $1 and status = 'ativa' and (token_expira_em is null or token_expira_em > now())`, [config.instagram.contaId]);
  if (!con?.token_cifrado) return { modo: 'dry_run' };
  const base = process.env.CONTEUDO_URL_MIDIA!.replace(/\/$/, '');
  return { modo: 'oficial', cliente: new InstagramGraphCliente(con.conta_id, decifrar(con.token_cifrado)), urlMidia: (f) => `${base}/${encodeURIComponent(f.split(/[\\/]/).pop()!)}` };
}

async function tentativa(pubId: string, fase: string, resultado: string, detalhe: Record<string, unknown> = {}) {
  await q(`insert into publication_attempts (publication_job_id, fase, resultado, detalhe) values ($1,$2,$3,$4)`, [pubId, fase, resultado, JSON.stringify(detalhe)]);
}

/** revalida fato, prazo, número e consentimento imediatamente antes de publicar */
export async function revalidar(pubId: string): Promise<{ ok: true } | { ok: false; acao: 'cancelled' | 'needs_correction'; motivo: string }> {
  const p = await q1<any>(`select p.*, s.dados, s.fontes, s.perfis_user_ids, s.valido_ate, s.demo s_demo, s.candidate_id, c.estado c_estado, c.motivo c_motivo
     from publication_jobs p join content_snapshots s on s.id = p.snapshot_id left join content_candidates c on c.id = s.candidate_id where p.id = $1`, [pubId]);
  if (!p) return { ok: false, acao: 'cancelled', motivo: 'publicação não encontrada' };
  if (p.valido_ate && new Date(p.valido_ate).getTime() <= Date.now()) return { ok: false, acao: 'cancelled', motivo: 'fato expirado' };
  if (p.c_estado === 'expirada' || p.c_estado === 'descartada') return { ok: false, acao: 'cancelled', motivo: `pauta ${p.c_estado}: ${p.c_motivo || ''}`.trim() };
  if (p.s_demo && p.campanha && !String(p.campanha).startsWith('demo')) return { ok: false, acao: 'cancelled', motivo: 'dado de demonstração em campanha real' };
  const d = p.dados;
  if (d.election_status !== 'oficial' && PALAVRAS_POSSE.test([d.title, d.lines?.evidencia, d.lines?.acao, p.legenda].join(' '))) return { ok: false, acao: 'cancelled', motivo: 'anuncia vencedor sem resultado oficial' };
  const t = TEMPLATES[d.template_id as TemplateId];
  if (t?.eleicao && !t.eleicao.includes(d.election_status)) return { ok: false, acao: 'cancelled', motivo: 'status da eleição incompatível com o template' };
  if (d.template_id === 'votacao' || d.template_id === 'virada') {
    const eid = d.scope && (await q1<{ e: string }>(`select escopo->>'eleicao_id' e from content_candidates where id = $1`, [p.candidate_id]))?.e;
    if (eid && await q1(`select 1 from content_candidates where escopo->>'eleicao_id' = $1 and template_id = 'resultado'`, [eid])) return { ok: false, acao: 'cancelled', motivo: 'votação já apurada' };
  }
  if (p.perfis_user_ids?.length) {
    const ok = await q1<{ n: number }>(`select count(*)::int n from privacy_preferences where user_id = any($1::uuid[]) and aparecer_em_video`, [p.perfis_user_ids]);
    if ((ok?.n ?? 0) < p.perfis_user_ids.length) return { ok: false, acao: 'cancelled', motivo: 'consentimento promocional removido' };
  }
  for (const f of p.fontes || []) {
    const atual = await consultarFonte(f.fonte, f.parametros);
    if (atual !== f.valor) return { ok: false, acao: 'needs_correction', motivo: `número mudou (${f.chave}: ${f.valor} → ${atual}); gerar novo snapshot` };
  }
  return { ok: true };
}

/** pacote para publicação manual: MP4 + thumbnail + legenda + manifesto (status honesto: NÃO publicado) */
export function exportarPacote(p: any, render: any, snapshot: any) {
  const dir = resolve(conteudoConfig.dirPacotes, p.id); mkdirSync(dir, { recursive: true });
  const copiar = (de: string | null, para: string) => { if (de && existsSync(de)) { copyFileSync(de, resolve(dir, para)); return para; } return null; };
  const video = copiar(render?.saida_mp4, 'video.mp4'), thumb = copiar(render?.saida_thumb, 'thumbnail.jpg');
  writeFileSync(resolve(dir, 'legenda.txt'), p.legenda || '');
  writeFileSync(resolve(dir, 'manifesto.json'), JSON.stringify({
    status: 'NAO_PUBLICADO: pacote dry-run para publicação manual pelo operador', publication_job_id: p.id, campanha: p.campanha, tipo: p.tipo,
    template_version: snapshot.template_version, snapshot_id: snapshot.id, contrato: snapshot.contrato_versao, fatos: snapshot.dados.metrics, fontes: snapshot.fontes,
    consentimentos: { perfis: snapshot.perfis_user_ids.length, regra: 'privacy_preferences.aparecer_em_video = true na revalidação' },
    demo: snapshot.demo, agendado_para: p.agendado_para, video, thumbnail: thumb, gerado_em: new Date().toISOString(),
  }, null, 2));
  return dir;
}

export class Reagendar extends Error {}

/** executa a publicação de um job agendado. Idempotente; seguro para retry. */
export async function publicarJob(pubId: string, deps?: Deps): Promise<string> {
  const p = await q1<any>(`select * from publication_jobs where id = $1`, [pubId]);
  if (!p) return 'inexistente';
  if (!['scheduled', 'publishing'].includes(p.estado)) return p.estado;
  const d = deps ?? await depsPadrao();
  const render = p.render_job_id ? await q1<any>(`select * from render_jobs where id = $1`, [p.render_job_id]) : null;
  if (!render || render.estado !== 'feito') { await q(`update publication_jobs set estado = 'failed', motivo = 'sem render concluído', atualizado_em = now() where id = $1`, [pubId]); return 'failed'; }

  // um envio pode ter acontecido: reconciliar ANTES de qualquer outra coisa
  if (!p.publicar_enviado_em) {
    const v = await revalidar(pubId);
    if (!v.ok) { await tentativa(pubId, 'revalidar', v.acao, { motivo: v.motivo }); await cancelarPublicacao(pubId, v.motivo, v.acao); if (v.acao === 'needs_correction') await q(`update publication_jobs set estado = 'needs_correction' where id = $1 and estado = 'cancelled'`, [pubId]); return v.acao; }
    await tentativa(pubId, 'revalidar', 'ok');
  }

  if (d.modo === 'dry_run' || !d.cliente) {
    const snap = await q1<any>(`select * from content_snapshots where id = $1`, [p.snapshot_id]);
    const dir = exportarPacote(p, render, snap);
    await q(`update publication_jobs set estado = 'exported_manual', modo = 'dry_run', pacote_manual = $2, atualizado_em = now() where id = $1`, [pubId, dir]);
    await q(`update editorial_calendar set estado = 'usado' where publication_job_id = $1 and estado = 'reservado'`, [pubId]);
    await tentativa(pubId, 'dry_run', 'pacote_gerado', { dir, enviado_externamente: false });
    return 'exported_manual';
  }

  const cli = d.cliente;
  await q(`update publication_jobs set estado = 'publishing', modo = 'oficial', tentativas = tentativas + 1, atualizado_em = now() where id = $1`, [pubId]);
  let containerId: string | null = p.container_id, jaFinalizado = false;
  try {
    if (p.publicar_enviado_em && containerId) {
      const st = await cli.statusContainer(containerId);
      await tentativa(pubId, 'reconciliar', st, { container: containerId });
      if (st === 'PUBLISHED') return await marcarPublicado(pubId, await cli.buscarMidiaPublicada(p.legenda));
      if (st === 'IN_PROGRESS') throw new Reagendar('container ainda processando');
      if (st === 'ERROR' || st === 'EXPIRED') { containerId = null; await q(`update publication_jobs set container_id = null, publicar_enviado_em = null where id = $1`, [pubId]); }
      else { jaFinalizado = true; await q(`update publication_jobs set publicar_enviado_em = null where id = $1`, [pubId]); }   // FINISHED: o envio anterior não publicou
    }
    if (!containerId) {
      const url = d.urlMidia?.(render.saida_mp4); if (!url) throw new Error('sem URL pública de mídia (CONTEUDO_URL_MIDIA)');
      containerId = await cli.criarContainer({ videoUrl: url, legenda: p.legenda, capaUrl: d.urlMidia?.(render.saida_thumb) || undefined });
      await q(`update publication_jobs set container_id = $2 where id = $1`, [pubId, containerId]);
      await tentativa(pubId, 'container', 'criado', { container: containerId });
    }
    const st: StatusContainer = jaFinalizado ? 'FINISHED' : await cli.statusContainer(containerId);
    if (!jaFinalizado) await tentativa(pubId, 'status', st, { container: containerId });
    if (st === 'IN_PROGRESS') throw new Reagendar('container processando');
    if (st === 'PUBLISHED') return await marcarPublicado(pubId, await cli.buscarMidiaPublicada(p.legenda));
    if (st !== 'FINISHED') { await q(`update publication_jobs set container_id = null where id = $1`, [pubId]); throw new Error('container ' + st); }
    await q(`update publication_jobs set publicar_enviado_em = now() where id = $1`, [pubId]);   // intenção gravada antes do envio
    const mediaId = await cli.publicar(containerId);
    await tentativa(pubId, 'publicar', 'ok', { media: mediaId });
    return await marcarPublicado(pubId, { id: mediaId });
  } catch (e: any) {
    const msg = redigir(String(e?.message || e)).slice(0, 1000);
    await tentativa(pubId, 'erro', e instanceof Reagendar ? 'reagendar' : 'falha', { erro: msg });
    const atual = await q1<any>(`select tentativas from publication_jobs where id = $1`, [pubId]);
    if (!(e instanceof Reagendar) && atual!.tentativas >= conteudoConfig.maxTentativasPublicacao) {
      await q(`update publication_jobs set estado = 'failed', ultimo_erro = $2, atualizado_em = now() where id = $1`, [pubId, msg]);
      return 'failed';
    }
    await q(`update publication_jobs set ultimo_erro = $2, atualizado_em = now() where id = $1`, [pubId, msg]);
    throw e;   // a fila repete com backoff; o retry passa pela reconciliação
  }
}

async function marcarPublicado(pubId: string, midia: { id: string; permalink?: string } | null) {
  await q(`update publication_jobs set estado = 'published', media_id_externo = $2, permalink = $3, publicado_em = now(), atualizado_em = now() where id = $1`, [pubId, midia?.id ?? null, midia?.permalink ?? null]);
  await q(`update editorial_calendar set estado = 'usado' where publication_job_id = $1 and estado = 'reservado'`, [pubId]);
  await tentativa(pubId, 'publicado', midia ? 'ok' : 'publicado_sem_id', { media: midia?.id ?? null });
  return 'published';
}
