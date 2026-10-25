/* Fase 6 · render usa snapshot real: fatos vêm do banco (casas reivindicadas da fixture), passam pela API interna,
   o worker do video-studio renderiza de verdade (Chrome + ffmpeg, escala reduzida) e o vídeo mostra o número do snapshot. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { moradorTeste } from './fixtures';
import { fecharDb, q, q1, emitir, db } from '../src/db/db';
import { publicarOutbox } from '../src/jobs/fila';
import { conteudoConfig } from '../src/modulos/conteudo/config';
import { criarPauta } from '../src/modulos/conteudo/pipeline';
import { HtmlRenderer } from '../../video-studio/renderers/html.ts';
import { processarUm } from '../../video-studio/scheduler/worker.ts';
import { ORCAMENTO } from '../../video-studio/scheduler/orcamento.ts';

const TOKEN = 'token-teste-estudio';
let app: ReturnType<typeof cliente>['app'];
beforeAll(async () => { await bancoLimpo(); app = cliente().app; conteudoConfig.tokenEstudio = TOKEN; ORCAMENTO.memoriaLivreMinMB = 256; });   // máquina de dev com pouca RAM livre
afterAll(fecharDb);

/** adaptador da API interna do worker sobre o app de teste (mesmas rotas, mesmo Bearer) */
const api = async (metodo: string, caminho: string, corpo?: unknown) => {
  const r = await app.request(caminho, { method: metodo, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const j: any = await r.json(); if (r.status >= 400) throw new Error(j.erro); return j;
};

describe('fase 6 · render usa snapshot real', () => {
  it('evento → candidata → snapshot com origem rastreável → render pelo estúdio → revisão', async () => {
    const IBGE = 3205309;
    for (let i = 0; i < 3; i++) await moradorTeste(IBGE);
    await q(`update houses set status = 'reservada' where id = (select id from houses order by criada_em desc limit 1)`);   // reservada ≠ reivindicada
    await emitir(db(), 'cidade.marco', { ibge: IBGE, nome: 'Vitória', uf: 'ES', marco: 2 }, 'teste:marco:vitoria');
    await publicarOutbox();
    const cand = await q1<any>(`select * from content_candidates where template_id = 'casa'`);
    expect(cand).toBeTruthy(); expect(cand.event_ids.length).toBe(1);

    const pub = await criarPauta(cand.id);
    expect(pub.estado).toBe('rendering');
    const snap = await q1<any>(`select * from content_snapshots where id = $1`, [pub.snapshot_id]);
    const m = snap.dados.metrics.find((x: any) => x.chave === 'moradores_reivindicados');
    expect(m.valor).toBe(2);                                     // só as reivindicadas contam
    expect(m.origem).toMatchObject({ tipo: 'consulta', ref: expect.stringContaining('cidade.moradores_reivindicados') });
    expect(snap.dados.snapshot_id).toBe(snap.id);
    expect(snap.dados.event_ids).toEqual([Number(cand.event_ids[0])]);
    expect(snap.dados.demo).toBe(false);
    expect(JSON.stringify(snap.dados)).not.toMatch(/user_id|identity|token|email/);

    // idempotência e cache: mesma pauta não cria outra publicação nem outro render
    const de_novo = await criarPauta(cand.id);
    expect(de_novo.id).toBe(pub.id);
    expect((await q1<any>(`select count(*)::int n from render_jobs`))!.n).toBe(1);

    // sem token a API interna recusa
    expect((await app.request('/interno/conteudo/render/reivindicar', { method: 'POST' })).status).toBe(401);

    // worker real do estúdio, pela API interna
    const r = new HtmlRenderer();
    const id = await processarUm(api, r, { escala: 0.25 });
    const job = await q1<any>(`select * from render_jobs where id = $1`, [id]);
    expect(job.estado).toBe('feito');
    expect(job.inspecao).toMatchObject({ ok: true, largura: 270, altura: 480, fps: 30, duracao_s: 14, codec: 'h264', tem_audio: false });
    expect((await q1<any>(`select estado from publication_jobs where id = $1`, [pub.id]))!.estado).toBe('review');   // autopublish desligado

    // o vídeo mostra o número do snapshot (e não outro)
    const textos = await r.textos(snap.dados, [snap.dados.duration_s / 2 - 0.5]);
    expect(Object.values(textos)[0].join(' ')).toContain('2 casas reivindicadas');
  }, 240000);
});
