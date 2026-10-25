/* Fase 4 · eleições virtuais: regras do capítulo 9 e critérios do capítulo 18 (voto, prazos, quorum, empates,
   candidatura única, suspensão, renúncia, apuração idempotente). Banco real (Postgres), relógio injetado. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo } from './ajuda';
import { moradorTeste } from './fixtures';
import { fecharDb, q, q1 } from '../src/db/db';
import { criarApp } from '../src/http/app';
import { rodarFila } from '../src/jobs/fila';
import { usarRelogio } from '../src/modulos/eleicoes/rotas';
import { suspenderCandidato, retirarCandidatura } from '../src/modulos/eleicoes/dominio';
import { renunciar, mandatoVigente, verificarOcupantes } from '../src/modulos/eleicoes/cargos';
import { calcularQuorum, localParaUtc, segundaDaSemana, partesLocais } from '../src/modulos/eleicoes/regras';
import { db } from '../src/db/db';
import { tempos, eleicaoDe, cidade, inscrever, votarTodos, estado, mandatos, eventos, tornarAdmin, avancarEleicao, votar, candidatar, mais } from './fase4-ajuda';

const { T, inscr, votando, fechou, publica } = tempos(7);

beforeAll(async () => { await bancoLimpo(); criarApp(); /* registra os jobs do módulo */ });
afterAll(async () => { usarRelogio(null); await fecharDb(); });

describe('fase 4 · calendário e regras', () => {
  it('calendário semanal em America/Sao_Paulo persistido em UTC', () => {
    const p = (d: Date) => partesLocais('America/Sao_Paulo', d);
    expect(p(T.inscricoesAbrem)).toMatchObject({ dow: 1, h: 0, min: 0 });
    expect(p(T.inscricoesFecham)).toMatchObject({ dow: 4, h: 20 });
    expect(p(T.votacaoAbre)).toMatchObject({ dow: 5, h: 0 });
    expect(p(T.votacaoFecha)).toMatchObject({ dow: 7, h: 20 });
    expect(p(T.publicaEm)).toMatchObject({ dow: 7, h: 21 });
    expect(T.mandatoFim.getTime() - T.publicaEm.getTime()).toBe(7 * 86400_000);
    // Brasília é UTC−3: domingo 21h local = segunda 00h UTC
    expect(T.publicaEm.getUTCHours()).toBe(0);
    expect(localParaUtc('America/Sao_Paulo', 2026, 9, 25, 21, 0).toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(segundaDaSemana('America/Sao_Paulo', new Date('2026-10-26T01:00:00Z'))).toEqual({ y: 2026, m: 9, d: 19 }); // dom 22h local ainda é a semana anterior
  });
  it('quorum de 30% arredondado para cima', () => {
    expect(calcularQuorum(10, 30)).toBe(3); expect(calcularQuorum(6, 30)).toBe(2); expect(calcularQuorum(5, 30)).toBe(2); expect(calcularQuorum(52, 30)).toBe(16); expect(calcularQuorum(1, 30)).toBe(1);
  });
});

describe('fase 4 · eleição municipal', () => {
  it('uma rua com dez moradores tem eleição municipal entre dois candidatos (XP não pesa)', async () => {
    const ibge = 3205309; const { m } = await cidade(ibge, 10);
    const e = await eleicaoDe('prefeito', String(ibge), inscr);
    expect(e).toMatchObject({ cargo: 'prefeito', escopo: 'cidade', estado: 'inscricoes', regra_id: 'eleicoes@1' });
    const [a, b] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await q(`update houses set xp = 999999, nivel = 11 where id = $1`, [m[9].houseId]); // XP alto não multiplica voto
    expect(await avancarEleicao(e.id, votando)).toBe('votacao');
    expect((await estado(e.id))).toMatchObject({ eleitorado: 10, quorum: 3, modo: 'disputa' });
    await votarTodos(e.id, [[m[0], a], [m[2], a], [m[3], a], [m[4], a], [m[1], b], [m[5], b], [m[9], b]], votando);
    expect(await avancarEleicao(e.id, mais(fechou, 1))).toBe('apuracao');
    expect(await avancarEleicao(e.id, publica)).toBe('publicada');
    const f = await estado(e.id);
    expect(f).toMatchObject({ resultado_tipo: 'eleito', vencedor_user_id: m[0].userId });
    expect(f.resultado.totais.map((t: any) => t.votos)).toEqual([4, 3]);
    const ms = await mandatos('prefeito', String(ibge));
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ estado: 'ativo', user_id: m[0].userId });
    expect(new Date(ms[0].fim).getTime()).toBe(T.mandatoFim.getTime());
    // eventos de domínio para a Fase 6 (outbox)
    for (const t of ['eleicao.votacao_aberta', 'eleicao.votacao_fechada', 'eleicao.resultado', 'mandato.posse'])
      expect((await eventos(t, (d) => d.eleicaoId === e.id)).length).toBe(1);
    // a eleição de líder da mesma rua é independente da municipal
    const lider = await eleicaoDe('lider', m[0].streetId, inscr);
    expect(lider.id).not.toBe(e.id);
  });

  it('cidade sem quorum não inventa eleito e cidade pequena fica em fundação', async () => {
    const { m } = await cidade(3301702, 6);
    const e = await eleicaoDe('prefeito', '3301702', inscr);
    const [a] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await avancarEleicao(e.id, votando);
    await votar(m[2].userId, e.id, a, votando); // 1 voto < quorum 2
    expect(await avancarEleicao(e.id, publica)).toBe('sem_eleito');
    expect(await estado(e.id)).toMatchObject({ resultado_tipo: 'sem_quorum', vencedor_user_id: null });
    expect(await mandatos('prefeito', '3301702')).toHaveLength(0);
    expect(await mandatoVigente(db(), 'prefeito', '3301702', publica)).toBeNull();

    const p = await cidade(3550308, 3); // abaixo do limiar de 5 eleitores
    const e2 = await eleicaoDe('prefeito', '3550308', inscr);
    await inscrever([p.m[0], p.m[1]], 'prefeito', e2.id, inscr);
    expect(await avancarEleicao(e2.id, votando)).toBe('fundacao');
    expect(await estado(e2.id)).toMatchObject({ resultado_tipo: 'fundacao', eleitorado: 3 });
    await expect(votar(p.m[2].userId, e2.id, (await q1<any>(`select id from candidates where election_id = $1 limit 1`, [e2.id])).id, votando)).rejects.toThrow(/não está em votação/);
  });

  it('nenhum candidato: sem eleito, cargo vago com calendário neutro', async () => {
    await cidade(3304557, 5);
    const e = await eleicaoDe('prefeito', '3304557', inscr);
    expect(await avancarEleicao(e.id, votando)).toBe('sem_eleito');
    expect(await estado(e.id)).toMatchObject({ resultado_tipo: 'sem_candidato' });
    expect(await mandatos('prefeito', '3304557')).toHaveLength(0);
  });
});

