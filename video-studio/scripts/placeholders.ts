/* Imagens PROVISÓRIAS, marcadas como placeholder na própria imagem e no input (placeholder: true).
   - obra-antes/obra-depois: ilustração para o template de obra enquanto não há dois snapshots reais da mesma rua.
   - <cena>.png de reserva: usadas só quando o dev server do jogo está fora (capturar-jogo.ts falhou).
   O contrato rejeita placeholder em conteúdo real (demo = false). */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME } from '../renderers/html.ts';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(raiz, 'assets/placeholders'); mkdirSync(out, { recursive: true });

function casas(n: number, seed: number) {
  let s = seed; const r = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cores = ['#e63946', '#3a86ff', '#4f9c3f', '#ff8a1f', '#8338ec'];
  let svg = '';
  for (let i = 0; i < n; i++) {
    const col = i % 5, lin = Math.floor(i / 5), x = 60 + col * 190 + r() * 20, y = 240 + lin * 230 + r() * 20;
    svg += `<g transform="translate(${x},${y})"><rect x="10" y="60" width="120" height="90" fill="#fff" stroke="#1e2430" stroke-width="7"/><path d="M0 66 70 8 140 66Z" fill="${cores[Math.floor(r() * 5)]}" stroke="#1e2430" stroke-width="7" stroke-linejoin="round"/></g>`;
  }
  return svg;
}
const pagina = (titulo: string, conteudo: string) => `<!doctype html><html><body style="margin:0;width:1080px;height:1920px;background:#78ad54;font:900 46px Nunito,system-ui,sans-serif;color:#1e2430">
  <svg width="1080" height="1920" style="position:absolute;inset:0"><rect x="0" y="900" width="1080" height="70" fill="#5a6270"/><rect x="500" y="0" width="70" height="1920" fill="#5a6270"/>${conteudo}</svg>
  <div style="position:absolute;left:0;right:0;top:80px;text-align:center"><span style="background:#e63946;color:#fff;border:6px solid #1e2430;border-radius:999px;padding:12px 30px">PLACEHOLDER · ${titulo}</span></div></body></html>`;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
const itens: [string, string][] = [
  ['obra-antes', pagina('ilustração: antes', casas(6, 7))],
  ['obra-depois', pagina('ilustração: depois', casas(21, 7))],
  ...['brasil', 'cidade-sp', 'cidade-rj', 'cidade-vitoria', 'rua-perto', 'casa-perto', 'loja-pet', 'cidade-noite'].map((n) => [n, pagina(`sem captura do jogo (${n})`, casas(15, n.length))] as [string, string]),
];
for (const [nome, html] of itens) { await page.setContent(html); await page.screenshot({ path: resolve(out, nome + '.png') }); console.log('placeholder', nome); }
await browser.close();
