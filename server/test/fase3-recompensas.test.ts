/* Fase 3 · recompensas, missões, obra e competição (banco real smn_test). */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { moradorTeste, sessaoTeste } from './fixtures';
import { fecharDb, q, q1, tx } from '../src/db/db';
import { resposta, mais, semana, ruaCom, mudarDeRua, somaLedger, fazerMissao } from './fase3-ajuda';
import { conceder } from '../src/modulos/recompensas/ledger';
import { garantirTemporada, competicaoDaRua, apurarTemporada } from '../src/modulos/recompensas/competicao';
import { contribuirObra, obraParaUI } from '../src/modulos/recompensas/obras';
import { emitirDesafio, verificarDesafio } from '../src/modulos/recompensas/desafios';

beforeAll(bancoLimpo);
afterAll(fecharDb);

describe('fase 3 · missões e ledger', () => {
  it('missão reexecutada não multiplica recompensa (HTTP, prova do servidor, pontos do cliente ignorados)', async () => {
    const m = await moradorTeste(3205309);
    const c = cliente(); c.jar.set('smn_sess', await sessaoTeste(m.userId)); await c.aquecer();
    const lista = await c.get('/api/missoes');
    expect(lista.status).toBe(200);
    expect(lista.json.missoes.map((x: any) => x.id)).toEqual(['obra.etapa', 'desafio.curto', 'atividade.praca']);

    const d = await c.post('/api/missoes/desafio.curto/desafio');
    expect(d.status).toBe(200); expect(d.json.desafio.enunciado.pergunta).toMatch(/quanto é/);
    expect(JSON.stringify(d.json)).not.toContain('gabarito');
    // resposta instantânea é recusada (não basta "aba aberta"/bot)
    const rapido = await c.post('/api/missoes/desafio.curto/concluir', { desafio_id: d.json.desafio.id, resposta: await resposta(d.json.desafio.id) });
    expect(rapido.status).toBe(422);
    await q(`update server_challenges set criado_em = criado_em - interval '10 seconds' where id = $1`, [d.json.desafio.id]);
    const ok = await c.post('/api/missoes/desafio.curto/concluir', { desafio_id: d.json.desafio.id, resposta: await resposta(d.json.desafio.id), pontos: 9999, xp: 9999 });
    expect(ok.status).toBe(200);
    expect(ok.json.recompensas).toEqual([{ sistema: 'xp', quantidade: 5, limitado: false }, { sistema: 'contribuicao', quantidade: 10, limitado: false }]);

    // reexecutar: mesmo desafio, novo desafio e chamadas concorrentes não pagam de novo
    const de_novo = await c.post('/api/missoes/desafio.curto/concluir', { desafio_id: d.json.desafio.id, resposta: await resposta(d.json.desafio.id) });
    expect(de_novo.json.ja_concluida).toBe(true);
    expect((await c.post('/api/missoes/desafio.curto/desafio')).status).toBe(409);
    await Promise.all([1, 2, 3].map(() => c.post('/api/missoes/desafio.curto/concluir', { desafio_id: d.json.desafio.id, resposta: 1 })));
    expect(await somaLedger(m.userId, 'xp')).toBe(5);
    expect(await somaLedger(m.userId, 'contribuicao')).toBe(10);
    expect((await q1<{ n: number }>(`select count(*)::int n from mission_completions where user_id = $1`, [m.userId]))!.n).toBe(1);
    expect((await q1<{ xp: number }>(`select xp from houses where id = $1`, [m.houseId]))!.xp).toBe(5);
  });

  it('erro de resposta é contado e 3 erros queimam o desafio', async () => {
    const m = await moradorTeste(3205309); const agora = semana(0);
    const d = await tx((c) => emitirDesafio(c, { userId: m.userId, contexto: 'teste', tipo: 'conta', agora }));
    const certa = await resposta(d.id);
    for (let i = 0; i < 3; i++) { const v = await tx((c) => verificarDesafio(c, { id: d.id, userId: m.userId, contexto: 'teste', resposta: certa + 100, agora: mais(agora, 5) })); expect(v.ok).toBe(false); }
    const depois = await tx((c) => verificarDesafio(c, { id: d.id, userId: m.userId, contexto: 'teste', resposta: certa, agora: mais(agora, 6) }));
    expect(depois).toEqual({ ok: false, motivo: 'desafio já usado' });
    // desafio de outro usuário não serve
    const outro = await moradorTeste(3205309);
    const d2 = await tx((c) => emitirDesafio(c, { userId: m.userId, contexto: 'teste', tipo: 'conta', agora }));
    expect((await tx((c) => verificarDesafio(c, { id: d2.id, userId: outro.userId, contexto: 'teste', resposta: 0, agora: mais(agora, 5) }))).ok).toBe(false);
  });

  it('três missões válidas dão no máximo 30 de contribuição por dia (uma conclusão paga por missão)', async () => {
    const agora = semana(1);
    const { moradores } = await ruaCom(3106200, 3);
    const u = moradores[0];
    for (const id of ['obra.etapa', 'desafio.curto', 'atividade.praca']) {
      const r: any = await fazerMissao(u.userId, id, agora);
      expect(r.contribuiu).toBe(true);
    }
    expect(await somaLedger(u.userId, 'contribuicao')).toBe(30);
    expect(await somaLedger(u.userId, 'xp')).toBe(15);
    // dia seguinte reabre (novo dia, nova conclusão)
    const r2: any = await fazerMissao(u.userId, 'desafio.curto', mais(agora, 86400));
    expect(r2.contribuiu).toBe(true);
    expect(await somaLedger(u.userId, 'contribuicao')).toBe(40);
  });

  it('limite de XP é compartilhado entre eventos e missões (teto 100/dia), inclusive em concorrência', async () => {
    const m = await moradorTeste(4314902); const agora = semana(2);
    const rs = await Promise.all(Array.from({ length: 7 }, (_, i) => tx((c) => conceder(c, { userId: m.userId, regraId: 'xp20@1', eventoRef: 'evento:paralelo-' + i, origem: 'evento', agora }))));
    expect(rs.reduce((s, r) => s + r.quantidade, 0)).toBe(100);
    expect(rs.filter((r) => r.limitado).length).toBeGreaterThanOrEqual(2);
    const missao: any = await fazerMissao(m.userId, 'desafio.curto', agora);
    expect(missao.recompensas.find((x: any) => x.sistema === 'xp')).toEqual({ sistema: 'xp', quantidade: 0, limitado: true });
    expect((await q1<{ s: number }>(`select sum(quantidade)::int s from reward_ledger where user_id = $1 and sistema = 'xp' and dia = '2031-01-22'`, [m.userId]))!.s).toBe(100);
    // ledger não aceita voto nem apoio (sistemas separados por constraint)
    await expect(q(`insert into reward_ledger (user_id, sistema, regra_id, evento_ref, chave, quantidade, pedida, dia, origem) values ($1, 'voto', 'x', 'y', 'z', 1, 1, current_date, 'evento')`, [m.userId])).rejects.toThrow();
  });
});