describe('fase 4 · voto', () => {
  it('um voto por eleição: troca não soma e requisições concorrentes respeitam unicidade', async () => {
    const { m } = await cidade(3106200, 5);
    const e = await eleicaoDe('prefeito', '3106200', inscr);
    const [a, b] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await avancarEleicao(e.id, votando);
    const rs = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => votar(m[2].userId, e.id, i % 2 ? a : b, votando)));
    expect(rs.filter((r) => r.status === 'fulfilled').length).toBe(8);
    expect((await q1<any>(`select count(*)::int n from votes where election_id = $1`, [e.id])).n).toBe(1);
    expect((await q1<any>(`select count(*)::int n from vote_audit where election_id = $1 and acao = 'votou'`, [e.id])).n).toBe(1);
    await votar(m[2].userId, e.id, a, votando);
    await votar(m[2].userId, e.id, b, votando); // troca: continua 1
    const v = await q<any>(`select candidate_id, trocas from votes where election_id = $1`, [e.id]);
    expect(v).toHaveLength(1); expect(v[0].candidate_id).toBe(b);
    // votar em si mesmo é permitido com o mesmo peso
    await votar(m[0].userId, e.id, a, votando);
    expect((await q1<any>(`select count(*)::int n from votes where election_id = $1`, [e.id])).n).toBe(2);
  });

  it('após o prazo o voto falha pelo relógio do servidor; antes de abrir também', async () => {
    const { m } = await cidade(4314902, 5);
    const e = await eleicaoDe('prefeito', '4314902', inscr);
    const [a] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await expect(votar(m[2].userId, e.id, a, inscr)).rejects.toThrow(/ainda não abriu/);
    await votar(m[2].userId, e.id, a, votando);
    await expect(votar(m[3].userId, e.id, a, fechou)).rejects.toThrow(/já fechou/);
    await expect(votar(m[3].userId, e.id, a, mais(fechou, 60))).rejects.toThrow(/já fechou/);
  });

  it('eleitorado congelado: novo morador e conta verificada há menos de 24h não votam', async () => {
    const { rua, m } = await cidade(2611606, 5);
    const recente = await moradorTeste(2611606, { rua });
    await q(`update users set verificado_em = $2 where id = $1`, [recente.userId, mais(T.inscricoesFecham, -120)]);
    const e = await eleicaoDe('prefeito', '2611606', inscr);
    const [a] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await avancarEleicao(e.id, votando);
    const novo = await moradorTeste(2611606, { rua }); // chegou depois do congelamento
    await expect(votar(novo.userId, e.id, a, votando)).rejects.toThrow(/eleitorado congelado/);
    await expect(votar(recente.userId, e.id, a, votando)).rejects.toThrow(/eleitorado congelado/);
    expect((await estado(e.id)).eleitorado).toBe(5);
    // mudar de cidade depois do congelamento não tira o voto da cidade antiga (snapshot)
    await votar(m[4].userId, e.id, a, votando);
  });
});

