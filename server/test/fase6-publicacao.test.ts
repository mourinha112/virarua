/* Fase 6 · regras editoriais e de publicação (sem render pesado: o render é concluído com um arquivo sintético). */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { bancoLimpo, cliente } from './ajuda';
import { moradorTeste } from './fixtures';
import { fecharDb, q, q1, emitir, db } from '../src/db/db';
import { aoEvento, publicarOutbox } from '../src/jobs/fila';
import { config } from '../src/config';
import { conteudoConfig } from '../src/modulos/conteudo/config';
import { agendar, aprovar, concluirRender, criarPauta, registrarCandidata, reivindicarRender, registrarFunil, relatorioFunil, type Candidata } from '../src/modulos/conteudo/pipeline';
import { depsPadrao, publicarJob, type GraphCliente, type StatusContainer } from '../src/modulos/conteudo/publicador';

const tmp = resolve(tmpdir(), 'smn-fase6-' + process.pid); mkdirSync(tmp, { recursive: true });
const MP4 = resolve(tmp, 'v.mp4'), JPG = resolve(tmp, 't.jpg'); writeFileSync(MP4, 'mp4-sintetico'); writeFileSync(JPG, 'jpg-sintetico');
let app: ReturnType<typeof cliente>['app'];
let seq = 0;
beforeAll(async () => { await bancoLimpo(); app = cliente().app; conteudoConfig.dirPacotes = resolve(tmp, 'pacotes'); });
afterAll(fecharDb);
afterEach(() => { config.kill.render = false; config.publicacao.autopublish = false; });

async function ev(tipo: string, dados: Record<string, unknown>) { await emitir(db(), tipo, dados, `teste:${tipo}:${++seq}`); await publicarOutbox(); }
const prazo = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

/** cidade com moradores reais e uma candidata 'casa' */
async function candidataCasa(ibge = 3301702, extra: Partial<Candidata> = {}) {
  await moradorTeste(ibge);
  return registrarCandidata({ template_id: 'casa', chave: `casa:${ibge}:${++seq}`, escopo: { tipo: 'cidade', nome: 'Duque de Caxias', uf: 'RJ', ibge }, categoria: 'crescimento-' + seq, ...extra }, [1]);
}
/** leva a pauta até 'scheduled' (render concluído com arquivo sintético + inspeção ok) */
async function agendada(candId: string) {
  const pub = await criarPauta(candId);
  await q(`update render_jobs set estado = 'rodando', tentativas = 1, travado_ate = now() + interval '5 min' where id = $1 and estado = 'pendente'`, [pub.render_job_id]);
  await concluirRender(pub.render_job_id, { ok: true, mp4: MP4, thumb: JPG, inspecao: { ok: true } });
  await aprovar(pub.id, null); await agendar(pub.id);
  return pub.id as string;
}
const estado = async (id: string) => (await q1<any>(`select estado, motivo from publication_jobs where id = $1`, [id]))!;

/** cliente Graph falso que simula timeout no media_publish */
function grafoFalso(o: { publicaNoTimeout: boolean }) {
  const s = { container: 0, publicar: 0, status: [] as string[], publicado: false };
  const c: GraphCliente = {
    async criarContainer() { s.container++; return 'container-1'; },
    async statusContainer(): Promise<StatusContainer> { const st = s.publicado ? 'PUBLISHED' : 'FINISHED'; s.status.push(st); return st; },
    async publicar() { s.publicar++; if (s.publicar === 1) { if (o.publicaNoTimeout) s.publicado = true; throw new Error('timeout: The operation was aborted'); } s.publicado = true; return 'midia-2'; },
    async buscarMidiaPublicada() { return s.publicado ? { id: 'midia-1', permalink: 'https://instagram.example/p/1' } : null; },
  };
  return { c, s };
}

