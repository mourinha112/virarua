/* Render avulso: npx tsx scripts/render.ts <input.json | exemplo:<template>> <saida.mp4> [--escala 0.5]
   Gera também <saida>.jpg (thumbnail) e imprime a inspeção (ffprobe). */
import { readFileSync } from 'node:fs';
import { HtmlRenderer } from '../renderers/html.ts';
import { exemplo } from '../storyboards/exemplos.ts';
import type { TemplateId } from '../contrato/contrato.ts';

const [fonte, saida] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ie = process.argv.indexOf('--escala'), escala = ie > 0 ? Number(process.argv[ie + 1]) : 1;
if (!fonte || !saida) { console.error('uso: render.ts <input.json|exemplo:<template>> <saida.mp4> [--escala 0.5]'); process.exit(1); }
const input = fonte.startsWith('exemplo:') ? exemplo(fonte.slice(8) as TemplateId) : JSON.parse(readFileSync(fonte, 'utf8'));
const r = new HtmlRenderer();
const v = r.validateInput(input); if (!v.ok) { console.error('input inválido:\n- ' + v.erros.join('\n- ')); process.exit(1); }
const res = await r.render(v.input, { saida, escala, progresso: (q, t) => { if (q % 60 === 0 || q === t) process.stdout.write(`\r${q}/${t} quadros`); } });
console.log(`\nrender: ${res.ms} ms, avisos: ${res.avisos.length ? res.avisos.join(' | ') : 'nenhum'}`);
const thumb = await r.thumbnail(v.input, { saida: saida.replace(/\.mp4$/, '') + '.jpg', escala });
const insp = await r.inspectOutput(saida, { largura: Math.round(1080 * escala / 2) * 2, altura: Math.round(1920 * escala / 2) * 2, fps: 30, duracao_s: v.input.duration_s });
console.log('thumbnail:', thumb);
console.log(JSON.stringify(insp, null, 2));
process.exit(insp.ok ? 0 : 2);
