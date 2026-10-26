/* Crescimento: pontos do Instagram (comentário, @amigo, @loja, amigo que ganhou a casa), ofensiva, guerra de cidades,
   caça ao tesouro, enfeites, missão de Natal e bônus do link de vizinho. Dados SINTÉTICOS. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { fecharDb, q, q1, tx } from '../src/db/db';
import { habilitarMidia, novoId, payloadComentario, CONTA } from './fase1-meta';
import { processarComentario } from '../src/modulos/instagram/processar';
import { concluirIdentidade } from '../src/modulos/identidade/reivindicacao';
import { moradorTeste, sessaoTeste } from './fixtures';
import { fazerMissao, semana, somaLedger } from './fase3-ajuda';
import { guerra } from '../src/modulos/crescimento';
import { missoesDoDia } from '../src/modulos/recompensas/missoes';
import { semanaJogo } from '../src/modulos/recompensas/regras';

beforeAll(async () => { await bancoLimpo(); await habilitarMidia(); });
afterAll(fecharDb);

const comentario = (o: Parameters<typeof payloadComentario>[0]) => {
  const p = payloadComentario(o); const e: any = p.entry[0];
  return { conta_id: e.id, field: 'comments', time: e.time, value: e.changes[0].value };
};
const regra = async (userId: string, r: string) => (await q<{ quantidade: number }>(`select quantidade from reward_ledger where user_id = $1 and regra_id = $2`, [userId, r])).map((x) => x.quantidade);
/** jogador que comentou a cidade e confirmou a casa (fluxo real) */
async function jogador(username: string, cidade = 'Recife - PE') {
  const fromId = novoId('2400');
  const r = await processarComentario(comentario({ fromId, username, text: cidade }));
  expect(r.estado).toBe('provisioned');
  const { userId } = await tx((c) => concluirIdentidade(c, r.identityId!, username));
  return { fromId, userId, identityId: r.identityId!, username };
}
const logado = async (userId: string) => { const c = cliente(); c.jar.set('smn_sess', await sessaoTeste(userId)); await c.aquecer(); return c; };

describe('pontos do Instagram', () => {
  it('comentar dá +5 por post/dia; cada @amigo +5 (até 3/dia); amigo que ganha e confirma a casa dá +50 a quem marcou primeiro', async () => {
    const a = await jogador('sintetico_marcador');
    const r = await processarComentario(comentario({ fromId: a.fromId, username: a.username, text: 'bora @Sintetico_Amigo1 @sintetico_amigo2 @sintetico_amigo3 @sintetico_amigo4 @viraruajogo' }));
    expect(r.estado).toBe('duplicate');   // já tinha casa: o comentário não muda a residência
    expect(await regra(a.userId, 'xp5_comentario@1')).toEqual([5]);
    expect((await regra(a.userId, 'xp5_marcar@1')).length).toBe(3);
    // outro comentário no mesmo post e dia: não paga comentário de novo nem passa do teto de marcações
    await processarComentario(comentario({ fromId: a.fromId, username: a.username, text: '@sintetico_amigo5' }));
    expect(await regra(a.userId, 'xp5_comentario@1')).toEqual([5]);
    expect((await regra(a.userId, 'xp5_marcar@1')).length).toBe(3);
    expect(await q1<{ n: number }>(`select count(*)::int n from ig_indicacoes where autor_external_id = $1`, [a.fromId])).toEqual({ n: 5 });

    // outra pessoa marca o mesmo amigo depois: quem vale é o primeiro
    const b = await jogador('sintetico_segundo');
    await processarComentario(comentario({ fromId: b.fromId, username: b.username, text: '@sintetico_amigo1' }));

    // o amigo comenta a cidade e confirma a casa → +50 para o primeiro que marcou
    const amigo = await jogador('sintetico_amigo1', 'Olinda - PE');
    expect(await regra(a.userId, 'xp50_amigo@1')).toEqual([50]);
    expect(await regra(b.userId, 'xp50_amigo@1')).toEqual([]);
    // confirmar de novo não paga de novo
    await tx((c) => concluirIdentidade(c, amigo.identityId, 'x'));
    expect(await regra(a.userId, 'xp50_amigo@1')).toEqual([50]);

    // quem já tinha casa antes de ser marcado não conta como indicação
    const velho = await jogador('sintetico_veterano');
    await processarComentario(comentario({ fromId: a.fromId, username: a.username, text: '@sintetico_veterano', mediaId: '18000000000000001' }));
    await tx((c) => concluirIdentidade(c, velho.identityId, 'x'));
    expect(await regra(a.userId, 'xp50_amigo@1')).toEqual([50]);
  });

  it('quem marca sem ter conta recebe os +50 quando confirmar a casa depois', async () => {
    const fromId = novoId('2400');
    const r = await processarComentario(comentario({ fromId, username: 'sintetico_semconta', text: 'Recife - PE @sintetico_novato' }));
    expect(r.estado).toBe('provisioned');
    await jogador('sintetico_novato', 'Caruaru - PE');
    const { userId } = await tx((c) => concluirIdentidade(c, r.identityId!, 'semconta'));
    expect(await regra(userId, 'xp50_amigo@1')).toEqual([50]);
  });

  it('API meus pontos mostra fontes e amigos', async () => {
    const a = await jogador('sintetico_api');
    await processarComentario(comentario({ fromId: a.fromId, username: a.username, text: '@sintetico_xyz' }));
    const c = await logado(a.userId);
    const r = await c.get('/api/pontos/eu');
    expect(r.status).toBe(200);
    expect(r.json.amigos).toEqual([{ amigo: 'sintetico_xyz', estado: 'esperando' }]);
    expect(r.json.fontes.map((f: any) => f.fonte).sort()).toEqual(['comentario', 'marcar']);
  });
});

