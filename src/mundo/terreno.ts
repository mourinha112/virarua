/* Terreno: continente (laje extrudada por UF), divisas, rios e mar, a partir de src/data/terreno.json.
   Coordenadas: km, x = leste, y = norte (no Three: x = x, z = -y, y = altura). */
import * as T from 'three';
import terrenoJson from '../data/terreno.json';

export type Pt = [number, number];
export type Poly = { o: Pt[]; h: Pt[][] };
export type UF = { uf: string; nome: string; polys: Poly[]; cx: number; cy: number };
export type Rio = { n: string; r: number; p: Pt[] };
export type Terreno = { v: number; box: [number, number, number, number]; ufs: UF[]; capitais: Record<string, string>; rios: Rio[]; costa: Pt[][] };

export const TERRENO = terrenoJson as unknown as Terreno;
export const BOX = TERRENO.box;
/** caixa do continente sem ilhas oceânicas pequenas (Noronha, Trindade, atóis): é o que a câmera enquadra */
export const BOX_CONT: [number, number, number, number] = (() => {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const u of TERRENO.ufs) for (const p of u.polys) {
    let pa = 1e9, pb = 1e9, pc = -1e9, pd = -1e9; for (const [x, y] of p.o) { pa = Math.min(pa, x); pb = Math.min(pb, y); pc = Math.max(pc, x); pd = Math.max(pd, y); }
    if ((pc - pa) * (pd - pb) < 2000) continue;
    a = Math.min(a, pa); b = Math.min(b, pb); c = Math.max(c, pc); d = Math.max(d, pd);
  }
  return [a, b, c, d];
})();
export const UF_POR_SIGLA = new Map(TERRENO.ufs.map((u) => [u.uf, u]));

/* ---------- terra x mar: máscara por tiles (ponto-em-polígono com cache) ---------- */
function pip(x: number, y: number, rg: Pt[]) {
  let c = false;
  for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
    const [xi, yi] = rg[i], [xj, yj] = rg[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const bboxDe = (pts: Pt[]) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; } return [a, b, c, d] as [number, number, number, number]; };
void pip; void bboxDe;

/* Máscara rasterizada por varredura de linhas (scanline, par-ímpar por UF): blocos de 32 km com células de 250 m,
   calculados sob demanda. Consulta = leitura de tabela (a costa detalhada tem ~33 mil pontos; ponto-em-polígono
   direto seria lento demais para gerar cidades). Valor da célula = índice da UF + 1 (0 = mar). */
export const SIGLAS = TERRENO.ufs.map((u) => u.uf);
const CEL_M = 0.25, TILE_KM = 32, NC = TILE_KM / CEL_M;
type Aresta = { u: number; x0: number; y0: number; x1: number; y1: number };
const faixas = new Map<number, Aresta[]>(); // linha de blocos → arestas que a atravessam
TERRENO.ufs.forEach((uf, ui) => {
  for (const p of uf.polys) for (const anel of [p.o, ...p.h]) for (let i = 0; i < anel.length; i++) {
    const [x0, y0] = anel[i], [x1, y1] = anel[(i + 1) % anel.length]; if (y0 === y1) continue;
    const a: Aresta = { u: ui, x0, y0, x1, y1 };
    for (let j = Math.floor(Math.min(y0, y1) / TILE_KM); j <= Math.floor(Math.max(y0, y1) / TILE_KM); j++) (faixas.get(j) || faixas.set(j, []).get(j)!).push(a);
  }
});
/** preenche uma grade nx×ny (x0..x0+nx*cel, y0..y0+ny*cel) com UF+1 por scanline */
function rasterizar(gx0: number, gy0: number, nx: number, ny: number, cel: number, arestasDaLinha: (y: number) => Aresta[], celY = cel) {
  const out = new Uint8Array(nx * ny);
  const xs: number[][] = TERRENO.ufs.map(() => []);
  for (let r = 0; r < ny; r++) {
    const y = gy0 + (r + 0.5) * celY;
    for (const l of xs) l.length = 0;
    for (const a of arestasDaLinha(y)) if ((a.y0 <= y && y < a.y1) || (a.y1 <= y && y < a.y0)) xs[a.u].push(a.x0 + ((y - a.y0) * (a.x1 - a.x0)) / (a.y1 - a.y0));
    for (let u = 0; u < xs.length; u++) {
      const l = xs[u]; if (l.length < 2) continue; l.sort((p, q) => p - q);
      for (let k = 0; k + 1 < l.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((l[k] - gx0) / cel - 0.5)), c1 = Math.min(nx - 1, Math.floor((l[k + 1] - gx0) / cel - 0.5));
        for (let c = c0; c <= c1; c++) out[r * nx + c] = u + 1;
      }
    }
  }
  return out;
}
const blocos = new Map<string, Uint8Array>();
function bloco(ti: number, tj: number) {
  const k = ti + ',' + tj; let b = blocos.get(k);
  if (!b) {
    const arestas = faixas.get(tj) || [];
    b = arestas.length ? rasterizar(ti * TILE_KM, tj * TILE_KM, NC, NC, CEL_M, () => arestas) : new Uint8Array(NC * NC);
    if (blocos.size > 6000) blocos.clear();
    blocos.set(k, b);
  }
  return b;
}
/** UF em (x, y) km, ou '' se mar (precisão de 250 m). */
export function ufEm(x: number, y: number): string {
  const ti = Math.floor(x / TILE_KM), tj = Math.floor(y / TILE_KM);
  const b = bloco(ti, tj);
  const c = Math.floor((x - ti * TILE_KM) / CEL_M), r = Math.floor((y - tj * TILE_KM) / CEL_M);
  const v = b[r * NC + c]; return v ? SIGLAS[v - 1] : '';
}
export const ehTerra = (x: number, y: number) => ufEm(x, y) !== '';
/** grade inteira de UFs (para texturas do mapa): Uint8 com UF+1, linha r = y crescente */
export function gradeUF(nx: number, ny: number, box: [number, number, number, number]) {
  const [x0, y0, x1, y1] = box;
  return rasterizar(x0, y0, nx, ny, (x1 - x0) / nx, (y) => faixas.get(Math.floor(y / TILE_KM)) || [], (y1 - y0) / ny);
}

