/* inspectOutput confere o arquivo de verdade (ffprobe/ffmpeg) e reprova vídeo preto, com áudio ou fora do formato. */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HtmlRenderer, RAIZ_ESTUDIO } from '../renderers/html.ts';
import { exemplo } from '../storyboards/exemplos.ts';
import { processarUm } from '../scheduler/worker.ts';
import { ORCAMENTO, temOrcamento } from '../scheduler/orcamento.ts';

const r = new HtmlRenderer(), dir = resolve(RAIZ_ESTUDIO, 'out/tmp/testes'); mkdirSync(dir, { recursive: true });
const ff = (args: string[]) => { const p = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]); if (p.status !== 0) throw new Error(String(p.stderr)); };

describe('inspectOutput', () => {
  const mp4 = resolve(dir, 'avatar-025.mp4');
  beforeAll(async () => { await r.render(exemplo('avatar'), { saida: mp4, escala: 0.25 }); });

  it('render real passa: H.264 yuv420p, 30 fps, duração exata, sem áudio, imagem muda', async () => {
    const i = await r.inspectOutput(mp4, { largura: 270, altura: 480, fps: 30, duracao_s: 12 });
    expect(i.erros).toEqual([]); expect(i.ok).toBe(true);
    expect(i).toMatchObject({ largura: 270, altura: 480, fps: 30, duracao_s: 12, quadros: 360, codec: 'h264', pix_fmt: 'yuv420p', tem_audio: false });
    expect(new Set(i.luminancia).size).toBeGreaterThan(1);
  });

  it('reprova formato errado (esperado 1080×1920)', async () => {
    const i = await r.inspectOutput(mp4, { largura: 1080, altura: 1920, fps: 30, duracao_s: 15 });
    expect(i.ok).toBe(false); expect(i.erros.join(' ')).toMatch(/largura 270 ≠ 1080/); expect(i.erros.join(' ')).toMatch(/duração/);
  });

  it('reprova vídeo preto e vídeo com áudio', async () => {
    const preto = resolve(dir, 'preto.mp4'), audio = resolve(dir, 'audio.mp4');
    ff(['-f', 'lavfi', '-i', 'color=c=black:s=270x480:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', preto]);
    ff(['-f', 'lavfi', '-i', 'testsrc=s=270x480:r=30:d=3', '-f', 'lavfi', '-i', 'sine=d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', audio]);
    expect((await r.inspectOutput(preto, {})).erros.join(' ')).toMatch(/vídeo preto/);
    expect((await r.inspectOutput(audio, {})).erros.join(' ')).toMatch(/tem áudio/);
    expect((await r.inspectOutput(resolve(dir, 'nao-existe.mp4'))).ok).toBe(false);
  });

  it('thumbnail sai do quadro de evidência', async () => {
    const t = await r.thumbnail(exemplo('avatar'), { saida: resolve(dir, 'avatar.jpg'), escala: 0.25 });
    expect(existsSync(t)).toBe(true);
  });

  it('orçamento: sem memória livre suficiente o worker não pega job', async () => {
    const antes = ORCAMENTO.memoriaLivreMinMB; ORCAMENTO.memoriaLivreMinMB = 10_000_000;
    try { expect(temOrcamento().ok).toBe(false); expect(await processarUm(async () => { throw new Error('não deveria chamar a API'); }, r)).toBeNull(); }
    finally { ORCAMENTO.memoriaLivreMinMB = antes; }
  });

  it('worker: pega job pela API interna, renderiza, inspeciona e devolve; input inválido volta como erro', async () => {
    ORCAMENTO.memoriaLivreMinMB = 256;
    const chamadas: any[] = [];
    let entregue = false;
    const api = async (metodo: string, caminho: string, corpo?: any) => {
      chamadas.push([metodo, caminho, corpo]);
      if (caminho.endsWith('/reivindicar')) { if (entregue) return { job: null }; entregue = true; return { job: { id: 'job-teste' }, input: exemplo('agenda') }; }
      if (caminho.endsWith('/concluir')) return { ok: true };
      return { estado: 'rodando' };
    };
    expect(await processarUm(api, r, { escala: 0.25, dir })).toBe('job-teste');
    const fim = chamadas.find((c) => c[1].endsWith('/concluir'))![2];
    expect(fim.ok).toBe(true); expect(fim.inspecao.ok).toBe(true); expect(existsSync(fim.mp4)).toBe(true);

    entregue = false; chamadas.length = 0;
    const apiRuim = async (m: string, c: string, b?: any) => (c.endsWith('/reivindicar') ? (entregue ? { job: null } : (entregue = true, { job: { id: 'job-ruim' }, input: { ...exemplo('resultado'), election_status: 'provisorio' } })) : api(m, c, b));
    await processarUm(apiRuim as any, r, { escala: 0.25, dir });
    const ruim = chamadas.find((c) => c[1].endsWith('/concluir'))![2];
    expect(ruim.ok).toBe(false); expect(ruim.erro).toMatch(/input inválido/);
  });
});
