/* HtmlRenderer — adaptador principal. Template HTML parametrizado → quadros PNG/JPEG no Chrome instalado
   (playwright-core, sem baixar navegador) → ffmpeg libx264 yuv420p 30 fps, sem áudio.
   Tempo determinístico: o renderer chama window.__seek(t) para cada quadro t = i/30; o template não usa relógio real.
   Math.random é semeado e Date.now congelado no data_timestamp do input (garantia extra de reprodutibilidade).
   Orçamento: 1 Chrome (sem GPU, heap JS 512 MB) + 1 ffmpeg (-threads 2) por render. Ver README "Recursos". */
import { chromium, type Browser, type Page } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validarRenderInput, type RenderInput } from '../contrato/contrato.ts';
import { inspecionar } from './inspecionar.ts';
import type { Esperado, OpcoesRender, RendererAdapter, ResultadoRender } from './tipos.ts';

export const RAIZ_ESTUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const FPS = 30, LARGURA = 1080, ALTURA = 1920;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

export class ErroRender extends Error {}

function initScript(input: RenderInput) {
  const fixo = Date.parse(input.data_timestamp) || 0;
  return `(() => {
    window.__INPUT__ = ${JSON.stringify(input).replace(/</g, '\\u003c')};
    let s = 0x5eed1234; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const D = Date; const fixo = ${fixo};
    window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [fixo])); } static now() { return fixo; } };
  })();`;
}

export class HtmlRenderer implements RendererAdapter {
  readonly nome = 'html-chrome-ffmpeg';
  constructor(private o: { chrome?: string; raiz?: string } = {}) {}

  validateInput(x: unknown) { return validarRenderInput(x); }

  private exigirValido(input: unknown): RenderInput {
    const v = this.validateInput(input);
    if (!v.ok) throw new ErroRender('input inválido: ' + v.erros.join('; '));
    const html = this.arquivoTemplate(v.input);
    if (!existsSync(html)) throw new ErroRender('template ausente: ' + html);
    return v.input;
  }
  arquivoTemplate(i: RenderInput) { return resolve(this.o.raiz || RAIZ_ESTUDIO, 'templates', i.template_id, 'index.html'); }

