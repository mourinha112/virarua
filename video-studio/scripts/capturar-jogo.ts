/* Capturas do JOGO REAL (engine Three.js atual, mesmos assets) em retrato 1080×1920 para os templates de vídeo.
   Referência: scripts/capturas/capturar.ts do jogo (mesmas cenas/câmeras, mesmo Chrome instalado).
   Uso: npx tsx scripts/capturar-jogo.ts [base-url=http://localhost:5173] [cena...]
   Se o dev server não responder, NÃO inventa mapa: use `npm run placeholders` (imagens marcadas como placeholder).
   Saída: assets/capturas/<cena>.png + assets/capturas/manifesto.json (origem, url, data, engine). */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(raiz, 'assets/capturas');
const base = process.argv[2] && /^https?:/.test(process.argv[2]) ? process.argv[2] : 'http://localhost:5173';
const so = process.argv.slice(2).filter((a) => !/^https?:/.test(a));
/** cenas extras por cidade: `cidade:<ibge>` → assets/capturas/cidade-<ibge>.png (o servidor usa como fundo daquela cidade) */
const extras = so.filter((a) => /^cidade:\d{7}$/.test(a)).map((a) => a.slice(7));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/** HUD do jogo escondido: o vídeo mostra o mundo; a moldura/legendas vêm do template. */
const SEM_HUD = `#topo,#ctrl,#rodape,#tabbar,#cartao,#paineis,#toast,#carrega,#camada{visibility:hidden!important}`; // #camada = rótulos/@ do mapa: vídeo não mostra perfis sem permissão
type Cena = { nome: string; js?: string; q?: string; hud?: boolean; espera?: number; descricao: string };
const CENAS: Cena[] = [
  { nome: 'brasil', descricao: 'mapa do Brasil inteiro' },
  { nome: 'cidade-sp', descricao: 'São Paulo de cima', js: `const c=ctx.dados.POR_IBGE.get(3550308); mundo.camera.voar({fx:c.x,fy:c.y,ld:Math.log(70),phi:45},true)` },
  { nome: 'cidade-rj', descricao: 'Rio de Janeiro de cima', js: `const c=ctx.dados.POR_IBGE.get(3304557); mundo.camera.voar({fx:c.x,fy:c.y,ld:Math.log(60),phi:48},true)` },
  { nome: 'cidade-vitoria', descricao: 'Vitória/ES aproximada', js: `const c=ctx.dados.POR_IBGE.get(3205309); mundo.camera.voar({fx:c.x,fy:c.y,ld:Math.log(30),phi:50},true)` },
  { nome: 'rua-perto', descricao: 'casas de uma rua bem perto', js: `const c=ctx.dados.POR_IBGE.get(3304557); mundo.camera.voar({fx:c.x,fy:c.y,ld:Math.log(12),phi:40},true)` },
  { nome: 'casa-perto', descricao: 'uma casa em destaque (sem cartão nem @)', js: `ctx.mostrarCasa(ctx.dados.ORDEM[0].ini); setTimeout(()=>ctx.fecharCartao&&ctx.fecharCartao(),300)` },
  { nome: 'loja-pet', descricao: 'estabelecimento 3D', js: `const l=ctx.dados.p.lojas.find(x=>x.tipo==='pet'); const p=window.__cid3d.posicaoLoja(l); mundo.camera.voar({fx:p.x,fy:p.y,ld:Math.log(14),phi:42},true)` },
  { nome: 'cidade-noite', descricao: 'São Paulo à noite', q: '?hora=20', js: `const c=ctx.dados.POR_IBGE.get(3550308); mundo.camera.voar({fx:c.x,fy:c.y-10,ld:Math.log(150),phi:50},true)` },
  { nome: 'jogo-ui', descricao: 'jogo com a interface (celular); mostra @ fictícios do pacote DEMO', hud: true },
];

for (const ibge of extras) CENAS.push({ nome: `cidade-${ibge}`, descricao: `cidade IBGE ${ibge}`, js: `const c=ctx.dados.POR_IBGE.get(${ibge}); mundo.camera.voar({fx:c.x,fy:c.y,ld:Math.log(35),phi:48},true)` });
const filtro = so.map((a) => (a.startsWith('cidade:') ? 'cidade-' + a.slice(7) : a));
mkdirSync(out, { recursive: true });
try { const r = await fetch(base, { signal: AbortSignal.timeout(4000) }); if (!r.ok) throw new Error('HTTP ' + r.status); }
catch (e) { console.error(`dev server indisponível em ${base} (${(e as Error).message}). Rode \`npm run dev\` na raiz ou \`npm run placeholders\` aqui.`); process.exit(2); }

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const manifesto: Record<string, unknown> = {};
for (const c of CENAS.filter((x) => !filtro.length || filtro.includes(x.nome))) {
  // 540×960 CSS px com DPR 2 = 1080×1920 reais (o layout mobile do jogo, sem esticar)
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(String(e)));
  await page.goto(base + '/' + (c.q ?? '?hora=12'), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).ctx, null, { timeout: 30000 });
  if (!c.hud) await page.addStyleTag({ content: SEM_HUD });
  if (c.js) await page.evaluate(c.js);
  await page.waitForTimeout(c.espera ?? 5000);
  const arquivo = resolve(out, c.nome + '.png');
  await page.screenshot({ path: arquivo });
  manifesto[c.nome] = { arquivo: `assets/capturas/${c.nome}.png`, descricao: c.descricao, origem: 'captura do jogo real (engine Three.js do repositório)', url: base + '/' + (c.q ?? '?hora=12'), capturado_em: new Date().toISOString(), placeholder: false, contem_perfis: !!c.hud, dados: 'pacote public/dados/mundo.json (DEMO: moradores fictícios)', erros };
  console.log(c.nome, erros.length ? 'ERROS: ' + erros.join(' | ') : 'ok');
  await page.close();
}
await browser.close();
const anterior = (() => { try { return JSON.parse(readFileSync(resolve(out, 'manifesto.json'), 'utf8')); } catch { return {}; } })();
writeFileSync(resolve(out, 'manifesto.json'), JSON.stringify({ ...anterior, ...manifesto }, null, 2));
