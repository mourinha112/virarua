/* Processamento de comentários do Instagram (job 'ig.comentario') e envio da private reply (job 'ig.private_reply').
   Regras: só mídia habilitada; autor = from.id (escopo = conta conectada), NUNCA o @ citado no texto; sem id estável →
   needs_review; cidade ambígua/não encontrada → pendente com motivo; o username só atualiza a exibição. */
import { q, q1, tx, type Tx } from '../../db/db';
import { config } from '../../config';
import { enfileirar } from '../../jobs/fila';
import { sha256, tokenForte } from '../../seguranca/cripto';
import { resolverCidade } from '../cidades/resolver';
import { provisionar, garantirIdentidade, marcarOnboarding } from '../mundo/provisionar';
import { provedorInstagram } from './provedor';
import { enfileirarRespostaPublica, enfileirarAvisoDono, respostasLigadas } from './respostas';

export const CAMPOS_COMENTARIO = new Set(['comments', 'live_comments']);
/** código do desafio: mesmo alfabeto de codigoLegivel() (sem I, O, 0, 1) */
export const RE_CODIGO = /\bSMN-[A-HJ-NP-Z2-9]{10}\b/g;
const JANELA_PRIVATE_REPLY_MS = 7 * 86400_000; // documentação: até 7 dias após a criação do comentário

export type MudancaComentario = { conta_id: string; field: string; time: number | null; value: any };

/** Extrai as mudanças de comentário do corpo do webhook. Aceita os dois formatos documentados:
    entry[].changes[] {field, value} e entry[] com field/value direto (exemplo "Business Login for Instagram"). */
export function extrairComentarios(corpo: unknown): { mudancas: MudancaComentario[]; ignoradas: number } {
  const objs = Array.isArray(corpo) ? corpo : [corpo];
  const mudancas: MudancaComentario[] = []; let ignoradas = 0;
  for (const o of objs as any[]) {
    if (!o || o.object !== 'instagram' || !Array.isArray(o.entry)) { ignoradas++; continue; }
    for (const e of o.entry) {
      const contaId = e?.id != null ? String(e.id) : '';
      const time = typeof e?.time === 'number' ? e.time : null;
      const lista: any[] = Array.isArray(e?.changes) ? e.changes : e?.field ? [{ field: e.field, value: e.value }] : [];
      for (const ch of lista) {
        if (!ch || !CAMPOS_COMENTARIO.has(ch.field) || !ch.value || typeof ch.value !== 'object') { ignoradas++; continue; }
        if (contaId !== config.instagram.contaId || !contaId) { ignoradas++; continue; }   // só a conta conectada
        const cid = ch.value.id ?? ch.value.comment_id;
        if (cid == null || !/^[\w-]{1,64}$/.test(String(cid))) { ignoradas++; continue; }
        mudancas.push({ conta_id: contaId, field: ch.field, time, value: ch.value });
      }
    }
  }
  return { mudancas, ignoradas };
}
export const idComentario = (m: MudancaComentario) => String(m.value.id ?? m.value.comment_id);

export type ResultadoComentario = { estado: string; motivo: string | null; identityId?: string; houseId?: string; ibge?: number };

