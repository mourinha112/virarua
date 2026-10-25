/* Fase 1 · reivindicação: link de uso único (GET não consome; POST consome uma vez), desafio por código vinculado ao
   navegador, /api/eu e privacidade. Digitar @ nunca autentica. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { fecharDb, q, q1 } from '../src/db/db';
import { habilitarMidia, novoId, drenar, payloadComentario, CONTA } from './fase1-meta';
import { processarComentario } from '../src/modulos/instagram/processar';
import { aoEnvioDev } from '../src/modulos/instagram/provedor';

beforeAll(async () => { await bancoLimpo(); await habilitarMidia(); });
afterAll(fecharDb);

const comentario = (o: Parameters<typeof payloadComentario>[0]) => {
  const p = payloadComentario(o); const e: any = p.entry[0];
  return { conta_id: e.id, field: 'comments', time: e.time, value: e.changes[0].value };
};
/** comentário sintético → casa reservada → private reply (adaptador dev) → token capturado do texto que SERIA enviado */
async function casaComLink(cidade = 'Recife - PE', username = 'sintetico_' + novoId('')) {
  cliente(); const autor = novoId('2400'); let texto = '';
  const off = aoEnvioDev((m) => { texto = m.texto; });
  const r = await processarComentario(comentario({ fromId: autor, username, text: cidade })); await drenar(); off();
  const t = new URL(texto.match(/https?:\/\/\S+/)![0]).searchParams.get('t')!;
  return { autor, t, identityId: r.identityId!, houseId: r.houseId!, username };
}
async function navegador() { const c = cliente(); await c.aquecer(); return c; }

describe('fase1 · link de uso único', () => {
  it('GET só valida e devolve dados da tela; não consome (pré-visualizador de link)', async () => {
    const { t, identityId } = await casaComLink('Duque de Caxias - RJ', 'sintetico_preview');
    const c = await navegador();
    for (let i = 0; i < 3; i++) {
      const r = await c.get('/api/reivindicacao/link?t=' + encodeURIComponent(t));
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ ok: true, cidade: 'Duque de Caxias', uf: 'RJ', ibge: 3301702, usuario_instagram: 'sintetico_preview', status_casa: 'reservada' });
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    expect(await q1(`select count(*)::int n from identity_claims where identity_id = $1 and consumido_em is null`, [identityId])).toEqual({ n: 1 });
    expect((await c.get('/api/eu')).status).toBe(401);           // GET não autentica
  });

  it('POST confirma: consome, cria usuário, casa reivindicada, sessão e /api/eu', async () => {
    const { t, identityId, houseId } = await casaComLink('Recife - PE', 'sintetico_confirma');
    const c = await navegador();
    expect((await c.post('/api/reivindicacao/confirmar', { t, nome_publico: 'Ana Teste' })).status).toBe(400);      // sem aceite
    expect((await c.post('/api/reivindicacao/confirmar', { t, nome_publico: '<b>', aceite_regras: true })).status).toBe(400);
    const r = await c.post('/api/reivindicacao/confirmar', { t, nome_publico: 'Ana Teste', aceite_regras: true });
    expect(r.status).toBe(200); expect(r.json).toMatchObject({ ok: true, casa: 'reivindicada' });
    const h = await q1<any>(`select h.status, h.dono_user_id, h.expira_em, u.verificado_em, u.nome_publico from houses h join users u on u.id = h.dono_user_id where h.id = $1`, [houseId]);
    expect(h).toMatchObject({ status: 'reivindicada', expira_em: null, nome_publico: 'Ana Teste' }); expect(h.verificado_em).not.toBeNull();
    expect(await q1(`select estado from onboarding where identity_id = $1`, [identityId])).toEqual({ estado: 'claimed' });
    const eu = await c.get('/api/eu');
    expect(eu.status).toBe(200);
    expect(eu.json.usuario).toMatchObject({ nome_publico: 'Ana Teste', usuario_instagram: 'sintetico_confirma', mostrar_handle: true });
    expect(eu.json.casa).toMatchObject({ id: houseId, status: 'reivindicada', cidade: { ibge: 2611606, uf: 'PE' } });
    expect(eu.json.rua.nome).toMatch(/^Rua \d+$/);
    expect(eu.json.avatar.config.pele).toBeDefined();
    expect(await q1(`select consumido_por_sessao is not null s from identity_claims where identity_id = $1 and consumido_em is not null`, [identityId])).toEqual({ s: true });
    // token reutilizado (mesmo ou outro navegador) não autentica
    const outro = await navegador();
    expect((await outro.post('/api/reivindicacao/confirmar', { t, nome_publico: 'Invasor', aceite_regras: true })).status).toBe(410);
    expect((await outro.get('/api/eu')).status).toBe(401);
    expect((await outro.get('/api/reivindicacao/link?t=' + t)).status).toBe(410);
  });

  it('link expirado e token inventado não autenticam', async () => {
    const { t, identityId } = await casaComLink('Natal - RN');
    await q(`update identity_claims set expira_em = now() - interval '1 second' where identity_id = $1`, [identityId]);
    const c = await navegador();
    expect((await c.get('/api/reivindicacao/link?t=' + t)).status).toBe(410);
    expect((await c.post('/api/reivindicacao/confirmar', { t, nome_publico: 'Ana', aceite_regras: true })).status).toBe(410);
    expect((await c.post('/api/reivindicacao/confirmar', { t: 'x'.repeat(43), nome_publico: 'Ana', aceite_regras: true })).status).toBe(410);
    expect((await c.get('/api/eu')).status).toBe(401);
    expect(await q1(`select status from houses where dono_identity_id = $1`, [identityId])).toEqual({ status: 'reservada' });
  });

  it('dois POST simultâneos consomem uma única vez', async () => {
    const { t, identityId } = await casaComLink('Olinda - PE');
    const bs = await Promise.all([navegador(), navegador(), navegador(), navegador()]);
    const rs = await Promise.all(bs.map((b, i) => b.post('/api/reivindicacao/confirmar', { t, nome_publico: 'Pessoa ' + i, aceite_regras: true })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 410)).toHaveLength(3);
    expect(await q1(`select count(*)::int n from users u join external_identities e on e.user_id = u.id where e.id = $1`, [identityId])).toEqual({ n: 1 });
    expect(await q1(`select count(*)::int n from sessions s join external_identities e on e.user_id = s.user_id where e.id = $1`, [identityId])).toEqual({ n: 1 });
  });
});

