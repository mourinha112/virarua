/* Fase 3 · catálogo de 60 eventos, motores e orquestrador (banco real smn_test). */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { moradorTeste, sessaoTeste } from './fixtures';
import { fecharDb, q, q1, tx, emitir } from '../src/db/db';
import { config } from '../src/config';
import { resposta, mais, ruaCom, somaLedger } from './fase3-ajuda';
import { CATALOGO } from '../src/modulos/eventos/catalogo';
import { validarCatalogo, validarDefinicao } from '../src/modulos/eventos/validador';
import { MOTORES, type EventDefinition } from '../src/modulos/eventos/tipos';
import { sincronizarCatalogo, criarInstancia, avancar, planejar, consolidarFatos } from '../src/modulos/eventos/orquestrador';
import { participar, desafioEvento, inscrever } from '../src/modulos/eventos/participacao';

beforeAll(bancoLimpo);
afterAll(fecharDb);

const def = (id: string) => CATALOGO.find((d) => d.id === id)!;
/** instância ativa agora (passa pela máquina de estados real: scheduled → announced → enrolling → active) */
async function ativa(id: string, ibge: number | null, agora: Date, horas = 24) {
  const d = def(id);
  const r = await tx((c) => criarInstancia(c, { def: d, escopo: d.scope, ibge, uf: null, chave: `teste:${id}:${ibge}:${agora.toISOString()}:${Math.random()}`, inicio: mais(agora, -3600), fim: mais(agora, horas * 3600 - 3600), modo: 'automatico', criado_por: 'teste', progresso: d.mechanic.params.alvo === 'meta_instancia' ? { meta: 100, total: 0 } : {} }));
  await avancar(agora);
  const e = (await q1<{ estado: string }>(`select estado from event_instances where id = $1`, [r.id]))!;
  expect(e.estado).toBe('active');
  return r.id!;
}
const part = (u: string, inst: string, acao: any, agora: Date) => tx((c) => participar(c, u, inst, acao, agora));
const des = (u: string, inst: string, acao: any, agora: Date) => tx((c) => desafioEvento(c, u, inst, acao, agora)) as Promise<any>;

describe('fase 3 · catálogo', () => {
  it('60 IDs únicos (E01–E60) e regras válidas; desabilitado sempre com motivo; todos os motores em uso', async () => {
    expect(CATALOGO.length).toBe(60);
    expect(new Set(CATALOGO.map((d) => d.id)).size).toBe(60);
    expect(CATALOGO.map((d) => d.id)).toEqual(Array.from({ length: 60 }, (_, i) => 'E' + String(i + 1).padStart(2, '0')));
    expect(validarCatalogo(CATALOGO)).toEqual([]);
    for (const d of CATALOGO.filter((x) => !x.enabled)) expect(d.disabled_reason!.length).toBeGreaterThan(10);
    const motoresHabilitados = new Set(CATALOGO.filter((d) => d.enabled).map((d) => d.mechanic.motor));
    expect([...motoresHabilitados].sort()).toEqual([...MOTORES].sort());
    expect(await tx((c) => sincronizarCatalogo(c))).toBe(60);
    expect((await q1<{ n: number }>(`select count(*)::int n from event_definitions`))!.n).toBe(60);
  });

  it('validador recusa definição quebrada (motor sem regra, XP em eleição, asset ausente, sem motivo)', () => {
    const base = def('E09');
    const ruins: [Partial<EventDefinition>, RegExp][] = [
      [{ completion_rule: { tipo: 'acertos_min' } }, /não existe no motor/],
      [{ category: 'eleicao_editorial' }, /eleição não pode dar XP/],
      [{ visual_asset_ids: ['asset.inexistente'] }, /asset ausente/],
      [{ enabled: false, disabled_reason: undefined }, /sem motivo/],
      [{ reward_rule_id: 'xp999@1' }, /reward_rule_id inexistente/],
      [{ reward_rule_id: 'contrib10_missao@1' }, /contribuição competitiva/],
      [{ min_participants: 3 }, /regra de cancelamento/],
    ];
    for (const [patch, re] of ruins) expect(validarDefinicao({ ...base, ...patch } as EventDefinition).join('\n')).toMatch(re);
    expect(validarCatalogo([base, base]).join()).toMatch(/duplicados/);
  });
});