describe('fase 4 · candidatura', () => {
  it('candidatura única: confirmação exige quorum e mais confirmações que rejeições', async () => {
    const ok = await cidade(5300108, 5);
    const e = await eleicaoDe('prefeito', '5300108', inscr);
    const [a] = await inscrever([ok.m[0]], 'prefeito', e.id, inscr);
    await avancarEleicao(e.id, votando);
    expect((await estado(e.id)).modo).toBe('confirmacao');
    await votarTodos(e.id, [[ok.m[1], a], [ok.m[2], a], [ok.m[3], 'rejeitar']], votando);
    expect(await avancarEleicao(e.id, publica)).toBe('publicada');
    expect(await estado(e.id)).toMatchObject({ resultado_tipo: 'eleito_sem_concorrencia', vencedor_user_id: ok.m[0].userId });
    expect(await mandatos('prefeito', '5300108')).toHaveLength(1);

    const no = await cidade(2304400, 5);
    const e2 = await eleicaoDe('prefeito', '2304400', inscr);
    const [b] = await inscrever([no.m[0]], 'prefeito', e2.id, inscr);
    await avancarEleicao(e2.id, votando);
    await votarTodos(e2.id, [[no.m[1], b], [no.m[2], 'rejeitar'], [no.m[3], 'rejeitar']], votando);
    expect(await avancarEleicao(e2.id, publica)).toBe('sem_eleito');
    expect((await estado(e2.id)).resultado_tipo).toBe('rejeitado');
    expect(await mandatos('prefeito', '2304400')).toHaveLength(0);
  });

  it('um cargo por temporada: troca só com confirmação e só durante as inscrições', async () => {
    const { m } = await cidade(2927408, 4);
    const lider = await eleicaoDe('lider', m[0].streetId, inscr);
    const pref = await eleicaoDe('prefeito', '2927408', inscr);
    await candidatar(m[0].userId, lider.id, { cargo: 'lider' }, inscr);
    await expect(candidatar(m[0].userId, pref.id, { cargo: 'lider' }, inscr)).rejects.toThrow(/confirme a intenção/);
    await expect(candidatar(m[0].userId, pref.id, { cargo: 'prefeito' }, inscr)).rejects.toThrow(/um cargo só/);
    const r = await candidatar(m[0].userId, pref.id, { cargo: 'prefeito', trocar: true }, inscr);
    expect(r.trocou).toBe(true);
    const ks = await q<any>(`select election_id, estado from candidates where user_id = $1 order by criado_em`, [m[0].userId]);
    expect(ks.map((k) => k.estado)).toEqual(['trocou', 'inscrito']);
    await expect(candidatar(m[1].userId, pref.id, { cargo: 'prefeito' }, mais(T.inscricoesFecham, 1))).rejects.toThrow(/inscrições desta eleição virtual estão fechadas/);
  });
});

