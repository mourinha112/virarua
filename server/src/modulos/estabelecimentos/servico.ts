/* Domínio da Fase 5: pedidos, vitrine pública (com política etária no servidor), visitas/cliques/cupons deduplicados,
   métricas agregadas e operações administrativas (verificação, links, patrocínio manual, cupons, eventos).
   Toda operação administrativa recebe o ator e grava auditoria na mesma transação. */
import { q, q1, tx, auditar, type Exec } from '../../db/db';
import { config } from '../../config';
import { sha256 } from '../../seguranca/cripto';
import { ErroHttp } from '../../http/app';
import { resolverCidade } from '../cidades/resolver';
import {
  TIPO_PEDIDO, CATEGORIAS, BENEFICIOS, restrito, podeVerRestrito, validarUrlExterna, normalizarInstagram, normalizarTelefone,
  textoLimpo, codigoAleatorio, SELO_PATROCINIO, AVISO_VIRTUAL, type Categoria,
} from './regras';

/** data de hoje no fuso do jogo (America/Sao_Paulo) */
export const HOJE = `(now() at time zone 'America/Sao_Paulo')::date`;
/** fragmento SQL: estabelecimento vigente = verificado + patrocínio ATIVO dentro da vigência (alias v) */
export const VIGENTE = `v.verificacao = 'verificado' and exists (select 1 from sponsorships s where s.venue_id = v.id and s.status = 'ativo' and ${HOJE} between s.inicio and s.fim)`;

export async function flagLigada(chave: string, ex?: Exec) {
  const r = await q1<{ ligada: boolean }>(`select ligada from feature_flags where chave = $1`, [chave], ex);
  return !!r?.ligada;
}
export async function dominiosPermitidos(ex?: Exec) { return (await q<{ dominio: string }>(`select dominio from link_domain_allowlist order by dominio`, [], ex)).map((r) => r.dominio); }

/* ======================= pedidos de cadastro (público) ======================= */
export type PedidoEntrada = { cidade?: unknown; nome?: unknown; ig?: unknown; zap?: unknown; tipo?: unknown };

