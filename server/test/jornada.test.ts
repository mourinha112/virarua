/* Jornada integrada (dados SINTÉTICOS): comentário assinado → casa pelo gerador atual → private reply (dev) →
   reivindicação → sessão → avatar → rua (com provedores de líder/competição/obra) → missões → eleições. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { payloadComentario, postarWebhook, habilitarMidia, drenar } from './fase1-meta';
import { aoEnvioDev } from '../src/modulos/instagram/provedor';
import { fecharDb, q1 } from '../src/db/db';

beforeAll(bancoLimpo);
afterAll(fecharDb);

describe('jornada integrada', () => {
  it('comentário → casa → reivindicação → avatar → rua → missões → eleições', async () => {
    await habilitarMidia();
    let texto = '';
    const parar = aoEnvioDev((m: any) => { texto = String(m?.texto ?? m?.text ?? JSON.stringify(m)); });
    const cli = cliente(); await cli.aquecer();
    const r = await postarWebhook(cli, payloadComentario({ text: 'Vila Velha - ES', username: 'sintetico_jornada', fromId: '24000000000000777' }));
    expect(r.status).toBe(200);
    await drenar();
    parar();

    const casa = await q1<{ status: string; lote_index: number; ibge: number }>(`select h.status, p.lote_index, p.ibge from houses h join plots p on p.id = h.plot_id join external_identities e on e.id = h.dono_identity_id where e.external_id = '24000000000000777'`);
    expect(casa).toMatchObject({ status: 'reservada', ibge: 3205200, lote_index: 0 });

    const t = /[?&]t=([A-Za-z0-9_-]+)/.exec(texto)?.[1];
    expect(t, 'o adaptador dev deve ter "enviado" o link').toBeTruthy();
    const nav = cliente(); await nav.aquecer();
    expect((await nav.get('/api/reivindicacao/link?t=' + t)).status).toBe(200);
    const conf = await nav.post('/api/reivindicacao/confirmar', { t, nome_publico: 'Jornada Teste', aceite_regras: true });
    expect(conf.json?.ok).toBe(true);
    expect((await nav.get('/api/sessao')).json.usuario?.nome).toBe('Jornada Teste');

    const av = await nav.get('/api/avatar/eu'); expect(av.json?.ok).toBe(true);
    const cfg = { ...av.json.avatar?.config ?? av.json.config, cabelo: 'cabelo.cacheado', cor_roupa: 'cor_roupa.verde' };
    const put = await nav.req('PUT', '/api/avatar/eu', { config: cfg });
    expect(put.json?.ok, JSON.stringify(put.json)).toBe(true);

    const rua = await nav.get('/api/ruas/minha'); expect(rua.json?.ok).toBe(true);
    const det = await nav.get('/api/ruas/' + (rua.json.rua?.id ?? rua.json.id));
    expect(det.json?.ok, JSON.stringify(det.json).slice(0, 300)).toBe(true);
    const txt = JSON.stringify(det.json);
    expect(txt).not.toMatch(/ainda não ligado/);         // provedores de competição/obra registrados pela integração

    expect((await nav.get('/api/missoes')).json?.ok).toBe(true);
    const el = await nav.get('/api/eleicoes'); expect(el.json?.ok).toBe(true);
    expect(el.json.selo).toMatch(/eleição virtual/);
  });
});