describe('fase 4 · empate e segundo turno', () => {
  it('empate gera segundo turno de 24h; desempate dá posse com mandato menor', async () => {
    const { m } = await cidade(4106902, 6);
    const e = await eleicaoDe('prefeito', '4106902', inscr);
    const [a, b] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await avancarEleicao(e.id, votando);
    await votarTodos(e.id, [[m[2], a], [m[3], a], [m[4], b], [m[5], b]], votando);
    expect(await avancarEleicao(e.id, publica)).toBe('segundo_turno');
    expect((await estado(e.id)).resultado_tipo).toBe('segundo_turno');
    const r2 = await q1<any>(`select * from elections where origem_id = $1`, [e.id]);
    expect(r2).toMatchObject({ turno: 2, estado: 'votacao', eleitorado: 6, quorum: 2 });
    expect(new Date(r2.votacao_fecha).getTime() - new Date(r2.votacao_abre).getTime()).toBe(24 * 3600_000);
    const k2 = await q<any>(`select id, user_id from candidates where election_id = $1 order by criado_em`, [r2.id]);
    expect(k2.map((k) => k.user_id).sort()).toEqual([m[0].userId, m[1].userId].sort());
    const kA = k2.find((k) => k.user_id === m[0].userId).id, kB = k2.find((k) => k.user_id === m[1].userId).id;
    const durante = mais(publica, 60);
    await votarTodos(r2.id, [[m[2], kA], [m[3], kA], [m[4], kB], [m[5], kA]], durante);
    await expect(votar(m[2].userId, e.id, a, durante)).rejects.toThrow(/fechou|não está em votação/);
    const depois = mais(new Date(r2.votacao_fecha), 1);
    expect(await avancarEleicao(r2.id, depois)).toBe('publicada');
    const ms = await mandatos('prefeito', '4106902');
    expect(ms).toHaveLength(1);
    expect(ms[0].user_id).toBe(m[0].userId);
    expect(new Date(ms[0].inicio).getTime()).toBe(depois.getTime());
    expect(new Date(ms[0].fim).getTime()).toBe(T.mandatoFim.getTime()); // data fixa: mandato fica menor
  });

  it('novo empate no segundo turno deixa o cargo vago', async () => {
    const { m } = await cidade(1302603, 6);
    const e = await eleicaoDe('prefeito', '1302603', inscr);
    const [a, b] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await avancarEleicao(e.id, votando);
    await votarTodos(e.id, [[m[2], a], [m[3], b]], votando);
    await avancarEleicao(e.id, publica);
    const r2 = await q1<any>(`select * from elections where origem_id = $1`, [e.id]);
    const k2 = await q<any>(`select id, user_id from candidates where election_id = $1`, [r2.id]);
    await votarTodos(r2.id, [[m[2], k2[0].id], [m[3], k2[1].id]], mais(publica, 5));
    expect(await avancarEleicao(r2.id, mais(new Date(r2.votacao_fecha), 1))).toBe('sem_eleito');
    expect((await estado(r2.id)).resultado_tipo).toBe('empate_vago');
    expect(await mandatos('prefeito', '1302603')).toHaveLength(0);
  });
});

