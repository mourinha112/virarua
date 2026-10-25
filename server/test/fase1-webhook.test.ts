/* Fase 1 · webhook do Instagram: handshake, assinatura sobre o corpo bruto, limite de tamanho, conta, dedupe e fila. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { fecharDb, q1 } from '../src/db/db';
import { config } from '../src/config';
import { payloadComentario, postarWebhook, assinar, habilitarMidia, novoId } from './fase1-meta';

beforeAll(async () => { await bancoLimpo(); await habilitarMidia(); });
afterAll(fecharDb);

const contar = async (sql: string, p: unknown[] = []) => (await q1<{ n: number }>(`select count(*)::int n from ${sql}`, p))!.n;

describe('fase1 · webhook', () => {
  it('handshake: devolve hub.challenge só com o verify token certo', async () => {
    const c = cliente();
    const ok = await c.app.request(`/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${config.instagram.verifyToken}&hub.challenge=1158201444`);
    expect(ok.status).toBe(200); expect(await ok.text()).toBe('1158201444');
    const ruim = await c.app.request(`/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1158201444`);
    expect(ruim.status).toBe(403);
    const semModo = await c.app.request(`/api/webhooks/instagram?hub.verify_token=${config.instagram.verifyToken}&hub.challenge=1`);
    expect(semModo.status).toBe(403);
  });

  it('webhook sem assinatura válida não entra no fluxo de negócio', async () => {
    const c = cliente();
    const p = payloadComentario({ text: 'Recife - PE' });
    const antes = [await contar('webhook_events'), await contar('processing_jobs')];
    expect((await postarWebhook(c, p, { assinatura: null })).status).toBe(401);
    expect((await postarWebhook(c, p, { assinatura: 'sha256=' + '0'.repeat(64) })).status).toBe(401);
    expect((await postarWebhook(c, p, { assinatura: assinar(JSON.stringify(p), 'outro-segredo') })).status).toBe(401);
    expect((await postarWebhook(c, p, { assinatura: 'md5=abc' })).status).toBe(401);
    // assinatura de outro corpo (corpo bruto adulterado)
    const outro = JSON.stringify({ ...p, x: 1 });
    expect((await postarWebhook(c, p, { assinatura: assinar(outro) })).status).toBe(401);
    expect([await contar('webhook_events'), await contar('processing_jobs')]).toEqual(antes);
  });

  it('payload acima do limite é recusado antes de qualquer gravação', async () => {
    const c = cliente(); const max = config.instagram.payloadMaxBytes;
    const p = payloadComentario({ text: 'x'.repeat(max + 10) });
    const r = await postarWebhook(c, p);
    expect(r.status).toBe(413);
    expect(await contar('webhook_events')).toBe(0);
  });

  it('evento assinado é gravado uma vez e enfileirado com chave idempotente (reentregas)', async () => {
    const c = cliente(); const cid = novoId('1795');
    const p = payloadComentario({ commentId: cid, text: 'Recife - PE' });
    const r1 = await postarWebhook(c, p);
    expect(r1.status).toBe(200); expect(r1.json).toMatchObject({ ok: true, recebidos: 1, novos: 1 });
    for (let i = 0; i < 4; i++) expect((await postarWebhook(c, p)).json.novos).toBe(0);
    expect(await contar(`webhook_events where provedor = 'instagram' and chave = $1`, [cid + ':comments'])).toBe(1);
    expect(await contar(`processing_jobs where tipo = 'ig.comentario' and chave = $1`, ['ig.comentario:' + cid + ':comments'])).toBe(1);
  });

  it('formato sem "changes" (field/value na entry) também é aceito', async () => {
    const c = cliente(); const cid = novoId('1795');
    const r = await postarWebhook(c, payloadComentario({ commentId: cid, text: 'Olinda PE', semChanges: true }));
    expect(r.json).toMatchObject({ recebidos: 1, novos: 1 });
  });

  it('conta diferente da conectada, campo não suportado ou objeto errado são ignorados (200, nada gravado)', async () => {
    const c = cliente(); const antes = await contar('webhook_events');
    expect((await postarWebhook(c, payloadComentario({ text: 'Recife PE', conta: '17841111111111111' }))).json).toMatchObject({ recebidos: 0, ignorados: 1 });
    expect((await postarWebhook(c, payloadComentario({ text: 'Recife PE', field: 'messages' }))).json).toMatchObject({ recebidos: 0 });
    expect((await postarWebhook(c, { object: 'page', entry: [] })).json).toMatchObject({ recebidos: 0 });
    expect(await contar('webhook_events')).toBe(antes);
  });

  it('JSON inválido com assinatura válida → 400 sem gravar', async () => {
    const c = cliente(); const corpo = '{nao-json';
    const r = await c.app.request('/api/webhooks/instagram', { method: 'POST', headers: { 'x-hub-signature-256': assinar(corpo) }, body: corpo });
    expect(r.status).toBe(400);
  });
});
