/* Gerador procedural de cidade. DETERMINÍSTICO: a mesma entrada (ibge, centro, nº de moradores) gera sempre o mesmo
   traçado e o morador de índice k sempre ocupa o mesmo lote — quem chega depois vai para lotes mais afastados e
   ninguém muda de lugar. Coordenadas em km (x leste, y norte).

   Malha: grade rotacionada de células de CEL km. Linhas i ≡ 0 (mod 4) e j ≡ 0 (mod 4) são ruas; i = 0 e j = 0 são
   as avenidas. Cada quadra 3×3 tem 8 lotes de frente para a rua e um miolo verde. A praça fica no cruzamento central. */
import { ehTerra } from './terreno';
import type { Linha } from './fitas';

export const CEL = 1.25;          // km por célula (lote)
export const R_PRACA = 2.6;       // em células: lotes mais perto que isso viram praça
/** vagas fixas de loja (coordenadas locais da grade): reservadas sempre, existam lojas ou não, para nenhuma casa mudar de lugar */
const VAGAS_LOC: [number, number][] = [0.62, 2.19, 3.76, 5.33, 1.4, 4.55].map((a) => [Math.cos(a) * (R_PRACA + 0.55), Math.sin(a) * (R_PRACA + 0.55)]);

export function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function h2(a: number, b: number, s: number) { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

export type Lote = { i: number; j: number; x: number; y: number; yaw: number; v: number };
/** vaga de loja: em volta da praça, em ângulos fixos (não ocupa lote de morador, então casas nunca mudam de lugar) */
export type VagaLoja = { x: number; y: number; yaw: number };
export type LayoutCidade = {
  ibge: number; cx: number; cy: number; ang: number;
  lotes: Lote[];                 // lotes ocupados por moradores, na ordem de chegada (lotes[k] = morador k)
  arvores: { x: number; y: number; s: number; palma: boolean }[];
  ruas: Linha[]; avenidas: Linha[];
  praca: { x: number; y: number; r: number };
  vagasLoja: VagaLoja[];
  verdes: { x: number; y: number; s: number }[];   // terrenos vazios / pracinhas entre as casas
  igreja: { x: number; y: number; yaw: number } | null;
  raio: number;                  // km, círculo que contém a cidade
};

const cache = new Map<string, LayoutCidade>();
/** a partir de quantas casas a quadra ganha gramado inteiro e árvore no miolo */
export const QUADRA_CHEIA = 3;

/** nCasas = quantos lotes ocupar. folga = lotes a mais calculados para árvores e expansão (não muda a ordem). */
export function construirCidade(ibge: number, cx: number, cy: number, nCasas: number, bloqueio?: (x: number, y: number) => boolean, sigBloq = ''): LayoutCidade {
  const chave = `${ibge}:${nCasas}:${sigBloq}`; const c0 = cache.get(chave); if (c0) return c0;
  const r = rng(ibge * 2654435761);
  // vila: até 24 casas não tem prefeitura nem rotatória; as casas ficam juntas em volta de uma pracinha
  const pequena = nCasas < 25; const RP = pequena ? 1.2 : R_PRACA;
  const ang = r() * Math.PI * 0.5 - Math.PI * 0.25;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // sede no mar (contorno simplificado/baía): desloca o centro para o ponto de terra mais próximo (espiral até 30 km)
  if (!ehTerra(cx, cy)) {
    achou: for (let rr = 1; rr <= 30; rr += 1) for (let a = 0; a < 16; a++) { const t = (a / 16) * Math.PI * 2, x = cx + Math.cos(t) * rr, y = cy + Math.sin(t) * rr; if (ehTerra(x, y) && ehTerra(x + Math.cos(t) * 1.5, y + Math.sin(t) * 1.5)) { cx = x + Math.cos(t) * 1.5; cy = y + Math.sin(t) * 1.5; break achou; } }
  }
  const W = (i: number, j: number): [number, number] => [cx + (i * ca - j * sa) * CEL, cy + (i * sa + j * ca) * CEL];
  // lote só em terra firme, com folga até a água (o centro e os 4 cantos do lote)
  const emTerra = (x: number, y: number) => { const m = CEL * 0.55; if (bloqueio && bloqueio(x, y)) return false; return ehTerra(x, y) && ehTerra(x + m, y + m) && ehTerra(x - m, y - m) && ehTerra(x + m, y - m) && ehTerra(x - m, y + m); };

  // candidatos em anéis crescentes até ter lotes suficientes
  const ruidoOrdem = (i: number, j: number) => 1 + 0.28 * (h2(i, j, ibge) - 0.5);
  const usados: Lote[] = [];
  let R = Math.max(4, Math.ceil(Math.sqrt(nCasas / 0.55) * 0.7) + 2);
  for (let tent = 0; tent < 6; tent++) {
    const cand: { i: number; j: number; k: number }[] = [];
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const mi = ((i % 4) + 4) % 4, mj = ((j % 4) + 4) % 4;
      if (mi === 0 || mj === 0) continue;            // rua
      if (mi === 2 && mj === 2) continue;            // miolo da quadra
      const d = Math.hypot(i, j); if (d < RP) continue;
      if (!pequena && VAGAS_LOC.some(([vi, vj]) => Math.hypot(i - vi, j - vj) < 1.75)) continue;
      cand.push({ i, j, k: d * ruidoOrdem(i, j) });
    }
    cand.sort((a, b) => a.k - b.k || a.j - b.j || a.i - b.i);
    usados.length = 0;
    for (const c of cand) {
      if (usados.length >= nCasas) break;
      // jitter determinístico dentro do lote: as casas não ficam todas alinhadas
      const jx = (h2(c.i, c.j, ibge + 11) - 0.5) * 0.08, jy = (h2(c.i, c.j, ibge + 13) - 0.5) * 0.08;
      const [x, y] = W(c.i + jx, c.j + jy); if (!emTerra(x, y)) continue;
      if (h2(c.i, c.j, ibge + 17) < 0.05) continue;      // ~5% dos lotes ficam vazios (terreno, quintal grande)
      const mi = ((c.i % 4) + 4) % 4, mj = ((c.j % 4) + 4) % 4;
      // de frente para a rua mais próxima. yaw θ (rotação Y do Three) aponta a frente para (sin θ, −cos θ) em km;
      // φ local: 0 = sul (rua em j−1), π = norte, −π/2 = oeste, π/2 = leste
      let yawL: number;
      if (mj === 1) yawL = 0; else if (mj === 3) yawL = Math.PI; else yawL = mi === 1 ? -Math.PI / 2 : Math.PI / 2;
      if ((mi === 1 || mi === 3) && (mj === 1 || mj === 3) && h2(c.i, c.j, 7) < 0.5) yawL = mi === 1 ? -Math.PI / 2 : Math.PI / 2;
      usados.push({ i: c.i, j: c.j, x, y, yaw: yawL + ang, v: Math.floor(h2(c.i, c.j, ibge + 23) * 1000) });
    }
    if (usados.length >= nCasas) break;
    R = Math.ceil(R * 1.4) + 2;
  }

  // ruas: para cada linha de rua, o trecho entre os lotes ocupados adjacentes
  const ocup = new Set(usados.map((l) => l.i + ',' + l.j));
  let maxR = 3; for (const l of usados) maxR = Math.max(maxR, Math.abs(l.i), Math.abs(l.j));
  const ruas: Linha[] = [], avenidas: Linha[] = [];
  const lim = Math.ceil(maxR / 4) * 4 + 4;
  for (let k = -lim; k <= lim; k += 4) {
    for (const eixo of [0, 1]) {
      let lo = Infinity, hi = -Infinity;
      for (let t = -lim; t <= lim; t++) {
        const a = eixo === 0 ? `${t},${k - 1}` : `${k - 1},${t}`, b = eixo === 0 ? `${t},${k + 1}` : `${k + 1},${t}`;
        if (ocup.has(a) || ocup.has(b)) { lo = Math.min(lo, t); hi = Math.max(hi, t); }
      }
      if (k === 0 && !pequena) { lo = Math.min(lo, -4); hi = Math.max(hi, 4); }
      if (!(hi >= lo)) continue;
      // amostra a linha a cada meia célula e só mantém os trechos em terra (rua não passa por cima da água)
      let trecho: [number, number][] = [];
      const fecha = () => { if (trecho.length >= 2) (k === 0 ? avenidas : ruas).push({ pts: trecho, hw: k === 0 ? 0.42 : 0.24 }); trecho = []; };
      // rua só onde o eixo E as duas bordas (±0,6 km) estão em terra; as pontas recuam um passo antes da água
      const terraRua = (tt: number) => { const p = eixo === 0 ? W(tt, k) : W(k, tt); const q1 = eixo === 0 ? W(tt, k + 0.5) : W(k + 0.5, tt), q2 = eixo === 0 ? W(tt, k - 0.5) : W(k - 0.5, tt); return ehTerra(p[0], p[1]) && ehTerra(q1[0], q1[1]) && ehTerra(q2[0], q2[1]); };
      for (let t = lo - 1; t <= hi + 1 + 1e-6; t += 0.25) {
        const p = eixo === 0 ? W(t, k) : W(k, t); const dentroPraca = !pequena && k === 0 && Math.abs(t) < RP - 0.3;
        if (terraRua(t) && terraRua(t - 0.3) && terraRua(t + 0.3) && !dentroPraca && !(bloqueio && bloqueio(p[0], p[1]))) trecho.push(p); else fecha();
      }
      fecha();
    }
  }

  // rotatória em volta da praça (a prefeitura fica no meio)
  if (!pequena) { // rotatória: só os trechos em terra (no litoral ela não entra na água)
    const pts: [number, number][] = []; for (let a = 0; a <= 48; a++) { const t = (a / 48) * Math.PI * 2; pts.push(W(Math.cos(t) * (RP - 0.3), Math.sin(t) * (RP - 0.3))); }
    const ok = pts.map((p) => ehTerra(p[0], p[1]));
    if (ok.every(Boolean)) avenidas.push({ pts: pts.slice(0, 48), hw: 0.42, fechada: true });
    else { let tr: [number, number][] = []; pts.forEach((p, i) => { if (ok[i]) tr.push(p); else { if (tr.length >= 2) avenidas.push({ pts: tr, hw: 0.42 }); tr = []; } }); if (tr.length >= 2) avenidas.push({ pts: tr, hw: 0.42 }); }
  }

  // árvores: miolos das quadras ocupadas + calçada da praça + algumas nas bordas
  const arvores: LayoutCidade['arvores'] = [];
  const tropical = cy > -2200 && cy < 1300 && cx > 900; // litoral NE/N: palmeiras
  const vistos = new Set<string>();
  // casas por quadra: árvore no miolo só em quadra com vizinhança (casa sozinha não ganha árvore solta no gramado)
  const porQuadra = new Map<string, number>(); for (const l of usados) { const kq = Math.floor(l.i / 4) + ',' + Math.floor(l.j / 4); porQuadra.set(kq, (porQuadra.get(kq) || 0) + 1); }
  for (const l of usados) {
    if ((porQuadra.get(Math.floor(l.i / 4) + ',' + Math.floor(l.j / 4)) || 0) < QUADRA_CHEIA) continue;
    const bi = Math.floor(l.i / 4) * 4 + 2, bj = Math.floor(l.j / 4) * 4 + 2, kk = bi + ',' + bj; if (vistos.has(kk)) continue; vistos.add(kk);
    const [x, y] = W(bi, bj); if (!emTerra(x, y)) continue;
    const q = h2(bi, bj, ibge);
    if (q < 0.45) arvores.push({ x, y, s: 0.8 + 0.3 * q, palma: tropical && q < 0.15 });
    if (q > 0.85) { const [x2, y2] = W(bi + 0.45, bj - 0.4); arvores.push({ x: x2, y: y2, s: 0.6 + 0.3 * q, palma: false }); }
  }
  // árvores da calçada da praça: só cidade com prefeitura (na vila o centro é um cruzamento de ruas)
  if (!pequena) for (let a = 0; a < 10; a++) {
    const t = (a / 10) * Math.PI * 2 + 0.3;
    const [x, y] = W(Math.cos(t) * (RP - 1.15), Math.sin(t) * (RP - 1.15));
    if (Math.abs(Math.cos(t)) > 0.2 && Math.abs(Math.sin(t)) > 0.2) arvores.push({ x, y, s: 0.55, palma: tropical });
  }

  // prefeitura no centro da praça, de frente para o sul da grade
  const igreja = pequena ? null : { x: cx, y: cy, yaw: ang };
  // vagas de loja: 6 posições na borda da praça, entre as avenidas, de frente para o centro
  const vagasLoja: VagaLoja[] = [];
  for (const [li, lj] of VAGAS_LOC) {
    const [x, y] = W(li, lj); if (!ehTerra(x, y) || (bloqueio && bloqueio(x, y))) continue;
    const a = Math.atan2(lj, li), phi = Math.atan2(-Math.cos(a), Math.sin(a)); // frente para o centro da praça
    vagasLoja.push({ x, y, yaw: phi + ang });
  }
  // terrenos vazios viram pracinhas/hortas
  const verdes: LayoutCidade['verdes'] = [];
  for (let j = -maxR; j <= maxR; j++) for (let i = -maxR; i <= maxR; i++) {
    const mi = ((i % 4) + 4) % 4, mj = ((j % 4) + 4) % 4; if (mi === 0 || mj === 0 || (mi === 2 && mj === 2)) continue;
    if (Math.hypot(i, j) < RP || VAGAS_LOC.some(([vi, vj]) => Math.hypot(i - vi, j - vj) < 1.75) || ocup.has(i + ',' + j) || h2(i, j, ibge + 17) >= 0.05) continue;
    // só se tiver vizinho ocupado (dentro da mancha urbana)
    if (!(ocup.has((i + 1) + ',' + j) || ocup.has((i - 1) + ',' + j) || ocup.has(i + ',' + (j + 1)) || ocup.has(i + ',' + (j - 1)))) continue;
    const [x, y] = W(i, j); if (ehTerra(x, y)) verdes.push({ x, y, s: 0.9 });
  }
  let raio = 2; for (const l of usados) raio = Math.max(raio, Math.hypot(l.x - cx, l.y - cy));
  const out: LayoutCidade = { ibge, cx, cy, ang, lotes: usados, arvores, ruas, avenidas, praca: { x: cx, y: cy, r: (RP - 0.75) * CEL }, vagasLoja, verdes, igreja, raio: raio + CEL };
  if (cache.size > 400) cache.clear();
  cache.set(chave, out);
  return out;
}

/** Tipo de construção pelo nível (pontos): 0 térrea, 1 sobrado, 2 casa alta, 3 prédio, 4 torre.
    5 (palácio) é exclusivo do presidente. Os outros cargos não mudam o tamanho (com poucos jogadores todo mundo
    viraria prefeito/senador e nasceria prédio); eles aparecem no telhado dourado e no cartão. */
export function tipoCasa(nivel: number, cargo: string | null) {
  if (cargo === 'P') return 5;
  if (nivel >= 20) return 4;
  if (nivel >= 12) return 3;
  if (nivel >= 7) return 2;
  if (nivel >= 3) return 1;
  return 0;
}
