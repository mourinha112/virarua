/* Biomas aproximados por polígonos em lat/lon → textura RGBA (R densidade de mata, G secura, B índice do bioma/8, A terra).
   Não é cartografia oficial: só dá o "clima" visual do chão (mata fechada no norte, caatinga seca, cerrado, mata atlântica, pampa, pantanal). */
import * as T from 'three';
import { TERRENO, gradeUF, SIGLAS } from './terreno';

type LL = [number, number]; // [lon, lat]
const LON0 = -54.4, LAT0 = -14.2, KM_LAT = 110.574, KM_LON = 111.32 * Math.cos((LAT0 * Math.PI) / 180);
const proj = ([lon, lat]: LL): [number, number] => [(lon - LON0) * KM_LON, (lat - LAT0) * KM_LAT];

export const BIOMAS = [
  null,
  { id: 1, nome: 'Amazônia', dens: 0.97, seca: 0.0, cor: '#4f8f7a' },
  { id: 2, nome: 'Caatinga', dens: 0.3, seca: 0.95, cor: '#bba57a' },
  { id: 3, nome: 'Cerrado', dens: 0.45, seca: 0.62, cor: '#a8935f' },
  { id: 4, nome: 'Mata Atlântica', dens: 0.8, seca: 0.08, cor: '#5f9050' },
  { id: 5, nome: 'Pampa', dens: 0.25, seca: 0.35, cor: '#93ac68' },
  { id: 6, nome: 'Pantanal', dens: 0.35, seca: 0.25, cor: '#98a27c' },
] as const;

const POLY: { id: number; pts: LL[] }[] = [
  { id: 6, pts: [[-58.5, -16], [-55.5, -16.5], [-55.5, -20], [-57, -22], [-58.5, -21]] },
  { id: 5, pts: [[-57.7, -29.5], [-50.5, -29.8], [-49.5, -32], [-53, -33.8], [-57.7, -31]] },
  { id: 1, pts: [[-74, 5.3], [-50, 5.3], [-50, -2], [-44, -2.5], [-44, -6], [-50, -9], [-56, -12], [-60, -15], [-66, -11], [-74, -10]] },
  { id: 2, pts: [[-44, -2.5], [-41, -3], [-37.5, -4.5], [-35.5, -5.5], [-36, -7], [-37.5, -9], [-39.5, -12], [-41, -15], [-43, -15], [-44, -12], [-45, -9], [-44, -6]] },
  { id: 4, pts: [[-35.5, -5.5], [-34.5, -8], [-37, -13], [-38.5, -16], [-39, -19], [-40, -21], [-42, -23.5], [-45, -24], [-48, -26], [-49, -29], [-50.5, -29.8], [-53, -29], [-54, -27], [-54, -25], [-53, -23], [-50, -21], [-46, -20], [-43, -18], [-41, -15], [-39.5, -12], [-37.5, -9], [-36, -7]] },
].map((p) => ({ id: p.id, pts: p.pts as LL[] }));
const POLY_KM = POLY.map((p) => ({ id: p.id, pts: p.pts.map(proj) }));

function pip(x: number, y: number, rg: [number, number][]) {
  let c = false;
  for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) { const [xi, yi] = rg[i], [xj, yj] = rg[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
  return c;
}
export function biomaEm(x: number, y: number) {
  for (const p of POLY_KM) if (pip(x, y, p.pts)) return p.id;
  return 3; // cerrado por padrão
}

function hash2(x: number, y: number) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export type MapaMata = { tex: T.DataTexture; texBio: T.DataTexture; nx: number; ny: number; box: [number, number, number, number]; bytes: Uint8Array; dens: (x: number, y: number) => number; seca: (x: number, y: number) => number };

/** Mapa de mata/secura/UF: nx×ny texels sobre a caixa do mapa. corBio(hex) devolve a cor linear já compensada. */
export function criarMapaMata(nx = 256, ny = 256, corBio: (hex: string) => T.Color = (h) => new T.Color(h)): MapaMata {
  const [x0, y0, x1, y1] = TERRENO.box, w = x1 - x0, h = y1 - y0;
  const bytes = new Uint8Array(nx * ny * 4);
  const bio = new Uint8Array(nx * ny * 4);
  const cores = BIOMAS.map((b) => (b ? corBio(b.cor) : null));
  const ufIdx = new Map(TERRENO.ufs.map((u, i) => [u.uf, i]));
  const grade = gradeUF(nx, ny, [x0, y0, x1, y1]);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + ((i + 0.5) / nx) * w, y = y0 + ((j + 0.5) / ny) * h; // j cresce com y (norte) — textura com flipY = false
    const o = (j * nx + i) * 4;
    const gv = grade[j * nx + i]; const uf = gv ? SIGLAS[gv - 1] : '';
    if (!uf) { bytes[o + 3] = 0; continue; }
    // bioma com borda "rasgada" por ruído (amostra num ponto deslocado)
    const jx = (vnoise(x / 90, y / 90) - 0.5) * 120, jy = (vnoise(x / 90 + 7.3, y / 90 + 1.1) - 0.5) * 120;
    const bid = biomaEm(x + jx, y + jy);
    const b = BIOMAS[bid]!;
    const n = vnoise(x / 180, y / 180) * 0.6 + vnoise(x / 45, y / 45) * 0.4;
    const c = cores[bid]!, v = 0.88 + 0.24 * n;
    bio[(j * nx + i) * 4] = Math.min(255, c.r * v * 255); bio[(j * nx + i) * 4 + 1] = Math.min(255, c.g * v * 255); bio[(j * nx + i) * 4 + 2] = Math.min(255, c.b * v * 255); bio[(j * nx + i) * 4 + 3] = 255;
    let dens = b.dens * (0.75 + 0.5 * n), seca = b.seca * (0.8 + 0.4 * (1 - n));
    dens = Math.max(0, Math.min(1, dens)); seca = Math.max(0, Math.min(1, seca));
    bytes[o] = Math.round(dens * 255); bytes[o + 1] = Math.round(seca * 255); bytes[o + 2] = (ufIdx.get(uf) ?? 0) * 8; bytes[o + 3] = 255;
  }
  const tex = new T.DataTexture(bytes, nx, ny, T.RGBAFormat);
  tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearFilter; tex.needsUpdate = true;
  const texBio = new T.DataTexture(bio, nx, ny, T.RGBAFormat);
  texBio.magFilter = T.LinearFilter; texBio.minFilter = T.LinearFilter; texBio.needsUpdate = true;
  const at = (x: number, y: number, c: number) => { const i = Math.max(0, Math.min(nx - 1, Math.floor(((x - x0) / w) * nx))), j = Math.max(0, Math.min(ny - 1, Math.floor(((y - y0) / h) * ny))); return bytes[(j * nx + i) * 4 + c] / 255; };
  return { tex, texBio, nx, ny, box: [x0, y0, w, h], bytes, dens: (x, y) => at(x, y, 0), seca: (x, y) => at(x, y, 1) };
}