/* ---------- cores das UFs: 4 tons de terra, vizinhas com tons diferentes (coloração gulosa por sobreposição de caixa) ---------- */
/** cor de cada estado vista de longe (cor de TELA desejada; o shader compensa a iluminação) */
export const COR_UF: Record<string, string> = {
  AM: '#4f909c', AC: '#4f909c', RR: '#4f949c', AP: '#6f9a6a', PA: '#b08440', RO: '#9a8a48', MT: '#9b9d39', TO: '#9ca38d',
  MA: '#a49a4c', PI: '#b8a866', CE: '#c4ad66', RN: '#c9b26c', PB: '#c2ab64', PE: '#bfa860', AL: '#b9a85e', SE: '#c4ae68',
  BA: '#ceb668', MG: '#bd9f53', ES: '#5f9a7d', RJ: '#7aa060', SP: '#a08f4f', GO: '#91a98c', DF: '#9ca38d', MS: '#9b9f8b',
  PR: '#9a8947', SC: '#8f9a52', RS: '#abac52',
};
export const TONS_UF = ['#7b8a4a', '#9a7a4a', '#8a8f86', '#6a8a7a', '#b0976a', '#5f7a45'];
export const TOM_DA_UF = new Map<string, number>();
(() => {
  const bbs = TERRENO.ufs.map((u) => bboxDe(u.polys.flatMap((p) => p.o)));
  const toca = (i: number, j: number) => { const a = bbs[i], b = bbs[j]; return !(a[2] + 20 < b[0] || b[2] + 20 < a[0] || a[3] + 20 < b[1] || b[3] + 20 < a[1]); };
  TERRENO.ufs.forEach((u, i) => {
    const usados = new Set<number>();
    TERRENO.ufs.forEach((v, j) => { if (j < i && toca(i, j)) usados.add(TOM_DA_UF.get(v.uf)!); });
    let k = i % 6; for (let t = 0; t < 6; t++) { const c = (i + t) % 6; if (!usados.has(c)) { k = c; break; } }
    TOM_DA_UF.set(u.uf, k);
  });
})();

/* ---------- geometria do continente ---------- */
export const ESPESSURA_LAJE = 60; // km visuais de "borda" da laje (o mapa parece uma mesa)

function shapeDe(p: Poly) {
  // no plano da Shape usamos (x, y); rotateX(-90°) leva y → -z, ou seja, norte fica em -z
  const s = new T.Shape(p.o.map(([x, y]) => new T.Vector2(x, y)));
  for (const h of p.h) s.holes.push(new T.Path(h.map(([x, y]) => new T.Vector2(x, y))));
  return s;
}

