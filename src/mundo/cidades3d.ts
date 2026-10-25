/* Cidades 3D: quando a câmera chega perto, as cidades em volta do foco são construídas (cidade.ts) e desenhadas
   com instancing global (um InstancedMesh por peça). Inclui quadras, ruas com calçada e faixa, postes,
   árvores (verdes, floridas, palmeiras), praças, igrejas e as lojas patrocinadas. */
import * as T from 'three';
import { construirCidade, tipoCasa, CEL, type LayoutCidade } from './cidade';
import { geoCasa, geoExtra, geoArvoreCidade, geoPraca, geoPrefeitura, caixa, cilindro, juntar, disco } from './geometrias';
import { fita } from './fitas';
import { ehTerra, TERRENO } from './terreno';
import { A, NOITE } from './cores';
import { criarLoja3D as criarLojaPadrao } from './lojas3d';
import { criarAcademia, criarMercado, criarTech, criarEscritorio } from './lojas-tipos';
const criarLoja3D = (l: Loja, A: (h: string) => T.Color) => l.tipo === 'academia' ? criarAcademia(l) : l.tipo === 'mercado' ? criarMercado(l) : l.tipo === 'tech' ? criarTech(l) : criarLojaPadrao(l, A);
import { criarAvatares, type ConfigAvatar } from './avatares3d';

/* placa da cidade: letreiro amarelo com o nome em caixa alta, em dois postes, na frente da prefeitura */
function placaCidade(nome: string): T.Group {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256; const g = cv.getContext('2d')!;
  g.fillStyle = '#1e2430'; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#ffd23f'; g.fillRect(14, 14, 996, 228);
  g.fillStyle = '#ffe680'; g.fillRect(14, 14, 996, 30);
  let fs = 150; const txt = nome.toUpperCase();
  g.font = '400 ' + fs + 'px "Lilita One", Nunito, sans-serif';
  while (g.measureText(txt).width > 930 && fs > 40) { fs -= 6; g.font = '400 ' + fs + 'px "Lilita One", Nunito, sans-serif'; }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#1e2430'; g.fillText(txt, 512, 140);
  const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
  const grupo = new T.Group();
  const quadro = new T.Mesh(new T.BoxGeometry(2.0, 0.5, 0.05), [new T.MeshStandardMaterial({ color: '#1e2430' }), new T.MeshStandardMaterial({ color: '#1e2430' }), new T.MeshStandardMaterial({ color: '#1e2430' }), new T.MeshStandardMaterial({ color: '#1e2430' }), new T.MeshBasicMaterial({ map: tex, toneMapped: false }), new T.MeshBasicMaterial({ map: tex, toneMapped: false })]);
  quadro.position.y = 0.62; quadro.rotation.x = -0.12; grupo.add(quadro);
  const poste = new T.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.9 });
  for (const x of [-0.8, 0.8]) { const p = new T.Mesh(new T.BoxGeometry(0.07, 0.62, 0.07), poste); p.position.set(x, 0.31, -0.03); grupo.add(p); }
  const base = new T.Mesh(new T.BoxGeometry(2.3, 0.05, 0.4), new T.MeshStandardMaterial({ color: '#c8572f', roughness: 0.9 })); base.position.y = 0.025; grupo.add(base);
  grupo.traverse((o) => { if ((o as T.Mesh).isMesh) o.castShadow = true; });
  return grupo;
}
function trofeu3d(tipo: string, nome: string) {
  const g = new T.Group();
  const ouro = new T.MeshStandardMaterial({ color: '#f2b705', metalness: 0.6, roughness: 0.3 }), escuro = new T.MeshStandardMaterial({ color: '#1e2430' });
  const base = new T.Mesh(new T.BoxGeometry(0.7, 0.25, 0.7), escuro); base.position.y = 0.125; g.add(base);
  const haste = new T.Mesh(new T.CylinderGeometry(0.06, 0.1, 0.5, 10), ouro); haste.position.y = 0.5; g.add(haste);
  const taca = new T.Mesh(new T.CylinderGeometry(0.42, 0.16, 0.6, 16, 1, true), ouro); taca.position.y = 1.05; g.add(taca);
  for (const s of [-1, 1]) { const al = new T.Mesh(new T.TorusGeometry(0.17, 0.04, 6, 12, Math.PI), ouro); al.position.set(s * 0.42, 1.1, 0); al.rotation.z = s * Math.PI / 2; g.add(al); }
  // faixa "rua campeã"
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const k = cv.getContext('2d')!;
  k.fillStyle = '#e63946'; k.fillRect(0, 0, 512, 128); k.fillStyle = '#fff'; k.font = '400 52px "Lilita One", sans-serif'; k.textAlign = 'center'; k.textBaseline = 'middle';
  k.fillText((tipo === 'trofeu' ? '🏆 ' : '') + 'RUA CAMPEÃ', 256, 46); k.font = '900 30px Nunito, sans-serif'; k.fillText(nome.slice(0, 26), 256, 98);
  const tx = new T.CanvasTexture(cv); tx.colorSpace = T.SRGBColorSpace;
  const fx = new T.Mesh(new T.PlaneGeometry(1.8, 0.45), new T.MeshBasicMaterial({ map: tx, side: T.DoubleSide, toneMapped: false })); fx.position.y = 1.85; g.add(fx);
  g.userData.anima = 'trofeu'; g.scale.setScalar(0.75);
  g.traverse((o) => { if ((o as T.Mesh).isMesh) o.castShadow = true; });
  return g;
}
const PELES = ['pele.1', 'pele.2', 'pele.3', 'pele.4', 'pele.5', 'pele.6'], CABS = ['cabelo.curto', 'cabelo.longo', 'cabelo.cacheado', 'cabelo.crespo', 'cabelo.raspado', 'cabelo.coque', 'cabelo.trancas'];
const CCABS = ['cor_cabelo.preto', 'cor_cabelo.castanho', 'cor_cabelo.loiro', 'cor_cabelo.ruivo', 'cor_cabelo.colorido'], ROUPAS = ['roupa.camiseta', 'roupa.moletom', 'roupa.vestido', 'roupa.camisa', 'roupa.regata'];
const CROUPAS = ['cor_roupa.amarelo', 'cor_roupa.azul', 'cor_roupa.verde', 'cor_roupa.vermelho', 'cor_roupa.preto', 'cor_roupa.branco'], ACS = ['acessorio.nenhum', 'acessorio.nenhum', 'acessorio.bone', 'acessorio.oculos', 'acessorio.fone'], CALS = ['calcado.tenis', 'calcado.chinelo', 'calcado.bota'];
function avatarDemo(seed: number): ConfigAvatar {
  let s = seed >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const p = <X,>(l: X[]) => l[Math.floor(r() * l.length)];
  return { pele: p(PELES), cabelo: p(CABS), cor_cabelo: p(CCABS), roupa: p(ROUPAS), cor_roupa: p(CROUPAS), acessorio: p(ACS), calcado: p(CALS) };
}
import type { Dados, Cidade } from '../dados/dados';
import type { Loja } from '../dados/formato';
import type { Camera } from './camera';