describe('ofensiva', () => {
  it('3 dias seguidos de missão pagam +10 uma vez; a sequência aparece em /api/decor/eu', async () => {
    const m = await moradorTeste(2611606);
    for (let d = 0; d < 3; d++) await fazerMissao(m.userId, 'desafio.curto', semana(40, d));
    expect(await regra(m.userId, 'xp10_ofensiva@1')).toEqual([10]);
    await fazerMissao(m.userId, 'quiz.jogo', semana(40, 2));   // segunda missão no mesmo dia não paga de novo
    expect(await regra(m.userId, 'xp10_ofensiva@1')).toEqual([10]);
  });
});

describe('guerra de cidades', () => {
  it('placar soma casas novas e XP da semana; ultrapassagem vira evento', async () => {
    const s = semanaJogo();
    const a = await moradorTeste(3550308), b = await moradorTeste(3304557);   // São Paulo, Rio
    await q(`insert into reward_ledger (user_id, sistema, regra_id, evento_ref, chave, quantidade, pedida, dia, origem) values ($1, 'xp', 'xp10@1', 'g1', $2, 30, 30, $3, 'evento')`, [a.userId, 'g1|' + a.userId, s]);
    const g1 = await guerra(true);
    const pos = (ibge: number, g = g1) => g.cidades.findIndex((x) => x.ibge === ibge);
    expect(pos(3550308)).toBeLessThan(pos(3304557));
    await q(`insert into reward_ledger (user_id, sistema, regra_id, evento_ref, chave, quantidade, pedida, dia, origem) values ($1, 'xp', 'xp10@1', 'g2', $2, 90, 90, $3, 'evento')`, [b.userId, 'g2|' + b.userId, s]);
    const g2 = await guerra(true);
    expect(pos(3304557, g2)).toBeLessThan(pos(3550308, g2));
    expect(await q1(`select 1 from city_war_events where tipo = 'cidade' and chave = '3304557' and passou = '3550308'`)).toBeTruthy();
    const r = await cliente().get('/api/guerra?ibge=3550308');
    expect(r.status).toBe(200);
    expect(r.json.minha.falta).toBeGreaterThan(0);
    expect(r.json.estados.length).toBeGreaterThan(0);
  });
});

