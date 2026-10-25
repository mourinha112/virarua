/* Fase 4 · contratos HTTP (/api/eleicoes…), ciclo do job, placar protegido, regra versionada valendo para a
   próxima temporada e correção administrativa auditada. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { moradorTeste } from './fixtures';
import { fecharDb, q, q1 } from '../src/db/db';
import { usarRelogio } from '../src/modulos/eleicoes/rotas';
import { ciclo } from '../src/modulos/eleicoes/ciclo';
import { tempos, eleicaoDe, cidade, inscrever, votarTodos, estado, mandatos, eventos, tornarAdmin, clienteDe, avancarEleicao, mais } from './fase4-ajuda';
import type { Morador } from './fixtures';

const { T, inscr, votando, fechou, publica } = tempos(7);
let adm: Morador;

beforeAll(async () => { await bancoLimpo(); adm = await moradorTeste(1501402); await tornarAdmin(adm.userId); });
afterAll(async () => { usarRelogio(null); await fecharDb(); });

describe('fase 4 · rotas', () => {
  it('GET /api/eleicoes: público sem login e as três eleições do lugar com login', async () => {
    usarRelogio(() => inscr);
    const anon = cliente(); await anon.aquecer();
    const r0 = await anon.get('/api/eleicoes');
    expect(r0.status).toBe(200); expect(r0.json).toMatchObject({ ok: true, publico: true }); expect(Array.isArray(r0.json.eleicoes)).toBe(true);
    const { m } = await cidade(3205309, 12);
    const k = await clienteDe(m[0].userId);
    const r = await k.get('/api/eleicoes');
    expect(r.json.ok).toBe(true);
    expect(r.json.eleicoes.map((e: any) => e.cargo)).toEqual(['lider', 'prefeito', 'presidente']);
    for (const e of r.json.eleicoes) {
      expect(e).toMatchObject({ status: 'inscricoes', selo: expect.stringContaining('eleição virtual') });
      expect(typeof e.id).toBe('string'); expect(typeof e.escopoNome).toBe('string'); expect(Array.isArray(e.candidatos)).toBe(true);
    }
    const cal = await k.get('/api/eleicoes/calendario');
    expect(cal.json).toMatchObject({ ok: true, fuso: 'America/Sao_Paulo', fase: 'inscricoes', regraId: 'eleicoes@1' });
    expect(cal.json.temporada.votacaoFecha).toBe(T.votacaoFecha.toISOString());
    expect(cal.json.mandatos.every((x: any) => x.vago && /calendário neutro/.test(x.texto))).toBe(true);
    const reg = await anon.get('/api/eleicoes/regras');
    expect(reg.json.regras.some((s: string) => /30%/.test(s))).toBe(true);
  });

  it('candidatura, voto concorrente pela rota, placar protegido e prazo pelo relógio do servidor', async () => {
    usarRelogio(() => inscr);
    const { m } = await cidade(3301702, 12);
    const ks = await Promise.all(m.map((x) => clienteDe(x.userId)));
    const pref = (await ks[0].get('/api/eleicoes')).json.eleicoes.find((e: any) => e.cargo === 'prefeito');
    expect((await ks[0].post(`/api/eleicoes/${pref.id}/candidatura`, { cargo: 'prefeito' })).status).toBe(400); // sem confirmar
    const c0 = await ks[0].post(`/api/eleicoes/${pref.id}/candidatura`, { confirmar: true, cargo: 'prefeito' });
    expect(c0.json).toMatchObject({ ok: true, mensagem: expect.stringContaining('eleição virtual') });
    const c1 = await ks[1].post(`/api/eleicoes/${pref.id}/candidatura`, { confirmar: true, cargo: 'prefeito' });
    // voto antes da votação abrir
    expect((await ks[2].post(`/api/eleicoes/${pref.id}/voto`, { candidato: c0.json.candidatoId })).status).toBe(409);

    usarRelogio(() => votando);
    const vs = await Promise.all(Array.from({ length: 6 }, (_, i) => ks[2].post(`/api/eleicoes/${pref.id}/voto`, { candidato: i % 2 ? c0.json.candidatoId : c1.json.candidatoId })));
    expect(vs.every((v) => v.status === 200)).toBe(true);
    expect((await q1<any>(`select count(*)::int n from votes where election_id = $1`, [pref.id])).n).toBe(1);
    // cliente não escolhe eleitor/peso: campos extras são ignorados
    await ks[3].post(`/api/eleicoes/${pref.id}/voto`, { candidato: c0.json.candidatoId, voterId: m[4].userId, peso: 50 });
    expect((await q1<any>(`select voter_id from votes where election_id = $1 and voter_id = $2`, [pref.id, m[4].userId]))).toBeNull();
    const det = await ks[3].get(`/api/eleicoes/${pref.id}`);
    expect(det.json.eleicao).toMatchObject({ status: 'votacao', eleitorado: 12, placarVisivel: true, placarProvisorio: true });
    expect(det.json.eleicao.meuVoto).toMatchObject({ candidato: c0.json.candidatoId, invalido: false });
    expect(det.json.eleicao.candidatos.reduce((t: number, x: any) => t + x.votos, 0)).toBe(2);
    expect(det.json.eleicao.regras.length).toBeGreaterThan(5);
    expect(det.json.eleicao.placarAtualizadoEm).toBeTruthy();
    // a lista não expõe escolhas individuais de outros eleitores
    expect(JSON.stringify(det.json)).not.toContain(m[2].userId);

    // eleitorado pequeno: totais escondidos
    const p = await cidade(3550308, 5);
    const kp = await Promise.all(p.m.map((x) => clienteDe(x.userId)));
    usarRelogio(() => inscr);
    const pe = (await kp[0].get('/api/eleicoes')).json.eleicoes.find((e: any) => e.cargo === 'prefeito');
    const a = (await kp[0].post(`/api/eleicoes/${pe.id}/candidatura`, { confirmar: true, cargo: 'prefeito' })).json.candidatoId;
    await kp[1].post(`/api/eleicoes/${pe.id}/candidatura`, { confirmar: true, cargo: 'prefeito' });
    usarRelogio(() => votando);
    await kp[2].post(`/api/eleicoes/${pe.id}/voto`, { candidato: a });
    const dp = (await kp[3].get(`/api/eleicoes/${pe.id}`)).json.eleicao;
    expect(dp.placarVisivel).toBe(false); expect(dp.candidatos.every((x: any) => x.votos === null)).toBe(true);

    usarRelogio(() => fechou);
    const tarde = await ks[5].post(`/api/eleicoes/${pref.id}/voto`, { candidato: c0.json.candidatoId });
    expect(tarde.status).toBe(409); expect(tarde.json.erro).toMatch(/eleição virtual já fechou/);
    usarRelogio(null);
  });

  it('ação de cargo sem mandato é recusada; renúncia exige confirmação', async () => {
    const x = await moradorTeste(3304557);
    const k = await clienteDe(x.userId);
    usarRelogio(() => publica);
    const r = await k.post('/api/eleicoes/cargo/acao', { tipo: 'festival', opcao: 'prefeito.festival.junino' });
    expect(r.status).toBe(403);
    expect((await k.post('/api/eleicoes/cargo/renuncia', {})).status).toBe(400);
    expect((await k.get('/api/eleicoes/cargo/catalogo')).json).toMatchObject({ ok: true, cargo: null });
    usarRelogio(null);
  });
});

describe('fase 4 · ciclo, virada e correção', () => {
  it('o job de ciclo avança todas as eleições vencidas e emite virada provisória', async () => {
    const { m } = await cidade(3106200, 10);
    const e = await eleicaoDe('prefeito', '3106200', inscr);
    const [a, b] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    expect((await ciclo(votando)).avancadas).toBeGreaterThanOrEqual(1);
    expect((await estado(e.id)).estado).toBe('votacao');
    await votarTodos(e.id, [[m[2], a]], votando);
    await ciclo(mais(votando, 5));
    await votarTodos(e.id, [[m[3], b], [m[4], b]], mais(votando, 6));
    await ciclo(mais(votando, 10));
    const v = await eventos('eleicao.virada', (d) => d.eleicaoId === e.id);
    expect(v).toHaveLength(1); expect(v[0]).toMatchObject({ provisorio: true });
    expect((await estado(e.id)).placar_atualizado_em).toBeTruthy();
    await ciclo(publica);
    expect(await estado(e.id)).toMatchObject({ estado: 'publicada', vencedor_user_id: m[1].userId });
    // fim fixo do mandato
    await ciclo(mais(T.mandatoFim, 1));
    expect((await mandatos('prefeito', '3106200'))[0].estado).toBe('encerrado');
  });

  it('correção pós-resultado só por ação administrativa auditada, com evento de correção', async () => {
    const { m } = await cidade(4314902, 5);
    const e = await eleicaoDe('prefeito', '4314902', inscr);
    const [a, b] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await avancarEleicao(e.id, votando);
    await votarTodos(e.id, [[m[2], a], [m[3], a], [m[4], b]], votando);
    await avancarEleicao(e.id, publica);
    usarRelogio(() => mais(publica, 10));
    const comum = await clienteDe(m[2].userId);
    expect((await comum.post(`/api/eleicoes/admin/${e.id}/correcao`, { motivo: 'quero mudar o resultado agora' })).status).toBe(403);
    const ka = await clienteDe(adm.userId);
    expect((await ka.post(`/api/eleicoes/admin/${e.id}/correcao`, { motivo: 'curto' })).status).toBe(400);
    const r = await ka.post(`/api/eleicoes/admin/${e.id}/correcao`, { motivo: 'revisão de abuso: contas coordenadas invalidadas', vencedorUserId: null });
    expect(r.json).toMatchObject({ ok: true, depois: { resultadoTipo: 'anulado' } });
    expect((await mandatos('prefeito', '4314902'))[0].estado).toBe('corrigido');
    expect((await eventos('eleicao.corrigida', (d) => d.eleicaoId === e.id)).length).toBe(1);
    expect((await q1<any>(`select count(*)::int n from admin_audit_logs where acao = 'eleicao.corrigir_resultado' and alvo = $1`, [e.id])).n).toBe(1);
    const det = await comum.get(`/api/eleicoes/${e.id}`);
    expect(det.json.eleicao.correcoes).toHaveLength(1);
    expect(det.json.eleicao.resultado).toMatchObject({ tipo: 'anulado', corrigido: true });
    usarRelogio(null);
  });

  it('mudança de regra é versionada e vale só para a próxima temporada', async () => {
    const atual = await eleicaoDe('prefeito', '2611606', inscr); // temporada já existente (regra @1)
    usarRelogio(() => mais(inscr, 30));
    const comum = await clienteDe((await moradorTeste(2611606)).userId);
    expect((await comum.post('/api/eleicoes/admin/regras', { regras: { quorumPct: 50 }, motivo: 'teste de permissão sem papel' })).status).toBe(403);
    const ka = await clienteDe(adm.userId);
    expect((await ka.post('/api/eleicoes/admin/regras', { regras: { quorumPct: 0 }, motivo: 'regra inválida não pode passar' })).status).toBe(400);
    const r = await ka.post('/api/eleicoes/admin/regras', { regras: { quorumPct: 50, limiares: { prefeito: 4 } }, motivo: 'ajuste de quorum para a próxima temporada' });
    expect(r.json).toMatchObject({ ok: true, regraId: 'eleicoes@2' });
    usarRelogio(null);
    expect((await eleicaoDe('prefeito', '2611606', mais(inscr, 60))).regra_id).toBe('eleicoes@1');
    expect((await estado(atual.id)).regra_id).toBe('eleicoes@1');
    const prox = tempos(21); // (+14 já foi criada pelo teste do ciclo, que viaja até o fim do mandato)
    const nova = await eleicaoDe('prefeito', '2611606', prox.inscr);
    expect(nova.regra_id).toBe('eleicoes@2');
    expect((await q1<any>(`select regras from rule_versions where id = 'eleicoes@2'`)).regras).toMatchObject({ quorumPct: 50, limiares: { prefeito: 4, lider: 3 }, versao: 2 });
  });
});