describe('fase 4 · suspensão, retirada, renúncia e vacância', () => {
  it('suspensão de candidato invalida votos com auditoria e aviso; eleitor pode escolher de novo', async () => {
    const adm = await moradorTeste(1501402); await tornarAdmin(adm.userId);
    const { m } = await cidade(5208707, 5);
    const e = await eleicaoDe('prefeito', '5208707', inscr);
    const [a, b] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await avancarEleicao(e.id, votando);
    await votarTodos(e.id, [[m[0], a], [m[2], a], [m[3], a], [m[1], b]], votando);
    await expect(suspenderCandidato(m[4].userId, a, 'tentativa sem papel administrativo', votando)).rejects.toThrow(/equipe da plataforma/);
    const r = await suspenderCandidato(adm.userId, a, 'violação das regras publicadas da eleição virtual', votando);
    expect(r.votosInvalidados).toBe(3);
    expect((await q1<any>(`select count(*)::int n from vote_audit where election_id = $1 and acao = 'invalidado'`, [e.id])).n).toBe(3);
    const ev = await eventos('eleicao.candidato_inativo', (d) => d.candidatoId === a);
    expect(ev[0]).toMatchObject({ estado: 'suspenso', aindaHaPrazo: true }); expect(ev[0].avisar).toHaveLength(3);
    expect((await q1<any>(`select count(*)::int n from admin_audit_logs where acao = 'eleicao.suspender_candidato' and alvo = $1`, [a])).n).toBe(1);
    await expect(votar(m[4].userId, e.id, a, votando)).rejects.toThrow(/retirada ou suspensa/);
    await votar(m[2].userId, e.id, b, votando); // nova escolha dentro do prazo
    expect(await avancarEleicao(e.id, publica)).toBe('publicada');
    expect(await estado(e.id)).toMatchObject({ resultado_tipo: 'eleito', vencedor_user_id: m[1].userId });
  });

  it('retirada voluntária: candidato some da disputa e o único restante concorre', async () => {
    const { m } = await cidade(3509502, 5);
    const e = await eleicaoDe('prefeito', '3509502', inscr);
    const [a, b] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await avancarEleicao(e.id, votando);
    await votarTodos(e.id, [[m[2], a], [m[3], b], [m[4], b]], votando);
    expect((await retirarCandidatura(m[1].userId, e.id, votando)).votosInvalidados).toBe(2);
    await expect(retirarCandidatura(m[0].userId, e.id, publica)).rejects.toThrow(/fechou/);
    expect(await avancarEleicao(e.id, publica)).toBe('sem_eleito'); // 1 voto válido < quorum 2
    expect((await estado(e.id)).resultado_tipo).toBe('sem_quorum');
  });

  it('renúncia e saída do escopo deixam o cargo vago sem inventar sucessor', async () => {
    const { m } = await cidade(2111300, 5);
    const e = await eleicaoDe('prefeito', '2111300', inscr);
    const [a, b] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await avancarEleicao(e.id, votando);
    await votarTodos(e.id, [[m[2], a], [m[3], a], [m[4], b]], votando);
    await avancarEleicao(e.id, publica);
    expect((await mandatoVigente(db(), 'prefeito', '2111300', mais(publica, 1)))!.user_id).toBe(m[0].userId);
    await renunciar(m[0].userId, mais(publica, 2));
    expect(await mandatoVigente(db(), 'prefeito', '2111300', mais(publica, 3))).toBeNull();
    expect((await mandatos('prefeito', '2111300'))[0].estado).toBe('vago_renuncia');
    expect((await eventos('mandato.vago', (d) => d.escopoId === '2111300'))[0]).toMatchObject({ motivo: 'vago_renuncia', calendarioNeutro: true });

    // líder que sai da rua: vacância por saída do escopo
    const r = await cidade(2704302, 3);
    const el = await eleicaoDe('lider', r.rua, inscr);
    const [k] = await inscrever([r.m[0]], 'lider', el.id, inscr);
    await avancarEleicao(el.id, votando);
    await votarTodos(el.id, [[r.m[1], k], [r.m[2], k]], votando);
    expect(await avancarEleicao(el.id, publica)).toBe('publicada');
    await q(`update street_memberships set saiu_em = now(), motivo_saida = 'mudou' where house_id = $1`, [r.m[0].houseId]);
    expect(await verificarOcupantes(mais(publica, 5))).toBeGreaterThanOrEqual(1);
    expect((await mandatos('lider', r.rua))[0].estado).toBe('vago_saiu_escopo');
  });
});

describe('fase 4 · apuração idempotente', () => {
  it('retry e workers concorrentes não criam dois mandatos', async () => {
    const { m } = await cidade(2408102, 5);
    const e = await eleicaoDe('prefeito', '2408102', inscr);
    const [a, b] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await avancarEleicao(e.id, votando);
    await votarTodos(e.id, [[m[2], a], [m[3], a], [m[4], b]], votando);
    await avancarEleicao(e.id, mais(fechou, 1)); // fecha e enfileira o job de apuração
    expect((await q1<any>(`select count(*)::int n from processing_jobs where chave = $1`, ['apurar:' + e.id])).n).toBe(1);
    await Promise.all(Array.from({ length: 6 }, () => avancarEleicao(e.id, publica)));
    // worker que morreu depois do commit e repete o job
    await q(`update elections set estado = 'apuracao' where id = $1`, [e.id]);
    await q(`update processing_jobs set estado = 'pendente', disponivel_em = now() where chave = $1`, ['apurar:' + e.id]);
    usarRelogio(() => publica);
    await rodarFila(50);
    await Promise.all([avancarEleicao(e.id, publica), avancarEleicao(e.id, publica)]);
    usarRelogio(null);
    const ms = await mandatos('prefeito', '2408102');
    expect(ms).toHaveLength(1);
    expect((await eventos('mandato.posse', (d) => d.eleicaoId === e.id)).length).toBe(1);
    // o banco recusa um segundo mandato ativo para o mesmo cargo/escopo
    await expect(q(`insert into office_terms (election_id, cargo, escopo_id, escopo_nome, user_id, inicio, fim) values ($1, 'prefeito', '2408102', 'x', $2, now(), now() + interval '1 day')`, [e.id, m[1].userId])).rejects.toThrow(/duplicate key/);
  });
});