/** processa um comentário (idempotente por comment_id; o mesmo autor é serializado pela trava da identidade) */
export async function processarComentario(m: MudancaComentario): Promise<ResultadoComentario> {
  const v = m.value || {};
  const commentId = idComentario(m);
  const mediaId = v.media?.id != null ? String(v.media.id) : null;
  const fromId = v.from?.id != null ? String(v.from.id) : null;
  const username = typeof v.from?.username === 'string' && /^[\w.]{1,30}$/.test(v.from.username) ? v.from.username : null;
  const texto = typeof v.text === 'string' ? v.text.slice(0, 1000) : '';
  const eventoEm = m.time ? new Date(m.time < 1e12 ? m.time * 1000 : m.time) : null;

  return tx(async (c) => {
    const ins = await q1(
      `insert into instagram_comments (comment_id, conta_id, media_id, campo, autor_external_id, username, texto, evento_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (comment_id) do nothing returning comment_id`,
      [commentId, m.conta_id, mediaId, m.field, fromId, username, texto.slice(0, 300), eventoEm], c);
    if (!ins) {
      const ex = await q1<{ estado: string; motivo: string | null }>(`select estado, motivo from instagram_comments where comment_id = $1 for update`, [commentId], c);
      if (ex && ex.estado !== 'received') return { estado: ex.estado, motivo: ex.motivo };
    }
    const fim = async (estado: string, motivo: string | null, extra: { identityId?: string; houseId?: string; ibge?: number; candidatos?: unknown } = {}) => {
      await c.query(`update instagram_comments set estado = $2, motivo = $3, identity_id = $4, ibge = $5, candidatos = $6, processado_em = now() where comment_id = $1`,
        [commentId, estado, motivo, extra.identityId ?? null, extra.ibge ?? null, extra.candidatos ? JSON.stringify(extra.candidatos) : null]);
      return { estado, motivo, identityId: extra.identityId, houseId: extra.houseId, ibge: extra.ibge };
    };

    if (m.conta_id !== config.instagram.contaId) return fim('ignored', 'conta não conectada');
    const midia = await q1<{ status: string; aceita_comentario_cidade: boolean }>(`select status, aceita_comentario_cidade from enabled_media where media_id = $1 and conta_id = $2`, [mediaId, m.conta_id], c);
    // IG_SO_CAMPANHA=1: só os posts habilitados no painel; padrão: qualquer post da conta vale (post pausado no painel continua bloqueado)
    if (midia ? midia.status !== 'ativa' : process.env.IG_SO_CAMPANHA === '1') return fim('ignored', 'mídia não habilitada como campanha');
    if (!fromId || !/^\d{1,40}$/.test(fromId)) return fim('needs_review', 'comentário sem id estável do autor (from.id); nada é resolvido por username');
    if (fromId === m.conta_id) return fim('ignored', 'comentário da própria conta oficial');
    const ident = { escopo: m.conta_id, externalId: fromId, username, eventoEm };

    // desafio por código: o AUTOR comprovado (from.id) publicou o código mostrado num navegador
    const codigos = (texto.toUpperCase().match(RE_CODIGO) || []).slice(0, 3);
    let desafio = false;
    if (codigos.length) {
      const idt = await garantirIdentidade(c, ident);
      if (idt.revogado_em) return fim('revoked', 'identidade removida a pedido do titular', { identityId: idt.id });
      for (const cod of codigos) {
        const ch = await q1(`update claim_challenges set verificado_identity_id = $2, verificado_em = now()
                              where codigo_hash = $1 and verificado_identity_id is null and consumido_em is null and expira_em > now() returning id`, [sha256(cod), idt.id], c);
        if (ch) desafio = true;
      }
    }
    const textoCidade = codigos.length ? texto.toUpperCase().replace(RE_CODIGO, ' ') : texto;
    if (midia && !midia.aceita_comentario_cidade) return fim(desafio ? 'challenge' : 'ignored', desafio ? 'código de verificação reconhecido' : 'mídia não aceita comentário de cidade');

    const res = await resolverCidade(textoCidade, c);
    if (res.tipo === 'ok') {
      const pr = await provisionar(c, { ...ident, ibge: res.ibge, origem: 'instagram:' + commentId });
      if (pr.resultado === 'revoked') return fim('revoked', 'identidade removida a pedido do titular', { identityId: pr.identityId });
      const mun = await q1<{ nome: string; uf: string }>(`select nome, uf from municipios where ibge = $1`, [pr.resultado === 'provisioned' || pr.resultado === 'duplicate' ? pr.ibge : res.ibge], c);
      const nomeCidade = mun ? `${mun.nome} - ${mun.uf}` : '';
      if (pr.resultado === 'provisioned') {
        await enfileirarPrivateReply(c, pr.identityId, commentId);
        await enfileirarRespostaPublica(c, { commentId, identityId: pr.identityId, tipo: 'casa_nova', handle: username, cidade: nomeCidade });
        return fim('provisioned', null, { identityId: pr.identityId, houseId: pr.houseId, ibge: pr.ibge });
      }
      // já tem casa: não muda residência. Se a reserva segue sem dono e não há link válido nem envio pendente,
      // este novo comentário permite uma nova private reply (uma por comentário).
      await enfileirarRespostaPublica(c, { commentId, identityId: pr.identityId, tipo: 'ja_tinha', handle: username, cidade: nomeCidade });
      if (pr.status === 'reivindicada') await enfileirarAvisoDono(c, { commentId, identityId: pr.identityId, handle: username, cidade: nomeCidade });
      if (pr.status === 'reservada') {
        const aberto = await q1(`select 1 from outbound_messages where identity_id = $1 and estado = 'pendente'
                                 union all select 1 from identity_claims where identity_id = $1 and consumido_em is null and expira_em > now() limit 1`, [pr.identityId], c);
        if (!aberto) await enfileirarPrivateReply(c, pr.identityId, commentId);
      }
      return fim('duplicate', pr.ibge === res.ibge ? 'já tem casa nesta cidade' : 'já tem casa em outra cidade; comentar outra cidade não muda a residência',
        { identityId: pr.identityId, houseId: pr.houseId, ibge: pr.ibge });
    }
    if (desafio) return fim('challenge', 'código de verificação reconhecido');
    const idt = await garantirIdentidade(c, ident);
    if (idt.revogado_em) return fim('revoked', 'identidade removida a pedido do titular', { identityId: idt.id });
    const motivo = res.tipo === 'ambigua'
      ? 'cidade ambígua: ' + res.candidatos.slice(0, 8).map((x) => `${x.nome}-${x.uf}`).join(', ') + (res.candidatos.length > 8 ? '…' : '') + ' (informe a UF)'
      : 'cidade não encontrada no comentário (escreva "Cidade - UF")';
    await marcarOnboarding(c, idt.id, 'pending_city_resolution', motivo);
    await enfileirarRespostaPublica(c, { commentId, identityId: idt.id, tipo: 'cidade_nao_achada', handle: username, cidade: null });
    return fim('pending_city_resolution', motivo, { identityId: idt.id, candidatos: res.tipo === 'ambigua' ? res.candidatos.slice(0, 50) : undefined });
  });
}