  private async abrir(input: RenderInput, escala: number): Promise<{ browser: Browser; page: Page; fontes: Record<string, boolean>; avisos: string[] }> {
    const browser = await chromium.launch({ executablePath: this.o.chrome || CHROME, args: ['--disable-gpu', '--hide-scrollbars', '--mute-audio', '--js-flags=--max-old-space-size=512', '--force-color-profile=srgb', '--font-render-hinting=none'] });
    try {
      const page = await browser.newPage({ viewport: { width: LARGURA, height: ALTURA }, deviceScaleFactor: escala });
      const avisos: string[] = [];
      page.on('pageerror', (e) => avisos.push('erro na página: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') avisos.push('console: ' + m.text()); });
      await page.addInitScript(initScript(input));
      await page.goto(pathToFileURL(this.arquivoTemplate(input)).href, { waitUntil: 'load', timeout: 60000 });
      const fontes = await page.evaluate(async () => { await (window as any).__ready; return (window as any).__fontes || {}; });
      const dur = await page.evaluate(() => (window as any).__duration);
      if (Math.abs(dur - input.duration_s) > 1e-6) throw new ErroRender(`template declarou ${dur}s, input pede ${input.duration_s}s`);
      const fatal = avisos.find((a) => a.startsWith('erro na página'));
      if (fatal) throw new ErroRender(fatal);
      if (!fontes.titulo || !fontes.texto) avisos.push('fontes do Google Fonts não carregaram (render usou fonte de sistema): verifique a rede');
      return { browser, page, fontes, avisos };
    } catch (e) { await browser.close(); throw e; }
  }

  async render(input0: RenderInput, o: OpcoesRender): Promise<ResultadoRender> {
    const input = this.exigirValido(input0), escala = o.escala ?? 1, inicio = Date.now();
    const W = Math.round(LARGURA * escala / 2) * 2, H = Math.round(ALTURA * escala / 2) * 2;
    const total = Math.round(input.duration_s * FPS);
    mkdirSync(dirname(o.saida), { recursive: true });
    const tmp = o.saida + '.parcial.mp4'; rmSync(tmp, { force: true });
    const { browser, page, fontes, avisos } = await this.abrir(input, escala);
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-vf', `scale=${W}:${H}:flags=lanczos:out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(o.crf ?? 20), '-threads', '2',
      '-r', String(FPS), '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-an', '-movflags', '+faststart', tmp], { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = ''; ff.stderr.on('data', (d) => (ffErr += d));
    const fim = new Promise<number>((r) => ff.on('close', (c) => r(c ?? 1)));
    try {
      const cdp = await page.context().newCDPSession(page);
      for (let i = 0; i < total; i++) {
        if (o.sinal?.aborted) throw new ErroRender('render cancelado');
        await page.evaluate((t) => (window as any).__seek(t), i / FPS);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
        const buf = Buffer.from(shot.data, 'base64');
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
        o.progresso?.(i + 1, total);
      }
      ff.stdin.end();
      const code = await fim;
      if (code !== 0) throw new ErroRender('ffmpeg falhou: ' + ffErr.slice(-500));
      rmSync(o.saida, { force: true });
      const { renameSync } = await import('node:fs'); renameSync(tmp, o.saida);
      return { mp4: o.saida, quadros: total, duracao_s: input.duration_s, largura: W, altura: H, ms: Date.now() - inicio, fontes, avisos };
    } catch (e) {
      try { ff.stdin.destroy(); ff.kill('SIGKILL'); } catch { /* já saiu */ }
      rmSync(tmp, { force: true });
      throw e;
    } finally { await browser.close(); }
  }

  /** thumbnail JPEG de um quadro (padrão: fim da evidência, onde o número real está na tela) */
  async thumbnail(input0: RenderInput, o: { saida: string; t?: number; escala?: number }) {
    const input = this.exigirValido(input0);
    const { browser, page } = await this.abrir(input, o.escala ?? 1);
    try {
      const t = o.t ?? await page.evaluate(() => { const p = (window as any).__partes; return p.evidencia[1] - 0.4; });
      await page.evaluate((x) => (window as any).__seek(x), t);
      mkdirSync(dirname(o.saida), { recursive: true });
      await page.screenshot({ path: o.saida, type: 'jpeg', quality: 90 });
      return o.saida;
    } finally { await browser.close(); }
  }

  /** textos visíveis em instantes dados (prova de que o vídeo mostra o snapshot) */
  async textos(input0: RenderInput, tempos: number[]) {
    const input = this.exigirValido(input0);
    const { browser, page } = await this.abrir(input, 0.25);
    try { const r: Record<string, string[]> = {}; for (const t of tempos) r[t] = await page.evaluate((x) => (window as any).__textos(x), t); return r; }
    finally { await browser.close(); }
  }

  /** quadros PNG soltos (storyboard/folha de contato para revisão do operador) */
  async stills(input0: RenderInput, tempos: number[], dir: string, escala = 0.25) {
    const input = this.exigirValido(input0);
    const { browser, page, avisos } = await this.abrir(input, escala);
    try {
      mkdirSync(dir, { recursive: true }); const arquivos: string[] = [];
      for (const [i, t] of tempos.entries()) { await page.evaluate((x) => (window as any).__seek(x), t); const f = resolve(dir, `${input.template_id}-${String(i).padStart(2, '0')}.png`); await page.screenshot({ path: f }); arquivos.push(f); }
      return { arquivos, avisos };
    } finally { await browser.close(); }
  }

  async inspectOutput(mp4: string, esperado: Esperado = { largura: LARGURA, altura: ALTURA, fps: FPS }) { return inspecionar(mp4, esperado); }
}
