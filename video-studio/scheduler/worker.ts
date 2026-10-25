/* Worker de render do estúdio (processo SEPARADO do jogo). Pede jobs à API interna do servidor, renderiza com o
   HtmlRenderer, inspeciona o MP4 e devolve o resultado. Nunca toca no banco do jogo nem em votos/pontos.
   Credencial mínima: só o Bearer CONTEUDO_TOKEN_ESTUDIO (rotas /interno/conteudo/render/*).

   Uso: SMN_API=http://localhost:8787 CONTEUDO_TOKEN_ESTUDIO=... npx tsx scheduler/worker.ts [--uma-vez]
   Orçamento (ver README "Recursos"): 1 render por worker; antes de pegar job confere memória livre e carga. */
import { resolve } from 'node:path';
import { hostname } from 'node:os';
import { HtmlRenderer, RAIZ_ESTUDIO } from '../renderers/html.ts';
import { temOrcamento } from './orcamento.ts';

const API = (process.env.SMN_API || 'http://localhost:8787').replace(/\/$/, '');
const TOKEN = process.env.CONTEUDO_TOKEN_ESTUDIO || '';
const SAIDA = process.env.CONTEUDO_DIR_RENDERS || resolve(RAIZ_ESTUDIO, 'out/jobs');
const TIMEOUT_S = Number(process.env.STUDIO_RENDER_TIMEOUT_S || 600);
const NOME = `${hostname()}:${process.pid}`;

type Api = (metodo: string, caminho: string, corpo?: unknown) => Promise<any>;
export const apiPadrao: Api = async (metodo, caminho, corpo) => {
  const r = await fetch(API + caminho, { method: metodo, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`API ${caminho}: ${r.status} ${j.erro || ''}`);
  return j;
};

/** processa UM job (se houver). Devolve o id processado ou null. Exportado para testes. */
export async function processarUm(api: Api = apiPadrao, renderer = new HtmlRenderer(), o: { escala?: number; dir?: string } = {}) {
  if (!temOrcamento().ok) return null;
  const { job, input } = await api('POST', '/interno/conteudo/render/reivindicar', { worker: NOME });
  if (!job) return null;
  const ctl = new AbortController();
  const limite = setTimeout(() => ctl.abort(), TIMEOUT_S * 1000);
  // cancelamento: consulta o estado do job a cada 3 s
  const vigia = setInterval(async () => { try { const e = await api('GET', `/interno/conteudo/render/${job.id}`); if (e.estado === 'cancelado') ctl.abort(); } catch { /* servidor fora: segue até o timeout */ } }, 3000);
  try {
    const v = renderer.validateInput(input);
    if (!v.ok) throw new Error('input inválido: ' + v.erros.join('; '));
    const escala = o.escala ?? 1, dir = resolve(o.dir || SAIDA, job.id);
    const mp4 = resolve(dir, 'video.mp4'), thumb = resolve(dir, 'thumbnail.jpg');
    await renderer.render(v.input, { saida: mp4, escala, sinal: ctl.signal });
    await renderer.thumbnail(v.input, { saida: thumb, escala });
    const W = Math.round(1080 * escala / 2) * 2, H = Math.round(1920 * escala / 2) * 2;
    const inspecao = await renderer.inspectOutput(mp4, { largura: W, altura: H, fps: 30, duracao_s: v.input.duration_s });
    await api('POST', `/interno/conteudo/render/${job.id}/concluir`, { ok: true, mp4, thumb, inspecao });
  } catch (e: any) {
    await api('POST', `/interno/conteudo/render/${job.id}/concluir`, { ok: false, erro: ctl.signal.aborted ? 'cancelado ou tempo esgotado' : String(e?.message || e) }).catch(() => {});
  } finally { clearTimeout(limite); clearInterval(vigia); }
  return job.id as string;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(RAIZ_ESTUDIO, 'scheduler/worker.ts')) {
  if (!TOKEN) { console.error('CONTEUDO_TOKEN_ESTUDIO não definido'); process.exit(1); }
  const umaVez = process.argv.includes('--uma-vez');
  for (;;) {
    let id: string | null = null;
    try { id = await processarUm(); if (id) console.log('render concluído/devolvido:', id); } catch (e) { console.error('[worker]', (e as Error).message); }
    if (umaVez) break;
    await new Promise((r) => setTimeout(r, id ? 500 : 10000));
  }
}
