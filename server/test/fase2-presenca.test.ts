import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo } from './ajuda';
import { moradorTeste } from './fixtures';
import { fecharDb, q, q1 } from '../src/db/db';
import { expirarPresencas } from '../src/modulos/social/presenca';
import { logado, VITORIA } from './fase2-ajuda';

beforeAll(bancoLimpo);
afterAll(fecharDb);

async function praca(c: Awaited<ReturnType<typeof logado>>, ibge = VITORIA) {
  const d = await c.get(`/api/cidades/${ibge}/destinos`);
  return d.json.destinos.find((x: any) => x.tipo === 'city_square');
}

describe('fase 2 · presença', () => {
  it('duas abas não criam duas presenças nem dois avatares', async () => {
    const m = await moradorTeste(VITORIA);
    const aba1 = await logado(m.userId), aba2 = await logado(m.userId);   // duas sessões/abas do mesmo usuário
    const [h1, h2] = await Promise.all([aba1.post('/api/presenca/heartbeat', { aba: 'A' }), aba2.post('/api/presenca/heartbeat', { aba: 'B' })]);
    expect(h1.status).toBe(200); expect(h2.status).toBe(200);
    expect((await q1<{ n: number }>(`select count(*)::int n from presence_sessions where user_id = $1`, [m.userId]))!.n).toBe(1);
    const p = await praca(aba1);
    // as duas abas entram ao mesmo tempo, em lugares diferentes ou no mesmo: sempre um único slot
    const [e1, e2] = await Promise.all([aba1.post(`/api/destinos/${p.id}/entrar`, {}), aba2.post(`/api/destinos/${p.id}/entrar`, {})]);
    expect(e1.json.ok && e2.json.ok).toBe(true);
    expect(e1.json.slot).toBe(e2.json.slot);
    expect((await q1<{ n: number }>(`select count(*)::int n from location_slots where user_id = $1`, [m.userId]))!.n).toBe(1);
    const sala = await aba1.get(`/api/destinos/salas/${e1.json.instancia.id}`);
    expect(sala.json.presentes.filter((x: any) => x.userId === m.userId).length).toBe(1);
    // aba 2 vai para a rua: a localização autoritativa muda, não duplica
    const rua = (await aba2.get(`/api/cidades/${VITORIA}/destinos`)).json.destinos.find((x: any) => x.tipo === 'street');
    const e3 = await aba2.post(`/api/destinos/${rua.id}/entrar`, {});
    expect(e3.json.ok).toBe(true);
    expect((await q1<{ n: number }>(`select count(*)::int n from location_slots where user_id = $1`, [m.userId]))!.n).toBe(1);
    expect((await q1<{ location_id: string }>(`select location_id from presence_sessions where user_id = $1`, [m.userId]))!.location_id).toBe(rua.id);
    const hb = await aba1.post('/api/presenca/heartbeat', { aba: 'A' });
    expect(hb.json.local.destinoId).toBe(rua.id);
  });

  it('desconexão expira: sem heartbeat a presença some e o slot é liberado', async () => {
    const m = await moradorTeste(VITORIA), outro = await moradorTeste(VITORIA);
    const c = await logado(m.userId), co = await logado(outro.userId);
    const p = await praca(c);
    const e = await c.post(`/api/destinos/${p.id}/entrar`, {});
    expect(e.json.ok).toBe(true);
    expect((await co.get(`/api/presenca/${m.userId}`)).json.estado).toBe('online');
    // simula 90 s sem heartbeat (aba fechada / rede caiu)
    await q(`update presence_sessions set expira_em = now() - interval '1 second' where user_id = $1`, [m.userId]);
    expect((await co.get(`/api/presenca/${m.userId}`)).json.estado).toBe('offline');
    const sala = await co.get(`/api/destinos/salas/${e.json.instancia.id}`);
    expect(sala.json.presentes.some((x: any) => x.userId === m.userId)).toBe(false);
    expect(await expirarPresencas()).toBeGreaterThanOrEqual(1);
    expect(await q1(`select 1 from location_slots where user_id = $1`, [m.userId])).toBeNull();
    expect(await q1(`select 1 from presence_sessions where user_id = $1`, [m.userId])).toBeNull();
    // a casa continua lá: presença não é inferida da casa nem a casa depende da presença
    expect((await q1<{ status: string }>(`select status from houses where id = $1`, [m.houseId]))!.status).toBe('reivindicada');
    // voltou: heartbeat abre sessão nova, sem lugar
    const hb = await c.post('/api/presenca/heartbeat', { aba: 'X' });
    expect(hb.json).toMatchObject({ estado: 'online', local: null, novaSessao: true });
  });

  it('sair limpa na hora, sem depender da expiração', async () => {
    const m = await moradorTeste(VITORIA); const c = await logado(m.userId);
    const p = await praca(c);
    await c.post(`/api/destinos/${p.id}/entrar`, {});
    await c.post('/api/destinos/sair');
    expect(await q1(`select 1 from location_slots where user_id = $1`, [m.userId])).toBeNull();
    expect((await q1<{ location_id: string | null }>(`select location_id from presence_sessions where user_id = $1`, [m.userId]))!.location_id).toBeNull();
    await c.post(`/api/destinos/${p.id}/entrar`, {});
    await c.post('/api/presenca/sair');
    expect(await q1(`select 1 from presence_sessions where user_id = $1`, [m.userId])).toBeNull();
    expect(await q1(`select 1 from location_slots where user_id = $1`, [m.userId])).toBeNull();
  });

  it('estados online/away/offline/invisible respeitam a preferência', async () => {
    const m = await moradorTeste(VITORIA), outro = await moradorTeste(VITORIA);
    const c = await logado(m.userId), co = await logado(outro.userId);
    await c.post('/api/presenca/heartbeat', { estado: 'away' });
    expect((await co.get(`/api/presenca/${m.userId}`)).json.estado).toBe('away');
    await c.put('/api/presenca/preferencia', { invisivel: true });
    expect((await c.post('/api/presenca/heartbeat', {})).json.estado).toBe('invisible');
    expect((await co.get(`/api/presenca/${m.userId}`)).json).toMatchObject({ estado: 'offline', local: null });
    expect((await c.get(`/api/presenca/${m.userId}`)).json.estado).toBe('invisible');
    // invisível ocupa slot mas não aparece para os outros
    const p = await praca(c);
    const e = await c.post(`/api/destinos/${p.id}/entrar`, {});
    const vistaOutro = await co.get(`/api/destinos/salas/${e.json.instancia.id}`);
    expect(vistaOutro.json.presentes.some((x: any) => x.userId === m.userId)).toBe(false);
    expect(vistaOutro.json.ocupados).toBeGreaterThanOrEqual(1);
    const minhaVista = await c.get(`/api/destinos/salas/${e.json.instancia.id}`);
    expect(minhaVista.json.presentes.some((x: any) => x.userId === m.userId && x.eu)).toBe(true);
    await c.put('/api/presenca/preferencia', { invisivel: false });
    await c.post('/api/presenca/heartbeat', {});
    expect((await co.get(`/api/presenca/${m.userId}`)).json.estado).toBe('online');
  });
});