export async function criarPedido(d: PedidoEntrada, ip: string) {
  const nome = textoLimpo(d.nome, 80);
  if (nome.length < 2 || nome.length > 60) throw new ErroHttp(400, 'nome do negócio precisa ter de 2 a 60 letras');
  const cidadeTxt = textoLimpo(d.cidade, 80);
  if (cidadeTxt.length < 3) throw new ErroHttp(400, 'escreva a cidade (ex.: Vitória - ES)');
  const tipoBruto = String(d.tipo ?? '').toLowerCase();
  if (tipoBruto === 'bar') throw new ErroHttp(400, 'bares e promoções de bebida estão desabilitados até a revisão de faixa etária');
  const categoria = TIPO_PEDIDO[tipoBruto]; if (!categoria) throw new ErroHttp(400, 'tipo de negócio inválido');
  const ig = normalizarInstagram(d.ig); if (ig === null) throw new ErroHttp(400, '@ do Instagram inválido');
  const zap = normalizarTelefone(d.zap); if (zap === null) throw new ErroHttp(400, 'WhatsApp inválido: use DDD + número');
  const cid = await resolverCidade(cidadeTxt);
  if (cid.tipo === 'ambigua') throw new ErroHttp(400, `há ${cid.candidatos.length} cidades com esse nome: escreva também a UF (ex.: ${cid.candidatos[0].nome} - ${cid.candidatos[0].uf})`);
  if (cid.tipo === 'nao_encontrada') throw new ErroHttp(400, 'não achei essa cidade: escreva o nome e a UF (ex.: Vitória - ES)');
  const ipHash = sha256(config.segredo + '|ip|' + ip);
  // limite persistente por origem (vale entre instâncias): 5 pedidos por hora
  const n = (await q1<{ n: number }>(`select count(*)::int n from venue_requests where ip_hash = $1 and criado_em > now() - interval '1 hour'`, [ipHash]))!.n;
  if (n >= 5) throw new ErroHttp(429, 'muitos pedidos daqui: tente de novo mais tarde');
  for (let tent = 0; ; tent++) {
    const codigo = codigoAleatorio('NEG', 6);
    try {
      await q(`insert into venue_requests (codigo, nome, cidade_texto, ibge, categoria, instagram, whatsapp, ip_hash) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [codigo, nome, cidadeTxt, cid.ibge, categoria, ig ?? null, zap ?? null, ipHash]);
      return { codigo, ibge: cid.ibge, cidade: `${cid.nome} - ${cid.uf}` };
    } catch (e: any) { if (e?.code === '23505' && tent < 5) continue; throw e; }
  }
}

/* ======================= vitrine (jogador) ======================= */
type Quem = { id: string; faixa_etaria: string } | null;
async function acessoRestrito(u: Quem) { return podeVerRestrito(u?.faixa_etaria, await flagLigada('bares')); }

/** lista estabelecimentos vigentes visíveis para quem pede (restritos somem para menor/faixa desconhecida/sem sessão) */
export async function listarVigentes(u: Quem, ibge?: number) {
  if (!(await flagLigada('estabelecimentos'))) return [];
  const verRestrito = await acessoRestrito(u);
  const rows = await q<any>(
    `select v.id, v.nome, v.categoria, v.ibge, v.cor, v.descricao, v.demo, v.alcool,
            (select max(s.fim) from sponsorships s where s.venue_id = v.id and s.status = 'ativo' and ${HOJE} between s.inicio and s.fim)::text ate
       from venues v where ${VIGENTE} and ($1::int is null or v.ibge = $1) and ($2 or (v.categoria <> 'bar' and not v.alcool))
      order by v.nome limit 200`, [ibge ?? null, verRestrito]);
  return rows.map((r) => ({ id: r.id, nome: r.nome, categoria: r.categoria, ibge: r.ibge, cor: r.cor, desc: r.descricao, ate: r.ate, demo: r.demo, patrocinado: true as const, selo: SELO_PATROCINIO }));
}

/** busca o estabelecimento vigente e aplica a política etária; 404 se não vigente, 403 se restrito para a pessoa */
async function vigenteOuErro(id: string, u: Quem, ex?: Exec) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErroHttp(404, 'estabelecimento não encontrado');
  if (!(await flagLigada('estabelecimentos', ex))) throw new ErroHttp(404, 'estabelecimento não encontrado');
  const v = await q1<any>(`select v.* from venues v where v.id = $1 and ${VIGENTE}`, [id], ex);
  if (!v) throw new ErroHttp(404, 'estabelecimento não encontrado');
  if (restrito(v) && !podeVerRestrito(u?.faixa_etaria, await flagLigada('bares', ex))) throw new ErroHttp(403, 'conteúdo disponível só para contas com maioridade confirmada');
  return v;
}

export async function detalhe(id: string, u: Quem) {
  const v = await vigenteOuErro(id, u);
  const verRestrito = await acessoRestrito(u);
  const pat = await q1<any>(`select modalidade, beneficios, fim::text fim from sponsorships s where s.venue_id = $1 and s.status = 'ativo' and ${HOJE} between s.inicio and s.fim order by fim desc limit 1`, [id]);
  const links = await q<any>(`select id, tipo, url, dominio, rotulo from venue_links where venue_id = $1 and ativo order by tipo, criado_em`, [id]);
  const allow = await dominiosPermitidos();
  const cupons = await q<any>(
    `select c.id, c.titulo, c.regras, c.fim, c.limite_total, c.resgatados, c.alcool,
            (select r.codigo from coupon_redemptions r where r.coupon_id = c.id and r.user_id = $2) meu_codigo
       from coupons c where c.venue_id = $1 and c.status = 'ativo' and now() between c.inicio and c.fim order by c.fim`, [id, u?.id ?? null]);
  const eventos = await q<any>(`select id, titulo, descricao, inicio, fim, capacidade, alcool from venue_events where venue_id = $1 and status = 'agendado' and fim > now() order by inicio limit 10`, [id]);
  const fotos = await q<any>(`select ref from venue_photos where venue_id = $1 and status = 'aprovada' order by criado_em limit 8`, [id]);
  const interior = v.interior || {};
  return {
    id: v.id, nome: v.nome, categoria: v.categoria as Categoria, ibge: v.ibge, cor: v.cor, descricao: v.descricao, demo: v.demo,
    patrocinado: true as const, selo: SELO_PATROCINIO,
    patrocinio: pat ? { modalidade: pat.modalidade, ate: pat.fim } : null,
    avisoVirtual: AVISO_VIRTUAL,
    endereco: v.endereco_comercial, horario: v.horario, telefone: v.contato_telefone,
    logo: v.logo_ref ? { ref: v.logo_ref, licenca: v.logo_licenca } : null,
    fotos: fotos.map((f) => f.ref),
    interior: { mesas: clampInt(interior.mesas, 1, 20, 4), lugaresPorMesa: clampInt(interior.lugares_por_mesa, 1, 12, 4), capacidade: v.capacidade },
    // revalida cada link na saída: se o domínio saiu da allowlist, o link some
    links: links.filter((l) => validarUrlExterna(l.url, allow).ok).map((l) => ({ id: l.id, tipo: l.tipo, rotulo: l.rotulo, dominio: l.dominio, url: l.url })),
    cupons: cupons.filter((c) => verRestrito || !c.alcool).map((c) => ({ id: c.id, titulo: c.titulo, regras: c.regras, ate: c.fim, esgotado: c.limite_total != null && c.resgatados >= c.limite_total, meuCodigo: c.meu_codigo ?? null })),
    eventos: eventos.filter((e) => verRestrito || !e.alcool).map((e) => ({ id: e.id, titulo: e.titulo, descricao: e.descricao, inicio: e.inicio, fim: e.fim, capacidade: e.capacidade, patrocinado: true })),
  };
}
const clampInt = (v: unknown, a: number, b: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };

/** visita virtual de conta autenticada: 1 por pessoa/local/dia */
export async function registrarVisita(id: string, u: { id: string; faixa_etaria: string }) {
  await vigenteOuErro(id, u);
  const r = await q(`insert into venue_visits (venue_id, user_id, dia) values ($1, $2, ${HOJE}) on conflict do nothing returning venue_id`, [id, u.id]);
  return { nova: r.length > 0 };
}

/** clique externo: devolve a URL (revalidada contra a allowlist atual) e conta 1 por pessoa/link/dia se houver sessão */
export async function registrarClique(id: string, linkId: string, u: Quem) {
  await vigenteOuErro(id, u);
  if (!/^[0-9a-f-]{36}$/i.test(linkId)) throw new ErroHttp(404, 'link não encontrado');
  const l = await q1<any>(`select id, url from venue_links where id = $1 and venue_id = $2 and ativo`, [linkId, id]);
  if (!l) throw new ErroHttp(404, 'link não encontrado');
  const val = validarUrlExterna(l.url, await dominiosPermitidos());
  if (!val.ok) throw new ErroHttp(410, 'este link foi desativado');
  let contado = false;
  if (u) contado = (await q(`insert into venue_clicks (venue_id, link_id, user_id, dia) values ($1, $2, $3, ${HOJE}) on conflict do nothing returning link_id`, [id, linkId, u.id])).length > 0;
  return { url: val.url, dominio: val.dominio, contado };
}

/** resgate de cupom: exige sessão; 1 por pessoa por cupom (repetir devolve o mesmo código, sem contar de novo) */
export async function resgatarCupom(cupomId: string, u: { id: string; faixa_etaria: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(cupomId)) throw new ErroHttp(404, 'cupom não encontrado');
  return tx(async (c) => {
    const cp = await q1<any>(`select * from coupons where id = $1 for update`, [cupomId], c);
    if (!cp) throw new ErroHttp(404, 'cupom não encontrado');
    await vigenteOuErro(cp.venue_id, u, c);
    if (cp.alcool && !podeVerRestrito(u.faixa_etaria, await flagLigada('bares', c))) throw new ErroHttp(403, 'cupom disponível só para contas com maioridade confirmada');
    const ja = await q1<{ codigo: string }>(`select codigo from coupon_redemptions where coupon_id = $1 and user_id = $2`, [cupomId, u.id], c);
    if (ja) return { codigo: ja.codigo, jaResgatado: true };
    const agora = await q1<{ ok: boolean }>(`select $1::timestamptz <= now() and now() < $2::timestamptz ok`, [cp.inicio, cp.fim], c);
    if (cp.status !== 'ativo' || !agora!.ok) throw new ErroHttp(409, 'cupom fora da validade');
    if (cp.limite_total != null && cp.resgatados >= cp.limite_total) throw new ErroHttp(409, 'cupom esgotado');
    const codigo = codigoAleatorio('CUP', 8);
    const ins = await q<{ codigo: string }>(`insert into coupon_redemptions (coupon_id, user_id, codigo) values ($1, $2, $3) on conflict (coupon_id, user_id) do nothing returning codigo`, [cupomId, u.id, codigo], c);
    if (!ins.length) { const r = await q1<{ codigo: string }>(`select codigo from coupon_redemptions where coupon_id = $1 and user_id = $2`, [cupomId, u.id], c); return { codigo: r!.codigo, jaResgatado: true }; }
    await q(`update coupons set resgatados = resgatados + 1 where id = $1`, [cupomId], c);
    return { codigo: ins[0].codigo, jaResgatado: false };
  });
}

/* ======================= métricas ======================= */
/** recalcula (idempotente) o agregado diário a partir dos eventos crus deduplicados */
export async function agregarMetricas(dia?: string, ex?: Exec) {
  const d = dia ?? (await q1<{ d: string }>(`select ${HOJE}::text d`, [], ex))!.d;
  const r = await q<{ venue_id: string }>(
    `with base as (
       select v.id venue_id, v.demo,
         (select count(*) from venue_visits x where x.venue_id = v.id and x.dia = $1::date)::int vis,
         (select count(*) from venue_clicks x where x.venue_id = v.id and x.dia = $1::date)::int cli,
         (select count(*) from coupon_redemptions r join coupons cp on cp.id = r.coupon_id where cp.venue_id = v.id and (r.criado_em at time zone 'America/Sao_Paulo')::date = $1::date)::int res
       from venues v)
     insert into aggregated_venue_metrics (venue_id, dia, visitantes_unicos, cliques, resgates, demo, calculado_em)
     select venue_id, $1::date, vis, cli, res, demo, now() from base where vis + cli + res > 0
     on conflict (venue_id, dia) do update set visitantes_unicos = excluded.visitantes_unicos, cliques = excluded.cliques, resgates = excluded.resgates, demo = excluded.demo, calculado_em = now()
     returning venue_id`, [d], ex);
  return { dia: d, estabelecimentos: r.length };
}

/** métricas de um estabelecimento num período (visitantes únicos no período inteiro, não soma de dias) */
export async function metricasVenue(id: string, desde: string, ate: string) {
  const r = await q1<any>(
    `select (select count(distinct user_id) from venue_visits where venue_id = $1 and dia between $2::date and $3::date)::int visitantes_unicos,
            (select count(*) from venue_clicks where venue_id = $1 and dia between $2::date and $3::date)::int cliques,
            (select count(*) from coupon_redemptions r join coupons c on c.id = r.coupon_id where c.venue_id = $1 and (r.criado_em at time zone 'America/Sao_Paulo')::date between $2::date and $3::date)::int resgates`, [id, desde, ate]);
  const dias = await q<any>(`select dia::text, visitantes_unicos, cliques, resgates from aggregated_venue_metrics where venue_id = $1 and dia between $2::date and $3::date order by dia`, [id, desde, ate]);
  return { ...r, dias };
}

/** contadores de PRODUÇÃO: estabelecimentos/patrocínios de demonstração nunca entram */
export async function contadoresProducao(ex?: Exec) {
  return (await q1<any>(
    `select (select count(*) from venues v where not v.demo and ${VIGENTE})::int estabelecimentos_vigentes,
            (select count(*) from sponsorships s join venues v on v.id = s.venue_id where not v.demo and s.status = 'ativo')::int patrocinios_ativos,
            (select count(distinct x.user_id) from venue_visits x join venues v on v.id = x.venue_id where not v.demo)::int visitantes_unicos,
            (select count(*) from venue_clicks x join venues v on v.id = x.venue_id where not v.demo)::int cliques,
            (select count(*) from coupon_redemptions r join coupons c on c.id = r.coupon_id join venues v on v.id = c.venue_id where not v.demo)::int resgates,
            (select coalesce(sum(visitantes_unicos), 0) from aggregated_venue_metrics where not demo)::int visitas_dia_somadas`, [], ex))!;
}

/* ======================= administração (chamado pelo painel; ator obrigatório) ======================= */
const ehData = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const ehIso = (s: unknown) => typeof s === 'string' && !isNaN(Date.parse(s));
function slugDe(nome: string) { return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'local'; }

export type VenueEntrada = {
  nome?: unknown; categoria?: unknown; ibge?: unknown; descricao?: unknown; cor?: unknown; endereco?: unknown; horario?: unknown; telefone?: unknown;
  logo_ref?: unknown; logo_licenca?: unknown; logo_declarado_por?: unknown; mesas?: unknown; lugares_por_mesa?: unknown; capacidade?: unknown; alcool?: unknown; pedido_id?: unknown;
};

export async function criarVenue(ator: string, d: VenueEntrada, opts: { demo?: boolean } = {}) {
  const nome = textoLimpo(d.nome, 60); if (nome.length < 2) throw new ErroHttp(400, 'nome inválido');
  const categoria = String(d.categoria ?? '') as Categoria; if (!CATEGORIAS.includes(categoria)) throw new ErroHttp(400, 'categoria inválida');
  const ibge = Number(d.ibge); if (!Number.isInteger(ibge)) throw new ErroHttp(400, 'cidade (IBGE) inválida');
  const cor = String(d.cor ?? '#ffd23f').toLowerCase(); if (!/^#[0-9a-f]{6}$/.test(cor)) throw new ErroHttp(400, 'cor inválida (use #rrggbb)');
  const tel = normalizarTelefone(d.telefone); if (tel === null) throw new ErroHttp(400, 'telefone inválido');
  const logoRef = d.logo_ref ? textoLimpo(d.logo_ref, 300) : null;
  const logoLic = d.logo_licenca ? textoLimpo(d.logo_licenca, 300) : null;
  const logoPor = d.logo_declarado_por ? textoLimpo(d.logo_declarado_por, 80) : null;
  if (logoRef && (!logoLic || logoLic.length < 10 || !logoPor)) throw new ErroHttp(400, 'logo exige declaração de licença (quem declarou e em que termos)');
  const alcool = categoria === 'bar' || d.alcool === true;
  return tx(async (c) => {
    if (!(await q1(`select 1 from municipios where ibge = $1`, [ibge], c))) throw new ErroHttp(400, 'cidade (IBGE) inexistente');
    const pedido = typeof d.pedido_id === 'string' && /^[0-9a-f-]{36}$/i.test(d.pedido_id) ? d.pedido_id : null;
    let slug = slugDe(nome) + '-' + ibge; if (await q1(`select 1 from venues where slug = $1`, [slug], c)) slug = slug.slice(0, 50) + '-' + Math.random().toString(36).slice(2, 7);
    const v = (await q1<{ id: string }>(
      `insert into venues (slug, nome, categoria, ibge, descricao, cor, logo_ref, logo_licenca, logo_declarado_por, logo_declarado_em, endereco_comercial, horario, contato_telefone, interior, capacidade, alcool, demo, pedido_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, case when $7::text is null then null else now() end, $10,$11,$12,$13,$14,$15,$16,$17) returning id`,
      [slug, nome, categoria, ibge, textoLimpo(d.descricao, 280), cor, logoRef, logoLic, logoPor, d.endereco ? textoLimpo(d.endereco, 200) : null, d.horario ? textoLimpo(d.horario, 120) : null, tel ?? null,
        JSON.stringify({ mesas: clampInt(d.mesas, 1, 20, 4), lugares_por_mesa: clampInt(d.lugares_por_mesa, 1, 12, 4) }), clampInt(d.capacidade, 1, 200, 16), alcool, !!opts.demo, pedido], c))!;
    if (pedido) await q(`update venue_requests set status = 'aprovado', venue_id = $2 where id = $1`, [pedido, v.id], c);
    await auditar(c, ator, 'estabelecimento.criar', 'venue:' + v.id, null, { categoria, ibge, demo: !!opts.demo, pedido });
    return { id: v.id, slug };
  });
}

export async function mudarVerificacao(ator: string, id: string, verificacao: unknown, nota: unknown) {
  if (!['verificado', 'rejeitado', 'suspenso', 'pendente'].includes(String(verificacao))) throw new ErroHttp(400, 'verificação inválida');
  const n = textoLimpo(nota, 300); if (n.length < 5) throw new ErroHttp(400, 'informe o motivo/nota da verificação');
  return tx(async (c) => {
    const r = await q(`update venues set verificacao = $2, verificado_por = $3, verificado_em = now(), nota_verificacao = $4, atualizado_em = now() where id = $1 returning id`, [id, verificacao, ator, n], c);
    if (!r.length) throw new ErroHttp(404, 'estabelecimento não encontrado');
    await auditar(c, ator, 'estabelecimento.verificacao', 'venue:' + id, n, { verificacao });
    return { alterado: true };
  });
}

export async function adicionarLink(ator: string, venueId: string, d: { tipo?: unknown; url?: unknown; rotulo?: unknown }) {
  if (!['site', 'instagram', 'whatsapp', 'cardapio', 'mapa'].includes(String(d.tipo))) throw new ErroHttp(400, 'tipo de link inválido');
  const rotulo = textoLimpo(d.rotulo, 40); if (rotulo.length < 2) throw new ErroHttp(400, 'rótulo do link obrigatório (o destino precisa ficar claro)');
  return tx(async (c) => {
    const val = validarUrlExterna(d.url, await dominiosPermitidos(c)); if (!val.ok) throw new ErroHttp(400, val.erro);
    if (!(await q1(`select 1 from venues where id = $1`, [venueId], c))) throw new ErroHttp(404, 'estabelecimento não encontrado');
    const r = await q1<{ id: string }>(`insert into venue_links (venue_id, tipo, url, dominio, rotulo) values ($1,$2,$3,$4,$5) on conflict (venue_id, url) do update set ativo = true, rotulo = excluded.rotulo returning id`, [venueId, d.tipo, val.url, val.dominio, rotulo], c);
    await auditar(c, ator, 'estabelecimento.link', 'venue:' + venueId, null, { tipo: d.tipo, dominio: val.dominio });
    return { id: r!.id, url: val.url };
  });
}

export async function adicionarDominio(ator: string, dominio: unknown, motivo: string) {
  const d = String(dominio ?? '').trim().toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d) || d.length > 100) throw new ErroHttp(400, 'domínio inválido');
  return tx(async (c) => {
    await q(`insert into link_domain_allowlist (dominio, nota, adicionado_por) values ($1, $2, $3) on conflict (dominio) do nothing`, [d, motivo, ator], c);
    await auditar(c, ator, 'estabelecimento.dominio_permitido', 'dominio:' + d, motivo);
    return { dominio: d };
  });
}

export async function criarPatrocinio(ator: string, venueId: string, d: { modalidade?: unknown; beneficios?: unknown; contrato_ref?: unknown; inicio?: unknown; fim?: unknown; observacao?: unknown }) {
  if (!['presenca', 'personalizacao', 'evento'].includes(String(d.modalidade))) throw new ErroHttp(400, 'modalidade inválida');
  const ben = Array.isArray(d.beneficios) && d.beneficios.length ? d.beneficios.map(String) : ['presenca_mapa'];
  const fora = ben.filter((b) => !(BENEFICIOS as readonly string[]).includes(b));
  if (fora.length) throw new ErroHttp(400, `benefício não permitido: ${fora.join(', ')} (patrocínio não compra voto, cargo nem vantagem no jogo)`);
  const contrato = textoLimpo(d.contrato_ref, 120); if (contrato.length < 3) throw new ErroHttp(400, 'referência do contrato manual obrigatória');
  if (!ehData(d.inicio) || !ehData(d.fim) || String(d.fim) < String(d.inicio)) throw new ErroHttp(400, 'vigência inválida (AAAA-MM-DD)');
  return tx(async (c) => {
    if (!(await q1(`select 1 from venues where id = $1`, [venueId], c))) throw new ErroHttp(404, 'estabelecimento não encontrado');
    const r = await q1<{ id: string }>(`insert into sponsorships (venue_id, modalidade, beneficios, contrato_ref, inicio, fim, observacao) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [venueId, d.modalidade, ben, contrato, d.inicio, d.fim, d.observacao ? textoLimpo(d.observacao, 300) : null], c);
    await auditar(c, ator, 'patrocinio.criar', 'sponsorship:' + r!.id, null, { venue: venueId, modalidade: d.modalidade, inicio: d.inicio, fim: d.fim });
    return { id: r!.id, status: 'rascunho' };
  });
}

