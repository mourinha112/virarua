/* módulo instagram: webhook oficial (handshake + POST assinado), jobs de processamento e de private reply. */
import type { Context } from 'hono';
import type { App } from '../../http/app';
import { config } from '../../config';
import { q1, tx } from '../../db/db';
import { enfileirar, registrarJob } from '../../jobs/fila';
import { assinaturaValida, iguais } from '../../seguranca/cripto';
import { extrairComentarios, idComentario, processarEvento, enviarPrivateReply } from './processar';
import { enviarGravada } from './respostas';

export const ROTA_WEBHOOK = '/api/webhooks/instagram';

/** GET: verificação da assinatura do webhook (hub.mode=subscribe, hub.verify_token, hub.challenge) */
function handshake(c: Context) {
  const modo = c.req.query('hub.mode'), tok = c.req.query('hub.verify_token') || '', desafio = c.req.query('hub.challenge') || '';
  const esperado = config.instagram.verifyToken;
  if (modo === 'subscribe' && esperado && iguais(Buffer.from(tok), Buffer.from(esperado)) && /^[\w-]{1,200}$/.test(desafio)) return c.text(desafio, 200);
  return c.text('verificação recusada', 403);
}

/** POST: corpo BRUTO → limite de tamanho → assinatura X-Hub-Signature-256 → conta → dedupe durável → fila → 200 rápido */
async function receber(c: Context) {
  const max = config.instagram.payloadMaxBytes;
  const declarado = Number(c.req.header('content-length') || 0);
  if (declarado > max) return c.json({ ok: false, erro: 'payload grande demais' }, 413);
  const bruto = Buffer.from(await c.req.arrayBuffer());
  if (bruto.length > max) return c.json({ ok: false, erro: 'payload grande demais' }, 413);
  if (!assinaturaValida(bruto, c.req.header('x-hub-signature-256'), config.instagram.appSecret || '')) return c.json({ ok: false, erro: 'assinatura inválida' }, 401);
  let corpo: unknown; try { corpo = JSON.parse(bruto.toString('utf8')); } catch { return c.json({ ok: false, erro: 'json inválido' }, 400); }
  const { mudancas, ignoradas } = extrairComentarios(corpo);
  let novos = 0;
  if (mudancas.length) {
    await tx(async (t) => {
      for (const m of mudancas) {
        const chave = idComentario(m) + ':' + m.field;
        const ev = await q1<{ id: string }>(`insert into webhook_events (provedor, chave, payload) values ('instagram', $1, $2) on conflict (provedor, chave) do nothing returning id`, [chave, JSON.stringify(m)], t);
        if (!ev) continue;                                   // reentrega: já gravado
        await enfileirar(t, 'ig.comentario', { evento_id: ev.id }, 'ig.comentario:' + chave);
        novos++;
      }
    });
  }
  return c.json({ ok: true, recebidos: mudancas.length, novos, ignorados: ignoradas });
}

export function registrar(app: App) {
  app.get(ROTA_WEBHOOK, handshake);
  app.post(ROTA_WEBHOOK, receber);
  registrarJob('ig.comentario', async (d) => { await processarEvento(String(d.evento_id)); });
  registrarJob('ig.private_reply', async (d, job) => { await enviarPrivateReply(String(d.outbound_id), job.tentativas); });
  registrarJob('ig.resposta_publica', async (d, job) => { await enviarGravada(String(d.outbound_id), 'publica', job.tentativas); });
  registrarJob('ig.aviso_dm', async (d, job) => { await enviarGravada(String(d.outbound_id), 'dm', job.tentativas); });
}
