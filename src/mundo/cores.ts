/* Pré-compensação do ACES: dado o hex que queremos VER na tela, acha o albedo linear que, iluminado pela cena
   e passado pelo tone mapping ACES, cai nessa cor. Mesmo esquema do original (Newton com jacobiano numérico). */
import * as T from 'three';

export const SUN_DIR = new T.Vector3(-0.62, 0.56, -0.36).normalize();
export const LIGHT = { hemi: 1.9, sun: 1.7, exposure: 1.0 };
export const KLIT = (LIGHT.hemi + LIGHT.sun * SUN_DIR.y) / Math.PI;

const M1 = [[0.59719, 0.35458, 0.04823], [0.076, 0.90834, 0.01566], [0.0284, 0.13383, 0.83777]];
const M2 = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const mv = (M: number[][], v: number[]) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function aces(v: number[]) {
  v = v.map((x) => (x * LIGHT.exposure) / 0.6);
  v = mv(M1, v);
  v = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  return mv(M2, v).map((x) => Math.min(1, Math.max(0, x)));
}
const s2l = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function hexLin(hex: string) { const n = parseInt(hex.slice(1), 16); return [s2l(((n >> 16) & 255) / 255), s2l(((n >> 8) & 255) / 255), s2l((n & 255) / 255)]; }

const cache = new Map<string, number[]>();
export function comp(hex: string, k = KLIT): number[] {
  const key = hex + '|' + k.toFixed(4); const c = cache.get(key); if (c) return c;
  const alvo = hexLin(hex); let a = alvo.map((x) => x / k);
  for (let it = 0; it < 60; it++) {
    const f = aces(a.map((x) => x * k)), erro = f.map((x, i) => x - alvo[i]);
    if (Math.max(...erro.map(Math.abs)) < 1e-4) break;
    const J: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], h = 1e-3;
    for (let j = 0; j < 3; j++) { const b = a.slice(); b[j] += h; const fb = aces(b.map((x) => x * k)); for (let i = 0; i < 3; i++) J[i][j] = (fb[i] - f[i]) / h; }
    // resolve J·d = erro (Cramer)
    const det = (M: number[][]) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det(J); if (Math.abs(D) < 1e-12) break;
    const d = [0, 1, 2].map((j) => { const Mj = J.map((r) => r.slice()); for (let i = 0; i < 3; i++) Mj[i][j] = erro[i]; return det(Mj) / D; });
    a = a.map((x, i) => Math.max(0, x - 0.8 * d[i]));
  }
  cache.set(key, a); return a;
}
/** cor linear já compensada para materiais iluminados */
export const A = (hex: string, k = KLIT) => { const c = comp(hex, k); return new T.Color().setRGB(c[0], c[1], c[2], T.LinearSRGBColorSpace); };
/** cor literal (materiais sem tone mapping / basic) */
export const DISP = (hex: string) => { const l = hexLin(hex); return new T.Color().setRGB(l[0], l[1], l[2], T.LinearSRGBColorSpace); };

/** 0 = dia, 1 = noite. Pelo horário de Brasília (UTC−3); ?hora=19 força para teste. */
export const NOITE = { value: 0 };
export function fatorNoite(agoraMs = Date.now()) {
  const p = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const h = p.has('hora') ? Number(p.get('hora')) : ((agoraMs / 3600_000 - 3) % 24 + 24) % 24;
  const s = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return Math.max(s(17.5, 19.5, h), 1 - s(5.0, 6.8, h));
}
