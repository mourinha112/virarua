// Confere que o jogo normal (sem ?filme) segue rodando: laço vivo, câmera com mola, sem exceção.
const skill = process.argv[2];
const { launchChrome } = await import('file:///' + skill.split(String.fromCharCode(92)).join('/') + '/scripts/_cdp.mjs');
const b = await launchChrome({ width: 540, height: 960 });
const p = await b.newPage({ width: 540, height: 960 });
const erros = []; p.on('Runtime.exceptionThrown', (e) => erros.push(e.exceptionDetails?.exception?.description?.split('\n')[0]));
await p.goto('http://localhost:5173/?hora=12', { timeout: 60000 });
await p.eval('new Promise(r => { const t = setInterval(() => { if (window.ctx) { clearInterval(t); r(); } }, 100); })');
const r = await p.eval(`new Promise(r => { const a = mundo.camera.st.ld; mundo.camera.voar({ ld: Math.log(300) }); setTimeout(() => r({ antes: a, depois: mundo.camera.st.ld, filme: document.documentElement.classList.contains('filme'), hud: !!document.querySelector('#busca, .topo, header') }), 1500); })`);
console.log(JSON.stringify(r), 'excecoes:', erros.length ? erros : 'nenhuma');
await b.close();
