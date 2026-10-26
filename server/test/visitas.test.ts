/* Visita na casa: campainha com adesivo (1 por dia por visitante), curtir (1 vez), +1 XP pro dono com teto; online anônimo. SINTÉTICO. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { fecharDb, q, tx } from '../src/db/db';
import { habilitarMidia, novoId, payloadComentario } from './fase1-meta';
import { processarComentario } from '../src/modulos/instagram/processar';
import { concluirIdentidade } from '../src/modulos/identidade/reivindicacao';
import { sessaoTeste } from './fixtures';
import { pingOnline, MAX_XP_VISITA } from '../src/modulos/visitas';

beforeAll(async () => { await bancoLimpo(); await habilitarMidia(); });
afterAll(fecharDb);

const comentario = (o: Parameters<typeof payloadComentario>[0]) => {
  const p = payloadComentario(o); const e: any = p.entry[0];
  return { conta_id: e.id, field: 'comments', time: e.time, value: e.changes[0].value };
};
async function jogador(username: string, confirmar = true) {
  const r = await processarComentario(comentario({ fromId: novoId('2400'), username, text: 'Recife - PE' }));
  if (!confirmar) return { userId: '', username };
  const { userId } = await tx((c) => concluirIdentidade(c, r.identityId!, username));
  return { userId, username };
}
const logado = async (userId: string) => { const c = cliente(); c.jar.set('smn_sess', await sessaoTeste(userId)); await c.aquecer(); return c; };
const xpVisita = async (u: string) => (await q<{ s: number }>(`select coalesce(sum(quantidade),0)::int s from reward_ledger where user_id = $1 and origem = 'visita'`, [u]))[0].s;

describe('visita na casa', () => {
  it('campainha 1x/dia com adesivo, curtir 1x, dono ganha +1 XP cada; não dá na própria casa', async () => {
    const dono = await jogador('sintetico_dono_casa'), vis = await jogador('sintetico_visitante');
    const v = await logado(vis.userId), d = await logado(dono.userId);
    const anon = cliente(); await anon.aquecer();
    expect((await anon.post('/api/casa-social/sintetico_dono_casa/curtir', {})).status).toBe(401);
    const s0 = await anon.get('/api/casa-social/@Sintetico_Dono_Casa');
    expect(s0.json).toMatchObject({ ok: true, campainhaHoje: 0, curtidas: 0, eu: { tocouHoje: false, curtiu: false } });
    expect((await v.post('/api/casa-social/sintetico_dono_casa/campainha', { adesivo: 'xx' })).status).toBe(400);
    const t = await v.post('/api/casa-social/sintetico_dono_casa/campainha', { adesivo: 'coracao' });
    expect(t.status).toBe(200);
    expect(t.json).toMatchObject({ xpDono: 1, campainhaHoje: 1, adesivos: { coracao: 1 }, eu: { tocouHoje: true } });
    expect((await v.post('/api/casa-social/sintetico_dono_casa/campainha', { adesivo: 'fogo' })).status).toBe(409);
    const c = await v.post('/api/casa-social/sintetico_dono_casa/curtir', {});
    expect(c.json).toMatchObject({ curtidas: 1, eu: { curtiu: true } });
    expect((await v.post('/api/casa-social/sintetico_dono_casa/curtir', {})).status).toBe(409);
    expect((await d.post('/api/casa-social/sintetico_dono_casa/curtir', {})).status).toBe(409);
    expect((await d.get('/api/casa-social/sintetico_dono_casa')).json.casa.minha).toBe(true);
    expect(await xpVisita(dono.userId)).toBe(2);
    expect((await anon.get('/api/casa-social/ninguem_aqui_xyz')).status).toBe(404);
  });

  it('casa ainda não reivindicada recebe o toque mas ninguém ganha XP; teto diário de XP por visitas', async () => {
    const sem = await jogador('sintetico_sem_conta', false);
    const vis = await jogador('sintetico_visit2'); const v = await logado(vis.userId);
    const r = await v.post('/api/casa-social/sintetico_sem_conta/curtir', {});
    expect(r.json).toMatchObject({ xpDono: 0, curtidas: 1 });
    expect(sem.username).toBeTruthy();
    // teto: muitos visitantes num dia → no máximo MAX_XP_VISITA
    const dono = await jogador('sintetico_famoso');
    for (let i = 0; i < MAX_XP_VISITA + 3; i++) {
      const f = await jogador('sintetico_fa' + i); const c = await logado(f.userId);
      expect((await c.post('/api/casa-social/sintetico_famoso/curtir', {})).status).toBe(200);
    }
    expect(await xpVisita(dono.userId)).toBe(MAX_XP_VISITA);
  }, 60_000);

  it('online conta aparelhos anônimos na janela e ignora id inválido', async () => {
    const t = Date.now();
    const base = pingOnline('aaaaaaaaaaaaaaaaaaaa', t);
    expect(pingOnline('bbbbbbbbbbbbbbbbbbbb', t)).toBe(base + 1);
    expect(pingOnline('<script>', t)).toBe(base + 1);
    expect(pingOnline('cccccccccccccccccccc', t + 10 * 60_000)).toBe(1);
    const c = cliente(); await c.aquecer();
    expect((await c.post('/api/online', { v: 'dddddddddddddddddddd' })).json.online).toBeGreaterThanOrEqual(1);
  });
});