/** aprovar (ativo) / pausar / encerrar / cancelar. Ativar exige estabelecimento verificado. Sem cobrança: status manual. */
export async function mudarStatusPatrocinio(ator: string, id: string, status: unknown, motivo: string) {
  if (!['ativo', 'pausado', 'encerrado', 'cancelado'].includes(String(status))) throw new ErroHttp(400, 'status inválido');
  return tx(async (c) => {
    const s = await q1<any>(`select s.*, v.verificacao from sponsorships s join venues v on v.id = s.venue_id where s.id = $1 for update of s`, [id], c);
    if (!s) throw new ErroHttp(404, 'patrocínio não encontrado');
    if (s.status === 'encerrado' || s.status === 'cancelado') throw new ErroHttp(409, 'patrocínio já finalizado');
    if (status === 'ativo' && s.verificacao !== 'verificado') throw new ErroHttp(409, 'verifique o estabelecimento antes de aprovar o patrocínio');
    await q(`update sponsorships set status = $2, aprovado_por = case when $2 = 'ativo' then $3::uuid else aprovado_por end, aprovado_em = case when $2 = 'ativo' then now() else aprovado_em end where id = $1`, [id, status, ator], c);
    await auditar(c, ator, 'patrocinio.status', 'sponsorship:' + id, motivo, { de: s.status, para: status });
    return { alterado: true };
  });
}