/** job 'ig.comentario': lê o evento durável e processa */
export async function processarEvento(eventoId: string) {
  const ev = await q1<{ id: string; payload: MudancaComentario; estado: string }>(`select id, payload, estado from webhook_events where id = $1`, [eventoId]);
  if (!ev || ev.estado === 'processado' || ev.estado === 'ignorado') return;
  await q(`update webhook_events set estado = 'processando', tentativas = tentativas + 1 where id = $1`, [eventoId]);
  try {
    const r = await processarComentario(ev.payload);
    await q(`update webhook_events set estado = $2, erro = $3 where id = $1`, [eventoId, r.estado === 'ignored' ? 'ignorado' : 'processado', r.motivo]);
  } catch (e: any) {
    await q(`update webhook_events set estado = 'erro', erro = $2 where id = $1`, [eventoId, String(e?.message || e).slice(0, 500)]);
    throw e;
  }
}

// ---------- private reply ----------
const linkReivindicar = (t: string) => `${config.urlPublica.replace(/\/$/, '')}/reivindicar.html?t=${t}`;
export function textoPrivateReply(link: string, cidade: string) {
  return `Sua casa em ${cidade} está reservada no Seu Mundo Novo! Para confirmar que é você, abra este link de uso único `
    + `(vale ${config.reivindicacao.validadeLinkMin} min, não compartilhe): ${link}`;
}

export async function enfileirarPrivateReply(c: Tx, identityId: string, commentId: string) {
  if (!respostasLigadas()) return null;
  const prov = provedorInstagram();
  const o = await q1<{ id: string }>(
    `insert into outbound_messages (canal, identity_id, referencia, chave, modo, estado, texto_redigido)
     values ('ig_private_reply', $1, $2, $3, $4, 'pendente', $5) on conflict (chave) do nothing returning id`,
    [identityId, commentId, 'ig_private_reply:' + commentId, prov.modo, textoPrivateReply(linkReivindicar('[redigido]'), '[cidade]')], c);
  if (!o) return null;
  await enfileirar(c, 'ig.private_reply', { outbound_id: o.id }, 'ig.private_reply:' + commentId);
  await c.query(`update onboarding set entrega = 'delivery_pending', atualizado_em = now() where identity_id = $1`, [identityId]);
  return o.id;
}

