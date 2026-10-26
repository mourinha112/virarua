/* Casa que evolui à vista: além do tipo de construção (térrea → sobrado → casa alta → prédio → torre), cada faixa
   de nível ganha detalhes no lote, de graça e para todo mundo ver:
   2+ flores na frente · 4+ cerquinha branca · 6+ caixa de correio · 8+ árvore no quintal · 11+ piscina no quintal
   · 14+ jardim com arbustos · 20+ fonte com chafariz. Só as casas perto da câmera (leve no celular). */
import * as T from 'three';
import type { LayoutCidade } from './cidade';
type Cid = { ibge: number; ini: number; n: number };
type Fonte = { visiveis: Cid[]; layout: (ibge: number) => LayoutCidade | null };

export const DETALHES_NIVEL: [number, string, string][] = [
  [2, '🌷', 'flores na frente'], [4, '🏡', 'cerquinha branca'], [6, '📮', 'caixa de correio'], [8, '🌳', 'árvore no quintal'],
  [11, '🏊', 'piscina no quintal'], [14, '🌿', 'jardim com arbustos'], [20, '⛲', 'fonte com chafariz'],
];

const mats = new Map<string, T.Material>();
const mat = (h: string) => { let m = mats.get(h); if (!m) { m = new T.MeshStandardMaterial({ color: h, roughness: 0.8 }); mats.set(h, m); } return m; };
const G = { caixa: new T.BoxGeometry(1, 1, 1), cil: new T.CylinderGeometry(0.5, 0.5, 1, 8), bola: new T.SphereGeometry(0.5, 8, 6), cone: new T.ConeGeometry(0.5, 1, 7) };
function p(g: T.Group, geo: T.BufferGeometry, cor: string, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const m = new T.Mesh(geo, mat(cor)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
}
/* peças no espaço do lote: +z = frente da casa (rua), x = lado. Casa ocupa ~[-0.45, 0.45]. */
function detalhes(nv: number) {
  const g = new T.Group();
  if (nv >= 2) for (const s of [-1, 1]) { p(g, G.caixa, '#7a4e2d', 0.24, 0.05, 0.1, s * 0.3, 0.025, 0.58); for (let i = 0; i < 3; i++) p(g, G.bola, ['#ff5d8f', '#ffd23f', '#e63946'][i], 0.06, 0.06, 0.06, s * 0.3 - 0.08 + i * 0.08, 0.08, 0.58); }
  if (nv >= 4) for (const s of [-1, 1]) { p(g, G.caixa, '#ffffff', 0.34, 0.03, 0.02, s * 0.32, 0.12, 0.8); p(g, G.caixa, '#ffffff', 0.34, 0.03, 0.02, s * 0.32, 0.05, 0.8); for (let i = 0; i < 2; i++) p(g, G.caixa, "#f4f1ea", 0.025, 0.16, 0.025, s * (0.16 + i * 0.3), 0.08, 0.8); }
  if (nv >= 6) { p(g, G.cil, '#5b4636', 0.025, 0.16, 0.025, 0.12, 0.08, 0.86); p(g, G.caixa, '#1d4ed8', 0.07, 0.06, 0.1, 0.12, 0.18, 0.86); }
  if (nv >= 8) { p(g, G.cil, '#6e4a2f', 0.06, 0.3, 0.06, 0, 0.15, -0.65); p(g, G.bola, '#3f9e3a', 0.34, 0.3, 0.34, 0, 0.42, -0.65); }
  if (nv >= 11) { p(g, G.caixa, '#f1efe6', 0.42, 0.04, 0.24, -0.38, 0.02, -0.62); p(g, G.caixa, '#3ab0e8', 0.36, 0.045, 0.18, -0.38, 0.025, -0.62); }
  if (nv >= 14) for (const s of [-1, 1]) for (let i = 0; i < 3; i++) p(g, G.bola, '#2f8a3a', 0.12, 0.11, 0.12, s * 0.58, 0.06, 0.4 - i * 0.28);
  if (nv >= 20) { p(g, G.cil, '#d9dbe0', 0.26, 0.06, 0.26, 0.38, 0.03, -0.62); p(g, G.cil, '#3ab0e8', 0.2, 0.065, 0.2, 0.38, 0.035, -0.62); const j = p(g, G.cone, '#9fd3f5', 0.06, 0.18, 0.06, 0.38, 0.15, -0.62); g.userData.jato = j; }
  return g;
}
const faixa = (nv: number) => DETALHES_NIVEL.filter(([n]) => nv >= n).length;

export function criarNiveis(scene: T.Scene, fonte: Fonte, NV: ArrayLike<number>, LIMITE = 140) {
  const raiz = new T.Group(); raiz.name = 'niveis'; scene.add(raiz);
  const vivos = new Map<string, T.Group>();
  let ultimo = '', tUlt = 0;
  function montar(fx: number, fy: number, dist: number) {
    const cand: { k: string; lo: { x: number; y: number; yaw: number }; f: number; nv: number; d: number }[] = [];
    for (const c of fonte.visiveis) {
      const L = fonte.layout(c.ibge); if (!L) continue;
      for (let k = 0; k < c.n; k++) {
        const nv = NV[c.ini + k], f = faixa(nv); if (!f) continue;
        const lo = L.lotes[k]; if (!lo) continue;
        const d = Math.hypot(lo.x - fx, lo.y - fy); if (d > dist * 1.2) continue;
        cand.push({ k: `${c.ibge}:${k}:${f}`, lo, f, nv, d });
      }
    }
    cand.sort((a, b) => a.d - b.d);
    const quero = new Set<string>();
    for (const c of cand.slice(0, LIMITE)) {
      quero.add(c.k); if (vivos.has(c.k)) continue;
      const g = detalhes(c.nv); g.position.set(c.lo.x, 0, -c.lo.y); g.rotation.y = c.lo.yaw; raiz.add(g); vivos.set(c.k, g);
    }
    for (const [k, g] of vivos) if (!quero.has(k)) { raiz.remove(g); vivos.delete(k); }
  }
  return {
    raiz,
    passo(agora: number, dist: number, fx: number, fy: number) {
      raiz.visible = dist < 110;
      if (!raiz.visible) return;
      const s = `${Math.round(fx / 2)}:${Math.round(fy / 2)}:${Math.round(dist / 10)}:${fonte.visiveis.length}`;
      if (s !== ultimo && agora - tUlt > 0.4) { ultimo = s; tUlt = agora; montar(fx, fy, Math.max(30, dist)); }
      for (const g of vivos.values()) if (g.userData.jato) g.userData.jato.scale.y = 0.18 + Math.sin(agora * 6) * 0.04;
    },
  };
}