export async function criarCupom(ator: string, venueId: string, d: { titulo?: unknown; regras?: unknown; inicio?: unknown; fim?: unknown; limite_total?: unknown; alcool?: unknown }) {
  const titulo = textoLimpo(d.titulo, 60), regras = textoLimpo(d.regras, 280);
  if (titulo.length < 3 || regras.length < 5) throw new ErroHttp(400, 'título e regras do cupom são obrigatórios');
  if (!ehIso(d.fim) || (d.inicio !== undefined && !ehIso(d.inicio))) throw new ErroHttp(400, 'validade inválida');
  const lim = d.limite_total == null || d.limite_total === '' ? null : Number(d.limite_total);
  if (lim !== null && (!Number.isInteger(lim) || lim < 1)) throw new ErroHttp(400, 'limite inválido');
  return tx(async (c) => {
    const v = await q1<any>(`select categoria, alcool from venues where id = $1`, [venueId], c); if (!v) throw new ErroHttp(404, 'estabelecimento não encontrado');
    const alcool = d.alcool === true || restrito(v);
    const r = await q1<{ id: string }>(`insert into coupons (venue_id, titulo, regras, inicio, fim, limite_total, alcool) values ($1,$2,$3,coalesce($4::timestamptz, now()),$5,$6,$7) returning id`, [venueId, titulo, regras, d.inicio ?? null, d.fim, lim, alcool], c);
    await auditar(c, ator, 'cupom.criar', 'coupon:' + r!.id, null, { venue: venueId, limite: lim, alcool });
    return { id: r!.id };
  });
}

