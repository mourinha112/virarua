/* O mundo 3D: renderer, cena, luz, céu, mar, continente, divisas, rios, câmera e entrada. */
import * as T from 'three';
import { Camera } from './camera';
import { BOX_CONT, TERRENO, criarContinente } from './terreno';
import { fita, UPX, type Linha } from './fitas';
import { criarMata } from './arvores';
import { criarNuvens } from './nuvens';
import { criarMapaMata } from './biomas';
import { criarMaterialChao, NUV_N } from './chao';
import { A, LIGHT, SUN_DIR, NOITE, fatorNoite } from './cores';

export const COR = {
  ceuAlto: '#b3d1ee', ceuBaixo: '#e6ebea', mar: '#a1d3ed', marFundo: '#a1d3ed', laje: '#3f6e3c',
  divisa: '#ffffff', rio: '#8ecdf0', praia: '#eeeec8', tinta: '#1e2430', grama: '#78ad54',
};

export type Mundo = ReturnType<typeof criarMundo>;
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function criarMundo(canvas: HTMLCanvasElement) {
  const ehCelular = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || Math.min(innerWidth, innerHeight) < 600;
  const Q = { nivel: ehCelular ? 1 : 3, dpr: 1 };
  const DPR_MAX = [1, 1.5, 2, 2], SOMBRA = [0, 1024, 2048, 4096];

  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = Q.nivel > 0; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const aplicarDpr = () => { Q.dpr = Math.min(DPR_MAX[Q.nivel], window.devicePixelRatio || 1); renderer.setPixelRatio(Q.dpr); };
  aplicarDpr();

  const scene = new T.Scene();
  scene.fog = new T.Fog(COR.ceuBaixo, 4000, 16000);
  const camera = new Camera(BOX_CONT);
  const hemi = new T.HemisphereLight('#f3f5ff', '#c6d79c', LIGHT.hemi); scene.add(hemi);
  const sun = new T.DirectionalLight('#ffe6c6', LIGHT.sun); sun.position.copy(SUN_DIR).multiplyScalar(3000);
  sun.castShadow = Q.nivel > 0; sun.shadow.mapSize.set(SOMBRA[Q.nivel] || 1024, SOMBRA[Q.nivel] || 1024); sun.shadow.bias = -0.0005; sun.shadow.radius = 4; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  /* ---- céu em degradê (esfera invertida presa à câmera) ---- */
  const skyMat = new T.ShaderMaterial({
    uniforms: { alto: { value: new T.Color(COR.ceuAlto) }, baixo: { value: new T.Color(COR.ceuBaixo) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 alto, baixo; varying vec3 vP; void main(){ float t = smoothstep(-0.1, 0.5, vP.y); gl_FragColor = vec4(mix(baixo, alto, t), 1.0);\n#include <colorspace_fragment>\n}',
    side: T.BackSide, depthWrite: false, fog: false, toneMapped: false,
  });
  const sky = new T.Mesh(new T.SphereGeometry(1, 24, 16), skyMat); sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  /* ---- mar: plano grande com grade sutil e brilho ---- */
  const TIME = { value: 0 };
  const marMat = new T.ShaderMaterial({
    uniforms: { t: TIME, c1: { value: new T.Color(COR.mar) }, c2: { value: new T.Color(COR.marFundo) }, camPos: { value: new T.Vector3() }, nevoa: { value: new T.Color(COR.ceuBaixo) } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float t; uniform vec3 c1, c2, camPos, nevoa; varying vec3 vW;
      void main(){
        float d = distance(camPos.xz, vW.xz);
        vec2 q = vW.xz / 180.0; vec2 f = abs(fract(q) - 0.5);
        float lw = clamp(0.008 * d / 1000.0 + 0.012, 0.012, 0.04);
        float g = smoothstep(lw, 0.0, min(f.x, f.y)) * smoothstep(7000.0, 800.0, d) * 0.08;
        float ond = 0.5 + 0.5 * sin(vW.x * 0.08 + t * 0.6) * sin(vW.z * 0.07 - t * 0.5);
        vec3 c = mix(c1, c2, smoothstep(300.0, 6000.0, d) * 0.35) + ond * 0.03 + g;
        c = mix(c, nevoa, smoothstep(camPos.y * 2.5 + 1500.0, camPos.y * 9.0 + 9000.0, d)); // some no horizonte
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
  const mar = new T.Mesh(new T.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), marMat); mar.position.y = -0.32; mar.receiveShadow = false; scene.add(mar);

  /* ---- continente ---- */
  const mata = criarMapaMata(384, 384, (h) => A(h));
  const chao = criarMaterialChao(mata, A);
  const matLado = new T.MeshStandardMaterial({ color: A(COR.laje, (LIGHT.hemi * 0.5 + LIGHT.sun * 0.05) / Math.PI), roughness: 1 });
  const continente = criarContinente({ topo: () => new T.Color(1, 1, 1), lado: new T.Color(COR.laje) }, { matTopo: chao.mat, matLado });
  scene.add(continente);

  /* ---- divisas, costa e rios (fitas com largura mínima em px) ---- */
  const divLinhas: Linha[] = TERRENO.ufs.flatMap((u) => u.polys.map((p) => ({ pts: p.o, hw: 0.08, fechada: true })));
  const costaLinhas: Linha[] = TERRENO.costa.map((a) => ({ pts: a, hw: 0.22, fechada: true }));
  const rioW = (r: number) => (r <= 3 ? 1.3 : r <= 6 ? 0.8 : 0.45);
  const RIOS = TERRENO.rios.filter((r) => r.r <= 6);
  const riosAreia: Linha[] = RIOS.map((r) => ({ pts: r.p, hw: rioW(r.r) + 0.45 }));
  const riosAgua: Linha[] = RIOS.map((r) => ({ pts: r.p, hw: rioW(r.r) }));
  const fitaCosta = fita(costaLinhas, { cor: COR.praia, minPx: 7, lift: 0.0002 }, 3);
  const fitaRiosA = fita(riosAreia, { cor: COR.praia, minPx: 7.5, lift: 0.00035 }, 4);
  const fitaRios = fita(riosAgua, { cor: '#6fdcf5', minPx: 4.2, lift: 0.0004 }, 5);
  const fitaDivE = fita(divLinhas, { cor: COR.tinta, alpha: 0.18, minPx: 3.6, lift: 0.00045 }, 6);
  const fitaDiv = fita(divLinhas, { cor: COR.divisa, alpha: 0.95, minPx: 2.2, lift: 0.0005, tracejadoPx: 4 }, 7);
  scene.add(fitaCosta, fitaRiosA, fitaRios, fitaDivE, fitaDiv);

  /* ---- mata e nuvens ---- */
  const arvores = criarMata(mata, undefined, 8);
  scene.add(arvores.mesh);
  const nuvens = criarNuvens(scene, chao.uni.uCl, Math.floor(NUV_N / 3));

  /* ---- grupo de objetos do jogo (cidades, casas, marcadores) ---- */
  const jogo = new T.Group(); scene.add(jogo);

  /* ---- tamanho ---- */
  const VIEW = { w: 1, h: 1 };
  function dimensionar() {
    const r = canvas.getBoundingClientRect();
    VIEW.w = Math.max(1, Math.round(r.width)); VIEW.h = Math.max(1, Math.round(r.height));
    renderer.setSize(VIEW.w, VIEW.h, false); camera.dimensionar(VIEW.w, VIEW.h);
  }
  addEventListener('resize', dimensionar); dimensionar();

  /* ---- entrada estilo mapa: o ponto do chão sob o dedo fica preso ao dedo (arrasto e pinça), sem mola ---- */
  const ptrs = new Map<number, { x: number; y: number }>();
  let moveu = 0, tDown = 0, girando = false;
  let ancora: [number, number] | null = null;                       // arrasto de 1 dedo
  let pinca: { d0: number; ld0: number; g0: [number, number] } | null = null;
  const aoClicar: ((x: number, y: number) => void)[] = [];
  const modoGirar = (e: PointerEvent) => e.shiftKey || e.ctrlKey || e.button === 2 || e.button === 1;
  const fixar = () => { Object.assign(camera.alvo, camera.st); camera.vel.fx = camera.vel.fy = camera.vel.ld = camera.vel.phi = camera.vel.psi = 0; camera.voo = false; };
  /** move o foco para que o ponto g do chão volte a ficar sob (cx, cy) */
  const prender = (g: [number, number], cx: number, cy: number) => {
    for (let i = 0; i < 2; i++) { camera.aplicar(0); const h = camera.chaoEm(cx, cy); if (!h) return; camera.st.fx += g[0] - h[0]; camera.st.fy += g[1] - h[1]; }
    camera.aplicar(0);
  };
  const meio = () => { const [p, q] = [...ptrs.values()]; return { cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2, d: Math.hypot(p.x - q.x, p.y - q.y) }; };
  const iniciarGesto = () => {
    camera.aplicar(0); fixar();
    if (ptrs.size === 1) { const [p] = [...ptrs.values()]; ancora = camera.chaoEm(p.x, p.y); pinca = null; }
    else if (ptrs.size >= 2) { const mm = meio(); const g = camera.chaoEm(mm.cx, mm.cy); pinca = g ? { d0: Math.max(10, mm.d), ld0: camera.st.ld, g0: g } : null; ancora = null; }
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moveu = 0; tDown = performance.now();
    girando = ptrs.size === 1 && modoGirar(e);
    iniciarGesto();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moveu += Math.abs(dx) + Math.abs(dy);
    if (ptrs.size === 1) {
      if (girando) { camera.st.psi -= dx * 0.3; camera.st.phi = Math.max(camera.lim.phiMin, Math.min(camera.lim.phiMax, camera.st.phi + dy * 0.2)); camera.aplicar(0); fixar(); return; }
      if (ancora) { prender(ancora, p.x, p.y); fixar(); }
    } else if (ptrs.size >= 2 && pinca) {
      const mm = meio();
      const ld = Math.max(camera.lim.ldMin, Math.min(camera.lim.ldMax, pinca.ld0 - Math.log(Math.max(10, mm.d) / pinca.d0)));
      camera.st.ld = ld; camera.st.phi = camera.phiAuto(ld);
      prender(pinca.g0, mm.cx, mm.cy); fixar();
    }
  });
  const soltar = (e: PointerEvent) => {
    const tinha = ptrs.has(e.pointerId); ptrs.delete(e.pointerId);
    if (ptrs.size > 0) iniciarGesto(); else { ancora = null; pinca = null; }
    if (tinha && ptrs.size === 0 && moveu < 8 && performance.now() - tDown < 500 && e.button !== 2) for (const f of aoClicar) f(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', soltar); canvas.addEventListener('pointercancel', soltar);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const f = Math.exp(Math.sign(e.deltaY) * Math.min(0.35, Math.abs(e.deltaY) / 300)); camera.zoomEm(e.clientX, e.clientY, f); }, { passive: false });
  canvas.addEventListener('dblclick', (e) => { camera.zoomEm(e.clientX, e.clientY, 0.5); });
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = camera.kmPorPx() * 40;
    if (e.key === 'ArrowLeft') camera.alvo.fx -= k; if (e.key === 'ArrowRight') camera.alvo.fx += k;
    if (e.key === 'ArrowUp') camera.alvo.fy += k; if (e.key === 'ArrowDown') camera.alvo.fy -= k;
    if (e.key === '+' || e.key === '=') camera.zoomEm(VIEW.w / 2, VIEW.h / 2, 0.7); if (e.key === '-') camera.zoomEm(VIEW.w / 2, VIEW.h / 2, 1.4);
  });

  /* ---- dia e noite ---- */
  const CORES_DIA = { alto: new T.Color(COR.ceuAlto), baixo: new T.Color(COR.ceuBaixo), mar: new T.Color(COR.mar), mar2: new T.Color(COR.marFundo) };
  const CORES_NOITE = { alto: new T.Color('#5a5ea8'), baixo: new T.Color('#b3a9d6'), mar: new T.Color('#7f9ad6'), mar2: new T.Color('#6a84c8') };
  let noiteAtual = -1;
  function aplicarNoite(n: number) {
    if (Math.abs(n - noiteAtual) < 0.005) return; noiteAtual = n; NOITE.value = n;
    skyMat.uniforms.alto.value.copy(CORES_DIA.alto).lerp(CORES_NOITE.alto, n);
    skyMat.uniforms.baixo.value.copy(CORES_DIA.baixo).lerp(CORES_NOITE.baixo, n);
    marMat.uniforms.c1.value.copy(CORES_DIA.mar).lerp(CORES_NOITE.mar, n);
    marMat.uniforms.c2.value.copy(CORES_DIA.mar2).lerp(CORES_NOITE.mar2, n);
    marMat.uniforms.nevoa.value.copy(skyMat.uniforms.baixo.value);
    (scene.fog as T.Fog).color.copy(skyMat.uniforms.baixo.value);
    hemi.intensity = LIGHT.hemi * (1 - 0.12 * n); hemi.color.set('#f3f5ff').lerp(new T.Color('#a9a6ff'), n); hemi.groundColor.set('#c6d79c').lerp(new T.Color('#5a5f8a'), n);
    sun.intensity = LIGHT.sun * (1 - 0.35 * n); sun.color.set('#ffe6c6').lerp(new T.Color('#b9b2ff'), n);
  }
  aplicarNoite(fatorNoite());

  /* ---- laço ---- */
  const passos: ((dt: number, t: number) => void)[] = [];
  let ultimo = performance.now() / 1000, rodando = true, t0 = ultimo;
  const gov = { n: 0, acc: 0 };
  function laco() {
    if (!rodando) return;
    requestAnimationFrame(laco);
    const agora = performance.now() / 1000, dtReal = agora - ultimo, dt = Math.min(0.05, dtReal); ultimo = agora;
    TIME.value = agora - t0;
    if ((gov.n & 31) === 0) aplicarNoite(fatorNoite());
    camera.passo(dtReal);
    { const f = scene.fog as T.Fog; const dd = camera.dist; f.near = dd * 2.2 + 120; f.far = dd * 7 + 3500; }
    { const h = camera.cam.position.y; chao.uni.uTint.value = 0.95 * sstep(120, 3000, h); chao.uni.uBioK.value = 0.25 + 0.57 * sstep(250, 2500, h); chao.uni.uTimeG.value = TIME.value; UPX.value = (2 * Math.tan((camera.cam.fov * Math.PI) / 360)) / Math.max(1, VIEW.h); arvores.passo(h); nuvens.passo(dt, h); }
    sky.position.copy(camera.cam.position); sky.scale.setScalar(camera.cam.far * 0.9);
    marMat.uniforms.camPos.value.copy(camera.cam.position);
    // sol acompanha o foco (sombras só perto)
    const d = Math.min(camera.dist, 400);
    sun.target.position.set(camera.st.fx, 0, -camera.st.fy); sun.position.copy(sun.target.position).add(new T.Vector3(-0.62, 0.7, -0.36).multiplyScalar(d * 3));
    const sc = sun.shadow.camera as T.OrthographicCamera; const ext = d * 1.4; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = d * 10; sc.updateProjectionMatrix();
    for (const f of passos) f(dt, agora - t0);
    renderer.render(scene, camera.cam);
    // governador simples: muitos quadros lentos → baixa o nível
    gov.n++; gov.acc += dt; if (gov.acc > 3) { const fps = gov.n / gov.acc; gov.n = 0; gov.acc = 0; if (fps < 28 && Q.nivel > 0) { Q.nivel--; aplicarDpr(); renderer.shadowMap.enabled = Q.nivel > 0; sun.castShadow = Q.nivel > 0; } }
  }
  laco();

  return {
    T, renderer, scene, camera, jogo, sun, Q, VIEW,
    aoClicar: (f: (x: number, y: number) => void) => aoClicar.push(f),
    aoPasso: (f: (dt: number, t: number) => void) => passos.push(f),
    parar: () => { rodando = false; },
    dimensionar,
    terreno: TERRENO,
    mata, arvores,
  };
}