describe('fase 3 · competição de ruas', () => {
  it('mudança de rua não transporta pontos competitivos; quem chega depois só pontua na próxima temporada', async () => {
    const agora = semana(3);
    const A = await ruaCom(3550308, 3, 'Rua Alfa SP'), B = await ruaCom(3550308, 3, 'Rua Beta SP');
    const s = await tx((c) => garantirTemporada(c, agora));
    const u = A.moradores[0];
    expect(((await fazerMissao(u.userId, 'desafio.curto', agora)) as any).contribuiu).toBe(true);
    await mudarDeRua(u, B.rua);
    const r: any = await fazerMissao(u.userId, 'atividade.praca', agora);
    expect(r.contribuiu).toBe(false); expect(r.motivo_sem_ponto).toBe('mudou_de_rua');
    expect(r.recompensas.find((x: any) => x.sistema === 'xp').quantidade).toBe(5); // XP individual continua
    const novato = await moradorTeste(3550308, { rua: A.rua });
    const rn: any = await fazerMissao(novato.userId, 'desafio.curto', agora);
    expect(rn.motivo_sem_ponto).toBe('fora_do_elenco');
    const ca: any = await tx((c) => competicaoDaRua(c, A.rua, null, agora));
    const cb: any = await tx((c) => competicaoDaRua(c, B.rua, u.userId, agora));
    expect(ca.temporada.id).toBe(s.id);
    expect(ca.entrada.pontos).toBe(10); expect(cb.entrada.pontos).toBe(0);
    expect(cb.eu.aviso).toMatch(/ficam com a rua do seu elenco/);
    expect(ca.entrada.modo).toBe('competitivo');
    expect(ca.explicacao).toMatch(/pessoas disputam cargos/); expect(ca.elege_cargo).toBe(false);
  });

  it('competição sem adversário fica cooperativa; divisões não se juntam; rua pequena é inelegível', async () => {
    const agora = semana(4);
    const so = await ruaCom(2611606, 3, 'Rua Única Recife');
    const pequena = await ruaCom(2927408, 2, 'Rua Pequena Salvador');
    const media = await ruaCom(5300108, 9, 'Rua Nove DF'), mini = await ruaCom(5300108, 3, 'Rua Três DF');
    await tx((c) => garantirTemporada(c, agora));
    const r1: any = await tx((c) => competicaoDaRua(c, so.rua, null, agora));
    expect(r1.entrada).toMatchObject({ modo: 'cooperativo', elegivel: true, divisao: '3-8', elenco: 3 });
    expect(r1.cooperativo.motivo).toMatch(/sem adversário inventado/); expect(r1.cooperativo.meta).toBe(180);
    expect(r1.ranking).toBeUndefined();
    const r2: any = await tx((c) => competicaoDaRua(c, pequena.rua, null, agora));
    expect(r2.entrada).toMatchObject({ modo: 'cooperativo', elegivel: false, divisao: null });
    const r3: any = await tx((c) => competicaoDaRua(c, media.rua, null, agora));
    const r4: any = await tx((c) => competicaoDaRua(c, mini.rua, null, agora));
    expect([r3.entrada.divisao, r4.entrada.divisao]).toEqual(['9-16', '3-8']);
    expect([r3.entrada.modo, r4.entrada.modo]).toEqual(['cooperativo', 'cooperativo']);
    // rua criada depois do snapshot: fica de fora até a próxima temporada
    const tarde = await ruaCom(2611606, 3, 'Rua Tardia Recife');
    const r5: any = await tx((c) => competicaoDaRua(c, tarde.rua, null, agora));
    expect(r5.participa).toBe(false); expect(r5.motivo).toMatch(/entra na próxima/);
  });

  it('empate gera colocação compartilhada e prêmio igual; apuração é idempotente e não apaga a obra', async () => {
    const agora = semana(5);
    const A = await ruaCom(4106902, 3, 'Rua A Curitiba'), B = await ruaCom(4106902, 3, 'Rua B Curitiba'), C = await ruaCom(4106902, 3, 'Rua C Curitiba');
    const s = await tx((c) => garantirTemporada(c, agora));
    for (const id of ['obra.etapa', 'desafio.curto', 'atividade.praca']) { await fazerMissao(A.moradores[0].userId, id, agora); await fazerMissao(B.moradores[0].userId, id, agora); }
    const fim = new Date(new Date(s.fim).getTime() + 1000);
    const ap = await tx((c) => apurarTemporada(c, s.id, fim));
    expect(ap).toMatchObject({ apurada: true });
    expect((await tx((c) => apurarTemporada(c, s.id, fim))).apurada).toBe(false);
    const ent = await q<{ street_id: string; colocacao: number; pontos_final: number }>(`select street_id, colocacao, pontos_final from competition_entries where season_id = $1 and street_id = any($2)`, [s.id, [A.rua, B.rua, C.rua]]);
    const por = Object.fromEntries(ent.map((e) => [e.street_id, e]));
    expect([por[A.rua].colocacao, por[B.rua].colocacao, por[C.rua].colocacao]).toEqual([1, 1, 3]);
    expect([por[A.rua].pontos_final, por[B.rua].pontos_final]).toEqual([30, 30]);
    const premios = await q<{ street_id: string; tipo: string }>(`select street_id, tipo from competition_awards where season_id = $1 order by tipo`, [s.id]);
    expect(premios.filter((p) => p.street_id === A.rua).map((p) => p.tipo).sort()).toEqual(['decoracao', 'faixa', 'trofeu']);
    expect(premios.filter((p) => p.street_id === B.rua).map((p) => p.tipo).sort()).toEqual(['decoracao', 'faixa', 'trofeu']);
    expect(premios.filter((p) => p.street_id === C.rua)).toEqual([]);
    // a obra continua de pé depois da apuração (competição não apaga obra)
    const obra: any = await tx((c) => obraParaUI(c, A.rua, null));
    expect(obra.progresso).toBe(10);
  });
});