describe('fase1 · desafio por código', () => {
  it('digitar @ nunca autentica', async () => {
    const { username } = await casaComLink('Caruaru - PE');
    const c = await navegador();
    const d = await c.post('/api/reivindicacao/desafio', { handle: '@' + username });
    expect(d.status).toBe(200); expect(d.json.codigo).toMatch(/^SMN-[A-HJ-NP-Z2-9]{10}$/);
    expect((await c.post('/api/reivindicacao/desafio/status', {})).json.estado).toBe('aguardando');
    expect((await c.post('/api/reivindicacao/desafio/status', { nome_publico: 'Eu Mesmo', aceite_regras: true })).json.estado).toBe('aguardando');
    expect((await c.get('/api/eu')).status).toBe(401);
  });

  it('código publicado pelo próprio autor conclui só no navegador com o cookie certo; código de outro navegador não autentica', async () => {
    const { autor, identityId, houseId } = await casaComLink('Maceió - AL', 'sintetico_desafio');
    const dono = await navegador();
    const { codigo } = (await dono.post('/api/reivindicacao/desafio', { handle: 'sintetico_desafio' })).json;
    // o autor publica o código (em minúsculas, com texto em volta) na mídia habilitada
    const r = await processarComentario(comentario({ fromId: autor, username: 'sintetico_desafio', text: `meu código ${codigo.toLowerCase()} :)` }));
    expect(r.estado).toBe('challenge');
    expect(await q1(`select count(*)::int n from houses where dono_identity_id = $1`, [identityId])).toEqual({ n: 1 });
    // outro navegador (atacante que viu o código público): sem o cookie, nada; com desafio próprio, nada
    const atacante = await navegador();
    expect((await atacante.post('/api/reivindicacao/desafio/status', { nome_publico: 'Invasor', aceite_regras: true })).json.estado).toBe('sem_desafio');
    await atacante.post('/api/reivindicacao/desafio', { handle: 'sintetico_desafio' });
    expect((await atacante.post('/api/reivindicacao/desafio/status', { nome_publico: 'Invasor', aceite_regras: true })).json.estado).toBe('aguardando');
    // cookie de outro navegador com o código certo no corpo também não serve (o código não é credencial do navegador)
    expect((await atacante.post('/api/reivindicacao/desafio/status', { codigo, nome_publico: 'Invasor', aceite_regras: true })).json.estado).toBe('aguardando');
    expect((await atacante.get('/api/eu')).status).toBe(401);
    // um terceiro republica o mesmo código depois: não muda a identidade verificada
    await processarComentario(comentario({ fromId: novoId('2400'), username: 'sintetico_copiao', text: codigo }));
    // o dono vê quem foi verificado e conclui
    const st = await dono.post('/api/reivindicacao/desafio/status', {});
    expect(st.json).toMatchObject({ estado: 'verificado', usuario_instagram: 'sintetico_desafio', cidade: 'Maceió' });
    const fim = await dono.post('/api/reivindicacao/desafio/status', { nome_publico: 'Dono Real', aceite_regras: true });
    expect(fim.json).toMatchObject({ estado: 'concluido' }); expect(fim.json.userId).toBeUndefined();
    const eu = await dono.get('/api/eu'); expect(eu.status).toBe(200); expect(eu.json.casa.id).toBe(houseId);
    // uso único: o desafio consumido não conclui de novo
    expect(await q1(`select count(*)::int n from claim_challenges where verificado_identity_id = $1 and consumido_em is null`, [identityId])).toEqual({ n: 0 });
  });

  it('código expirado não é verificado', async () => {
    const { autor } = await casaComLink('Aracaju - SE');
    const c = await navegador();
    const { codigo } = (await c.post('/api/reivindicacao/desafio', {})).json;
    await q(`update claim_challenges set expira_em = now() - interval '1 second'`);
    const r = await processarComentario(comentario({ fromId: autor, text: codigo }));
    expect(r.estado).not.toBe('challenge');
    expect((await c.post('/api/reivindicacao/desafio/status', { nome_publico: 'Ana', aceite_regras: true })).json.estado).toBe('expirado');
    expect((await c.get('/api/eu')).status).toBe(401);
  });
});