const ESTADOS_ENTREGA = ['provisioned_unclaimed', 'claim_pending', 'delivery_pending', 'delivery_failed'];

/** job 'ig.private_reply': gera o link (só o hash vai ao banco), envia pelo provedor e registra o resultado.
    Falha de envio marca delivery_failed e NUNCA desfaz nem duplica a casa. */
export async function enviarPrivateReply(outboundId: string, tentativa = 1) {
  const o = await q1<{ id: string; identity_id: string; referencia: string; estado: string; evento_em: Date | null }>(
    `select om.id, om.identity_id, om.referencia, om.estado, ic.evento_em from outbound_messages om
       left join instagram_comments ic on ic.comment_id = om.referencia where om.id = $1`, [outboundId]);
  if (!o || o.estado !== 'pendente') return;
  const casa = await q1<{ id: string; nome: string; uf: string }>(
    `select h.id, m.nome, m.uf from houses h join plots p on p.id = h.plot_id join municipios m on m.ibge = p.ibge
      where h.dono_identity_id = $1 and h.principal and h.status = 'reservada'`, [o.identity_id]);
  if (!casa) { await q(`update outbound_messages set estado = 'cancelada', resposta_provedor = $2 where id = $1`, [o.id, JSON.stringify({ motivo: 'casa já reivindicada, expirada ou removida' })]); return; }
  const falhar = async (erro: string, resposta: unknown, claimId?: string) => {
    await tx(async (c) => {
      if (claimId) await c.query(`update identity_claims set expira_em = now() where id = $1 and consumido_em is null`, [claimId]);
      await c.query(`update outbound_messages set estado = 'falhou', resposta_provedor = $2 where id = $1 and estado = 'pendente'`, [o.id, JSON.stringify({ erro, resposta })]);
      await c.query(`update onboarding set estado = case when estado = any($3) then 'delivery_failed' else estado end, entrega = 'delivery_failed', detalhe = $2, atualizado_em = now() where identity_id = $1`,
        [o.identity_id, `link privado não entregue (${erro}). A casa continua reservada: confirme pelo código de verificação em /reivindicar.html`, ESTADOS_ENTREGA]);
    });
  };
  if (o.evento_em && Date.now() - o.evento_em.getTime() > JANELA_PRIVATE_REPLY_MS) return falhar('fora da janela de 7 dias da private reply', {});

  const prov = provedorInstagram();
  const token = tokenForte(32);
  const claim = await tx(async (c) => {
    await c.query(`update identity_claims set expira_em = now() where identity_id = $1 and consumido_em is null and expira_em > now()`, [o.identity_id]);
    return (await q1<{ id: string }>(`insert into identity_claims (identity_id, token_hash, expira_em) values ($1, $2, now() + make_interval(mins => $3)) returning id`,
      [o.identity_id, sha256(token), config.reivindicacao.validadeLinkMin], c))!;
  });
  const cidade = `${casa.nome}-${casa.uf}`;
  const r = await prov.enviarPrivateReply({ commentId: o.referencia, texto: textoPrivateReply(linkReivindicar(token), cidade) });
  if (r.ok) {
    await tx(async (c) => {
      await c.query(`update outbound_messages set estado = $2, modo = $3, resposta_provedor = $4, texto_redigido = $5, enviado_em = now() where id = $1`,
        [o.id, prov.modo === 'dry_run' ? 'dry_run' : 'enviada', prov.modo, JSON.stringify(r.resposta), textoPrivateReply(linkReivindicar('[redigido]'), cidade)]);
      await c.query(`update onboarding set estado = case when estado = any($3) then 'claim_pending' else estado end, entrega = $2, detalhe = null, atualizado_em = now() where identity_id = $1`,
        [o.identity_id, prov.modo === 'dry_run' ? 'dry_run' : 'enviada', ESTADOS_ENTREGA]);
    });
    return;
  }
  if (r.transitorio && tentativa < 3) {
    // resultado incerto/transitório: a fila repete com backoff; o link desta tentativa continua válido até expirar
    await q(`update onboarding set entrega = 'delivery_pending', atualizado_em = now() where identity_id = $1`, [o.identity_id]);
    throw new Error('private reply: ' + (r.erro || 'falha transitória'));
  }
  await falhar(r.erro || 'falha no envio', r.resposta, claim.id);
}