/** Laje do continente: topo com cor por UF (vertex color) e laterais escuras. */
export function criarContinente(cores: { topo: (uf: string) => T.Color; lado: T.Color }, opts: { matTopo: T.Material; matLado: T.Material }) {
  const grupo = new T.Group();
  const topos: T.BufferGeometry[] = [];
  const lados: T.BufferGeometry[] = [];
  for (const u of TERRENO.ufs) {
    const cor = cores.topo(u.uf);
    for (const p of u.polys) {
      const sh = shapeDe(p);
      const g = new T.ShapeGeometry(sh, 1).rotateX(-Math.PI / 2); // xz plano, y = 0
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = cor.r; col[i * 3 + 1] = cor.g; col[i * 3 + 2] = cor.b; }
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      topos.push(g);
      // lateral: parede vertical ao longo do anel externo
      const o = p.o, pos: number[] = [], nor: number[] = [];
      for (let i = 0; i < o.length; i++) {
        const a = o[i], b = o[(i + 1) % o.length];
        const ax = a[0], az = -a[1], bx = b[0], bz = -b[1];
        const nx = bz - az, nz = -(bx - ax), l = Math.hypot(nx, nz) || 1;
        pos.push(ax, 0, az, bx, 0, bz, bx, -ESPESSURA_LAJE, bz, ax, 0, az, bx, -ESPESSURA_LAJE, bz, ax, -ESPESSURA_LAJE, az);
        for (let k = 0; k < 6; k++) nor.push(nx / l, 0, nz / l);
      }
      const gl = new T.BufferGeometry();
      gl.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      gl.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
      lados.push(gl);
    }
  }
  const topo = new T.Mesh(juntar(topos), opts.matTopo); topo.receiveShadow = true; topo.name = 'continente';
  const lado = new T.Mesh(juntar(lados), opts.matLado); lado.name = 'laje';
  grupo.add(topo, lado);
  return grupo;
}

function juntar(gs: T.BufferGeometry[]) {
  // junta geometrias não indexadas com os mesmos atributos
  const attrs = Object.keys(gs[0].attributes);
  const out = new T.BufferGeometry();
  for (const a of attrs) {
    const item = gs[0].attributes[a].itemSize;
    const arrs = gs.map((g) => { const ng = g.index ? g.toNonIndexed() : g; return ng.attributes[a].array as Float32Array; });
    const n = arrs.reduce((s, x) => s + x.length, 0), all = new Float32Array(n); let off = 0;
    for (const x of arrs) { all.set(x, off); off += x.length; }
    out.setAttribute(a, new T.BufferAttribute(all, item));
  }
  out.computeBoundingSphere();
  return out;
}

/* ---------- fitas (linhas com largura no chão): divisas, rios, costa ---------- */
/** Gera uma fita (triângulos) ao longo de uma polilinha, largura em km. Posição levemente acima do chão (y = lift). */
export function fitaGeo(linhas: { pts: Pt[]; hw: number }[], lift = 0.3) {
  const pos: number[] = [], uvs: number[] = [];
  for (const { pts, hw } of linhas) {
    if (pts.length < 2) continue;
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const nx = -dy, ny = dx;
      if (i > 0) dist += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      // dois vértices por ponto (esquerda/direita) — montamos quads entre pares consecutivos
      (pts as any)[i].__l = [p[0] + nx * hw, p[1] + ny * hw]; (pts as any)[i].__r = [p[0] - nx * hw, p[1] - ny * hw]; (pts as any)[i].__d = dist;
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const A = pts[i] as any, B = pts[i + 1] as any;
      const l0 = A.__l, r0 = A.__r, l1 = B.__l, r1 = B.__r;
      pos.push(l0[0], lift, -l0[1], r0[0], lift, -r0[1], r1[0], lift, -r1[1], l0[0], lift, -l0[1], r1[0], lift, -r1[1], l1[0], lift, -l1[1]);
      uvs.push(A.__d, 0, A.__d, 1, B.__d, 1, A.__d, 0, B.__d, 1, B.__d, 0);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.computeBoundingSphere();
  return g;
}

export function divisasGeo(hw: number) {
  const linhas: { pts: Pt[]; hw: number }[] = [];
  for (const u of TERRENO.ufs) for (const p of u.polys) linhas.push({ pts: [...p.o, p.o[0]], hw });
  return fitaGeo(linhas, 0.35);
}
/** trechos da costa; anel fechado vem com o 1º ponto repetido no fim → fechada: true e sem a repetição */
export const COSTA: { pts: Pt[]; fechada: boolean }[] = TERRENO.costa.map((a) => {
  const f = a.length > 2 && a[0][0] === a[a.length - 1][0] && a[0][1] === a[a.length - 1][1];
  return { pts: f ? a.slice(0, -1) : a, fechada: f };
});
export function costaGeo(hw: number) {
  return fitaGeo(COSTA.map((c) => ({ pts: c.fechada ? [...c.pts, c.pts[0]] : c.pts, hw })), 0.3);
}
export function riosGeo(extra = 0) {
  // rios maiores mais largos (scalerank menor = mais importante); extra = margem de areia
  return fitaGeo(TERRENO.rios.map((r) => ({ pts: r.p, hw: (r.r <= 3 ? 3.2 : r.r <= 6 ? 2.2 : 1.5) + extra })), extra ? 0.22 : 0.25);
}
