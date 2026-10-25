// Sonda: abre o jogo em ?filme, lista cidades com 1 morador e desenha quadros de teste.
// uso: node tools/sonda.mjs <skillDir> [ibge] [saida.png]
import fs from 'node:fs';
const [skill, ibgeArg, out] = process.argv.slice(2);
const { launchChrome } = await import('file:///' + skill.split(String.fromCharCode(92)).join('/') + '/scripts/_cdp.mjs');
const b = await launchChrome({ width: 1080, height: 1920 });
const p = await b.newPage({ width: 1080, height: 1920 });
await p.goto('http://localhost:5173/?filme&hora=12', { timeout: 60000 });
await p.eval('new Promise(r => { const t = setInterval(() => { if (window.__filme) { clearInterval(t); window.__filme.pronto.then(r); } }, 100); })');
console.log(await p.eval(`(() => { const g = document.createElement('canvas').getContext('webgl'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); })()`));
if (!ibgeArg) {
  const l = await p.eval(`ctx.dados.CID.filter(c => c.n === 1 && c.pop < 30000).slice(0, 4000).map(c => [c.ibge, c.nome, c.uf, c.pop, ctx.dados.USR[c.ini]])`);
  console.log(l.length); for (const r of l.filter((_, i) => i % Math.ceil(l.length / 40) === 0)) console.log(r.join(' | '));
} else {
  const info = await p.eval(`(() => { __filme.fixar(${ibgeArg}); return __filme.cidade(${ibgeArg}); })()`);
  console.log(JSON.stringify(info).slice(0, 400));
  const shots = JSON.parse(process.env.SHOTS || '[]');
  for (const [i, st] of shots.entries()) {
    const s = { fx: info.x + (st.dx || 0), fy: info.y + (st.dy || 0), ld: Math.log(st.d), phi: st.phi, psi: st.psi || 0 };
    await p.eval(`__filme.quadro(${JSON.stringify(s)}, ${i})`);
    fs.writeFileSync(out.replace('.png', `-${i}.png`), await p.shot({ format: 'png' }));
  }
}
await b.close();
