/* Respostas automáticas a um comentário de cidade:
   - resposta PÚBLICA embaixo do comentário (job 'ig.resposta_publica'), uma por comentário;
   - aviso no DIRECT para quem já é dono da casa (job 'ig.aviso_dm'). Quem acabou de ganhar a casa recebe a private
     reply com o link de confirmação (processar.ts), que ocupa a única mensagem privada permitida por comentário.
   Os textos não levam token: o que fica gravado em outbound_messages é exatamente o que foi enviado. */
import { q, q1, type Tx } from '../../db/db';
import { config } from '../../config';
import { enfileirar } from '../../jobs/fila';
import { provedorInstagram } from './provedor';

export type TipoResposta = 'casa_nova' | 'ja_tinha' | 'cidade_nao_achada';

const url = () => config.urlPublica.replace(/\/+$/, '');
const arroba = (h: string | null) => (h ? '@' + h + ' ' : '');

export function textoPublico(tipo: TipoResposta, handle: string | null, cidade: string | null) {
  if (tipo === 'casa_nova') return `${arroba(handle)}🏠 pronto! Sua casa em ${cidade} foi criada no mapa do Brasil. Te mandei o link no direct pra confirmar que é você.`;
  if (tipo === 'ja_tinha') return `${arroba(handle)}🏠 você já tem casa em ${cidade}! Te mandei no direct o link pra ver no mapa.`;
  return `${arroba(handle)}não achei essa cidade 😅 Comenta de novo assim: Duque de Caxias - RJ`;
}
export function textoAvisoDono(handle: string | null, cidade: string) {
  return `Oi${handle ? ' @' + handle : ''}! Sua casa em ${cidade} já está no mapa do Brasil virtual 🏠 Veja aqui: ${url()}/${handle ? '?u=' + encodeURIComponent(handle) : ''}`;
}

/** IG_RESPONDER=0: o app oficial não responde (ex.: enquanto o ManyChat responde pela ponte) */
export const respostasLigadas = () => process.env.IG_RESPONDER !== '0';

async function registrar(c: Tx, canal: string, chave: string, identityId: string | null, commentId: string, texto: string, job: string) {
  if (!respostasLigadas()) return null;
  const prov = provedorInstagram();
  const o = await q1<{ id: string }>(
    `insert into outbound_messages (canal, identity_id, referencia, chave, modo, estado, texto_redigido)
     values ($1, $2, $3, $4, $5, 'pendente', $6) on conflict (chave) do nothing returning id`,
    [canal, identityId, commentId, chave, prov.modo, texto], c);
  if (o) await enfileirar(c, job, { outbound_id: o.id }, job + ':' + commentId);
  return o?.id ?? null;
}

/** resposta pública embaixo do comentário */
export function enfileirarRespostaPublica(c: Tx, a: { commentId: string; identityId: string | null; tipo: TipoResposta; handle: string | null; cidade: string | null }) {
  return registrar(c, 'ig_comment_reply', 'ig_comment_reply:' + a.commentId, a.identityId, a.commentId, textoPublico(a.tipo, a.handle, a.cidade), 'ig.resposta_publica');
}
/** direct para quem já é dono (usa a mesma chave da private reply: no máximo UMA mensagem privada por comentário) */
export function enfileirarAvisoDono(c: Tx, a: { commentId: string; identityId: string; handle: string | null; cidade: string }) {
  return registrar(c, 'ig_private_reply', 'ig_private_reply:' + a.commentId, a.identityId, a.commentId, textoAvisoDono(a.handle, a.cidade), 'ig.aviso_dm');
}

/** envia uma mensagem já gravada (texto pronto) pelo provedor; erro transitório volta para a fila */
export async function enviarGravada(outboundId: string, tipo: 'publica' | 'dm', tentativa = 1) {
  const o = await q1<{ id: string; referencia: string; estado: string; texto_redigido: string }>(`select id, referencia, estado, texto_redigido from outbound_messages where id = $1`, [outboundId]);
  if (!o || o.estado !== 'pendente') return;
  const prov = provedorInstagram();
  const enviar = tipo === 'publica' ? prov.responderComentario?.bind(prov) : prov.enviarPrivateReply.bind(prov);
  if (!enviar) { await q(`update outbound_messages set estado = 'cancelada', resposta_provedor = $2 where id = $1`, [o.id, JSON.stringify({ motivo: 'provedor sem resposta pública' })]); return; }
  const r = await enviar({ commentId: o.referencia, texto: o.texto_redigido });
  if (r.ok) {
    await q(`update outbound_messages set estado = $2, modo = $3, resposta_provedor = $4, enviado_em = now() where id = $1`,
      [o.id, prov.modo === 'dry_run' ? 'dry_run' : 'enviada', prov.modo, JSON.stringify(r.resposta)]);
    return;
  }
  if (r.transitorio && tentativa < 3) throw new Error('resposta ' + tipo + ': ' + (r.erro || 'falha transitória'));
  await q(`update outbound_messages set estado = 'falhou', resposta_provedor = $2 where id = $1 and estado = 'pendente'`, [o.id, JSON.stringify({ erro: r.erro, resposta: r.resposta })]);
}
