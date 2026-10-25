import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo } from './ajuda';
import { moradorTeste } from './fixtures';
import { fecharDb, q1 } from '../src/db/db';
import { moderarTexto } from '../src/modulos/social/moderacao';
import { logado, VITORIA } from './fase2-ajuda';

beforeAll(bancoLimpo);
afterAll(fecharDb);

describe('fase 2 · amizade, emotes, lembranças', () => {
  it('amizade precisa do aceite dos dois lados; recusar, remover e pedido cruzado', async () => {
    const a = await moradorTeste(VITORIA), b = await moradorTeste(VITORIA), d = await moradorTeste(VITORIA);
    const ca = await logado(a.userId), cb = await logado(b.userId), cd = await logado(d.userId);
    const p = await ca.post('/api/amigos/pedidos', { handle: '@' + b.handle });
    expect(p.json).toMatchObject({ ok: true, estado: 'pendente' });
    expect((await ca.get('/api/amigos')).json.amigos.length).toBe(0);
    expect((await ca.post(`/api/amigos/pedidos/${p.json.id}/aceitar`)).status).toBe(404);   // quem pediu não aceita o próprio pedido
    expect((await cb.get('/api/amigos')).json.recebidos.length).toBe(1);
    await cb.post(`/api/amigos/pedidos/${p.json.id}/aceitar`);
    const la = (await ca.get('/api/amigos')).json;
    expect(la.amigos.map((x: any) => x.userId)).toEqual([b.userId]);
    expect((await ca.post('/api/amigos/pedidos', { userId: b.userId })).json.estado).toBe('aceita');   // idempotente
    // recusa
    const p2 = await cd.post('/api/amigos/pedidos', { userId: a.userId });
    await ca.post(`/api/amigos/pedidos/${p2.json.id}/recusar`);
    expect((await cd.get('/api/amigos')).json.amigos.length).toBe(0);
    // pedido cruzado vira amizade
    const p3 = await cd.post('/api/amigos/pedidos', { userId: b.userId });
    const p4 = await cb.post('/api/amigos/pedidos', { userId: d.userId });
    expect(p4.json).toMatchObject({ id: p3.json.id, estado: 'aceita' });
    // remover
    await ca.post(`/api/amigos/${b.userId}/remover`);
    expect((await ca.get('/api/amigos')).json.amigos.length).toBe(0);
    expect((await ca.post('/api/amigos/pedidos', { userId: a.userId })).status).toBe(400);
  });

  it('bloqueio impede pedido de amizade e desfaz amizade', async () => {
    const a = await moradorTeste(VITORIA), b = await moradorTeste(VITORIA);
    const ca = await logado(a.userId), cb = await logado(b.userId);
    const p = await ca.post('/api/amigos/pedidos', { userId: b.userId });
    await cb.post(`/api/amigos/pedidos/${p.json.id}/aceitar`);
    await cb.post(`/api/amigos/${a.userId}/bloquear`);
    expect((await ca.get('/api/amigos')).json.amigos.length).toBe(0);
    expect((await ca.post('/api/amigos/pedidos', { userId: b.userId })).status).toBe(403);
    await cb.post(`/api/amigos/${a.userId}/desbloquear`);
    expect((await ca.post('/api/amigos/pedidos', { userId: b.userId })).status).toBe(200);
  });

  it('emotes só predefinidos, só dentro de um lugar, com limite; chat livre desligado', async () => {
    const a = await moradorTeste(VITORIA), b = await moradorTeste(VITORIA);
    const ca = await logado(a.userId), cb = await logado(b.userId);
    expect((await ca.get('/api/emotes')).json.emotes.length).toBeGreaterThanOrEqual(10);
    expect((await ca.post('/api/emotes', { emote: 'acenar' })).status).toBe(409);   // fora de um lugar
    const praca = (await ca.get(`/api/cidades/${VITORIA}/destinos`)).json.destinos.find((x: any) => x.tipo === 'city_square');
    const ea = await ca.post(`/api/destinos/${praca.id}/entrar`, {}); await cb.post(`/api/destinos/${praca.id}/entrar`, {});
    expect((await ca.post('/api/emotes', { emote: 'xingamento livre' })).status).toBe(400);
    const r = await ca.post('/api/emotes', { emote: 'acenar', alvoUserId: b.userId });
    expect(r.json).toMatchObject({ ok: true, emote: 'acenar', animacao: 'aceno' });
    for (let i = 0; i < 4; i++) expect((await ca.post('/api/emotes', { emote: 'oi' })).status).toBe(200);
    expect((await ca.post('/api/emotes', { emote: 'oi' })).status).toBe(429);
    const sala = await cb.get(`/api/destinos/salas/${ea.json.instancia.id}?desde=0`);
    expect(sala.json.emotes.length).toBe(5);
    expect(sala.json.emotes[0]).toMatchObject({ userId: a.userId, emote: 'acenar', alvoUserId: b.userId });
    const desde = sala.json.emotes[4].id;
    expect((await cb.get(`/api/destinos/salas/${ea.json.instancia.id}?desde=${desde}`)).json.emotes.length).toBe(0);
    const chat = await ca.post('/api/chat', { texto: 'oi' });
    expect(chat.status).toBe(403);
    expect((await q1<{ ligada: boolean }>(`select ligada from feature_flags where chave = 'chat_livre'`))!.ligada).toBe(false);
  });

  it('reações moderadas em casa e álbum de lembranças (guardar este momento, uma por lugar por dia)', async () => {
    const a = await moradorTeste(VITORIA), b = await moradorTeste(VITORIA);
    const ca = await logado(a.userId), cb = await logado(b.userId);
    const re = await cb.post('/api/reacoes', { alvoTipo: 'casa', alvoId: a.houseId, emote: 'coracao' });
    expect(re.json.reacoes).toEqual([{ emote: 'coracao', n: 1, minha: true }]);
    expect((await cb.post('/api/reacoes', { alvoTipo: 'casa', alvoId: a.houseId, emote: 'bem_vindo' })).status).toBe(400);   // frase não é reação
    expect((await cb.post('/api/reacoes', { alvoTipo: 'casa', alvoId: a.houseId, emote: 'coracao' })).json.reacoes[0].n).toBe(1);   // sem duplicar
    expect((await ca.post('/api/lembrancas', { titulo: 'tarde na praça' })).status).toBe(409);   // precisa estar num lugar
    const dest = (await cb.get(`/api/casas/${a.houseId}/destino`)).json.destino;
    await ca.post(`/api/destinos/${dest.id}/entrar`, {});
    const vis = await cb.post(`/api/destinos/${dest.id}/entrar`, {});
    expect(vis.json.ok).toBe(true);
    const g = await ca.post('/api/lembrancas', { titulo: 'visita do vizinho' });
    expect(g.status).toBe(200);
    expect((await ca.post('/api/lembrancas', { titulo: 'de novo' })).status).toBe(409);
    const la = (await ca.get('/api/lembrancas')).json.lembrancas;
    expect(la.find((l: any) => l.tipo === 'foto').dados.comQuem.length).toBe(1);
    const lb = (await cb.get('/api/lembrancas')).json.lembrancas;
    expect(lb.some((l: any) => l.tipo === 'visita')).toBe(true);    // visitar casa de outro gera lembrança
  });

  it('filtro de moderação recusa ofensa/link/telefone/@ e aceita nomes comuns', () => {
    for (const ok of ['Rua das Flores', 'Travessa Computação', 'Rua do Pintor', 'Beco dos Amigos 2']) expect(moderarTexto(ok, 'nome', 3, 40).ok).toBe(true);
    for (const ruim of ['p u t a', 'Rua F0d4', 'Rua @fulano', 'https://x.com', 'Rua 27 99999 0000', '!!!', 'ab']) expect(moderarTexto(ruim, 'nome', 3, 40).ok).toBe(false);
  });
});
