/* Gera os dados geográficos do mundo a partir dos arquivos brutos (IBGE + municipios-brasileiros):
   - src/data/terreno.json : polígonos das 27 UFs em km (x leste, y norte), já simplificados
   - src/data/municipios.json : [ibge, nome, uf, x, y, pop, capital] dos 5.570 municípios
   Projeção: equiretangular centrada no Brasil (lon0, lat0), 1 unidade = 1 km. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raw = (f: string) => JSON.parse(readFileSync(resolve(here, 'raw', f), 'utf8').replace(/^﻿/, ''));

export const LON0 = -54.4, LAT0 = -14.2;
const KM_LAT = 110.574, KM_LON = 111.32 * Math.cos((LAT0 * Math.PI) / 180);
export const proj = (lat: number, lon: number): [number, number] => [
  Math.round((lon - LON0) * KM_LON * 10) / 10,
  Math.round((lat - LAT0) * KM_LAT * 10) / 10,
];

const UF_POR_COD: Record<string, string> = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE',
  27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};
const NOME_UF: Record<string, string> = {
  RO: 'Rondônia', AC: 'Acre', AM: 'Amazonas', RR: 'Roraima', PA: 'Pará', AP: 'Amapá', TO: 'Tocantins', MA: 'Maranhão', PI: 'Piauí', CE: 'Ceará',
  RN: 'Rio Grande do Norte', PB: 'Paraíba', PE: 'Pernambuco', AL: 'Alagoas', SE: 'Sergipe', BA: 'Bahia', MG: 'Minas Gerais', ES: 'Espírito Santo',
  RJ: 'Rio de Janeiro', SP: 'São Paulo', PR: 'Paraná', SC: 'Santa Catarina', RS: 'Rio Grande do Sul', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso',
  GO: 'Goiás', DF: 'Distrito Federal',
};
const CAPITAL_UF: Record<string, string> = {
  RO: 'Porto Velho', AC: 'Rio Branco', AM: 'Manaus', RR: 'Boa Vista', PA: 'Belém', AP: 'Macapá', TO: 'Palmas', MA: 'São Luís', PI: 'Teresina',
  CE: 'Fortaleza', RN: 'Natal', PB: 'João Pessoa', PE: 'Recife', AL: 'Maceió', SE: 'Aracaju', BA: 'Salvador', MG: 'Belo Horizonte', ES: 'Vitória',
  RJ: 'Rio de Janeiro', SP: 'São Paulo', PR: 'Curitiba', SC: 'Florianópolis', RS: 'Porto Alegre', MS: 'Campo Grande', MT: 'Cuiabá', GO: 'Goiânia', DF: 'Brasília',
};

/* ---- Douglas-Peucker em km ---- */
function simplificar(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const dist = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    if (!l2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!; let md = 0, mi = -1;
    for (let k = i + 1; k < j; k++) { const d = dist(pts[k], pts[i], pts[j]); if (d > md) { md = d; mi = k; } }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([i, mi], [mi, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ---- UFs ---- */
const existe = (f: string) => { try { readFileSync(resolve(here, 'raw', f)); return true; } catch { return false; } };
// malha de qualidade máxima (costa detalhada); cai para a intermediária se não tiver sido baixada
const geo = raw(existe('br_ufs_max.geojson') ? 'br_ufs_max.geojson' : 'br_ufs.geojson');
const TOL_UF = 0.35, TOL_COSTA = 0.2;
type Poly = { o: [number, number][]; h: [number, number][][] };
const ufs: { uf: string; nome: string; polys: Poly[]; cx: number; cy: number }[] = [];
for (const f of geo.features) {
  const cod = String(f.properties.codarea), uf = UF_POR_COD[cod];
  const rings: number[][][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const polys = rings.map((poly) => {
    const [outer, ...holes] = poly.map((ring: number[][]) => simplificar(ring.map(([lon, lat]) => proj(lat, lon)), TOL_UF));
    return { o: outer, h: holes.filter((h) => h.length >= 4) };
  }).filter((p) => p.o.length >= 4);
  const big = polys.reduce((a, b) => (b.o.length > a.o.length ? b : a));
  const cx = big.o.reduce((s, p) => s + p[0], 0) / big.o.length, cy = big.o.reduce((s, p) => s + p[1], 0) / big.o.length;
  ufs.push({ uf, nome: NOME_UF[uf], polys, cx: Math.round(cx), cy: Math.round(cy) });
}
ufs.sort((a, b) => a.uf.localeCompare(b.uf));

/* ---- municípios ---- */
const pop = new Map<number, number>();
for (const s of raw('pop.json')[0].resultados[0].series) pop.set(Number(s.localidade.id), Number(s.serie['2024']) || 0);
type Mun = [number, string, string, number, number, number, number];
const muns: Mun[] = (raw('municipios.json') as any[]).map((m) => {
  const uf = UF_POR_COD[String(m.codigo_uf)];
  const [x, y] = proj(m.latitude, m.longitude);
  return [m.codigo_ibge, m.nome, uf, x, y, pop.get(m.codigo_ibge) || 0, m.capital ? 1 : 0] as Mun;
}).sort((a, b) => a[0] - b[0]);

/* ---- costa + fronteira: contorno do país (IBGE), separado em trechos que tocam o mar ou não ---- */
const pais = raw(existe('br_pais_max.geojson') ? 'br_pais_max.geojson' : 'br_pais.geojson');
const costa: [number, number][][] = [];
for (const poly of pais.features[0].geometry.coordinates as number[][][][]) {
  const anel = simplificar(poly[0].map(([lon, lat]) => proj(lat, lon)), TOL_COSTA);
  if (anel.length >= 4) costa.push(anel);
}

/* ---- rios (Natural Earth 10m, domínio público), recortados no retângulo do Brasil ---- */
type Rio = { n: string; r: number; p: [number, number][] };
const rios: Rio[] = [];
try {
  const ne = raw('ne_rivers.geojson');
  // ponto-em-polígono contra as UFs (com buracos) para só manter rios dentro do Brasil
  const pip = (x: number, y: number, rg: [number, number][]) => { let c = false; for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) { const [xi, yi] = rg[i], [xj, yj] = rg[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const emTerra = (x: number, y: number) => { for (const u of ufs) for (const p of u.polys) if (pip(x, y, p.o) && !p.h.some((h) => pip(x, y, h))) return true; return false; };
  const dentro = (lon: number, lat: number) => { if (!(lon >= -74.5 && lon <= -34 && lat >= -34.5 && lat <= 5.8)) return false; const [x, y] = proj(lat, lon); return emTerra(x, y); };
  for (const f of ne.features) {
    const linhas: number[][][] = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const l of linhas) {
      // corta em trechos contínuos dentro do retângulo
      let seg: [number, number][] = [];
      const flush = () => { if (seg.length >= 2) { const s = simplificar(seg, 2.5); if (s.length >= 2) rios.push({ n: f.properties.name_en || f.properties.name || '', r: Number(f.properties.scalerank) || 9, p: s }); } seg = []; };
      for (const [lon, lat] of l) { if (dentro(lon, lat)) seg.push(proj(lat, lon)); else flush(); }
      flush();
    }
  }
} catch (e) { console.warn('sem ne_rivers.geojson (rode scripts/geo/baixar.sh para incluir rios)'); }

/* ---- caixa do mundo ---- */
let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
for (const u of ufs) for (const p of u.polys) for (const [x, y] of p.o) { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); }

const out = resolve(here, '../../src/data');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'terreno.json'), JSON.stringify({
  v: 1,
  proj: { lon0: LON0, lat0: LAT0, kmLat: KM_LAT, kmLon: +KM_LON.toFixed(4) },
  box: [Math.floor(minx), Math.floor(miny), Math.ceil(maxx), Math.ceil(maxy)],
  ufs,
  capitais: CAPITAL_UF,
  rios,
  costa,
}));
writeFileSync(resolve(out, 'municipios.json'), JSON.stringify(muns));
const nPts = ufs.reduce((s, u) => s + u.polys.reduce((t, p) => t + p.o.length + p.h.reduce((q, h) => q + h.length, 0), 0), 0);
console.log(`UFs: ${ufs.length} · pontos: ${nPts} · caixa km: [${Math.floor(minx)}, ${Math.floor(miny)}, ${Math.ceil(maxx)}, ${Math.ceil(maxy)}]`);
console.log(`rios: ${rios.length} trechos · ${rios.reduce((s, r) => s + r.p.length, 0)} pontos`);
console.log(`municípios: ${muns.length} · sem população: ${muns.filter((m) => !m[5]).length} · capitais: ${muns.filter((m) => m[6]).length}`);