describe('caça ao tesouro', () => {
  it('cavar errado diz quente/frio; certo paga 50 ao 1º e 20 ao 2º; 5 pás por dia', async () => {
    const t = await cliente().get('/api/tesouro');
    expect(t.status).toBe(200);
    expect(t.json.dicas.length).toBeGreaterThanOrEqual(1);
    expect(t.json.cidade).toBeUndefined();   // não vaza a cidade
    const alvo = (await q1<{ ibge: number }>(`select ibge from treasure_hunts where semana = $1`, [semanaJogo()]))!.ibge;
    const errada = (await q1<{ ibge: number }>(`select ibge from municipios where ibge <> $1 order by ibge limit 1`, [alvo]))!.ibge;
    const p1 = await moradorTeste(2611606), p2 = await moradorTeste(2611606);
    const c1 = await logado(p1.userId), c2 = await logado(p2.userId);
    const e = await c1.post('/api/tesouro/cavar', { ibge: errada });
    expect(e.status).toBe(200);
    expect(e.json.km).toBeGreaterThan(0);
    expect(['fervendo', 'quente', 'morno', 'frio']).toContain(e.json.calor);
    const ok = await c1.post('/api/tesouro/cavar', { ibge: alvo });
    expect(ok.json.premio).toEqual({ ordem: 1, xp: 50 });
    expect((await c1.post('/api/tesouro/cavar', { ibge: alvo })).status).toBe(409);
    expect((await c2.post('/api/tesouro/cavar', { ibge: alvo })).json.premio).toEqual({ ordem: 2, xp: 20 });
    const p3 = await moradorTeste(2611606), c3 = await logado(p3.userId);
    for (let i = 0; i < 5; i++) expect((await c3.post('/api/tesouro/cavar', { ibge: errada })).status).toBe(200);
    expect((await c3.post('/api/tesouro/cavar', { ibge: errada })).status).toBe(429);
    const eu = await c1.get('/api/tesouro');
    expect(eu.json.eu.achou).toBe(true);
    expect(eu.json.achados.length).toBe(2);
  });
});

describe('enfeites', () => {
  it('só libera com XP; aparece no mapa público', async () => {
    const m = await moradorTeste(2607901);
    const c = await logado(m.userId);
    expect((await c.post('/api/decor/eu', { itens: ['horta'] })).status).toBe(403);
    await q(`insert into reward_ledger (user_id, sistema, regra_id, evento_ref, chave, quantidade, pedida, dia, origem) values ($1, 'xp', 'xp10@1', 'd1', $2, 45, 45, current_date, 'evento')`, [m.userId, 'd1|' + m.userId]);
    expect((await c.post('/api/decor/eu', { itens: ['horta', 'bandeira'], bandeira: '#ff0000-#000000' })).status).toBe(200);
    expect((await c.post('/api/decor/eu', { itens: ['piscina'] })).status).toBe(403);
    const eu = await c.get('/api/decor/eu');
    expect(eu.json.escolhidos).toEqual(['horta', 'bandeira']);
    const mapa = await cliente().get('/api/enfeites?ibge=2607901');
    expect(mapa.json.casas).toContainEqual(expect.objectContaining({ itens: ['horta', 'bandeira'], bandeira: '#ff0000-#000000' }));
  });
});

describe('Natal e link de vizinho', () => {
  it('missão de Natal só aparece de 1/12 a 6/1', async () => {
    const m = await moradorTeste(2611606);
    const ids = async (d: string) => (await tx((c) => missoesDoDia(c, m.userId, new Date(d + 'T15:00:00Z')))).missoes.map((x: any) => x.id);
    expect(await ids('2026-11-20')).not.toContain('natal.presente');
    expect(await ids('2026-12-10')).toContain('natal.presente');
    expect(await ids('2027-01-07')).not.toContain('natal.presente');
  });

  it('quem chama vizinho novo pelo link ganha +20 XP', async () => {
    const dono = await moradorTeste(2611606);
    const cd = await logado(dono.userId);
    const conv = await cd.post('/api/convites', { tipo: 'rua', ruaId: dono.streetId });
    expect(conv.status).toBe(200);
    const novo = await moradorTeste(2611606);
    const cn = await logado(novo.userId);
    const ac = await cn.post(`/api/convites/${encodeURIComponent(conv.json.convite.codigo)}/aceitar`);
    expect(ac.status).toBe(200);
    expect(await regra(dono.userId, 'xp20_vizinho@1')).toEqual([20]);
    expect(await somaLedger(dono.userId, 'xp')).toBe(20);
  });
});
