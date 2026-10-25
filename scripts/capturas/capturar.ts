/* Capturas de tela do jogo em viewports fixos (referência visual e testes de paridade).
   Uso: npx tsx scripts/capturas/capturar.ts <saida-dir> [base-url]
   Cada cena: URL + código que posiciona a câmera; espera o mapa estabilizar e salva PNG. */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] || 'docs/capturas/atual');
const base = process.argv[3] || 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

type Cena = { nome: string; w: number; h: number; js?: string; espera?: number; q?: string };
export const CENAS: Cena[] = [
  { nome: 'brasil-desktop', w: 1440, h: 900 },
  { nome: 'brasil-celular', w: 390, h: 844 },
  { nome: 'cidade-sp', w: 1440, h: 900, js: `const c=ctx.dados.POR_IBGE.get(3550308); mundo.camera.voar({fx:c.x,fy:c.y,ld:Math.log(70),phi:45},true)` },
  { nome: 'cidade-rj', w: 1440, h: 900, js: `const c=ctx.dados.POR_IBGE.get(3304557); mundo.camera.voar({fx:c.x,fy:c.y,ld:Math.log(60),phi:48},true)` },
  { nome: 'loja-pet', w: 1440, h: 900, js: `const l=ctx.dados.p.lojas.find(x=>x.tipo==='pet'); const p=window.__cid3d.posicaoLoja(l); mundo.camera.voar({fx:p.x,fy:p.y,ld:Math.log(14),phi:42},true)` },
  { nome: 'media-sp-noite', w: 1440, h: 900, q: '?hora=20', js: `const c=ctx.dados.POR_IBGE.get(3550308); mundo.camera.voar({fx:c.x,fy:c.y-10,ld:Math.log(150),phi:50},true)` },
  { nome: 'loja-pet-noite', w: 1440, h: 900, q: '?hora=20', js: `const l=ctx.dados.p.lojas.find(x=>x.tipo==='pet'); const p=window.__cid3d.posicaoLoja(l); mundo.camera.voar({fx:p.x,fy:p.y,ld:Math.log(18),phi:45},true)` },
  { nome: 'rj-perto', w: 1440, h: 900, js: `const c=ctx.dados.POR_IBGE.get(3304557); const L=window.__cid3d; mundo.camera.voar({fx:c.x+6,fy:c.y-4,ld:Math.log(28),phi:42},true)` },
  { nome: 'rj-medio', w: 1440, h: 900, js: `const c=ctx.dados.POR_IBGE.get(3304557); mundo.camera.voar({fx:c.x,fy:c.y,ld:Math.log(70),phi:48},true)` },
  { nome: 'interior', w: 1440, h: 900, js: `const c=ctx.dados.POR_IBGE.get(3148103); mundo.camera.voar({fx:c.x,fy:c.y,ld:Math.log(55),phi:46},true)` },
  { nome: 'painel-lojas', w: 1440, h: 900, espera: 2500, js: `ctx.paineis.abrir('lojas')` },
  { nome: 'painel-negocio', w: 1440, h: 900, espera: 2500, js: `ctx.paineis.abrir('negocio')` },
  { nome: 'painel-casa', w: 1440, h: 900, espera: 2500, js: `ctx.paineis.abrir('casa')` },
  { nome: 'painel-ranking', w: 1440, h: 900, espera: 2500, js: `ctx.paineis.abrir('ranking')` },
  { nome: 'painel-eleicoes', w: 1440, h: 900, espera: 2500, js: `ctx.paineis.abrir('eleicoes')` },
  { nome: 'painel-avatar', w: 1440, h: 900, espera: 2500, js: `ctx.paineis.abrir('avatar')` },
  { nome: 'praca-vitoria', w: 1440, h: 900, js: `const c=ctx.dados.POR_IBGE.get(3304557); setTimeout(()=>{ const L=window.__cid3d.layout(3304557); if(L) mundo.camera.voar({fx:L.cx,fy:L.cy-2,ld:Math.log(9),phi:40},true); }, 1500); mundo.camera.voar({fx:c.x,fy:c.y,ld:Math.log(40),phi:40},true)`, espera: 6500 },
  { nome: 'academia', w: 1440, h: 900, espera: 7000, js: `const l=ctx.dados.p.lojas.find(x=>x.tipo==='academia'); ctx.visitarLoja(l)` },
  { nome: 'mercado-cel', w: 390, h: 844, espera: 7000, js: `const l=ctx.dados.p.lojas.find(x=>x.tipo==='mercado'); ctx.visitarLoja(l)` },
  { nome: 'jornal', w: 1440, h: 900, espera: 3000, js: `ctx.paineis.abrir('jornal')` },
  { nome: 'jornal-cel', w: 390, h: 844, espera: 3000 },
  { nome: 'aeroporto-rj', w: 1440, h: 900, espera: 6000, js: `const a=window.__aeros?.lista?.[2]; if(a) mundo.camera.voar({fx:a.x,fy:a.y,ld:Math.log(22),phi:48},true)` },
  { nome: 'casa-perto', w: 1440, h: 900, js: `ctx.mostrarCasa(ctx.dados.ORDEM[0].ini)` },
];

const so = process.argv.slice(4);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const c of CENAS.filter((x) => !so.length || so.includes(x.nome))) {
  const page = await browser.newPage({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 1 });
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  await page.goto(base + '/' + (c.q ?? '?hora=12'), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).ctx, null, { timeout: 30000 });
  if (c.js) await page.evaluate(c.js);
  await page.waitForTimeout(c.espera ?? 5000);
  await page.screenshot({ path: resolve(out, c.nome + '.png') });
  console.log(c.nome, erros.length ? 'ERROS: ' + erros.join(' | ') : 'ok');
  await page.close();
}
await browser.close();