describe('fase 3 · um exemplar por motor', () => {
  const agora = new Date('2031-06-11T15:00:00Z');
  const VIX = 3205309;

  it('quiz (E15): desafio do banco revisado, uma tentativa, recompensa única', async () => {
    const { moradores: [u] } = await ruaCom(VIX, 1);
    const inst = await ativa('E15', VIX, agora);
    const d = await des(u.userId, inst, {}, agora);
    expect(d.enunciado.perguntas.length).toBe(3);
    const r: any = await part(u.userId, inst, { desafio_id: d.id, respostas: await resposta(d.id) }, mais(agora, 5));
    expect(r.concluido).toBe(true); expect(r.recompensa.quantidade).toBe(15);
    expect((await part(u.userId, inst, { desafio_id: d.id, respostas: [] }, mais(agora, 9))).ja_concluido).toBe(true);
    expect(await somaLedger(u.userId, 'xp')).toBe(15);
  });

  it('exploração (E22): três cidades distintas fora de casa, cada uma com ação válida', async () => {
    const u = await moradorTeste(VIX);
    const inst = await ativa('E22', null, agora);
    const casa: any = await part(u.userId, inst, { ibge: VIX, desafio_id: null }, agora);
    expect(casa.erro).toMatch(/outra cidade/);
    let ult: any = null;
    for (const ibge of [3304557, 3550308, 2611606]) {
      const d = await des(u.userId, inst, { ibge }, agora);
      ult = await part(u.userId, inst, { ibge, desafio_id: d.id, resposta: await resposta(d.id) }, mais(agora, 5));
      if (ibge === 3304557) { const rep: any = await part(u.userId, inst, { ibge, desafio_id: d.id }, mais(agora, 6)); expect(rep.erro).toMatch(/já conta/); }
    }
    expect(ult.concluido).toBe(true); expect(ult.recompensa.quantidade).toBe(20);
  });

  it('contribuição (E11): ajuda validada entra na obra da rua com os mesmos limites', async () => {
    const { rua, moradores: [u] } = await ruaCom(VIX, 3);
    const inst = await ativa('E11', VIX, agora);
    const d = await des(u.userId, inst, {}, agora);
    const r: any = await part(u.userId, inst, { desafio_id: d.id, resposta: await resposta(d.id) }, mais(agora, 5));
    expect(r.concluido).toBe(true); expect(r.progresso.obra.progresso).toBe(10);
    expect((await q1<{ progresso: number }>(`select progresso from community_projects where street_id = $1`, [rua]))!.progresso).toBe(10);
  });

  it('decoração (E09 aplicar e E14 escolha): só opções do catálogo, com confirmação', async () => {
    const { moradores: [u, v] } = await ruaCom(VIX, 2);
    const inst = await ativa('E09', VIX, agora);
    expect(((await part(u.userId, inst, { config: { cor: 'cor.neon' }, confirmar: true }, agora)) as any).erro).toMatch(/opção inválida/);
    expect(((await part(u.userId, inst, { config: { cor: 'cor.azul' } }, agora)) as any).erro).toMatch(/confirme/);
    const r: any = await part(u.userId, inst, { config: { cor: 'cor.azul' }, confirmar: true }, agora);
    expect(r.concluido).toBe(true); expect(r.recompensa.quantidade).toBe(10);
    const mural = await ativa('E14', VIX, agora);
    await part(u.userId, mural, { escolha: { arte: 'mural.flores' } }, agora);
    await part(v.userId, mural, { escolha: { arte: 'mural.flores' } }, agora);
    expect(((await part(v.userId, mural, { escolha: { arte: 'texto livre' } }, agora)) as any).ja_concluido).toBe(true);
    const p = (await q1<{ progresso: any }>(`select progresso from event_instances where id = $1`, [mural]))!.progresso;
    expect(p.votos).toEqual({ 'arte=mural.flores': 2 });
  });

  it('reação (E36): sequência sorteada pelo servidor', async () => {
    const u = await moradorTeste(VIX);
    const inst = await ativa('E36', VIX, agora);
    const d = await des(u.userId, inst, {}, agora);
    expect(d.enunciado.sequencia.length).toBe(4);
    expect(((await part(u.userId, inst, { desafio_id: d.id, sequencia: ['rir'] }, mais(agora, 5))) as any).erro).toBeTruthy();
    const r: any = await part(u.userId, inst, { desafio_id: d.id, sequencia: await resposta(d.id) }, mais(agora, 6));
    expect(r.concluido).toBe(true);
  });

  it('presença (E30): check-in sozinho não vale; ação depois do tempo mínimo vale', async () => {
    const u = await moradorTeste(VIX);
    const inst = await ativa('E30', VIX, agora, 2);
    const ck: any = await part(u.userId, inst, { tipo: 'checkin', local: 'praca_visitantes' }, agora);
    expect(ck.concluido).toBe(false); expect(ck.recompensa).toBeNull();
    const id = ck.info.desafio.id;
    expect(((await part(u.userId, inst, { local: 'praca_visitantes', desafio_id: id, resposta: await resposta(id) }, mais(agora, 1))) as any).erro).toMatch(/rápido demais/);
    const r: any = await part(u.userId, inst, { local: 'praca_visitantes', desafio_id: id, resposta: await resposta(id) }, mais(agora, 6));
    expect(r.concluido).toBe(true); expect(r.recompensa.quantidade).toBe(10);
  });

  it('social (E27): outra conta reivindicada de outra rua da mesma cidade; sem autoindicação', async () => {
    const A = await ruaCom(VIX, 1), B = await ruaCom(VIX, 1);
    const u = A.moradores[0], v = B.moradores[0], mesmaRua = await moradorTeste(VIX, { rua: A.rua });
    const inst = await ativa('E27', VIX, agora);
    expect(((await part(u.userId, inst, { alvo_user_id: u.userId, emote: 'acenar' }, agora)) as any).erro).toMatch(/outra pessoa/);
    expect(((await part(u.userId, inst, { alvo_user_id: mesmaRua.userId, emote: 'acenar' }, agora)) as any).erro).toMatch(/OUTRA rua/);
    const r: any = await part(u.userId, inst, { alvo_user_id: v.userId, emote: 'acenar' }, agora);
    expect(r.concluido).toBe(true); expect(r.recompensa.quantidade).toBe(10);
  });

  it('calendário (E50): confirmação de fato real, sem XP', async () => {
    const u = await moradorTeste(VIX);
    const inst = await ativa('E50', VIX, agora);
    const r: any = await part(u.userId, inst, { tipo: 'confirmar' }, agora);
    expect(r.concluido).toBe(true); expect(r.recompensa.sistema).toBe('nenhum');
    expect(await somaLedger(u.userId, 'xp')).toBe(0);
  });

  it('evento coletivo sem participantes suficientes é cancelado e não paga nem vira fato', async () => {
    const u = await moradorTeste(VIX);
    const inst = await ativa('E38', VIX, agora, 2);
    const d = await des(u.userId, inst, {}, agora);
    const r: any = await part(u.userId, inst, { desafio_id: d.id, sequencia: await resposta(d.id) }, mais(agora, 5));
    expect(r.recompensa.pendente).toBe(true);
    await avancar(mais(agora, 3 * 3600)); await avancar(mais(agora, 3 * 3600 + 1));
    const e = (await q1<{ estado: string; motivo: string }>(`select estado, motivo from event_instances where id = $1`, [inst]))!;
    expect(e.estado).toBe('cancelled'); expect(e.motivo).toMatch(/insuficientes/);
    expect(await somaLedger(u.userId, 'xp')).toBe(0);
    expect((await q1(`select 1 from domain_events where chave_idempotencia = $1`, [`evento:${inst}:concluido`]))).toBeNull();
  });

  it('rotas: agenda da cidade e participação por HTTP; kill switch pausa só os eventos', async () => {
    const u = await moradorTeste(VIX);
    const inst = await ativa('E50', VIX, new Date());
    const c = cliente(); c.jar.set('smn_sess', await sessaoTeste(u.userId)); await c.aquecer();
    const ag = await c.get('/api/eventos');
    expect(ag.status).toBe(200); expect(ag.json.eventos.some((e: any) => e.id === inst)).toBe(true);
    const cat = await c.get('/api/eventos/catalogo');
    expect(cat.json.eventos.length).toBe(60); expect(cat.json.eventos.find((e: any) => e.id === 'E54').motivo).toMatch(/Fase 6/);
    config.kill.eventos = true;
    try {
      expect((await c.post(`/api/eventos/${inst}/participar`, { acao: { tipo: 'confirmar' } })).status).toBe(503);
      expect((await planejar()).pausado).toBe(true);
      expect((await c.get('/api/missoes')).status).toBe(200); // o jogo continua
    } finally { config.kill.eventos = false; }
    const ok = await c.post(`/api/eventos/${inst}/participar`, { acao: { tipo: 'confirmar' } });
    expect(ok.status).toBe(200); expect(ok.json.concluido).toBe(true);
    expect((await c.post(`/api/eventos/${inst}/inscrever`)).json.estado).toBe('concluido');
  });
});