export async function criarEvento(ator: string, venueId: string, d: { titulo?: unknown; descricao?: unknown; inicio?: unknown; fim?: unknown; capacidade?: unknown; alcool?: unknown }) {
  const titulo = textoLimpo(d.titulo, 80); if (titulo.length < 3) throw new ErroHttp(400, 'título do evento obrigatório');
  if (!ehIso(d.inicio) || !ehIso(d.fim) || Date.parse(String(d.fim)) <= Date.parse(String(d.inicio))) throw new ErroHttp(400, 'horário do evento inválido');
  return tx(async (c) => {
    const v = await q1<any>(`select categoria, alcool from venues where id = $1`, [venueId], c); if (!v) throw new ErroHttp(404, 'estabelecimento não encontrado');
    const r = await q1<{ id: string }>(`insert into venue_events (venue_id, titulo, descricao, inicio, fim, capacidade, alcool) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [venueId, titulo, textoLimpo(d.descricao, 280), d.inicio, d.fim, d.capacidade ? clampInt(d.capacidade, 1, 500, 20) : null, d.alcool === true || restrito(v)], c);
    await auditar(c, ator, 'evento_patrocinado.criar', 'venue_event:' + r!.id, null, { venue: venueId });
    return { id: r!.id };
  });
}

export async function mudarStatusPedido(ator: string, id: string, status: unknown, nota: unknown) {
  if (!['em_analise', 'recusado', 'spam', 'novo'].includes(String(status))) throw new ErroHttp(400, 'status inválido (aprovar = criar o estabelecimento a partir do pedido)');
  return tx(async (c) => {
    const r = await q(`update venue_requests set status = $2, nota = $3 where id = $1 returning id`, [id, status, textoLimpo(nota, 300) || null], c);
    if (!r.length) throw new ErroHttp(404, 'pedido não encontrado');
    await auditar(c, ator, 'pedido_estabelecimento.status', 'venue_request:' + id, textoLimpo(nota, 300) || null, { status });
    return { alterado: true };
  });
}
