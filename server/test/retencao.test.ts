/* Retenção: baú diário com sequência, pet com fome/comida, chuva de baús das 20h e aviso de campainha. SINTÉTICO. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { fecharDb, q, q1, tx } from '../src/db/db';
import { habilitarMidia, novoId, payloadComentario } from './fase1-meta';
import { processarComentario } from '../src/modulos/instagram/processar';
import { concluirIdentidade } from '../src/modulos/identidade/reivindicacao';
import { sessaoTeste } from './fixtures';
import { abrirBau, estadoBau, humorPet, janelaChuva, pegarBau, alimentarPet, MAX_CHUVA_DIA, PREMIOS_BAU } from '../src/modulos/retencao';

beforeAll(async () => { await bancoLimpo(); await habilitarMidia(); });
afterAll(fecharDb);

const comentario = (o: Parameters<typeof payloadComentario>[0]) => {
  const p = payloadComentario(o); const e: any = p.entry[0];
  return { conta_id: e.id, field: 'comments', time: e.time, value: e.changes[0].value };
};
async function jogador(username: string) {
  const r = await processarComentario(comentario({ fromId: novoId('2400'), username, text: 'Recife - PE' }));
  const { userId } = await tx((c) => concluirIdentidade(c, r.identityId!, username));
  return userId;
}
const logado = async (userId: string) => { const c = cliente(); c.jar.set('smn_sess', await sessaoTeste(userId)); await c.aquecer(); return c; };
const dia = (d: string, h = 15) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00-03:00`);
const xp = async (u: string, origem: string) => (await q1<{ s: number }>(`select coalesce(sum(quantidade),0)::int s from reward_ledger where user_id = $1 and origem = $2`, [u, origem]))!.s;

describe('baú diário', () => {
  it('sequência de 7 dias com prêmios crescentes, 1 por dia, volta pro dia 1 quando pula', async () => {
    const u = await jogador('sintetico_bau');
    expect((await estadoBau(u, dia('2026-11-02'))).proximo).toBe(1);
    const a = await abrirBau(u, dia('2026-11-02'));
    expect(a).toMatchObject({ seq: 1, xp: PREMIOS_BAU[0] });
    await expect(abrirBau(u, dia('2026-11-02', 22))).rejects.toThrow(/já foi aberto/);
    for (let d = 3; d <= 8; d++) await abrirBau(u, dia(`2026-11-0${d}`));
    expect((await estadoBau(u, dia('2026-11-08'))).seq).toBe(7);
    expect(await xp(u, 'bau')).toBe(PREMIOS_BAU.reduce((s, x) => s + x, 0));
    // depois do dia 7 recomeça no 1; pulando um dia também
    expect((await abrirBau(u, dia('2026-11-09'))).seq).toBe(1);
    const st = await estadoBau(u, dia('2026-11-11'));
    expect(st).toMatchObject({ aberto: false, seq: 0, proximo: 1, perdeu: true });
    expect((await abrirBau(u, dia('2026-11-11'))).seq).toBe(1);
  });
  it('rota exige login e devolve o estado', async () => {
    const anon = cliente(); await anon.aquecer();
    expect((await anon.get('/api/bau-diario')).status).toBe(401);
    const c = await logado(await jogador('sintetico_bau2'));
    expect((await c.get('/api/bau-diario')).json).toMatchObject({ aberto: false, proximo: 1 });
    expect((await c.post('/api/bau-diario/abrir', {})).json).toMatchObject({ seq: 1, xp: 5 });
    expect((await c.post('/api/bau-diario/abrir', {})).status).toBe(409);
  });
});

describe('pet que sente falta', () => {
  it('humor por horas sem comida; comida 1x por dia dá +5 e deixa feliz; mapa mostra o humor', async () => {
    expect(humorPet(new Date(Date.now() - 3 * 3600_000))).toBe('feliz');
    expect(humorPet(new Date(Date.now() - 30 * 3600_000))).toBe('fome');
    expect(humorPet(new Date(Date.now() - 50 * 3600_000))).toBe('triste');
    const u = await jogador('sintetico_pet_fome');
    await expect(alimentarPet(u)).rejects.toThrow(/não tem pet/);
    await q(`insert into pets (user_id, especie, cor, nome, alimentado_em) values ($1, 'cachorro', 'caramelo', 'Rex', now() - interval '50 hours')`, [u]);
    const c = await logado(u);
    expect((await c.get('/api/pets/eu')).json.pet).toMatchObject({ nome: 'Rex', humor: 'triste', comeuHoje: false });
    const ibge = (await q1<{ ibge: number }>(`select p.ibge from houses h join plots p on p.id = h.plot_id where h.dono_user_id = $1`, [u]))!.ibge;
    expect((await c.get('/api/pets?ibge=' + ibge)).json.pets[0]).toMatchObject({ nome: 'Rex', humor: 'triste' });
    expect((await c.post('/api/pets/eu/alimentar', {})).json).toMatchObject({ humor: 'feliz', xp: 5 });
    expect((await c.post('/api/pets/eu/alimentar', {})).status).toBe(409);
    expect((await c.get('/api/pets/eu')).json.pet).toMatchObject({ humor: 'feliz', comeuHoje: true });
  });
});

describe('chuva de baús', () => {
  it('só das 20h às 20h15, até 5 por dia, cada baú uma vez', async () => {
    expect(janelaChuva(dia('2026-11-02', 19)).ativa).toBe(false);
    expect(janelaChuva(new Date('2026-11-02T20:10:00-03:00')).ativa).toBe(true);
    expect(janelaChuva(new Date('2026-11-02T20:16:00-03:00')).ativa).toBe(false);
    const u = await jogador('sintetico_chuva'), em = new Date('2026-11-02T20:05:00-03:00');
    await expect(pegarBau(u, 2611606, 0, dia('2026-11-02', 18))).rejects.toThrow(/20h/);
    await expect(pegarBau(u, 2611606, 99, em)).rejects.toThrow(/inválido/);
    expect(await pegarBau(u, 2611606, 0, em)).toMatchObject({ xp: 5, pegos: 1 });
    await expect(pegarBau(u, 2611606, 0, em)).rejects.toThrow(/já pegou esse/);
    for (let i = 1; i < MAX_CHUVA_DIA; i++) await pegarBau(u, 2611606, i, em);
    await expect(pegarBau(u, 2611606, 5, em)).rejects.toThrow(/já pegou 5/);
    // 1 minuto de tolerância depois de fechar
    expect((await pegarBau(u, 3550308, 0, new Date('2026-11-03T20:15:30-03:00'))).pegos).toBe(1);
    expect(await xp(u, 'chuva')).toBe(5 * (MAX_CHUVA_DIA + 1));
  });
});

describe('aviso de campainha', () => {
  it('tocar a campainha e curtir avisam o dono com o @ de quem visitou', async () => {
    const dono = await jogador('sintetico_dono_aviso'), vis = await jogador('sintetico_quem_toca');
    const v = await logado(vis), d = await logado(dono);
    await v.post('/api/casa-social/sintetico_dono_aviso/campainha', { adesivo: 'festa' });
    await v.post('/api/casa-social/sintetico_dono_aviso/curtir', {});
    const n = (await d.get('/api/notificacoes')).json;
    expect(n.naoLidas).toBe(2);
    expect(n.itens.map((x: any) => x.texto).join(' | ')).toMatch(/@sintetico_quem_toca deixou 🎉 na sua porta/);
    expect(n.itens[0]).toMatchObject({ tipo: 'visita', acao: 'u:sintetico_quem_toca' });
  });
});
