/* Mata: árvores baixo-poli instanciadas numa grade com jitter, densidade pelo bioma.
   De longe são os "pontinhos" verdes do mapa; ao aproximar encolhem (uTS) e somem perto do chão. */
import * as T from 'three';
import type { MapaMata } from './biomas';
import { ehTerra, TERRENO } from './terreno';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function geoArvore() {
  const copa = new T.IcosahedronGeometry(0.5, 0).toNonIndexed(); copa.scale(1, 1.05, 1); copa.translate(0, 0.62, 0);
  const tronco = new T.CylinderGeometry(0.05, 0.07, 0.3, 5, 1).toNonIndexed(); tronco.translate(0, 0.15, 0);
  const pinta = (g: T.BufferGeometry, hex: string) => { const c = new T.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new T.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g; };
  pinta(copa, '#5aa247'); pinta(tronco, '#7a5a3a');
  const pos = new Float32Array([...copa.attributes.position.array, ...tronco.attributes.position.array]);
  const col = new Float32Array([...copa.attributes.color.array, ...tronco.attributes.color.array]);
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3)); g.computeVertexNormals();
  return g;
}

export type Mata = ReturnType<typeof criarMata>;

/** evitar(x, y) → true se a árvore não deve nascer ali (cidades). */
export function criarMata(mata: MapaMata, evitar: (x: number, y: number) => boolean = () => false, sp = 20) {
  const uTS = { value: 1 };
  const [x0, y0, x1, y1] = TERRENO.box;
  const r = rng(20261024);
  const itens: { x: number; y: number; s: number; rot: number; cor: T.Color }[] = [];
  for (let y = y0; y < y1; y += sp) for (let x = x0; x < x1; x += sp) {
    const px = x + r() * sp, py = y + r() * sp, k = r(), ss = r(), rr = r();
    const dn = mata.dens(px, py); if (dn <= 0.02 || k > Math.pow(dn, 0.9)) continue;
    if (!ehTerra(px, py) || evitar(px, py)) continue;
    const seca = mata.seca(px, py);
    const cor = new T.Color((0.55 + 0.3 * seca) * (0.9 + 0.14 * rr), 0.82 - 0.06 * seca, (0.62 - 0.2 * seca) * (1.04 - 0.1 * rr));
    itens.push({ x: px, y: py, s: sp * (0.55 + 0.3 * ss), rot: rr * Math.PI * 2, cor });
  }
  const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  mat.onBeforeCompile = (sh) => { sh.uniforms.uTS = uTS; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTS;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed *= uTS;'); };
  const mesh = new T.InstancedMesh(geoArvore(), mat, itens.length);
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), sc = new T.Vector3(), p = new T.Vector3();
  itens.forEach((it, i) => { q.setFromEuler(e.set(0, it.rot, 0)); m4.compose(p.set(it.x, 0, -it.y), q, sc.set(it.s, it.s * 1.15, it.s)); mesh.setMatrixAt(i, m4); mesh.setColorAt(i, it.cor); });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false; mesh.name = 'mata';
  return {
    mesh, n: itens.length,
    /** h = altura da câmera (km) */
    passo(h: number) {
      uTS.value = Math.max(0.02, Math.min(0.7, h / 5000));
      mesh.visible = h > 120;
    },
  };
}
