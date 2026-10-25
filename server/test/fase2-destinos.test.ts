import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo } from './ajuda';
import { moradorTeste } from './fixtures';
import { fecharDb, db, q, q1 } from '../src/db/db';
import { garantirLocation } from '../src/modulos/social/destinos';
import { logado, ruaDe, invariantes, VITORIA, CAXIAS, RECIFE } from './fase2-ajuda';

beforeAll(bancoLimpo);
afterAll(fecharDb);

describe('fase 2 · destinos, salas e slots', () => {
  it('sala cheia abre outra instância; acabando as instâncias devolve alternativas (sem sobrepor ninguém)', async () => {
    const ms = await Promise.all(Array.from({ length: 5 }, () => moradorTeste(VITORIA)));
    const cs = await Promise.all(ms.map((m) => logado(m.userId)));
    await cs[0].get(`/api/cidades/${VITORIA}/destinos`);   // garante a praça (alternativa)
    const cafe = await garantirLocation(db(), 'venue', 'cafe-teste-1', VITORIA, 'Café Sintético', 2, 2);
    const rs = await Promise.all(cs.map((c) => c.post(`/api/destinos/${cafe.id}/entrar`, {})));
    const ok = rs.filter((r) => r.json.ok), cheio = rs.filter((r) => !r.json.ok);
    expect(ok.length).toBe(4);
    expect(cheio.length).toBe(1);
    expect(cheio[0].status).toBe(409);
    expect(cheio[0].json.motivo).toBe('cheio');
    expect(cheio[0].json.alternativas.some((a: any) => a.tipo === 'city_square')).toBe(true);
    const salas = new Set(ok.map((r) => r.json.instancia.id));
    expect(salas.size).toBe(2);
    const pares = ok.map((r) => r.json.instancia.id + ':' + r.json.slot);
    expect(new Set(pares).size).toBe(4);                       // ninguém no mesmo slot
    const n = await q1<{ n: number }>(`select count(*)::int n from location_instances where location_id = $1`, [cafe.id]);
    expect(n!.n).toBe(2);
    // alguém sai → a vaga volta a ser usada
    await cs[rs.indexOf(ok[0])].post('/api/destinos/sair');
    const de = await cs[rs.indexOf(cheio[0])].post(`/api/destinos/${cafe.id}/entrar`, {});
    expect(de.json.ok).toBe(true);
  });

  it('escolher um slot ocupado devolve os livres; slot livre é ocupado na hora', async () => {
    const a = await moradorTeste(VITORIA), b = await moradorTeste(VITORIA);
    const ca = await logado(a.userId), cb = await logado(b.userId);
    const mesa = await garantirLocation(db(), 'venue', 'mesa-teste', VITORIA, 'Mesas da praça', 4, 1);
    const ea = await ca.post(`/api/destinos/${mesa.id}/entrar`, {});
    const r = await cb.post(`/api/destinos/${mesa.id}/entrar`, { instanciaId: ea.json.instancia.id, slot: ea.json.slot });
    expect(r.status).toBe(409);
    expect(r.json.motivo).toBe('slot_ocupado');
    expect(r.json.slotsLivres.length).toBe(3);
    const r2 = await cb.post(`/api/destinos/${mesa.id}/entrar`, { instanciaId: ea.json.instancia.id, slot: r.json.slotsLivres[1] });
    expect(r2.json.ok).toBe(true);
    expect(r2.json.slot).toBe(r.json.slotsLivres[1]);
    expect(r2.json.presentes.length).toBe(2);
  });

  it('30 pessoas entrando ao mesmo tempo: slots únicos e nenhum usuário em dois lugares', async () => {
    const ms = await Promise.all(Array.from({ length: 30 }, () => moradorTeste(CAXIAS)));
    const cs = await Promise.all(ms.map((m) => logado(m.userId)));
    const ev = await garantirLocation(db(), 'event', 'evento-teste', CAXIAS, 'Festa sintética', 8, 3);
    const rs = await Promise.all(cs.map((c) => c.post(`/api/destinos/${ev.id}/entrar`, {})));
    expect(rs.filter((r) => r.json.ok).length).toBe(24);
    expect(rs.filter((r) => r.json.motivo === 'cheio').length).toBe(6);
    const dup = await q1(`select instance_id, slot from location_slots where user_id is not null group by instance_id, slot having count(*) > 1`);
    expect(dup).toBeNull();
    const porUser = await q1(`select user_id from location_slots where user_id is not null group by user_id having count(*) > 1`);
    expect(porUser).toBeNull();
  });

  it('visitar outra cidade (Recife) não muda residência, rua, lote nem casa de Caxias', async () => {
    const m = await moradorTeste(CAXIAS);
    const antes = await q1(`select h.plot_id, p.ibge, p.lote_index from houses h join plots p on p.id = h.plot_id where h.id = $1`, [m.houseId]);
    const ruaAntes = await ruaDe(m.houseId);
    const c = await logado(m.userId);
    const d = await c.get(`/api/cidades/${RECIFE}/destinos`);
    const praca = d.json.destinos.find((x: any) => x.tipo === 'city_square');
    const e = await c.post(`/api/destinos/${praca.id}/entrar`, {});
    expect(e.json.ok).toBe(true);
    expect(e.json.destino.ibge).toBe(RECIFE);
    const depois = await q1(`select h.plot_id, p.ibge, p.lote_index from houses h join plots p on p.id = h.plot_id where h.id = $1`, [m.houseId]);
    expect(depois).toEqual(antes);
    expect((depois as any).ibge).toBe(CAXIAS);
    expect(await ruaDe(m.houseId)).toBe(ruaAntes);
    expect((await q1<{ n: number }>(`select count(*)::int n from street_memberships where house_id = $1`, [m.houseId]))!.n).toBe(1);
    // a visita vira carimbo no passaporte (lembrança), não residência
    const lem = await c.get('/api/lembrancas');
    expect(lem.json.lembrancas.some((l: any) => l.tipo === 'praca' && l.ibge === RECIFE)).toBe(true);
    await invariantes([m.houseId]);
  });

  it('casa respeita a privacidade de visita (amigos/privada) e convite de visita libera', async () => {
    const dono = await moradorTeste(VITORIA), vis = await moradorTeste(VITORIA);
    await q(`insert into privacy_preferences (user_id, visita) values ($1, 'privada') on conflict (user_id) do update set visita = 'privada'`, [dono.userId]);
    const cd = await logado(dono.userId), cv = await logado(vis.userId);
    const dest = (await cv.get(`/api/casas/${dono.houseId}/destino`)).json.destino;
    expect((await cv.post(`/api/destinos/${dest.id}/entrar`, {})).status).toBe(403);
    expect((await cd.post(`/api/destinos/${dest.id}/entrar`, {})).json.ok).toBe(true);   // o dono sempre entra
    const conv = await cd.post('/api/convites', { tipo: 'visita', destinoId: dest.id, paraUserId: vis.userId });
    expect(conv.status).toBe(200);
    const ac = await cv.post(`/api/convites/${conv.json.convite.codigo}/aceitar`);
    expect(ac.json).toMatchObject({ ok: true, tipo: 'visita', destinoId: dest.id });
    const e = await cv.post(`/api/destinos/${dest.id}/entrar`, {});
    expect(e.json.ok).toBe(true);
    expect(e.json.presentes.length).toBe(2);
    // amigos: sem amizade não entra; com amizade entra
    const tercei = await moradorTeste(VITORIA); const ct = await logado(tercei.userId);
    await q(`update privacy_preferences set visita = 'amigos' where user_id = $1`, [dono.userId]);
    expect((await ct.post(`/api/destinos/${dest.id}/entrar`, {})).status).toBe(403);
    const ped = await ct.post('/api/amigos/pedidos', { userId: dono.userId });
    await cd.post(`/api/amigos/pedidos/${ped.json.id}/aceitar`);
    expect((await ct.post(`/api/destinos/${dest.id}/entrar`, {})).json.ok).toBe(true);
  });
});
