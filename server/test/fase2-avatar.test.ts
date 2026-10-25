import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo } from './ajuda';
import { moradorTeste } from './fixtures';
import { fecharDb, q, q1 } from '../src/db/db';
import { logado, VITORIA } from './fase2-ajuda';

beforeAll(bancoLimpo);
afterAll(fecharDb);

describe('fase 2 · avatar', () => {
  it('avatar editado persiste (nova leitura e nova sessão)', async () => {
    const m = await moradorTeste(VITORIA);
    const c = await logado(m.userId);
    const antes = await c.get('/api/avatar/eu');
    expect(antes.json).toMatchObject({ ok: true, editavel: true, houseId: m.houseId });
    const r = await c.put('/api/avatar/eu', { config: { pele: 'pele.5', cabelo: 'cabelo.trancas', cor_roupa: 'cor_roupa.verde' }, versao: antes.json.versao });
    expect(r.status).toBe(200);
    expect(r.json.config).toMatchObject({ pele: 'pele.5', cabelo: 'cabelo.trancas', cor_roupa: 'cor_roupa.verde', roupa: 'roupa.camiseta' });
    const c2 = await logado(m.userId);
    const depois = await c2.get('/api/avatar/eu');
    expect(depois.json.config).toMatchObject({ pele: 'pele.5', cabelo: 'cabelo.trancas', cor_roupa: 'cor_roupa.verde' });
    expect(depois.json.versao).toBe(antes.json.versao + 1);
    const db = await q1<{ config: any }>(`select config from avatars where house_id = $1 and ativo`, [m.houseId]);
    expect(db!.config.pele).toBe('pele.5');
    // leitura pública da casa mostra o mesmo avatar
    expect((await c2.get(`/api/avatares/${m.houseId}`)).json.config.cabelo).toBe('cabelo.trancas');
  });

  it('não edita avatar alheio (rota da casa alheia → 403; houseId no corpo é ignorado)', async () => {
    const a = await moradorTeste(VITORIA), b = await moradorTeste(VITORIA);
    const ca = await logado(a.userId);
    const r = await ca.put(`/api/avatares/${b.houseId}`, { config: { pele: 'pele.1' } });
    expect(r.status).toBe(403);
    const r2 = await ca.put('/api/avatar/eu', { houseId: b.houseId, house_id: b.houseId, config: { pele: 'pele.6' } });
    expect(r2.status).toBe(200);
    expect(r2.json.houseId).toBe(a.houseId);
    const cfgB = await q1<{ config: any }>(`select config from avatars where house_id = $1 and ativo`, [b.houseId]);
    expect(cfgB!.config.pele).toBe('pele.3');   // padrão intacto
    // sem login também não
    const anon = await (await import('./ajuda')).cliente(); await anon.aquecer();
    expect((await anon.req('PUT', '/api/avatar/eu', { config: { pele: 'pele.1' } })).status).toBe(401);
  });

  it('não equipa item inexistente, de slot errado nem item pago fora do inventário (cliente não concede cosmético)', async () => {
    const m = await moradorTeste(VITORIA); const c = await logado(m.userId);
    expect((await c.put('/api/avatar/eu', { config: { cabelo: 'cabelo.moicano_dourado' } })).status).toBe(400);
    expect((await c.put('/api/avatar/eu', { config: { cabelo: 'roupa.vestido' } })).status).toBe(400);
    await q(`insert into avatar_catalog (item_id, slot, nome, gratuito) values ('acessorio.coroa', 'acessorio', 'coroa', false) on conflict do nothing`);
    const pago = await c.put('/api/avatar/eu', { config: { acessorio: 'acessorio.coroa' } });
    expect(pago.status).toBe(403);
    // tentar "se dar" o item pelo corpo não funciona
    expect((await c.put('/api/avatar/eu', { config: { acessorio: 'acessorio.coroa' }, inventario: ['acessorio.coroa'] })).status).toBe(403);
    expect((await q1<{ n: number }>(`select count(*)::int n from user_inventory where user_id = $1`, [m.userId]))!.n).toBe(0);
    // concedido pelo servidor (ledger/loja), aí equipa
    await q(`insert into user_inventory (user_id, item_id, origem) values ($1, 'acessorio.coroa', 'teste')`, [m.userId]);
    expect((await c.put('/api/avatar/eu', { config: { acessorio: 'acessorio.coroa' } })).status).toBe(200);
    const cfg = await q1<{ config: any }>(`select config from avatars where house_id = $1 and ativo`, [m.houseId]);
    expect(cfg!.config.acessorio).toBe('acessorio.coroa');
    // item desativado no catálogo deixa de ser aceito
    await q(`update avatar_catalog set ativo = false where item_id = 'cabelo.coque'`);
    expect((await c.put('/api/avatar/eu', { config: { cabelo: 'cabelo.coque' } })).status).toBe(400);
    await q(`update avatar_catalog set ativo = true where item_id = 'cabelo.coque'`);
  });

  it('só edita depois de reivindicar; versão desatualizada é recusada', async () => {
    const m = await moradorTeste(VITORIA);
    await q(`update houses set status = 'reservada', reivindicada_em = null where id = $1`, [m.houseId]);
    const c = await logado(m.userId);
    const eu = await c.get('/api/avatar/eu');
    expect(eu.json).toMatchObject({ ok: true, editavel: false });
    expect((await c.put('/api/avatar/eu', { config: { pele: 'pele.2' } })).status).toBe(403);
    await q(`update houses set status = 'reivindicada', reivindicada_em = now() where id = $1`, [m.houseId]);
    const v = (await c.get('/api/avatar/eu')).json.versao;
    expect((await c.put('/api/avatar/eu', { config: { pele: 'pele.2' }, versao: v })).status).toBe(200);
    expect((await c.put('/api/avatar/eu', { config: { pele: 'pele.4' }, versao: v })).status).toBe(409);
  });

  it('catálogo marca o que a pessoa possui', async () => {
    const m = await moradorTeste(VITORIA); const c = await logado(m.userId);
    const r = await c.get('/api/avatar/catalogo');
    const coroa = r.json.itens.find((i: any) => i.id === 'acessorio.coroa');
    expect(coroa).toMatchObject({ gratuito: false, possui: false });
    expect(r.json.itens.filter((i: any) => i.slot === 'pele').length).toBeGreaterThanOrEqual(6);
  });
});
