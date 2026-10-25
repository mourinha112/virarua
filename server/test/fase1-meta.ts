/* Fixtures da Meta para a Fase 1 — DADOS SINTÉTICOS (ids e @ inventados, prefixo "sintetico"), nunca pessoas reais.
   Formato conforme a documentação consultada em 24/10/2026 (docs/meta-instagram.md):
   { object: 'instagram', entry: [{ id: <IG da conta profissional>, time, changes: [{ field: 'comments', value: {
       id: <comment id>, from: { id: <IGSID do autor>, username }, text, media: { id, media_product_type } } }] }] }
   A variante "sem changes" (field/value direto na entry) também aparece na documentação e é aceita. */
import { createHmac } from 'node:crypto';
import { config } from '../src/config';
import { q } from '../src/db/db';
import { rodarFila } from '../src/jobs/fila';

export const CONTA = (): string => config.instagram.contaId || '';                 // vitest.config: 17840000000000000
export const MIDIA = '18000000000000001';                            // mídia sintética de campanha
let n = 0;
export const novoId = (pref = '1790000') => pref + String(Date.now()).slice(-7) + String(++n).padStart(4, '0');

export type ComentarioSint = { commentId?: string; fromId?: string | null; username?: string; text: string; mediaId?: string; time?: number; semChanges?: boolean; field?: string; conta?: string };
export function payloadComentario(o: ComentarioSint) {
  const value: any = { id: o.commentId || novoId('1795'), text: o.text, media: { id: o.mediaId || MIDIA, media_product_type: 'FEED' } };
  if (o.fromId !== null) value.from = { id: o.fromId || novoId('2400'), username: o.username || 'sintetico_autor' };
  const entry: any = { id: o.conta || CONTA(), time: o.time ?? Math.floor(Date.now() / 1000) };
  if (o.semChanges) { entry.field = o.field || 'comments'; entry.value = value; } else entry.changes = [{ field: o.field || 'comments', value }];
  return { object: 'instagram', entry: [entry] };
}
export const assinar = (corpo: string, segredo = config.instagram.appSecret || '') => 'sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex');

type Cli = { app: { request: (p: string, i: RequestInit) => Response | Promise<Response> } };
export async function postarWebhook(cli: Cli, payload: unknown, opts: { assinatura?: string | null } = {}) {
  const corpo = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const sig = opts.assinatura === undefined ? assinar(corpo) : opts.assinatura;
  if (sig) headers['x-hub-signature-256'] = sig;
  const r = await cli.app.request('/api/webhooks/instagram', { method: 'POST', headers, body: corpo });
  let json: any = null; try { json = await r.json(); } catch { /* */ }
  return { status: r.status, json };
}

export async function habilitarMidia(mediaId = MIDIA, opts: { aceita?: boolean; status?: string } = {}) {
  await q(`insert into enabled_media (media_id, conta_id, campanha, aceita_comentario_cidade, texto_consentimento, status) values ($1, $2, 'campanha sintética', $3, 'Comente sua cidade e UF para criar sua casa virtual. Seu @ poderá aparecer no mundo.', $4)
           on conflict (media_id) do update set aceita_comentario_cidade = excluded.aceita_comentario_cidade, status = excluded.status`, [mediaId, CONTA(), opts.aceita ?? true, opts.status || 'ativa']);
}

/** roda a fila até esvaziar o que está disponível agora */
export async function drenar() { let tot = 0; for (let i = 0; i < 50; i++) { const k = await rodarFila(50); tot += k; if (!k) break; } return tot; }
