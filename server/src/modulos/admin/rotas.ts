/* módulo admin: painel administrativo (API em /api/admin/*) + denúncia do jogador (POST /api/denuncias).
   Toda rota passa por exigirArea (papel separado + sessão recente) e toda ação que muda estado grava auditar().
   Não existe — de propósito — "editar votos", "dar cargo" ou "dar presidência": correções eleitorais seguem as regras
   públicas da Fase 4, com motivo e auditoria, fora deste painel. */
import type { Context } from 'hono';
import { type App, limite, exigirLogin, ErroHttp } from '../../http/app';
import { db, q, q1, tx, auditar } from '../../db/db';
import { config } from '../../config';
import { enfileirar, reprocessar } from '../../jobs/fila';
import { normNome } from '../../db/semear';
import { exigirArea, exigirAdmin, exigirMotivo, areasDe, sessaoMaxMin } from './auth';
import { protegerLinha, paraCsv, type LinhaAuditoria } from './auditoria';
import * as est from '../estabelecimentos/servico';

async function corpo(c: Context): Promise<Record<string, any>> { try { const j = await c.req.json(); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: string) => { if (!UUID.test(v)) throw new ErroHttp(404, 'não encontrado'); return v; };
const limpo = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** jobs que a Fase 1 consome quando o admin escolhe a cidade de um onboarding pendente/ambíguo */
export const JOB_CIDADE_ESCOLHIDA = 'onboarding.cidade_escolhida';

export const ACOES_MODERACAO = ['advertir', 'ocultar_conteudo', 'suspender_usuario', 'reativar_usuario', 'suspender_estabelecimento', 'pausar_rua', 'reativar_rua', 'descartar'] as const;

/** aplica ação de moderação (com ou sem denúncia), sempre com motivo + moderation_actions + auditoria */
export async function aplicarModeracao(ator: string, d: { reportId?: string | null; alvoTipo: string; alvoId: string; acao: string; motivo: string; dias?: number }) {
  if (!(ACOES_MODERACAO as readonly string[]).includes(d.acao)) throw new ErroHttp(400, 'ação inválida');
  return tx(async (c) => {
    let expira: string | null = null;
    if (d.acao === 'suspender_usuario' || d.acao === 'reativar_usuario') {
      if (d.alvoTipo !== 'user' || !UUID.test(d.alvoId)) throw new ErroHttp(400, 'alvo precisa ser um usuário');
      if (d.acao === 'suspender_usuario') {
        const dias = Math.round(Number(d.dias ?? 7)); if (!(dias >= 1 && dias <= 365)) throw new ErroHttp(400, 'dias de suspensão: 1 a 365');
        const r = await q1<{ ate: string }>(`update users set status = 'suspenso', suspenso_ate = now() + make_interval(days => $2) where id = $1 returning suspenso_ate::text ate`, [d.alvoId, dias], c);
        if (!r) throw new ErroHttp(404, 'usuário não encontrado');
        expira = r.ate;
        await q(`update sessions set revogada_em = now() where user_id = $1 and revogada_em is null`, [d.alvoId], c);
      } else {
        const r = await q(`update users set status = 'ativo', suspenso_ate = null where id = $1 and status = 'suspenso' returning id`, [d.alvoId], c);
        if (!r.length) throw new ErroHttp(409, 'usuário não está suspenso');
      }
    } else if (d.acao === 'suspender_estabelecimento') {
      if (d.alvoTipo !== 'venue' || !UUID.test(d.alvoId)) throw new ErroHttp(400, 'alvo precisa ser um estabelecimento');
      const r = await q(`update venues set verificacao = 'suspenso', nota_verificacao = $2, atualizado_em = now() where id = $1 returning id`, [d.alvoId, d.motivo], c);
      if (!r.length) throw new ErroHttp(404, 'estabelecimento não encontrado');
    } else if (d.acao === 'pausar_rua' || d.acao === 'reativar_rua') {
      if (d.alvoTipo !== 'street' || !UUID.test(d.alvoId)) throw new ErroHttp(400, 'alvo precisa ser uma rua');
      const [de, para] = d.acao === 'pausar_rua' ? [['fundacao', 'ativa'], 'pausada'] : [['pausada'], 'ativa'];
      const r = await q(`update virtual_streets set status = $2 where id = $1 and status = any($3) returning id`, [d.alvoId, para, de], c);
      if (!r.length) throw new ErroHttp(409, 'rua não encontrada ou já está nesse estado');
    }
    const m = await q1<{ id: string }>(`insert into moderation_actions (report_id, ator_user_id, alvo_tipo, alvo_id, acao, motivo, expira_em) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [d.reportId ?? null, ator, d.alvoTipo, d.alvoId, d.acao, d.motivo, expira], c);
    if (d.reportId) await q(`update reports set estado = $2, resolvido_por = $3, resolvido_em = now() where id = $1`, [d.reportId, d.acao === 'descartar' ? 'descartada' : 'resolvida', ator], c);
    await auditar(c, ator, 'moderacao.' + d.acao, `${d.alvoTipo}:${d.alvoId}`, d.motivo, { report: d.reportId ?? null, acao_id: m!.id, expira });
    return { id: m!.id, expira };
  });
}

export function registrar(app: App) {
  app.use('/api/admin/*', async (c, next) => { await next(); c.header('cache-control', 'no-store'); c.header('x-robots-tag', 'noindex'); });
  app.use('/api/admin/*', limite(240));

  /* ---------- quem sou (papéis e áreas) ---------- */
  app.get('/api/admin/eu', async (c) => {
    const a = await exigirAdmin(c);
    return c.json({ ok: true, usuario: { id: a.usuario.id, nome: a.usuario.nome_publico }, papeis: a.papeis, areas: areasDe(a.papeis), sessaoMaxMin: sessaoMaxMin(), ambiente: config.ambiente });
  });

  /* ---------- saúde da integração Meta ---------- */
  app.get('/api/admin/saude', async (c) => {
    await exigirArea(c, 'saude');
    const conexoes = await q(`select conta_id, username, status, token_expira_em, (token_cifrado is not null) tem_token, atualizado_em from instagram_connections order by atualizado_em desc`);
    const webhooks = await q(`select estado, count(*)::int n from webhook_events where recebido_em > now() - interval '24 hours' group by estado order by estado`);
    const ultimoWebhook = (await q1<{ t: string | null }>(`select max(recebido_em) t from webhook_events`))!.t;
    const jobs = await q(`select estado, count(*)::int n from processing_jobs group by estado order by estado`);
    const atraso = (await q1<{ s: number | null }>(`select extract(epoch from now() - min(disponivel_em))::int s from processing_jobs where estado in ('pendente','erro') and disponivel_em <= now()`))!.s;
    const mensagens = await q(`select estado, count(*)::int n from outbound_messages where criado_em > now() - interval '24 hours' group by estado order by estado`);
    const onboarding = await q(`select estado, count(*)::int n from onboarding group by estado order by estado`);
    const alertas: string[] = [];
    if (!conexoes.some((x: any) => x.status === 'ativa')) alertas.push('nenhuma conta oficial conectada: suspenda posts que prometem criação imediata');
    for (const x of conexoes as any[]) if (x.status === 'ativa' && x.token_expira_em && Date.parse(x.token_expira_em) - Date.now() < 7 * 86400e3) alertas.push(`token da conta ${x.conta_id} expira em menos de 7 dias`);
    if (!ultimoWebhook || Date.now() - Date.parse(ultimoWebhook) > 86400e3) alertas.push('nenhum webhook recebido nas últimas 24h');
    const mortos = (jobs as any[]).find((j) => j.estado === 'morto')?.n || 0; if (mortos) alertas.push(`${mortos} job(s) na fila morta`);
    if (atraso != null && atraso > 600) alertas.push(`fila atrasada: job mais antigo esperando há ${Math.round(atraso / 60)} min`);
    return c.json({ ok: true, conexoes, webhooks24h: webhooks, ultimoWebhook, jobs, atrasoFilaSeg: atraso, mensagens24h: mensagens, onboarding, alertas });
  });

  /* ---------- mídias habilitadas (texto de consentimento obrigatório) ---------- */
  app.get('/api/admin/midias', async (c) => { await exigirArea(c, 'midias'); return c.json({ ok: true, midias: await q(`select * from enabled_media order by criado_em desc limit 200`) }); });
  app.post('/api/admin/midias', async (c) => {
    const a = await exigirArea(c, 'midias'); const b = await corpo(c);
    const mediaId = limpo(b.media_id, 40); if (!/^\d{5,30}$/.test(mediaId)) throw new ErroHttp(400, 'media_id inválido (id numérico da mídia)');
    const campanha = limpo(b.campanha, 80); if (campanha.length < 3) throw new ErroHttp(400, 'nome da campanha obrigatório');
    const texto = limpo(b.texto_consentimento, 600); if (texto.length < 30) throw new ErroHttp(400, 'texto de consentimento obrigatório (o aviso publicado no post, mín. 30 caracteres)');
    const conta = limpo(b.conta_id || config.instagram.contaId, 40); if (!conta) throw new ErroHttp(400, 'conta oficial não configurada');
    await tx(async (t) => {
      const r = await q(`insert into enabled_media (media_id, conta_id, campanha, aceita_comentario_cidade, texto_consentimento) values ($1,$2,$3,$4,$5) on conflict (media_id) do nothing returning media_id`, [mediaId, conta, campanha, b.aceita_comentario_cidade !== false, texto], t);
      if (!r.length) throw new ErroHttp(409, 'mídia já cadastrada');
      await auditar(t, a.usuario.id, 'midia.habilitar', 'media:' + mediaId, null, { campanha, aceita_comentario_cidade: b.aceita_comentario_cidade !== false });
    });
    return c.json({ ok: true, media_id: mediaId });
  });
  app.post('/api/admin/midias/:id', async (c) => {
    const a = await exigirArea(c, 'midias'); const b = await corpo(c); const id = c.req.param('id');
    const sets: string[] = [], vals: unknown[] = [id];
    if (b.status !== undefined) { if (!['ativa', 'pausada', 'encerrada'].includes(b.status)) throw new ErroHttp(400, 'status inválido'); vals.push(b.status); sets.push(`status = $${vals.length}`); }
    if (b.campanha !== undefined) { const v = limpo(b.campanha, 80); if (v.length < 3) throw new ErroHttp(400, 'campanha inválida'); vals.push(v); sets.push(`campanha = $${vals.length}`); }
    if (b.texto_consentimento !== undefined) { const v = limpo(b.texto_consentimento, 600); if (v.length < 30) throw new ErroHttp(400, 'texto de consentimento obrigatório (mín. 30 caracteres)'); vals.push(v); sets.push(`texto_consentimento = $${vals.length}`); }
    if (b.aceita_comentario_cidade !== undefined) { vals.push(b.aceita_comentario_cidade === true); sets.push(`aceita_comentario_cidade = $${vals.length}`); }
    if (!sets.length) throw new ErroHttp(400, 'nada para alterar');
    await tx(async (t) => {
      const r = await q(`update enabled_media set ${sets.join(', ')} where media_id = $1 returning media_id`, vals, t);
      if (!r.length) throw new ErroHttp(404, 'mídia não encontrada');
      await auditar(t, a.usuario.id, 'midia.alterar', 'media:' + id, b.motivo ? limpo(b.motivo, 300) : null, { campos: Object.keys(b).filter((k) => k !== 'motivo') });
    });
    return c.json({ ok: true });
  });

  /* ---------- comentários pendentes / ambíguos ---------- */
  app.get('/api/admin/comentarios', async (c) => {
    await exigirArea(c, 'comentarios');
    const itens = await q(`select o.identity_id, o.estado, o.detalhe, o.atualizado_em, e.username,
        (select json_build_object('ibge', r.ibge, 'em', r.criado_em) from admin_city_resolutions r where r.identity_id = o.identity_id order by r.criado_em desc limit 1) ultima_escolha
      from onboarding o join external_identities e on e.id = o.identity_id
      where o.estado in ('needs_review','pending_city_resolution') order by o.atualizado_em limit 200`);
    return c.json({ ok: true, itens });
  });
  app.post('/api/admin/comentarios/:identityId/cidade', async (c) => {
    const a = await exigirArea(c, 'comentarios'); const b = await corpo(c); const id = uuid(c.req.param('identityId'));
    const motivo = exigirMotivo(b.motivo); const ibge = Number(b.ibge); if (!Number.isInteger(ibge)) throw new ErroHttp(400, 'cidade (IBGE) inválida');
    const r = await tx(async (t) => {
      const o = await q1<{ estado: string }>(`select estado from onboarding where identity_id = $1 for update`, [id], t);
      if (!o) throw new ErroHttp(404, 'onboarding não encontrado');
      if (!['needs_review', 'pending_city_resolution'].includes(o.estado)) throw new ErroHttp(409, 'este onboarding não está pendente de cidade');
      const m = await q1<{ nome: string; uf: string }>(`select nome, uf from municipios where ibge = $1`, [ibge], t); if (!m) throw new ErroHttp(400, 'cidade (IBGE) inexistente');
      const res = (await q1<{ id: string }>(`insert into admin_city_resolutions (identity_id, ibge, ator_user_id, motivo) values ($1,$2,$3,$4) returning id`, [id, ibge, a.usuario.id, motivo], t))!;
      const job = await enfileirar(t, JOB_CIDADE_ESCOLHIDA, { identityId: id, ibge, resolucaoId: res.id }, 'onboarding-cidade:' + res.id);
      await q(`update admin_city_resolutions set job_id = $2 where id = $1`, [res.id, job], t);
      await q(`update onboarding set detalhe = $2, atualizado_em = now() where identity_id = $1`, [id, `cidade escolhida no painel: ${m.nome} - ${m.uf} (${ibge}); job ${job} reenfileirado`], t);
      await auditar(t, a.usuario.id, 'onboarding.escolher_cidade', 'identity:' + id, motivo, { ibge, job });
      return { job, cidade: `${m.nome} - ${m.uf}` };
    });
    return c.json({ ok: true, ...r });
  });

  /* ---------- reservas / reivindicações ---------- */
  app.get('/api/admin/reservas', async (c) => {
    await exigirArea(c, 'reservas');
    const casas = await q(`select status, count(*)::int n from houses group by status order by status`);
    const claims = await q1(`select count(*) filter (where consumido_em is null and expira_em > now())::int abertos, count(*) filter (where consumido_em is not null)::int consumidos, count(*) filter (where consumido_em is null and expira_em <= now())::int expirados from identity_claims`);
    const desafios = await q1(`select count(*) filter (where consumido_em is null and expira_em > now())::int abertos, count(*) filter (where consumido_em is not null)::int consumidos from claim_challenges`);
    const proximas = await q(`select h.id, h.criada_em, h.expira_em, p.ibge, m.nome cidade, m.uf, e.username from houses h left join plots p on p.id = h.plot_id left join municipios m on m.ibge = p.ibge left join external_identities e on e.id = h.dono_identity_id where h.status = 'reservada' order by h.expira_em nulls last limit 50`);
    return c.json({ ok: true, casas, claims, desafios, reservasAExpirar: proximas });
  });

  /* ---------- denúncias / revisão de abuso ---------- */
  app.get('/api/admin/denuncias', async (c) => {
    await exigirArea(c, 'denuncias');
    const estado = c.req.query('estado') || 'aberta'; if (!['aberta', 'em_analise', 'resolvida', 'descartada'].includes(estado)) throw new ErroHttp(400, 'estado inválido');
    const itens = await q(`select r.id, r.alvo_tipo, r.alvo_id, r.categoria, r.texto, r.estado, r.criado_em, (select count(*)::int from reports x where x.alvo_tipo = r.alvo_tipo and x.alvo_id = r.alvo_id) total_no_alvo from reports r where r.estado = $1 order by r.criado_em limit 200`, [estado]);
    const acoes = await q(`select acao, alvo_tipo, alvo_id, motivo, criado_em, expira_em from moderation_actions order by criado_em desc limit 50`);
    return c.json({ ok: true, itens, acoes });
  });
  app.post('/api/admin/denuncias/:id/acao', async (c) => {
    const a = await exigirArea(c, 'denuncias'); const b = await corpo(c); const id = uuid(c.req.param('id'));
    const motivo = exigirMotivo(b.motivo);
    const r = await q1<{ alvo_tipo: string; alvo_id: string; estado: string }>(`select alvo_tipo, alvo_id, estado from reports where id = $1`, [id]);
    if (!r) throw new ErroHttp(404, 'denúncia não encontrada');
    if (r.estado === 'resolvida' || r.estado === 'descartada') throw new ErroHttp(409, 'denúncia já fechada');
    return c.json({ ok: true, ...(await aplicarModeracao(a.usuario.id, { reportId: id, alvoTipo: r.alvo_tipo, alvoId: r.alvo_id, acao: String(b.acao), motivo, dias: b.dias })) });
  });
  app.post('/api/admin/moderacao', async (c) => {
    const a = await exigirArea(c, 'denuncias'); const b = await corpo(c);
    return c.json({ ok: true, ...(await aplicarModeracao(a.usuario.id, { alvoTipo: limpo(b.alvo_tipo, 20), alvoId: limpo(b.alvo_id, 80), acao: String(b.acao), motivo: exigirMotivo(b.motivo), dias: b.dias })) });
  });

  /* ---------- cidades / ruas ---------- */
  app.get('/api/admin/cidades', async (c) => {
    await exigirArea(c, 'cidades');
    const t = normNome(c.req.query('q') || ''); if (t.length < 2) return c.json({ ok: true, cidades: [] });
    const cidades = await q(`select m.ibge, m.nome, m.uf, m.pop,
        (select count(*)::int from plots p join houses h on h.plot_id = p.id and h.status in ('reservada','reivindicada') where p.ibge = m.ibge) casas,
        (select count(*)::int from virtual_streets s where s.ibge = m.ibge) ruas
      from municipios m where m.nome_norm like $1 order by m.pop desc limit 30`, [t + '%']);
    return c.json({ ok: true, cidades });
  });
  app.get('/api/admin/cidades/:ibge/ruas', async (c) => {
    await exigirArea(c, 'cidades');
    return c.json({ ok: true, ruas: await q(`select id, nome, status, ocupadas, capacidade, publica, criada_em from virtual_streets where ibge = $1 order by criada_em`, [Number(c.req.param('ibge')) || 0]) });
  });
  app.post('/api/admin/cidades/alias', async (c) => {
    const a = await exigirArea(c, 'cidades'); const b = await corpo(c); const motivo = exigirMotivo(b.motivo);
    const alias = normNome(String(b.alias ?? '')); const ibge = Number(b.ibge); const uf = b.uf ? String(b.uf).toUpperCase() : null;
    if (alias.length < 2 || alias.length > 60) throw new ErroHttp(400, 'apelido inválido');
    await tx(async (t) => {
      const m = await q1<{ uf: string }>(`select uf from municipios where ibge = $1`, [ibge], t); if (!m) throw new ErroHttp(400, 'cidade (IBGE) inexistente');
      if (uf && uf !== m.uf) throw new ErroHttp(400, 'UF não confere com a cidade');
      await q(`insert into municipio_aliases (alias_norm, uf, ibge, revisado_por) values ($1,$2,$3,$4) on conflict do nothing`, [alias, uf, ibge, a.usuario.id], t);
      await auditar(t, a.usuario.id, 'cidade.alias', 'municipio:' + ibge, motivo, { alias, uf });
    });
    return c.json({ ok: true });
  });
  app.post('/api/admin/ruas/:id/status', async (c) => {
    const a = await exigirArea(c, 'cidades'); const b = await corpo(c); const id = uuid(c.req.param('id'));
    const acao = b.status === 'pausada' ? 'pausar_rua' : b.status === 'ativa' ? 'reativar_rua' : null; if (!acao) throw new ErroHttp(400, 'status: pausada ou ativa');
    return c.json({ ok: true, ...(await aplicarModeracao(a.usuario.id, { alvoTipo: 'street', alvoId: id, acao, motivo: exigirMotivo(b.motivo) })) });
  });

  /* ---------- patrocinadores / estabelecimentos (status manual, sem cobrança) ---------- */
  app.get('/api/admin/estabelecimentos', async (c) => {
    await exigirArea(c, 'patrocinadores');
    const venues = await q(`select v.id, v.nome, v.categoria, v.ibge, m.nome cidade, m.uf, v.verificacao, v.demo, v.alcool, v.criado_em,
        coalesce((select json_agg(json_build_object('id', s.id, 'status', s.status, 'modalidade', s.modalidade, 'inicio', s.inicio, 'fim', s.fim, 'contrato_ref', s.contrato_ref) order by s.criado_em desc) from sponsorships s where s.venue_id = v.id), '[]') patrocinios,
        coalesce((select json_agg(json_build_object('id', l.id, 'tipo', l.tipo, 'url', l.url, 'rotulo', l.rotulo, 'ativo', l.ativo)) from venue_links l where l.venue_id = v.id), '[]') links,
        (select count(*)::int from coupons cp where cp.venue_id = v.id and cp.status = 'ativo') cupons_ativos
      from venues v join municipios m on m.ibge = v.ibge order by v.demo, v.criado_em desc limit 300`);
    return c.json({ ok: true, estabelecimentos: venues, contadoresProducao: await est.contadoresProducao(), dominios: await est.dominiosPermitidos() });
  });
  app.get('/api/admin/estabelecimentos/pedidos', async (c) => {
    await exigirArea(c, 'patrocinadores');
    const status = c.req.query('status') || 'novo';
    return c.json({ ok: true, pedidos: await q(`select r.id, r.codigo, r.nome, r.cidade_texto, r.ibge, m.nome cidade, m.uf, r.categoria, r.instagram, r.whatsapp, r.status, r.nota, r.criado_em from venue_requests r left join municipios m on m.ibge = r.ibge where r.status = $1 order by r.criado_em limit 200`, [status]) });
  });
  app.post('/api/admin/estabelecimentos/pedidos/:id/status', async (c) => {
    const a = await exigirArea(c, 'patrocinadores'); const b = await corpo(c);
    return c.json({ ok: true, ...(await est.mudarStatusPedido(a.usuario.id, uuid(c.req.param('id')), b.status, b.nota)) });
  });
  app.post('/api/admin/estabelecimentos', async (c) => {
    const a = await exigirArea(c, 'patrocinadores'); const b = await corpo(c);
    return c.json({ ok: true, ...(await est.criarVenue(a.usuario.id, b)) });   // demo nunca pela API: só pela semente isolada
  });
  app.post('/api/admin/estabelecimentos/dominios', async (c) => {
    const a = await exigirArea(c, 'patrocinadores'); const b = await corpo(c);
    return c.json({ ok: true, ...(await est.adicionarDominio(a.usuario.id, b.dominio, exigirMotivo(b.motivo))) });
  });
  app.post('/api/admin/estabelecimentos/:id/verificacao', async (c) => {
    const a = await exigirArea(c, 'patrocinadores'); const b = await corpo(c);
    return c.json({ ok: true, ...(await est.mudarVerificacao(a.usuario.id, uuid(c.req.param('id')), b.verificacao, b.nota)) });
  });
  app.post('/api/admin/estabelecimentos/:id/links', async (c) => {
    const a = await exigirArea(c, 'patrocinadores'); const b = await corpo(c);
    return c.json({ ok: true, ...(await est.adicionarLink(a.usuario.id, uuid(c.req.param('id')), { tipo: b.tipo, url: b.url, rotulo: b.rotulo })) });
  });
  app.post('/api/admin/estabelecimentos/:id/patrocinios', async (c) => {
    const a = await exigirArea(c, 'patrocinadores'); const b = await corpo(c);
    return c.json({ ok: true, ...(await est.criarPatrocinio(a.usuario.id, uuid(c.req.param('id')), b)) });
  });
  app.post('/api/admin/estabelecimentos/:id/cupons', async (c) => {
    const a = await exigirArea(c, 'patrocinadores'); const b = await corpo(c);
    return c.json({ ok: true, ...(await est.criarCupom(a.usuario.id, uuid(c.req.param('id')), b)) });
  });
  app.post('/api/admin/estabelecimentos/:id/eventos', async (c) => {
    const a = await exigirArea(c, 'patrocinadores'); const b = await corpo(c);
    return c.json({ ok: true, ...(await est.criarEvento(a.usuario.id, uuid(c.req.param('id')), b)) });
  });
  app.get('/api/admin/estabelecimentos/:id/metricas', async (c) => {
    await exigirArea(c, 'patrocinadores'); const id = uuid(c.req.param('id'));
    const ate = c.req.query('ate') || new Date().toISOString().slice(0, 10), desde = c.req.query('desde') || new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    if (![desde, ate].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new ErroHttp(400, 'período inválido');
    return c.json({ ok: true, aviso: 'Métricas de visitas virtuais e cliques de contas autenticadas, deduplicadas. Não indicam vendas.', ...(await est.metricasVenue(id, desde, ate)) });
  });
  app.post('/api/admin/patrocinios/:id/status', async (c) => {
    const a = await exigirArea(c, 'patrocinadores'); const b = await corpo(c);
    return c.json({ ok: true, ...(await est.mudarStatusPatrocinio(a.usuario.id, uuid(c.req.param('id')), b.status, exigirMotivo(b.motivo))) });
  });

  /* ---------- feature flags e kill switches ---------- */
  app.get('/api/admin/flags', async (c) => {
    await exigirArea(c, 'flags');
    return c.json({ ok: true, flags: await q(`select chave, ligada, nota, atualizado_em from feature_flags order by chave`), killEnv: config.kill });
  });
  app.post('/api/admin/flags/:chave', async (c) => {
    const a = await exigirArea(c, 'flags'); const b = await corpo(c); const chave = c.req.param('chave'); const motivo = exigirMotivo(b.motivo);
    if (typeof b.ligada !== 'boolean') throw new ErroHttp(400, 'ligada: true ou false');
    if (chave === 'bares' && b.ligada && b.confirmo_politica_etaria !== true) throw new ErroHttp(400, 'ligar bares exige confirmar a revisão da política etária (confirmo_politica_etaria: true)');
    await tx(async (t) => {
      const r = await q1<{ antes: boolean }>(`update feature_flags f set ligada = $2, atualizado_em = now() from (select ligada antes from feature_flags where chave = $1 for update) x where f.chave = $1 returning x.antes`, [chave, b.ligada], t);
      if (!r) throw new ErroHttp(404, 'flag inexistente (flags novas entram por migração)');
      await auditar(t, a.usuario.id, 'flag.alterar', 'flag:' + chave, motivo, { de: r.antes, para: b.ligada });
    });
    return c.json({ ok: true });
  });

  /* ---------- fila (jobs mortos, reprocessar com motivo) ---------- */
  app.get('/api/admin/fila', async (c) => {
    await exigirArea(c, 'fila');
    const resumo = await q(`select tipo, estado, count(*)::int n from processing_jobs group by tipo, estado order by tipo, estado`);
    const mortos = await q(`select id, tipo, tentativas, max_tentativas, erro, criado_em, (select array_agg(k) from jsonb_object_keys(dados) k) campos from processing_jobs where estado = 'morto' order by id desc limit 100`);
    return c.json({ ok: true, resumo, mortos });
  });
  app.post('/api/admin/fila/:id/reprocessar', async (c) => {
    const a = await exigirArea(c, 'fila'); const b = await corpo(c); const id = Number(c.req.param('id')); const motivo = exigirMotivo(b.motivo);
    if (!Number.isInteger(id) || id <= 0) throw new ErroHttp(404, 'job não encontrado');
    const j = await q1<{ estado: string; tipo: string }>(`select estado, tipo from processing_jobs where id = $1`, [id]);
    if (!j) throw new ErroHttp(404, 'job não encontrado');
    if (j.estado !== 'morto' && j.estado !== 'erro') throw new ErroHttp(409, 'só job morto ou com erro pode ser reprocessado');
    await reprocessar(id);
    await auditar(db(), a.usuario.id, 'fila.reprocessar', 'job:' + id, motivo, { tipo: j.tipo, estado_anterior: j.estado });
    return c.json({ ok: true });
  });

  /* ---------- auditoria (dados pessoais protegidos) ---------- */
  app.get('/api/admin/auditoria', async (c) => {
    await exigirArea(c, 'auditoria');
    const linhas = await q<LinhaAuditoria>(`select * from admin_audit_logs order by id desc limit 200`);
    return c.json({ ok: true, linhas: linhas.map(protegerLinha) });
  });
  app.get('/api/admin/auditoria/exportar', async (c) => {
    const a = await exigirArea(c, 'auditoria');
    const desde = c.req.query('desde') || '1970-01-01', ate = c.req.query('ate') || '9999-12-31', formato = c.req.query('formato') === 'json' ? 'json' : 'csv';
    if (![desde, ate].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new ErroHttp(400, 'período inválido');
    const linhas = (await q<LinhaAuditoria>(`select * from admin_audit_logs where criado_em >= $1::date and criado_em < $2::date + 1 order by id limit 50000`, [desde, ate])).map(protegerLinha);
    await auditar(db(), a.usuario.id, 'auditoria.exportar', 'admin_audit_logs', null, { desde, ate, formato, linhas: linhas.length });
    const nome = `auditoria-${desde}-${ate}.${formato}`;
    c.header('content-disposition', `attachment; filename="${nome}"`);
    if (formato === 'json') return c.json({ ok: true, protegido: true, linhas });
    c.header('content-type', 'text/csv; charset=utf-8');
    return c.body(paraCsv(linhas));
  });

  /* ---------- denúncia do jogador ---------- */
  app.post('/api/denuncias', limite(10), async (c) => {
    const u = exigirLogin(c); const b = await corpo(c);
    const alvoTipo = String(b.alvo_tipo ?? ''), alvoId = limpo(b.alvo_id, 80), categoria = String(b.categoria ?? '');
    if (!['user', 'house', 'street', 'venue', 'comentario', 'conteudo'].includes(alvoTipo) || !alvoId) throw new ErroHttp(400, 'alvo inválido');
    if (!['abuso', 'spam', 'golpe', 'conteudo_improprio', 'menor_em_risco', 'falsidade', 'outro'].includes(categoria)) throw new ErroHttp(400, 'categoria inválida');
    const r = await q<{ id: string }>(`insert into reports (autor_user_id, alvo_tipo, alvo_id, categoria, texto) values ($1,$2,$3,$4,$5) on conflict do nothing returning id`, [u.id, alvoTipo, alvoId, categoria, limpo(b.texto, 500) || null]);
    return c.json({ ok: true, recebida: true, nova: r.length > 0 });
  });
}