describe('fase 3 · obra comunitária', () => {
  it('ninguém completa a obra sozinho; etapas persistem; obra concluída fica no histórico', async () => {
    const agora = semana(6);
    const { rua, moradores } = await ruaCom(3304557, 2, 'Rua Obra Rio');
    const [a, b] = moradores;
    const c1 = await tx((c) => contribuirObra(c, { userId: a.userId, streetId: rua, origem: 't', chave: 'o1', agora }));
    expect(c1).toMatchObject({ ok: true, quantidade: 10, progresso: 10, meta: 30 });
    const c2 = await tx((c) => contribuirObra(c, { userId: a.userId, streetId: rua, origem: 't', chave: 'o2', agora }));
    expect(c2).toMatchObject({ ok: true, quantidade: 5, progresso: 15 }); // teto de 50% da meta
    const c3 = await tx((c) => contribuirObra(c, { userId: a.userId, streetId: rua, origem: 't', chave: 'o3', agora: mais(agora, 86400) }));
    expect(c3.ok).toBe(false);
    const dup = await tx((c) => contribuirObra(c, { userId: a.userId, streetId: rua, origem: 't', chave: 'o1', agora }));
    expect(dup).toMatchObject({ ok: true, quantidade: 0, duplicado: true });
    const estranho = await moradorTeste(3304557);
    expect((await tx((c) => contribuirObra(c, { userId: estranho.userId, streetId: rua, origem: 't', chave: 'o4', agora }))).ok).toBe(false);
    await tx((c) => contribuirObra(c, { userId: b.userId, streetId: rua, origem: 't', chave: 'o5', agora }));
    const fim = await tx((c) => contribuirObra(c, { userId: b.userId, streetId: rua, origem: 't', chave: 'o6', agora }));
    expect(fim).toMatchObject({ ok: true, progresso: 30, concluida: true, etapa: 3 });
    const ui: any = await tx((c) => obraParaUI(c, rua, a.userId));
    expect(ui.modelo).toBe('banco'); // próxima obra do rodízio
    expect(ui.concluidas.map((x: any) => x.modelo)).toEqual(['jardim']);
    const evs = await q<{ tipo: string }>(`select tipo from domain_events where dados->>'street_id' = $1 and tipo like 'obra.%' order by id`, [rua]);
    expect(evs.map((e) => e.tipo)).toEqual(['obra.etapa_concluida', 'obra.etapa_concluida', 'obra.etapa_concluida', 'obra.concluida']);
  });

  it('rotas da rua: obra e competição respondem; não-morador não ajuda a obra', async () => {
    const { rua, moradores } = await ruaCom(3205309, 3, 'Rua Rotas Vitória');
    const c = cliente(); c.jar.set('smn_sess', await sessaoTeste(moradores[0].userId)); await c.aquecer();
    const comp = await c.get(`/api/ruas/${rua}/competicao`);
    expect(comp.status).toBe(200); expect(comp.json.explicacao).toMatch(/Ruas disputam troféu/);
    const obra = await c.get(`/api/ruas/${rua}/obra`);
    expect(obra.status).toBe(200); expect(obra.json.obra.etapas.length).toBe(3);
    const d = await c.post(`/api/ruas/${rua}/obra/desafio`);
    expect(d.status).toBe(200);
    await q(`update server_challenges set criado_em = criado_em - interval '10 seconds' where id = $1`, [d.json.desafio.id]);
    const ok = await c.post(`/api/ruas/${rua}/obra`, { desafio_id: d.json.desafio.id, resposta: await resposta(d.json.desafio.id) });
    expect(ok.status).toBe(200); expect(ok.json.obra.quantidade).toBe(10); expect(ok.json.obra_atual.progresso).toBe(10);
    const fora = await moradorTeste(3205309);
    const c2 = cliente(); c2.jar.set('smn_sess', await sessaoTeste(fora.userId)); await c2.aquecer();
    expect((await c2.post(`/api/ruas/${rua}/obra/desafio`)).status).toBe(403);
    expect((await c2.get(`/api/ruas/nao-e-uuid/obra`)).status).toBe(404);
  });
});
