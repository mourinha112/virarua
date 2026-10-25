/* Folhas de contato dos 12 templates (inputs de demonstração): 6 quadros por template, um em cada parte do filme.
   Uso: npx tsx scripts/folhas.ts [template...]  → out/folhas/<template>.png  (revisão do storyboard pelo operador) */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { HtmlRenderer, RAIZ_ESTUDIO } from '../renderers/html.ts';
import { exemplo } from '../storyboards/exemplos.ts';
import { TEMPLATE_IDS, type TemplateId } from '../contrato/contrato.ts';

const ids = (process.argv.slice(2).length ? process.argv.slice(2) : TEMPLATE_IDS) as TemplateId[];
const r = new HtmlRenderer(), dir = resolve(RAIZ_ESTUDIO, 'out/folhas');
for (const id of ids) {
  const i = exemplo(id), D = i.duration_s;
  const cta = D - (D >= 15 ? 3 : D >= 12 ? 2.5 : 2), acao = 2 + (cta - 2) * 0.5;
  const tempos = [0.5, 2.6, acao - 0.5, acao + 1.2, cta + 0.8, D - 0.05];
  const { arquivos, avisos } = await r.stills(i, tempos, resolve(dir, 'tmp'));
  const saida = resolve(dir, `${id}.png`);
  const f = spawnSync('ffmpeg', ['-v', 'error', '-y', ...arquivos.flatMap((a) => ['-i', a]), '-filter_complex', `${arquivos.map((_, k) => `[${k}]`).join('')}hstack=inputs=${arquivos.length}`, saida]);
  console.log(id, f.status === 0 ? saida : 'ffmpeg falhou', avisos.length ? avisos.join(' | ') : '');
}
rmSync(resolve(dir, 'tmp'), { recursive: true, force: true });
