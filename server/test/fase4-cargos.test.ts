/* Fase 4 · presidente (apoios, limiar nacional), poderes dos cargos como comandos de catálogo com quota/auditoria e
   limites: presidente não altera eleições municipais, prefeito não controla cidade alheia, líder não despeja. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo } from './ajuda';
import { fecharDb, q, q1, db } from '../src/db/db';
import { apoiar } from '../src/modulos/eleicoes/dominio';
import { executarAcao, escolhaVigente } from '../src/modulos/eleicoes/cargos';
import { tempos, eleicaoDe, cidade, inscrever, votarTodos, estado, mandatos, eventos, avancarEleicao, candidatar, votar, mais } from './fase4-ajuda';
import type { Morador } from './fixtures';

const { inscr, votando, publica } = tempos(7);
const depois = mais(publica, 30);

beforeAll(bancoLimpo);
afterAll(fecharDb);

let todos: Morador[] = [];
let presidente: Morador;

describe('fase 4 · presidente', () => {
  it('candidatura a presidente exige 5 apoios de contas elegíveis; apoio não é voto', async () => {
    for (const ibge of [3205309, 3301702, 3550308, 3304557]) todos.push(...(await cidade(ibge, 13)).m); // 52 eleitores no país
    const e = await eleicaoDe('presidente', 'BR', inscr);
    const [p1, p2] = await inscrever([todos[0], todos[13]], 'presidente', e.id, inscr);
    await expect(apoiar(todos[0].userId, e.id, p1, inscr)).rejects.toThrow(/outra conta/);
    for (const x of todos.slice(1, 6)) await apoiar(x.userId, e.id, p1, inscr);
    for (const x of todos.slice(14, 18)) await apoiar(x.userId, e.id, p2, inscr); // só 4
    await expect(apoiar(todos[1].userId, e.id, p2, inscr)).rejects.toThrow(/já apoia outra/);
    expect((await apoiar(todos[1].userId, e.id, p1, inscr)).apoios).toBe(5); // repetir é idempotente
    // apoio não cria voto nem mexe em placar
    expect((await q1<any>(`select count(*)::int n from votes where election_id = $1`, [e.id])).n).toBe(0);
    expect(await avancarEleicao(e.id, votando)).toBe('votacao');
    const f = await estado(e.id);
    expect(f).toMatchObject({ eleitorado: 52, quorum: 16, modo: 'confirmacao' });
    expect((await q1<any>(`select estado from candidates where id = $1`, [p2])).estado).toBe('sem_apoios');
    await votarTodos(e.id, todos.slice(20, 36).map((x) => [x, p1] as [Morador, string]), votando);
    await votar(todos[40].userId, e.id, 'rejeitar', votando);
    expect(await avancarEleicao(e.id, publica)).toBe('publicada');
    expect(await estado(e.id)).toMatchObject({ resultado_tipo: 'eleito_sem_concorrencia', vencedor_user_id: todos[0].userId });
    presidente = todos[0];
    expect(await mandatos('presidente', 'BR')).toHaveLength(1);
  });

  it('trocar de cargo durante as inscrições invalida os apoios anteriores', async () => {
    // temporada seguinte (+14 dias): nova eleição nacional
    const t2 = tempos(14);
    const e = await eleicaoDe('presidente', 'BR', t2.inscr);
    const [k] = await inscrever([todos[50]], 'presidente', e.id, t2.inscr);
    await apoiar(todos[49].userId, e.id, k, t2.inscr); await apoiar(todos[48].userId, e.id, k, t2.inscr);
    const pref = await eleicaoDe('prefeito', String(todos[50].ibge), t2.inscr);
    await candidatar(todos[50].userId, pref.id, { cargo: 'prefeito', trocar: true }, t2.inscr);
    const sup = await q<any>(`select invalidado_em, motivo_invalidacao from nomination_supports where candidate_id = $1`, [k]);
    expect(sup).toHaveLength(2);
    expect(sup.every((s) => s.invalidado_em && /trocou/.test(s.motivo_invalidacao))).toBe(true);
    // o apoiador fica livre para apoiar outra candidatura
    const [k2] = await inscrever([todos[47]], 'presidente', e.id, t2.inscr);
    expect((await apoiar(todos[49].userId, e.id, k2, t2.inscr)).apoios).toBe(1);
  });
});

describe('fase 4 · poderes dos cargos', () => {
  it('presidente escolhe tema nacional do catálogo, com quota e auditoria; não altera eleições municipais', async () => {
    const mun = await eleicaoDe('prefeito', '3205309', depois);
    const antes = await estado(mun.id);
    const r = await executarAcao(presidente.userId, { tipo: 'tema_nacional', opcao: 'presidente.tema.futebol' }, depois);
    expect(r.opcao).toBe('presidente.tema.futebol');
    await expect(executarAcao(presidente.userId, { tipo: 'tema_nacional', opcao: 'presidente.tema.carnaval' }, depois)).rejects.toThrow(/quota/);
    for (const tipo of ['cancelar_eleicao', 'alterar_voto', 'alterar_regra', 'remover_prefeito', 'dar_moedas', 'moderar'])
      await expect(executarAcao(presidente.userId, { tipo, opcao: mun.id }, depois)).rejects.toThrow(/não tem esse poder/);
    await expect(executarAcao(presidente.userId, { tipo: 'festival', opcao: 'prefeito.festival.junino' }, depois)).rejects.toThrow(/fora do catálogo/);
    await expect(executarAcao(presidente.userId, { tipo: 'monumento', opcao: 'presidente.monumento.arco', escopoId: '3205309' }, depois)).rejects.toThrow(/vale só para/);
    const dep = await estado(mun.id);
    expect(dep.estado).toBe(antes.estado); expect(dep.regra_id).toBe(antes.regra_id);
    expect((await q1<any>(`select count(*)::int n from admin_audit_logs where acao = 'cargo.acao' and ator_user_id = $1`, [presidente.userId])).n).toBe(1);
    expect((await eventos('cargo.acao', (d) => d.cargo === 'presidente')).length).toBe(1);
    expect(await escolhaVigente(db(), 'presidente', 'BR', 'tema_nacional', mais(depois, 1))).toMatchObject({ fonte: 'cargo', opcao: 'presidente.tema.futebol' });
  });

  it('prefeito não controla cidade alheia; cidade sem prefeito segue o calendário neutro', async () => {
    const { m } = await cidade(2611606, 5);
    const e = await eleicaoDe('prefeito', '2611606', inscr);
    const [a, b] = await inscrever([m[0], m[1]], 'prefeito', e.id, inscr);
    await avancarEleicao(e.id, votando);
    await votarTodos(e.id, [[m[2], a], [m[3], a], [m[4], b]], votando);
    expect(await avancarEleicao(e.id, publica)).toBe('publicada');
    await expect(executarAcao(m[0].userId, { tipo: 'festival', opcao: 'prefeito.festival.musica', escopoId: '3301702' }, depois)).rejects.toThrow(/vale só para/);
    await executarAcao(m[0].userId, { tipo: 'festival', opcao: 'prefeito.festival.musica', escopoId: '2611606' }, depois);
    expect(await escolhaVigente(db(), 'prefeito', '2611606', 'festival', mais(depois, 1))).toMatchObject({ fonte: 'cargo', opcao: 'prefeito.festival.musica' });
    expect(await escolhaVigente(db(), 'prefeito', '3301702', 'festival', mais(depois, 1))).toMatchObject({ fonte: 'calendario_neutro' });
    expect(await q<any>(`select * from office_actions where escopo_id = '3301702'`)).toHaveLength(0);
    // quem não tem cargo não executa nada
    await expect(executarAcao(m[2].userId, { tipo: 'festival', opcao: 'prefeito.festival.junino' }, depois)).rejects.toThrow(/não ocupa cargo/);
  });

  it('líder escolhe obra/evento/decoração, mas não despeja nem expulsa moradores', async () => {
    const { rua, m } = await cidade(5300108, 3);
    const e = await eleicaoDe('lider', rua, inscr);
    const [k] = await inscrever([m[0]], 'lider', e.id, inscr);
    await avancarEleicao(e.id, votando);
    await votarTodos(e.id, [[m[1], k], [m[2], k]], votando);
    expect(await avancarEleicao(e.id, publica)).toBe('publicada');
    const membrosAntes = (await q1<any>(`select count(*)::int n from street_memberships where street_id = $1 and saiu_em is null`, [rua])).n;
    for (const tipo of ['despejar', 'expulsar', 'remover_morador', 'tomar_casa'])
      await expect(executarAcao(m[0].userId, { tipo, opcao: m[1].houseId }, depois)).rejects.toThrow(/não tem esse poder/);
    await expect(executarAcao(m[0].userId, { tipo: 'obra', opcao: 'inexistente' }, depois)).rejects.toThrow(/fora do catálogo/);
    for (const [tipo, opcao] of [['obra', 'lider.obra.horta'], ['evento', 'lider.evento.cinema'], ['decoracao', 'lider.decoracao.luzes']])
      await executarAcao(m[0].userId, { tipo, opcao }, depois);
    expect((await q1<any>(`select count(*)::int n from street_memberships where street_id = $1 and saiu_em is null`, [rua])).n).toBe(membrosAntes);
    expect((await q1<any>(`select count(*)::int n from houses where id = $1 and status = 'reivindicada'`, [m[1].houseId])).n).toBe(1);
    // a ação expira no máximo no fim do mandato
    const a = await q1<any>(`select a.expira_em, t.fim from office_actions a join office_terms t on t.id = a.term_id where a.opcao_id = 'lider.obra.horta'`);
    expect(new Date(a.expira_em).getTime()).toBeLessThanOrEqual(new Date(a.fim).getTime());
  });
});