/* faixa de nível → modelos possíveis (a variante sai do hash do lote) */
const MODELOS_DA_FAIXA = [[0, 6, 7, 10, 0, 6], [1, 8, 1], [2, 9], [3], [4], [5]];
const N_MOD = 11;
/* paleta da cidade: paredes claras e telhados pastel (laranja, pêssego, azul-claro, verde-claro) */
const PAREDES = ['#ffffff', '#fbf8f2', '#ffffff', '#f6f2ea', '#ffffff', '#fdf6ee'];
const TELHADOS = ['#f0965a', '#9cc2e8', '#f3a46c', '#a9cbec', '#f0965a', '#9cc2e8', '#f2b48c', '#b3d7a0'];

export type CasaVisivel = { gi: number; x: number; y: number; alt: number; ibge: number };
export type LojaVisivel = { loja: Loja; x: number; y: number; ibge: number };

function matCidade() {
  const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNoite = NOITE;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float aEmis; varying float vEmis;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float hI = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453); vEmis = aEmis * step(0.3, hI);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uNoite; varying float vEmis;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.62, 0.18) * vEmis * uNoite * 1.25;`);
  };
  return mat;
}
function grupo(geo: T.BufferGeometry, cap: number, sombra: boolean): T.InstancedMesh {
  const mat = matCidade();
  const m = new T.InstancedMesh(geo, mat, cap); m.count = 0; m.castShadow = sombra; m.receiveShadow = true; m.frustumCulled = false;
  return m;
}
function geoPoste() { return juntar([{ pos: cilindro(0.018, 0.022, 0.62, 5), cor: '#9aa3ae' }, { pos: caixa(-0.04, 0.6, -0.04, 0.04, 0.66, 0.04), cor: '#fff4c2' }]); }
function geoQuadra() { return juntar([{ pos: caixa(-0.5, 0, -0.5, 0.5, 0.008, 0.5, false), cor: '#ffffff' }]); }
function geoGuardaSol() {
  const cone = new T.ConeGeometry(0.22, 0.1, 8, 1, true).toNonIndexed(); cone.translate(0, 0.36, 0);
  return juntar([{ pos: Array.from(cone.attributes.position.array as Float32Array), cor: '#ffffff' }, { pos: cilindro(0.008, 0.008, 0.34, 4), cor: '#e9e4d8' }, { pos: caixa(0.12, 0, 0.05, 0.3, 0.02, 0.14, false), cor: '#ffffff' }]);
}
function geoFlorida() {
  const copa = new T.IcosahedronGeometry(0.34, 0).toNonIndexed(); copa.translate(0, 0.6, 0);
  return juntar([{ pos: Array.from(copa.attributes.position.array as Float32Array), cor: '#d9453a' }, { pos: cilindro(0.04, 0.06, 0.32, 5), cor: '#7a5a3a' }]);
}

export function criarCidades3D(scene: T.Scene, dados: Dados, camera: Camera, opts: { maxCidades: number; maxCasas: number }) {
  const raiz = new T.Group(); raiz.name = 'cidades'; scene.add(raiz);
  const geos = Array.from({ length: N_MOD }, (_, m) => (m <= 5 ? geoCasa(m) : geoExtra(m)));
  const G: Record<string, T.InstancedMesh> = {};
  const novo = (k: string, geo: T.BufferGeometry, sombra: boolean) => { G[k] = grupo(geo, 64, sombra); raiz.add(G[k]); };
  for (let m = 0; m < N_MOD; m++) { novo('p' + m, geos[m].paredes, true); novo('t' + m, geos[m].telhado, true); }
  novo('arv', geoArvoreCidade(false), true); novo('palma', geoArvoreCidade(true), true); novo('flor', geoFlorida(), true);
  novo('praca', geoPraca(), false); novo('igreja', geoPrefeitura(), true); novo('poste', geoPoste(), false);
  novo('quadra', geoQuadra(), false); novo('guardasol', geoGuardaSol(), true); novo('chao', juntar([{ pos: disco(1, 48, 0.002), cor: '#ffffff' }]), false);
  G.quadra.renderOrder = 1; G.chao.renderOrder = 0; G.chao.castShadow = false;
  const fitas: T.Mesh[] = [];
  const haloMat = new T.ShaderMaterial({
    uniforms: { uNoite: NOITE, uEsc: { value: 900 } },
    vertexShader: 'attribute float aS; uniform float uEsc; varying float vS; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uEsc * aS / -mv.z; vS = aS; }',
    fragmentShader: 'uniform float uNoite; void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q); if (d > 1.0) discard; float a = pow(1.0 - d, 2.6) * uNoite * 0.35; gl_FragColor = vec4(1.0, 0.82, 0.45, a); }',
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
  });
  const halos = new T.Points(new T.BufferGeometry(), haloMat); halos.frustumCulled = false; halos.renderOrder = 15; raiz.add(halos);
  const lojasG = new Map<string, T.Group>();
  const placas = new Map<number, T.Group>();
  const avatares = criarAvatares({ escala: 0.6, maxRender: 140 }); raiz.add(avatares.raiz);
  let avIds: string[] = [];
  let meu: { ibge: number; lote: number; config: ConfigAvatar; trabalhando?: boolean; alvo?: { x: number; y: number; yaw: number } | null } | null = null;
  let empresas: Loja[] = [];
  const empG = new Map<string, T.Group>();
  const posEmp = new Map<string, { x: number; y: number; yaw: number }>();
  let vizinhos: { id: string; ibge: number; lote: number; config: ConfigAvatar }[] = [];
  let campeas: { ibge: number; lotes: number[]; tipo: string; nome: string }[] = [];
  const trofeus = new T.Group(); raiz.add(trofeus);
  const posLoja = new Map<string, { x: number; y: number; yaw: number } | null>();

  const PAR = PAREDES.map((h) => A(h)), TEL = TELHADOS.map((h) => A(h));
  const SOLS = ['#e63946', '#ffd23f', '#3a86ff', '#ff8a1f', '#2a9d8f', '#ffffff'].map((h) => A(h));
  const OURO = A('#e0a92a'), QUADRA = A('#8fc468'), CHAO = A('#97cc72');
  const COPAS = ['#4f9c3f', '#5aa247', '#3f8a3a', '#6aae4f', '#4f9c3f', '#5aa247', '#e0b030', '#9b6fd1', '#e58ab5', '#d98a2b'].map((h) => A(h));
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _s = new T.Vector3(), _p = new T.Vector3();
  const mat = (x: number, y: number, yaw: number, sx: number, sy = sx, sz = sx) => { _q.setFromEuler(_e.set(0, yaw, 0)); return _m.compose(_p.set(x, 0, -y), _q, _s.set(sx, sy, sz)).clone(); };

  function encher(k: string, l: { m: T.Matrix4; c?: T.Color }[]) {
    let g = G[k];
    if (l.length > g.instanceMatrix.count) {
      let cap = 64; while (cap < l.length * 1.25) cap *= 2;
      const n = new T.InstancedMesh(g.geometry, g.material, cap); n.castShadow = g.castShadow; n.receiveShadow = true; n.frustumCulled = false; n.renderOrder = g.renderOrder;
      raiz.remove(g); g.dispose(); raiz.add(n); G[k] = g = n;
    }
    l.forEach((it, i) => { g.setMatrixAt(i, it.m); if (it.c) g.setColorAt(i, it.c); });
    g.count = l.length; g.instanceMatrix.needsUpdate = true; if (g.instanceColor) g.instanceColor.needsUpdate = true;
  }

  let visiveis: Cidade[] = [], assinatura = '', casas: CasaVisivel[] = [], lojas: LojaVisivel[] = [], layouts = new Map<number, LayoutCidade>();
  let ultimaTroca = 0;
  const lojasPorIbge = new Map<number, Loja[]>(); for (const l of dados.p.lojas) (lojasPorIbge.get(l.ibge) || lojasPorIbge.set(l.ibge, []).get(l.ibge)!).push(l);

  /* cidades vizinhas não se sobrepõem: a maior ocupa o chão primeiro e a menor desvia dos lotes dela */
  const rEst = (c: Cidade) => CEL * (Math.sqrt(c.n / 0.5) * 0.75 + 4);
  const memo = new Map<number, LayoutCidade>();
  const grade = (() => { const g = new Map<string, Cidade[]>(); for (const c of dados.CID) { const k = Math.floor(c.x / 60) + ',' + Math.floor(c.y / 60); (g.get(k) || g.set(k, []).get(k)!).push(c); } return g; })();
  function vizinhasMaiores(c: Cidade) {
    const out: Cidade[] = [], gx = Math.floor(c.x / 60), gy = Math.floor(c.y / 60);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const o of grade.get(gx + a + ',' + (gy + b)) || []) {
      if (o === c || o.n < c.n || (o.n === c.n && o.ibge > c.ibge)) continue;
      if (Math.hypot(o.x - c.x, o.y - c.y) < rEst(o) + rEst(c)) out.push(o);
    }
    return out;
  }
  function layoutDe(c: Cidade): LayoutCidade {
    const m = memo.get(c.ibge); if (m) return m;
    const viz = vizinhasMaiores(c).map(layoutDe);
    // afasta o centro da cidade menor para fora das maiores (uma prefeitura por mancha urbana)
    let cx = c.x, cy = c.y; const rOwn = rEst(c) * 0.7;
    for (let it = 0; it < 3; it++) for (const v of viz) {
      let dx = cx - v.cx, dy = cy - v.cy; let d = Math.hypot(dx, dy); const need = v.raio + rOwn + 1.5;
      if (d >= need) continue;
      if (d < 0.01) { const a = (c.ibge % 360) * Math.PI / 180; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
      cx = v.cx + (dx / d) * need; cy = v.cy + (dy / d) * need;
    }
    let bloq: ((x: number, y: number) => boolean) | undefined, sig = '';
    if (viz.length) {
      const occ = new Set<string>(), Q = 1.0;
      for (const v of viz) { for (const l of v.lotes) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) occ.add(Math.floor(l.x / Q + a) + ',' + Math.floor(l.y / Q + b)); }
      const centros = viz.map((v) => [v.cx, v.cy, v.praca.r + 2.2] as const);
      bloq = (x, y) => occ.has(Math.floor(x / Q) + ',' + Math.floor(y / Q)) || centros.some(([a, b, r]) => Math.hypot(x - a, y - b) < r);
      sig = viz.map((v) => v.ibge + ':' + v.lotes.length).join(',');
    }
    const L = construirCidade(c.ibge, cx, cy, c.n, bloq, sig + '@' + cx.toFixed(1) + ',' + cy.toFixed(1)); memo.set(c.ibge, L); return L;
  }

  let fixa = false;
  function escolher(): Cidade[] {
    const d = camera.dist; if (d > 420) return [];
    const fx = camera.st.fx, fy = camera.st.fy, raio = Math.max(40, d * 1.7);
    const cand: { c: Cidade; k: number }[] = [];
    for (const c of dados.CID) { const dd = Math.hypot(c.x - fx, c.y - fy); if (dd < raio + 30) cand.push({ c, k: dd - Math.sqrt(c.n) * 2 }); }
    cand.sort((a, b) => a.k - b.k);
    const out: Cidade[] = []; let casasN = 0;
    for (const { c } of cand) { if (out.length >= opts.maxCidades || casasN + c.n > opts.maxCasas) continue; out.push(c); casasN += c.n; }
    return out;
  }

  function postes(pts: [number, number][], off: number, out: { m: T.Matrix4 }[]) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], len = Math.hypot(x1 - x0, y1 - y0); if (len < 0.01) continue;
      const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      for (let t = 1.2; t < len - 0.5; t += 5.0) { const x = x0 + ((x1 - x0) * t) / len, y = y0 + ((y1 - y0) * t) / len; const s = (Math.floor(t / 5.0) % 2) * 2 - 1; out.push({ m: mat(x + nx * off * s, y + ny * off * s, 0, 1) }); }
    }
  }

  function reconstruir(lista: Cidade[]) {
    visiveis = lista; layouts = new Map(); casas = []; lojas = [];
    const L: Record<string, { m: T.Matrix4; c?: T.Color }[]> = {}; for (const k of Object.keys(G)) L[k] = [];
    const ruas: { pts: [number, number][]; hw: number }[] = [], avs: { pts: [number, number][]; hw: number }[] = [], contornos: any[] = [];
    const praias: { pts: [number, number][]; hw: number }[] = [];
    const D = dados.p;
    for (const c of lista) {
      const Lc = layoutDe(c); layouts.set(c.ibge, Lc);
      const ca = Math.cos(Lc.ang), sa = Math.sin(Lc.ang);
      const W = (i: number, j: number): [number, number] => [Lc.cx + (i * ca - j * sa) * CEL, Lc.cy + (i * sa + j * ca) * CEL];
      const quadras = new Set<string>();
      Lc.lotes.forEach((lo, k) => {
        const gi = c.ini + k, cg = dados.cargo(gi), faixa = tipoCasa(dados.NV[gi], cg);
        const opcoes = MODELOS_DA_FAIXA[faixa], mod = opcoes[lo.v % opcoes.length];
        const cor = D.cor[gi] || 0, h = ((gi * 2654435761) >>> 0) / 4294967296;
        const cw = PAR[(Math.floor(cor / 10) + lo.v) % PAR.length], cr = cg && 'PGM'.includes(cg) ? OURO : TEL[((cor % 10) + lo.v * 7) % TEL.length];
        const s = 0.72 + 0.08 * h;
        const m = mat(lo.x, lo.y, lo.yaw, s, s * 0.95, s);
        L['p' + mod].push({ m, c: cw }); L['t' + mod].push({ m, c: cr });
        quadras.add(Math.floor(lo.i / 4) + ',' + Math.floor(lo.j / 4));
        casas.push({ gi, x: lo.x, y: lo.y, alt: [0.6, 1.0, 1.15, 1.6, 2.5, 0.9][faixa], ibge: c.ibge });
      });
      // quadra = bloco 3×3 lotes; rotação no Three é +ang para alinhar com a grade (x→x, y→−z)
      for (const q of quadras) { const [bi, bj] = q.split(',').map(Number); const [x, y] = W(bi * 4 + 2, bj * 4 + 2); if (![[0.6, 0.6], [3.4, 0.6], [0.6, 3.4], [3.4, 3.4]].every(([a, b]) => { const p = W(bi * 4 + a, bj * 4 + b); return ehTerra(p[0], p[1]); })) continue; L.quadra.push({ m: mat(x, y, Lc.ang, 3 * CEL - 0.12, 1, 3 * CEL - 0.12), c: QUADRA }); }
      for (const v of Lc.verdes) L.arv.push({ m: mat(v.x, v.y, v.x * 7.7, 0.8), c: COPAS[Math.floor((((v.x * 91.3 + v.y * 37.1) % 1) + 1) % 1 * COPAS.length)] });
      for (const a of Lc.arvores) { const fl = !a.palma && (((a.x * 131.7 + a.y * 71.3) % 1) + 1) % 1 < 0.12; L[a.palma ? 'palma' : fl ? 'flor' : 'arv'].push({ m: mat(a.x, a.y, a.x * 13.1, a.s), c: a.palma || fl ? undefined : COPAS[Math.floor((((a.x * 53.7 + a.y * 19.3) % 1) + 1) % 1 * COPAS.length)] }); }
      L.praca.push({ m: mat(Lc.praca.x, Lc.praca.y, 0, Lc.praca.r, 1.4, Lc.praca.r) });
      // praia: trechos da costa a até (raio + 8 km) do centro viram faixa de areia com coqueiros e guarda-sóis
      { const R = Lc.raio + 8;
        for (const anel of TERRENO.costa) {
          let trecho: [number, number][] = [];
          const fecha = () => { if (trecho.length >= 2) praias.push({ pts: trecho, hw: 0.55 }); trecho = []; };
          for (let i = 0; i < anel.length; i++) {
            const [x0, y0] = anel[i], [x1, y1] = anel[(i + 1) % anel.length];
            if (Math.hypot(x0 - Lc.cx, y0 - Lc.cy) > R && Math.hypot(x1 - Lc.cx, y1 - Lc.cy) > R) { fecha(); continue; }
            trecho.push([x0, y0]);
            const len = Math.hypot(x1 - x0, y1 - y0); if (len < 0.01) continue;
            const tx = (x1 - x0) / len, ty = (y1 - y0) / len; let nx = -ty, ny = tx;
            for (let t = 0.8; t < len; t += 1.7) {
              const px = x0 + tx * t, py = y0 + ty * t; const dc = Math.hypot(px - Lc.cx, py - Lc.cy); if (dc > R || dc < Lc.praca.r + 4.5) continue;
              if (Lc.lotes.some((lo) => Math.abs(lo.x - px) < 1.3 && Math.abs(lo.y - py) < 1.3)) continue;
              let lx = nx, ly = ny; if (!ehTerra(px + lx * 1.2, py + ly * 1.2)) { lx = -nx; ly = -ny; }
              const h = (((px * 12.9898 + py * 78.233) % 1) + 1) % 1;
              L.guardasol.push({ m: mat(px + lx * 0.15, py + ly * 0.15, h * 6.28, 1.1), c: SOLS[Math.floor(h * SOLS.length)] });
              if (h > 0.35) L.palma.push({ m: mat(px + lx * 0.75, py + ly * 0.75, h * 9, 0.9 + h * 0.4) });
            }
          }
          trecho.push(anel[0]); fecha();
        }
      }
      if (Lc.igreja) L.igreja.push({ m: mat(Lc.igreja.x, Lc.igreja.y, Lc.igreja.yaw, 1.1) });
      for (const r of Lc.ruas) { ruas.push(r as any); postes(r.pts as [number, number][], 0.34, L.poste); }
      for (const r of Lc.avenidas) { avs.push(r as any); postes(r.pts as [number, number][], 0.56, L.poste); }
      // empresa fica AO LADO da casa do dono: no terreno vazio mais próximo (ou encostada na lateral do lote)
      for (const e of empresas.filter((x) => x.ibge === c.ibge)) {
        const lo = (e as any).dono_lote != null ? Lc.lotes[(e as any).dono_lote] : null;
        if (!lo) { const nl = (lojasPorIbge.get(c.ibge) || []).length; const v = Lc.vagasLoja[nl]; if (v) posEmp.set(e.id, { ...v }); continue; }
        let melhor: { x: number; y: number } | null = null, md = CEL * 2.2;
        for (const v of Lc.verdes) { const d = Math.hypot(v.x - lo.x, v.y - lo.y); if (d < md) { md = d; melhor = v; } }
        if (melhor) posEmp.set(e.id, { x: melhor.x, y: melhor.y, yaw: lo.yaw });
        else { const lx = Math.cos(lo.yaw), ly = Math.sin(lo.yaw); posEmp.set(e.id, { x: lo.x + lx * CEL * 0.62, y: lo.y + ly * CEL * 0.62, yaw: lo.yaw }); }
      }
      (lojasPorIbge.get(c.ibge) || []).forEach((l, k) => { const v = Lc.vagasLoja[k % Math.max(1, Lc.vagasLoja.length)]; if (v) { lojas.push({ loja: l, x: v.x, y: v.y, ibge: c.ibge }); posLoja.set(l.id, { ...v }); } });
    }
    for (const k of Object.keys(G)) encher(k, L[k]);
    { // halos: um por poste (altura da lâmpada), praça e loja
      const pos: number[] = [], sz: number[] = [];
      const p3 = new T.Vector3();
      for (const it of L.poste) { p3.setFromMatrixPosition(it.m); pos.push(p3.x, 0.65, p3.z); sz.push(1.6); }
      for (const it of L.praca) { p3.setFromMatrixPosition(it.m); pos.push(p3.x, 0.4, p3.z); sz.push(5.5); }
      for (const lv of lojas) { pos.push(lv.x, 0.8, -lv.y); sz.push(4); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('aS', new T.Float32BufferAttribute(sz, 1));
      halos.geometry.dispose(); halos.geometry = g;
    }
    for (const m of fitas) { raiz.remove(m); m.geometry.dispose(); }
    fitas.length = 0;
    if (praias.length) { const fp = fita(praias, { cor: '#f2e2b2', minPx: 2, lift: 0.0002 }, 7, 0.006); fitas.push(fp); raiz.add(fp); }
    if (ruas.length || avs.length) {
      const rw = ruas.map((r) => ({ ...r, hw: 0.3 })), aw = avs.map((r) => ({ ...r, hw: 0.48 }));
      fitas.push(fita([...rw.map((r) => ({ ...r, hw: r.hw + 0.1 })), ...aw.map((r) => ({ ...r, hw: r.hw + 0.12 }))], { cor: '#e4e2dc', minPx: 2, lift: 0.00025 }, 8, 0.012));
      fitas.push(fita([...rw, ...aw], { cor: '#62676b', minPx: 1.2, lift: 0.0003 }, 9, 0.014));
      fitas.push(fita([...rw, ...aw].map((r) => ({ ...r, hw: 0.025 })), { cor: '#f4f4f0', minPx: 0.6, lift: 0.00035, tracejado: 0.55, fadePx: 1.2 }, 10, 0.016));
      raiz.add(...fitas);
    }
    // placas das cidades com prefeitura e avatares de demonstração passeando nas praças
    const comPref = lista.filter((cc) => layouts.get(cc.ibge)?.igreja);
    const vivasP = new Set(comPref.map((cc) => cc.ibge));
    for (const [ib, g] of placas) if (!vivasP.has(ib)) { raiz.remove(g); placas.delete(ib); }
    const pessoas: { id: string; config: ConfigAvatar; x: number; y: number; yaw: number }[] = [];
    for (const cc of comPref) {
      const Lc = layouts.get(cc.ibge)!; const f = Lc.igreja!; const fx = Math.sin(f.yaw), fy = -Math.cos(f.yaw);
      let g = placas.get(cc.ibge); if (!g) { g = placaCidade(cc.nome); placas.set(cc.ibge, g); raiz.add(g); }
      g.position.set(Lc.cx + fx * Lc.praca.r * 0.62, 0, -(Lc.cy + fy * Lc.praca.r * 0.62)); g.rotation.y = f.yaw + 0.25;
      if (pessoas.length < 130) for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + cc.ibge % 7, rr = Lc.praca.r * (0.55 + 0.25 * ((k * 37) % 10) / 10);
        pessoas.push({ id: cc.ibge + ':' + k, config: avatarDemo(cc.ibge * 31 + k), x: Lc.cx + Math.cos(a) * rr, y: Lc.cy + Math.sin(a) * rr, yaw: -a + Math.PI / 2 });
      }
    }
    for (const v of vizinhos) { const Lv = layouts.get(v.ibge); const lo = Lv?.lotes[v.lote]; if (lo) { const fx = Math.sin(lo.yaw), fy = -Math.cos(lo.yaw); pessoas.push({ id: v.id, config: v.config, x: lo.x + fx * 0.75, y: lo.y + fy * 0.75, yaw: lo.yaw }); } }
    // troféu / faixa nas ruas campeãs: no centro dos lotes da rua
    trofeus.clear();
    for (const cp of campeas) { const Lc = layouts.get(cp.ibge); if (!Lc) continue; const pts = cp.lotes.map((k) => Lc.lotes[k]).filter(Boolean); if (!pts.length) continue;
      const x = pts.reduce((s, p) => s + p.x, 0) / pts.length, y = pts.reduce((s, p) => s + p.y, 0) / pts.length; const g = trofeu3d(cp.tipo, cp.nome); g.position.set(x, 0, -y); trofeus.add(g); }
    if (meu && meu.trabalhando) { const Lm = layouts.get(meu.ibge); const a = meu.alvo; if (a) { const fx = Math.sin(a.yaw), fy = -Math.cos(a.yaw); pessoas.push({ id: 'eu', config: meu.config, x: a.x + fx * 0.6, y: a.y + fy * 0.6, yaw: a.yaw + Math.PI }); } else if (Lm) pessoas.push({ id: 'eu', config: meu.config, x: Lm.cx + Lm.praca.r * 0.35, y: Lm.cy - Lm.praca.r * 0.35, yaw: 0 }); }
    else if (meu) { const Lm = layouts.get(meu.ibge); const lo = Lm?.lotes[meu.lote]; if (lo) { const fx = Math.sin(lo.yaw), fy = -Math.cos(lo.yaw); pessoas.push({ id: 'eu', config: meu.config, x: lo.x + fx * 0.75, y: lo.y + fy * 0.75, yaw: lo.yaw }); } }
    avatares.definir(pessoas); avIds = pessoas.map((a) => a.id);
    { const vivasE = new Set<string>(); for (const e of empresas) { const v = posEmp.get(e.id); if (!v || !lista.some((cc) => cc.ibge === e.ibge)) continue; vivasE.add(e.id); let g = empG.get(e.id); if (!g) { g = criarEscritorio(e); empG.set(e.id, g); raiz.add(g); } g.position.set(v.x, 0, -v.y); g.rotation.y = v.yaw; g.scale.setScalar(0.42); }
      for (const [id, g] of empG) if (!vivasE.has(id)) { raiz.remove(g); empG.delete(id); } }
    const vivas = new Set(lojas.map((l) => l.loja.id));
    for (const [id, g] of lojasG) if (!vivas.has(id)) { raiz.remove(g); lojasG.delete(id); }
    for (const lv of lojas) {
      let g = lojasG.get(lv.loja.id); if (!g) { g = criarLoja3D(lv.loja, A); lojasG.set(lv.loja.id, g); raiz.add(g); }
      const v = posLoja.get(lv.loja.id)!; g.position.set(v.x, 0, -v.y); g.rotation.y = v.yaw; g.scale.setScalar(1.12);
    }
  }

  return {
    raiz,
    get casas() { return casas; },
    get lojas() { return lojas; },
    get visiveis() { return visiveis; },
    layout: (ibge: number) => layouts.get(ibge) || null,
    passo(agora: number) {
      const d = camera.dist;
      raiz.visible = d < 420;
      avatares.raiz.visible = d < 120; avatares.passo(agora);
      for (const g of trofeus.children) g.rotation.y = agora * 0.8;
      for (const g of empG.values()) { const m = g.children.find((x) => x.userData.anima === 'gira'); if (m) { m.rotation.y = agora; m.rotation.x = agora * 0.6; } }
      if (!fixa && avIds.length && Math.random() < 0.02) avatares.animar(avIds[Math.floor(Math.random() * avIds.length)], Math.random() < 0.5 ? 'aceno' : 'comemorar'); halos.visible = NOITE.value > 0.05; haloMat.uniforms.uEsc.value = innerHeight * 0.9;
      const sombra = d < 120;
      for (const k of Object.keys(G)) if (k[0] === 'p' || k[0] === 't' || k === 'arv' || k === 'igreja' || k === 'flor' || k === 'palma') G[k].castShadow = sombra;
      for (const g of lojasG.values()) { const m = g.children.find((x) => x.userData.anima === 'flutua'); if (m) m.position.y = 1.13 + Math.sin(agora * 2) * 0.05; }
      if (fixa || agora - ultimaTroca < 0.35 || (camera.voo && d > 300)) return;
      const lista = escolher(); const sig = lista.map((c) => c.ibge).join(',');
      if (sig !== assinatura) { assinatura = sig; ultimaTroca = agora; reconstruir(lista); }
    },
    definirMeuAvatar(m: { ibge: number; lote: number; config: ConfigAvatar; trabalhando?: boolean } | null) { meu = m; assinatura = ''; },
    trabalhando(t: boolean, alvo?: { x: number; y: number; yaw: number } | null) { if (meu) { meu = { ...meu, trabalhando: t, alvo: alvo ?? null }; assinatura = ''; } },
    definirEmpresas(l: Loja[]) { empresas = l; assinatura = ''; },
    posicaoEmpresa(id: string) { return posEmp.get(id) || null; },
    lojaDoTipo(ibge: number, tipos: string[]) { const l = (lojasPorIbge.get(ibge) || []).find((x) => !tipos.length || tipos.includes(x.tipo)); if (!l) return null; const c = dados.POR_IBGE.get(ibge)!; const L = layoutDe(c); const k = (lojasPorIbge.get(ibge) || []).indexOf(l); return L.vagasLoja[k] || null; },
    definirVizinhos(l: { id: string; ibge: number; lote: number; config: ConfigAvatar }[]) { const sig = JSON.stringify(l.map((v) => v.id + v.lote)); if (sig === JSON.stringify(vizinhos.map((v) => v.id + v.lote))) return; vizinhos = l; assinatura = ''; },
    definirCampeas(l: { ibge: number; lotes: number[]; tipo: string; nome: string }[]) { campeas = l; assinatura = ''; },
    animarAvatar(id: string, a: 'aceno' | 'comemorar') { avatares.animar(id, a); },
    posicaoAvatar(id: string) { if (id === 'eu' && meu) { const p = this.posicaoLote(meu.ibge, meu.lote); return p; } const v = vizinhos.find((x) => x.id === id); return v ? this.posicaoLote(v.ibge, v.lote) : null; },
    posicaoLote(ibge: number, lote: number) { const c = dados.POR_IBGE.get(ibge); if (!c) return null; const L = layoutDe(c); const lo = L.lotes[lote]; return lo ? { x: lo.x, y: lo.y } : { x: L.cx, y: L.cy }; },
    acenarEu() { avatares.animar('eu', 'aceno'); },
    /** modo filme: congela as cidades construídas (a lista não muda com a câmera) */
    fixar(lista: Cidade[] | null) { fixa = !!lista; if (lista) { assinatura = lista.map((x) => x.ibge).join(','); reconstruir(lista); } },
    vizinhasDe(c: Cidade, n: number) { return [c, ...dados.CID.filter((x) => x !== c).map((x) => ({ x, d: Math.hypot(x.x - c.x, x.y - c.y) })).filter((o) => o.d < 120).sort((a, b) => a.d - b.d).slice(0, n - 1).map((o) => o.x)]; },
    forcar(c: Cidade) { if (!visiveis.includes(c)) { const l = [c, ...visiveis.filter((x) => x !== c)].slice(0, opts.maxCidades); assinatura = l.map((x) => x.ibge).join(','); reconstruir(l); } },
    posicaoCasa(gi: number): { x: number; y: number } | null {
      const ci = dados.CID_DE[gi]; if (ci < 0) return null; const c = dados.CID[ci];
      const Lc = layoutDe(c); const lo = Lc.lotes[gi - c.ini];
      return lo ? { x: lo.x, y: lo.y } : { x: Lc.cx, y: Lc.cy };
    },
    posicaoLoja(l: Loja): { x: number; y: number } | null {
      const c = dados.POR_IBGE.get(l.ibge); if (!c) return null;
      const Lc = layoutDe(c); const k = (lojasPorIbge.get(c.ibge) || []).indexOf(l);
      const v = Lc.vagasLoja[Math.max(0, k) % Math.max(1, Lc.vagasLoja.length)]; return v ? { x: v.x, y: v.y, yaw: v.yaw } as any : { x: Lc.cx, y: Lc.cy };
    },
  };
}
