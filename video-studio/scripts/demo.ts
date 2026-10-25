/* Vídeos de DEMONSTRAÇÃO (dados fictícios, selo "DEMONSTRAÇÃO · dados fictícios" em todos os quadros).
   Uso: npx tsx scripts/demo.ts [template...]   (padrão: casa votacao resultado)
   Saída: out/demo/<template>.mp4 + .jpg + pacote manual em out/demo/<template>-pacote/ + relatório out/demo/relatorio.json */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HtmlRenderer, RAIZ_ESTUDIO } from '../renderers/html.ts';
import { exemplo } from '../storyboards/exemplos.ts';
import { gerarPacote } from '../publisher/pacote.ts';
import type { TemplateId } from '../contrato/contrato.ts';

const ids = (process.argv.slice(2).length ? process.argv.slice(2) : ['casa', 'votacao', 'resultado']) as TemplateId[];
const r = new HtmlRenderer(), dir = resolve(RAIZ_ESTUDIO, 'out/demo'); mkdirSync(dir, { recursive: true });
const relatorio: Record<string, unknown> = {};
for (const id of ids) {
  const input = exemplo(id), mp4 = resolve(dir, `${id}.mp4`), thumb = resolve(dir, `${id}.jpg`);
  const res = await r.render(input, { saida: mp4, progresso: (q, t) => { if (q % 90 === 0 || q === t) process.stdout.write(`\r${id}: ${q}/${t}`); } });
  await r.thumbnail(input, { saida: thumb });
  const insp = await r.inspectOutput(mp4, { largura: 1080, altura: 1920, fps: 30, duracao_s: input.duration_s });
  gerarPacote(input, { mp4, thumb, inspecao: insp }, resolve(dir, `${id}-pacote`));
  relatorio[id] = { mp4, thumb, render_ms: res.ms, avisos: res.avisos, fontes: res.fontes, inspecao: insp };
  console.log(`\n${id}: ${insp.ok ? 'OK' : 'FALHOU ' + insp.erros.join('; ')} ${insp.largura}x${insp.altura} ${insp.fps}fps ${insp.duracao_s}s (${res.ms} ms)`);
}
writeFileSync(resolve(dir, 'relatorio.json'), JSON.stringify(relatorio, null, 2));