describe('fase 3 · orquestrador', () => {
  it('scheduler reiniciado (inclusive após queda no meio) não duplica evento; respeita 48h e cidade pequena', async () => {
    const agora = new Date('2032-03-03T06:00:00Z');
    await ruaCom(2927408, 1, 'Rua Solo Salvador');                                    // cidade pequena (1 ativo)
    for (const n of ['Norte', 'Sul', 'Leste']) await ruaCom(4314902, 3, 'Rua ' + n + ' POA'); // 3 ruas, 9 ativos
    await expect(planejar(agora, { falharAposCidades: 1 })).rejects.toThrow(/queda simulada/);
    const r2 = await planejar(agora);
    const n2 = (await q1<{ n: number }>(`select count(*)::int n from event_instances`))!.n;
    const r3 = await planejar(agora);
    const n3 = (await q1<{ n: number }>(`select count(*)::int n from event_instances`))!.n;
    expect(r2.criadas + r2.permanentes).toBeGreaterThan(0);
    expect(r3.criadas + r3.permanentes + r3.por_fato).toBe(0);
    expect(n3).toBe(n2);
    const dup = await q(`select definicao_id, ibge, uf, inicio, count(*) from event_instances group by 1, 2, 3, 4 having count(*) > 1`);
    expect(dup).toEqual([]);
    expect((await q1<{ execucoes: number }>(`select execucoes from event_planner_runs where chave = 'madrugada:2032-03-03'`))!.execucoes).toBe(3);
    // nenhuma categoria repetida na mesma cidade em 48h (fora calendário eleitoral)
    const rep = await q(`select a.id from event_instances a join event_instances b on a.ibge = b.ibge and a.categoria = b.categoria and a.id < b.id
                          where a.criado_por = 'planejador' and b.criado_por = 'planejador' and not a.permanente and not b.permanente and a.categoria <> 'eleicao_editorial' and abs(extract(epoch from a.inicio - b.inicio)) < 48 * 3600`);
    expect(rep).toEqual([]);
    // cidade pequena: nada coletivo (E33/E38), nada entre ruas (E27), nada de competição sem adversário
    const pequenos = await q<{ definicao_id: string }>(`select definicao_id from event_instances where ibge = 2927408`);
    expect(pequenos.length).toBeGreaterThan(0);
    expect(pequenos.filter((x) => ['E33', 'E38', 'E27', 'E49', 'E50', 'E53'].includes(x.definicao_id))).toEqual([]);
    // permanentes (boas-vindas) já estão ativas; agendados aguardam o anúncio
    expect((await q1<{ estado: string }>(`select estado from event_instances where chave = 'E01@1:permanente'`))!.estado).toBe('active');
    expect((await q<{ estado: string }>(`select distinct estado from event_instances where not permanente and ibge in (2927408, 4314902)`)).map((x) => x.estado)).toEqual(['scheduled']);
  });

  it('IA indisponível mantém o calendário com textos parametrizados (e registra a falha)', async () => {
    const antes = { ...config.ia }; const env = { m: process.env.IA_MODELO, u: process.env.IA_URL };
    Object.assign(config.ia, { provedor: 'anthropic', chave: 'chave-de-teste' });
    process.env.IA_MODELO = 'modelo-teste'; process.env.IA_URL = 'http://127.0.0.1:9/v1/messages';
    try {
      await ruaCom(3106200, 3, 'Rua IA BH');
      const r = await planejar(new Date('2032-04-07T06:00:00Z'));
      expect(r.ia).toBe(true); expect(r.criadas).toBeGreaterThan(0);
      const fontes = await q<{ fonte: string }>(`select distinct textos->>'fonte' fonte from event_instances where criado_em > now() - interval '1 minute' and not permanente`);
      expect(fontes.map((f) => f.fonte)).toEqual(['template']);
      expect((await q1<{ n: number }>(`select count(*)::int n from ai_calls where not ok`))!.n).toBeGreaterThan(0);
      const t = (await q1<{ textos: any }>(`select textos from event_instances where ibge = 3106200 and not permanente limit 1`))!.textos;
      expect(t.chamada.length).toBeGreaterThan(3); expect(t.template_id).toMatch(/^gancho\.E\d\d$/);
    } finally { Object.assign(config.ia, antes); process.env.IA_MODELO = env.m; process.env.IA_URL = env.u; if (!env.m) delete process.env.IA_MODELO; if (!env.u) delete process.env.IA_URL; }
  });

  it('fato real de competição agenda evento ancorado; consolidação horária emite conteudo.fato uma vez só', async () => {
    const agora = new Date('2032-05-05T06:00:00Z');
    await ruaCom(2304400, 3, 'Rua Fato Fortaleza');
    await tx((c) => emitir(c, 'competicao.virada', { ibge: 2304400, season_id: null, lideres: [] }, 'teste:virada:fortaleza'));
    await tx((c) => emitir(c, 'eleicao.votacao_aberta', { eleicaoId: 'x', escopoId: '2304400', fechaEm: '2032-05-08T21:00:00Z' }, 'teste:votacao:fortaleza'));
    await q(`update domain_events set criado_em = $1 where chave_idempotencia like 'teste:%'`, [agora]);
    const r = await planejar(agora);
    expect(r.por_fato).toBeGreaterThanOrEqual(2);
    const ids = (await q<{ definicao_id: string; inicio: Date }>(`select definicao_id, inicio from event_instances where ibge = 2304400 and chave like '%:fato:%' order by definicao_id`));
    expect(ids.map((x) => x.definicao_id)).toEqual(expect.arrayContaining(['E45', 'E46', 'E50']));
    // E46 usa o horário oficial (24h antes do fechamento) — a IA/planejador não mexe no calendário eleitoral
    expect(new Date(ids.find((x) => x.definicao_id === 'E46')!.inicio).toISOString()).toBe('2032-05-07T21:00:00.000Z');
    const f1 = await consolidarFatos(agora);
    const f2 = await consolidarFatos(agora);
    expect(f1.emitidos).toBeGreaterThan(0); expect(f2).toMatchObject({ lidos: 0, emitidos: 0 });
    const fatos = await q(`select chave_idempotencia from domain_events where tipo = 'conteudo.fato'`);
    expect(new Set(fatos.map((f: any) => f.chave_idempotencia)).size).toBe(fatos.length);
  });

  it('modo assistido deixa propostas para revisão; inscrição opt-in respeita limite', async () => {
    await q(`update event_orchestrator_settings set modo = 'assistido'`);
    try {
      await ruaCom(1501402, 1, 'Rua Belém');
      await planejar(new Date('2032-06-02T06:00:00Z'));
      const est = await q<{ estado: string }>(`select distinct estado from event_instances where ibge = 1501402 and not permanente`);
      expect(est.map((e) => e.estado)).toEqual(['proposed']);
    } finally { await q(`update event_orchestrator_settings set modo = 'automatico'`); }
    const u = await moradorTeste(3205309); const agora = new Date('2031-06-11T15:00:00Z');
    const ids = [];
    for (const id of ['E09', 'E36', 'E15', 'E25']) ids.push(await ativa(id, 3205309, agora));
    for (const i of ids) await tx((c) => inscrever(c, u.userId, i));
    const extra = await ativa('E58', 3205309, agora);
    await expect(tx((c) => inscrever(c, u.userId, extra))).rejects.toThrow(/limite de 4 eventos/);
  });
});