describe('fase 6 · publicação', () => {
  it('vitória provisória não vira vídeo de posse', async () => {
    await ev('eleicao.parcial', { eleicao_id: 'e1', nome: 'Recife', uf: 'PE', ibge: 2611606, lider_mudou: true, diferenca_votos: 3, diferenca_publicavel: true, prazo: prazo(24), rodada: 1 });
    await ev('eleicao.apurada', { eleicao_id: 'e1', nome: 'Recife', uf: 'PE', ibge: 2611606, oficial: false, cargo: 'prefeito', mandato_dias: 7 });
    const cands = await q<any>(`select template_id, election_status from content_candidates where escopo->>'eleicao_id' = 'e1'`);
    expect(cands.map((c) => c.template_id)).toEqual(['virada']);
    expect(cands[0].election_status).toBe('em_andamento');
    // forçar um "resultado" com placar provisório: o contrato barra
    const forcada = await registrarCandidata({ template_id: 'resultado', chave: 'forcada:e1', escopo: { tipo: 'eleicao', nome: 'Recife', uf: 'PE', ibge: 2611606, eleicao_id: 'e1' }, election_status: 'provisorio', categoria: 'eleicao', fatos: { cargo: 'prefeito', mandato_dias: 7 } }, [1]);
    await expect(criarPauta(forcada)).rejects.toThrow(/exige election_status em \[oficial\]/);
    // a virada pautada e agendada é cancelada quando a apuração oficial sai
    const virada = await q1<any>(`select id from content_candidates where template_id = 'virada' and escopo->>'eleicao_id' = 'e1'`);
    const pubVirada = await agendada(virada.id);
    await ev('eleicao.apurada', { eleicao_id: 'e1', nome: 'Recife', uf: 'PE', ibge: 2611606, oficial: true, cargo: 'prefeito', mandato_dias: 7 });
    expect(await estado(pubVirada)).toMatchObject({ estado: 'cancelled', motivo: expect.stringMatching(/votação encerrada/) });
    const res = await q1<any>(`select * from content_candidates where template_id = 'resultado' and chave = 'eleicao.resultado:e1'`);
    expect(res.election_status).toBe('oficial');
    const pubRes = await criarPauta(res.id);
    const snap = await q1<any>(`select dados from content_snapshots where id = $1`, [pubRes.snapshot_id]);
    expect(snap.dados.metrics.find((m: any) => m.chave === 'vencedor').valor).toBe('A candidatura vencedora');   // sem consentimento, sem nome
  });

  it('dry-run nunca envia: gera pacote MP4 + thumbnail + legenda e não chama a rede', async () => {
    const fetchOriginal = globalThis.fetch; let chamadas = 0;
    globalThis.fetch = (async () => { chamadas++; throw new Error('rede proibida no teste'); }) as any;
    try {
      const deps = await depsPadrao();
      expect(deps.modo).toBe('dry_run');   // IG_ADAPTADOR=dev e KILL_PUBLICACAO padrão ligado
      const id = await agendada(await candidataCasa());
      const g = grafoFalso({ publicaNoTimeout: false });
      expect(await publicarJob(id, { modo: 'dry_run', cliente: g.c })).toBe('exported_manual');   // mesmo com cliente, dry-run não usa
      expect(chamadas).toBe(0); expect(g.s.container + g.s.publicar).toBe(0);
      const p = await q1<any>(`select * from publication_jobs where id = $1`, [id]);
      expect(p).toMatchObject({ estado: 'exported_manual', modo: 'dry_run', media_id_externo: null });
      expect(existsSync(resolve(p.pacote_manual, 'video.mp4'))).toBe(true);
      expect(existsSync(resolve(p.pacote_manual, 'thumbnail.jpg'))).toBe(true);
      expect(readFileSync(resolve(p.pacote_manual, 'legenda.txt'), 'utf8')).toMatch(/Jogo virtual Seu Mundo Novo/);
      expect(JSON.parse(readFileSync(resolve(p.pacote_manual, 'manifesto.json'), 'utf8')).status).toMatch(/^NAO_PUBLICADO/);
      expect(await publicarJob(id)).toBe('exported_manual');   // rodar de novo não faz nada
    } finally { globalThis.fetch = fetchOriginal; }
  });

  it('publicação com timeout reconcilia antes de retry (não duplica post)', async () => {
    // caso 1: o media_publish deu timeout MAS publicou → retry reconcilia e não chama publicar de novo
    const id1 = await agendada(await candidataCasa());
    const g1 = grafoFalso({ publicaNoTimeout: true });
    const deps1 = { modo: 'oficial' as const, cliente: g1.c, urlMidia: (f: string) => 'https://midia.example/' + f.split(/[\\/]/).pop() };
    await expect(publicarJob(id1, deps1)).rejects.toThrow(/timeout/);
    const meio = await q1<any>(`select * from publication_jobs where id = $1`, [id1]);
    expect(meio.estado).toBe('publishing'); expect(meio.publicar_enviado_em).not.toBeNull(); expect(meio.container_id).toBe('container-1');
    expect(await publicarJob(id1, deps1)).toBe('published');
    expect(g1.s.publicar).toBe(1); expect(g1.s.container).toBe(1);
    expect(await q1(`select media_id_externo m from publication_jobs where id = $1`, [id1])).toEqual({ m: 'midia-1' });
    const fases = (await q<any>(`select fase, resultado from publication_attempts where publication_job_id = $1 order by id`, [id1])).map((a) => `${a.fase}:${a.resultado}`);
    expect(fases).toContain('reconciliar:PUBLISHED');
    expect(fases.indexOf('reconciliar:PUBLISHED')).toBeGreaterThan(fases.indexOf('erro:falha'));

    // caso 2: timeout e NÃO publicou (container ainda FINISHED) → retry publica uma vez, mesmo container
    const id2 = await agendada(await candidataCasa());
    const g2 = grafoFalso({ publicaNoTimeout: false });
    const deps2 = { ...deps1, cliente: g2.c };
    await expect(publicarJob(id2, deps2)).rejects.toThrow(/timeout/);
    expect(await publicarJob(id2, deps2)).toBe('published');
    expect(g2.s.container).toBe(1); expect(g2.s.publicar).toBe(2);
    expect(g2.s.status).toEqual(['FINISHED', 'FINISHED']);   // 1º: antes de publicar; 2º: reconciliação
  });

  it('remover autorização promocional cancela jobs pendentes e some de novos renders', async () => {
    const m = await moradorTeste(2611606, { adulto: true });
    await q(`insert into privacy_preferences (user_id, aparecer_em_video) values ($1, true)`, [m.userId]);
    await ev('eleicao.apurada', { eleicao_id: 'e2', nome: 'Recife', uf: 'PE', ibge: 2611606, oficial: true, cargo: 'prefeito', mandato_dias: 7, vencedor_user_id: m.userId });
    const cand = await q1<any>(`select id from content_candidates where chave = 'eleicao.resultado:e2'`);
    const pub = await criarPauta(cand.id);
    const snap = await q1<any>(`select * from content_snapshots where id = $1`, [pub.snapshot_id]);
    expect(snap.perfis_user_ids).toEqual([m.userId]);
    expect(snap.dados.permitted_public_profiles[0].nome_publico).toMatch(/^Teste /);
    expect(JSON.stringify(snap.dados)).not.toContain(m.userId);   // id interno fica fora do input do template
    // outra pauta já agendada com a mesma pessoa
    await q(`update content_candidates set chave = chave || ':b' where id = $1`, [cand.id]);
    const outra = await registrarCandidata({ template_id: 'resultado', chave: 'eleicao.resultado:e2:x', escopo: { tipo: 'eleicao', nome: 'Recife', uf: 'PE', ibge: 2611606, eleicao_id: 'e2' }, election_status: 'oficial', categoria: 'eleicao', perfis_user_ids: [m.userId], fatos: { cargo: 'prefeito', mandato_dias: 14 } }, [1]);
    const agendadaId = await agendada(outra);

    await ev('privacidade.video_revogado', { user_id: m.userId });
    expect((await estado(pub.id)).estado).toBe('cancelled');
    expect((await estado(agendadaId)).estado).toBe('cancelled');
    expect((await q1<any>(`select estado from render_jobs where id = $1`, [pub.render_job_id]))!.estado).toBe('cancelado');
    expect((await q1<any>(`select estado from editorial_calendar where publication_job_id = $1`, [agendadaId]))!.estado).toBe('liberado');
    expect((await q1<any>(`select estado from processing_jobs where chave = $1`, ['conteudo.publicar:' + agendadaId]))!.estado).toBe('cancelado');
    expect((await q1<any>(`select aparecer_em_video a from privacy_preferences where user_id = $1`, [m.userId]))!.a).toBe(false);
    // novo render da mesma eleição já não mostra a pessoa
    const nova = await registrarCandidata({ template_id: 'resultado', chave: 'eleicao.resultado:e2:nova', escopo: { tipo: 'eleicao', nome: 'Recife', uf: 'PE', ibge: 2611606, eleicao_id: 'e2' }, election_status: 'oficial', categoria: 'eleicao', perfis_user_ids: [m.userId], fatos: { cargo: 'prefeito', mandato_dias: 30 } }, [1]);
    const p2 = await criarPauta(nova);
    const s2 = await q1<any>(`select * from content_snapshots where id = $1`, [p2.snapshot_id]);
    expect(s2.perfis_user_ids).toEqual([]); expect(s2.dados.permitted_public_profiles).toEqual([]);
  });

  it('fato expirado não publica; número que mudou pede correção', async () => {
    const id = await agendada(await candidataCasa(3550308));
    await q(`update content_snapshots set valido_ate = now() - interval '1 minute' where id = (select snapshot_id from publication_jobs where id = $1)`, [id]);
    const g = grafoFalso({ publicaNoTimeout: false });
    expect(await publicarJob(id, { modo: 'oficial', cliente: g.c, urlMidia: () => 'https://x' })).toBe('cancelled');
    expect(await estado(id)).toMatchObject({ estado: 'cancelled', motivo: 'fato expirado' });
    expect(g.s.container + g.s.publicar).toBe(0);
    expect((await q1<any>(`select estado from editorial_calendar where publication_job_id = $1`, [id]))!.estado).toBe('liberado');

    const id2 = await agendada(await candidataCasa(3550308));
    await moradorTeste(3550308);   // mais uma casa reivindicada depois do snapshot
    expect(await publicarJob(id2, { modo: 'oficial', cliente: g.c, urlMidia: () => 'https://x' })).toBe('needs_correction');
    expect((await estado(id2)).motivo).toMatch(/número mudou/);
    expect(g.s.container + g.s.publicar).toBe(0);
  });

  it('falha de render não afeta voto nem jogo', async () => {
    let votos = 0;
    aoEvento('teste.voto_registrado', async () => { votos++; });
    const casas = (await q1<any>(`select count(*)::int n from houses`))!.n;
    // evento de conteúdo malformado entre dois votos: a outbox segue e o erro fica registrado
    await emitir(db(), 'teste.voto_registrado', { eleicao_id: 'x' }, 'teste:voto:1');
    await emitir(db(), 'conteudo.fato', { lixo: true }, 'teste:fato:ruim');
    await emitir(db(), 'teste.voto_registrado', { eleicao_id: 'x' }, 'teste:voto:2');
    await publicarOutbox();
    expect(votos).toBe(2);
    expect((await q1<any>(`select count(*)::int n from domain_events where publicado_em is null`))!.n).toBe(0);
    expect((await q1<any>(`select count(*)::int n from content_event_errors where tipo = 'conteudo.fato'`))!.n).toBe(1);

    // render falha até o limite: só o conteúdo vira 'failed'
    const pub = await criarPauta(await candidataCasa(4314902));
    for (let i = 0; i < 3; i++) {
      await q(`update render_jobs set estado = 'rodando', tentativas = tentativas + 1, travado_ate = now() + interval '5 min' where id = $1`, [pub.render_job_id]);
      await concluirRender(pub.render_job_id, { ok: false, erro: 'Chrome caiu' });
    }
    expect((await q1<any>(`select estado from render_jobs where id = $1`, [pub.render_job_id]))!.estado).toBe('morto');
    expect((await estado(pub.id)).estado).toBe('failed');
    expect((await q1<any>(`select count(*)::int n from houses`))!.n).toBe(casas + 1);   // só a casa da fixture
    expect((await app.request('/api/saude')).status).toBe(200);

    // kill switch do render: worker não recebe job; jogo continua
    const outra = await criarPauta(await candidataCasa(4314902));
    await q(`update render_jobs set estado = 'cancelado' where estado in ('pendente','erro') and id <> $1`, [outra.render_job_id]);   // isola a fila deste teste
    config.kill.render = true;
    expect(await reivindicarRender('teste')).toBeNull();
    config.kill.render = false;
    expect((await reivindicarRender('teste'))!.job.id).toBe(outra.render_job_id);
  });

  it('autopublish desligado por padrão; teto de 1 post orgânico por dia; demo nunca em campanha real', async () => {
    expect(config.publicacao.autopublish).toBe(false);
    expect(config.publicacao.maxPostsDia).toBe(1);
    const a = await agendada(await candidataCasa(2927408)), b = await agendada(await candidataCasa(2927408));
    const ag = await q<any>(`select data::text d, horario from editorial_calendar where publication_job_id = any($1::uuid[]) order by horario`, [[a, b]]);
    expect(ag).toHaveLength(2); expect(ag[0].d).not.toBe(ag[1].d);   // segundo post vai para outro dia

    // mesmo com autopublish ligado, sem storyboard aprovado não aprova sozinho
    config.publicacao.autopublish = true;
    const p = await criarPauta(await candidataCasa(2927408));
    await q(`update render_jobs set estado = 'rodando', tentativas = 1, travado_ate = now() + interval '5 min' where id = $1`, [p.render_job_id]);
    await concluirRender(p.render_job_id, { ok: true, mp4: MP4, thumb: JPG, inspecao: { ok: true } });
    expect((await estado(p.id)).estado).toBe('review');

    const demo = await candidataCasa(2927408, { demo: true, campanha: 'lancamento-real' });
    await expect(criarPauta(demo)).rejects.toThrow(/demonstração/);
    await expect(q(`insert into publication_jobs (snapshot_id, template_id, campanha, chave_idempotencia, demo) values ((select id from content_snapshots limit 1), 'casa', 'real', 'x', true)`)).rejects.toThrow();

    // funil: demo fora do relatório
    await registrarFunil({ etapa: 'comentario', chave: 'f1', campanha: 'c1', template_id: 'casa' });
    await registrarFunil({ etapa: 'comentario', chave: 'f1', campanha: 'c1', template_id: 'casa' });   // idempotente
    await registrarFunil({ etapa: 'reserva', chave: 'f2', campanha: 'c1', template_id: 'casa', demo: true });
    expect(await relatorioFunil()).toEqual([{ campanha: 'c1', template_id: 'casa', etapa: 'comentario', n: 1 }]);
  });

  it('migrações 050–051 são reversíveis', async () => {
    const { reverter, migrar } = await import('../src/db/migrar');
    const ids = (await q<any>(`select id from schema_migrations where id >= '050' order by id desc`)).map((r) => r.id);
    await reverter(ids.length, config.databaseUrl, () => {});
    expect(await q1(`select to_regclass('public.publication_jobs') r`)).toEqual({ r: null });
    await migrar(config.databaseUrl, () => {});
    expect((await q1<{ r: string }>(`select to_regclass('public.publication_jobs')::text r`))!.r).toBe('publication_jobs');
  });
});