describe('fase1 · privacidade do titular', () => {
  it('ocultar @, exportar e remover dados (rotas autenticadas)', async () => {
    const { t, autor, identityId, houseId } = await casaComLink('Fortaleza - CE', 'sintetico_priv');
    const anon = await navegador();
    expect((await anon.post('/api/eu/privacidade', { mostrar_handle: false })).status).toBe(401);
    expect((await anon.get('/api/eu/dados')).status).toBe(401);
    expect((await anon.post('/api/eu/remover', { confirmar: 'REMOVER' })).status).toBe(401);
    const c = await navegador();
    await c.post('/api/reivindicacao/confirmar', { t, nome_publico: 'Priv Teste', aceite_regras: true });
    expect((await c.post('/api/eu/privacidade', { mostrar_handle: false })).json).toMatchObject({ ok: true, mostrar_handle: false });
    expect((await c.get('/api/eu')).json.usuario.mostrar_handle).toBe(false);
    const ex = await c.get('/api/eu/dados');
    expect(ex.status).toBe(200);
    expect(ex.headers.get('content-disposition')).toMatch(/attachment/);
    expect(ex.json.identidades[0]).toMatchObject({ provedor: 'instagram', username: 'sintetico_priv' });
    expect(ex.json.casas[0].id).toBe(houseId);
    expect(JSON.stringify(ex.json)).not.toMatch(/token_hash|token_cifrado/);
    expect((await c.post('/api/eu/remover', {})).status).toBe(400);
    expect((await c.post('/api/eu/remover', { confirmar: 'REMOVER' })).json).toMatchObject({ ok: true });
    expect((await c.get('/api/eu')).status).toBe(401);
    expect(await q1(`select status from houses where id = $1`, [houseId])).toEqual({ status: 'removida' });
    expect(await q1(`select username, revogado_em is not null r from external_identities where id = $1`, [identityId])).toEqual({ username: null, r: true });
    // novo comentário do mesmo autor não recria o perfil
    const r = await processarComentario(comentario({ fromId: autor, username: 'sintetico_priv', text: 'Fortaleza - CE' }));
    expect(r.estado).toBe('revoked');
    expect(await q1(`select count(*)::int n from houses where dono_identity_id = $1 and status in ('reservada','reivindicada')`, [identityId])).toEqual({ n: 0 });
    expect(await q1(`select count(*)::int n from external_identities where escopo = $1 and external_id = $2`, [CONTA(), autor])).toEqual({ n: 1 });
  });
});
