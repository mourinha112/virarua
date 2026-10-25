/* Geometrias baixo-poli (triângulos soltos, cor por vértice). Medidas em km, frente = +z, base no chão. */
import * as T from 'three';

type Parte = { pos: number[]; cor: string };

export function caixa(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, semFundo = true): number[] {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [3, 7, 6, 2], ...(semFundo ? [] : [[0, 1, 5, 4]])];
  const out: number[] = [];
  for (const [a, b, c, d] of f) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  return out;
}
/** telhado de 4 águas: base retangular (ex, ez = meias medidas) em y0, cumeeira ao longo de x em y1 */
export function telhado4(ex: number, ez: number, y0: number, y1: number, cume = 0.35): number[] {
  const a = [-ex, y0, -ez], b = [ex, y0, -ez], c = [ex, y0, ez], d = [-ex, y0, ez];
  const r0 = [-ex * cume, y1, 0], r1 = [ex * cume, y1, 0];
  return [...d, ...c, ...r1, ...d, ...r1, ...r0, ...b, ...a, ...r0, ...b, ...r0, ...r1, ...c, ...b, ...r1, ...a, ...d, ...r0];
}
/** telhado de duas águas: cumeeira ao longo de x, empenas triangulares nas pontas */
export function telhado2(ex: number, ez: number, y0: number, y1: number): number[] {
  const a = [-ex, y0, -ez], b = [ex, y0, -ez], c = [ex, y0, ez], d = [-ex, y0, ez], r0 = [-ex, y1, 0], r1 = [ex, y1, 0];
  return [...d, ...c, ...r1, ...d, ...r1, ...r0, ...b, ...a, ...r0, ...b, ...r0, ...r1, ...c, ...b, ...r1, ...a, ...d, ...r0];
}
/** retângulo vertical na face z = zf (janela/porta), levemente para fora */
export function placa(x0: number, y0: number, x1: number, y1: number, zf: number): number[] {
  return [x0, y0, zf, x1, y0, zf, x1, y1, zf, x0, y0, zf, x1, y1, zf, x0, y1, zf];
}
export function cilindro(r0: number, r1: number, h: number, seg: number, y0 = 0, x = 0, z = 0): number[] {
  const g = new T.CylinderGeometry(r1, r0, h, seg, 1, false).toNonIndexed(); g.translate(x, y0 + h / 2, z);
  return Array.from(g.attributes.position.array as Float32Array);
}
export function cone(r: number, h: number, seg: number, y0 = 0, x = 0, z = 0): number[] {
  const g = new T.ConeGeometry(r, h, seg, 1, false).toNonIndexed(); g.translate(x, y0 + h / 2, z);
  return Array.from(g.attributes.position.array as Float32Array);
}
export function disco(r: number, seg: number, y: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < seg; i++) { const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2; out.push(0, y, 0, Math.cos(a1) * r, y, Math.sin(a1) * r, Math.cos(a0) * r, y, Math.sin(a0) * r); }
  return out;
}
export function anel(r0: number, r1: number, seg: number, y: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (r: number, a: number) => [Math.cos(a) * r, y, Math.sin(a) * r];
    out.push(...p(r0, a0), ...p(r1, a1), ...p(r1, a0), ...p(r0, a0), ...p(r0, a1), ...p(r1, a1));
  }
  return out;
}

/** junta partes numa BufferGeometry com cor por vértice e normais planas */
const EMISSIVAS = new Set(['#2c3342', '#3f5670', '#5a86b0', '#7fa8cc', '#fff4c2', '#fff0b0']);
export function juntar(partes: Parte[]) {
  const pos: number[] = [], col: number[] = [], em: number[] = [];
  for (const p of partes) { const c = new T.Color(p.cor), e = EMISSIVAS.has(p.cor.toLowerCase()) ? 1 : 0; for (let i = 0; i < p.pos.length; i += 3) { pos.push(p.pos[i], p.pos[i + 1], p.pos[i + 2]); col.push(c.r, c.g, c.b); em.push(e); } }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.setAttribute('aEmis', new T.Float32BufferAttribute(em, 1));
  g.computeVertexNormals();
  return g;
}

const JAN = '#2c3342', PORTA = '#8a6a45', BRANCO = '#ffffff';

/* Cada tipo tem DUAS geometrias: paredes (multiplicadas pela cor da parede) e telhado (pela cor do telhado). */
export function geoCasa(tipo: number): { paredes: T.BufferGeometry; telhado: T.BufferGeometry } {
  switch (tipo) {
    case 0: { // térrea
      const P = [{ pos: caixa(-0.45, 0, -0.38, 0.45, 0.5, 0.38), cor: BRANCO }, { pos: placa(-0.3, 0.18, -0.12, 0.36, 0.381), cor: JAN }, { pos: placa(0.12, 0.18, 0.3, 0.36, 0.381), cor: JAN }, { pos: placa(-0.07, 0, 0.07, 0.34, 0.382), cor: PORTA }];
      return { paredes: juntar(P), telhado: juntar([{ pos: telhado4(0.55, 0.47, 0.5, 0.92), cor: BRANCO }]) };
    }
    case 1: { // sobrado
      const P = [{ pos: caixa(-0.42, 0, -0.36, 0.42, 0.98, 0.36), cor: BRANCO }, { pos: placa(-0.28, 0.6, -0.1, 0.8, 0.361), cor: JAN }, { pos: placa(0.1, 0.6, 0.28, 0.8, 0.361), cor: JAN }, { pos: placa(-0.28, 0.16, -0.1, 0.36, 0.361), cor: JAN }, { pos: placa(0.08, 0, 0.24, 0.36, 0.362), cor: PORTA }, { pos: caixa(-0.3, 0.5, 0.36, 0.3, 0.54, 0.5), cor: '#e8e2d2' }];
      return { paredes: juntar(P), telhado: juntar([{ pos: telhado4(0.52, 0.46, 0.98, 1.4), cor: BRANCO }]) };
    }
    case 2: { // casa alta / laje
      const P: Parte[] = [{ pos: caixa(-0.42, 0, -0.38, 0.42, 1.5, 0.38), cor: BRANCO }, { pos: caixa(-0.44, 0.74, -0.4, 0.44, 0.8, 0.4), cor: '#ebe5d6' }];
      for (const y of [0.2, 0.95]) for (const x of [-0.25, 0.08]) P.push({ pos: placa(x, y, x + 0.18, y + 0.28, 0.381), cor: JAN });
      P.push({ pos: placa(0.25, 0, 0.36, 0.36, 0.382), cor: PORTA });
      return { paredes: juntar(P), telhado: juntar([{ pos: caixa(-0.46, 1.5, -0.42, 0.46, 1.58, 0.42), cor: BRANCO }, { pos: caixa(-0.2, 1.58, -0.15, 0.1, 1.78, 0.15), cor: '#d9dde3' }]) };
    }
    case 3: { // prédio de 5 andares
      const P: Parte[] = [{ pos: caixa(-0.4, 0, -0.36, 0.4, 2.3, 0.36), cor: BRANCO }];
      for (let a = 0; a < 5; a++) for (const z of [0.361, -0.361]) P.push({ pos: z > 0 ? placa(-0.32, 0.25 + a * 0.42, 0.32, 0.47 + a * 0.42, z) : placa(0.32, 0.25 + a * 0.42, -0.32, 0.47 + a * 0.42, z), cor: '#3f5670' });
      return { paredes: juntar(P), telhado: juntar([{ pos: caixa(-0.43, 2.3, -0.39, 0.43, 2.38, 0.39), cor: BRANCO }, { pos: cilindro(0.12, 0.12, 0.2, 8, 2.38, 0.15, 0), cor: '#d9dde3' }]) };
    }
    case 4: { // torre de vidro
      const P: Parte[] = [{ pos: caixa(-0.36, 0, -0.33, 0.36, 3.6, 0.33), cor: BRANCO }];
      for (let a = 0; a < 9; a++) { const y = 0.3 + a * 0.36; P.push({ pos: placa(-0.3, y, 0.3, y + 0.22, 0.331), cor: '#5a86b0' }); P.push({ pos: placa(0.3, y, -0.3, y + 0.22, -0.331), cor: '#5a86b0' }); }
      return { paredes: juntar(P), telhado: juntar([{ pos: caixa(-0.39, 3.6, -0.36, 0.39, 3.7, 0.36), cor: BRANCO }, { pos: cilindro(0.02, 0.02, 0.6, 4, 3.7), cor: '#c9ced6' }]) };
    }
    default: { // palácio (governador/presidente)
      const P: Parte[] = [{ pos: caixa(-0.66, 0, -0.42, 0.66, 0.08, 0.5), cor: '#efe7d2' }, { pos: caixa(-0.62, 0.08, -0.36, 0.62, 0.7, 0.36), cor: BRANCO }, { pos: caixa(-0.3, 0.08, -0.38, 0.3, 1.0, 0.38), cor: BRANCO }];
      for (let c = 0; c < 6; c++) P.push({ pos: cilindro(0.035, 0.035, 0.6, 6, 0.08, -0.25 + c * 0.1, 0.45), cor: '#f4f1e8' });
      for (const x of [-0.5, -0.38, 0.38, 0.5]) P.push({ pos: placa(x - 0.04, 0.3, x + 0.04, 0.52, 0.361), cor: JAN });
      return { paredes: juntar(P), telhado: juntar([{ pos: caixa(-0.34, 0.68, 0.36, 0.34, 0.74, 0.52), cor: BRANCO }, { pos: cone(0.2, 0.32, 10, 1.0), cor: BRANCO }, { pos: cilindro(0.01, 0.01, 0.5, 4, 1.3), cor: '#e6e6e6' }]) };
    }
  }
}

/* Modelos extras (variantes). Faixa → lista de modelos; a variante sai do hash do lote. */
export function geoExtra(m: number): { paredes: T.BufferGeometry; telhado: T.BufferGeometry } {
  switch (m) {
    case 6: { // térrea duas águas com chaminé
      const P: Parte[] = [{ pos: caixa(-0.48, 0, -0.34, 0.48, 0.48, 0.34), cor: BRANCO }, { pos: placa(-0.36, 0.16, -0.16, 0.34, 0.341), cor: JAN }, { pos: placa(0.18, 0, 0.32, 0.34, 0.342), cor: PORTA }, { pos: placa(-0.06, 0.16, 0.1, 0.34, 0.341), cor: JAN }];
      return { paredes: juntar(P), telhado: juntar([{ pos: telhado2(0.56, 0.44, 0.48, 0.86), cor: BRANCO }, { pos: caixa(0.2, 0.6, -0.2, 0.32, 1.0, -0.08), cor: '#b9a99a' }]) };
    }
    case 7: { // térrea moderna com varanda
      const P: Parte[] = [{ pos: caixa(-0.46, 0, -0.36, 0.2, 0.5, 0.3), cor: BRANCO }, { pos: caixa(0.2, 0, -0.36, 0.48, 0.42, 0.1), cor: BRANCO }, { pos: placa(-0.38, 0.12, 0.0, 0.42, 0.301), cor: '#5a86b0' }, { pos: placa(0.08, 0, 0.18, 0.36, 0.302), cor: PORTA }];
      for (const x of [0.24, 0.44]) P.push({ pos: cilindro(0.02, 0.02, 0.42, 5, 0, x, 0.36), cor: '#f4f1e8' });
      return { paredes: juntar(P), telhado: juntar([{ pos: caixa(-0.5, 0.5, -0.4, 0.24, 0.56, 0.36), cor: BRANCO }, { pos: caixa(0.16, 0.42, -0.4, 0.52, 0.47, 0.44), cor: BRANCO }]) };
    }
    case 8: { // sobrado duas águas com sacada
      const P: Parte[] = [{ pos: caixa(-0.4, 0, -0.36, 0.4, 0.95, 0.36), cor: BRANCO }, { pos: caixa(-0.3, 0.48, 0.36, 0.3, 0.52, 0.56), cor: '#e8e2d2' }, { pos: caixa(-0.3, 0.52, 0.54, 0.3, 0.66, 0.56), cor: '#f4f1e8' }];
      for (const x of [-0.26, 0.06]) { P.push({ pos: placa(x, 0.6, x + 0.2, 0.82, 0.361), cor: JAN }); P.push({ pos: placa(x, 0.14, x + 0.2, 0.36, 0.361), cor: x < 0 ? JAN : PORTA }); }
      return { paredes: juntar(P), telhado: juntar([{ pos: telhado2(0.48, 0.44, 0.95, 1.38), cor: BRANCO }]) };
    }
    case 9: { // casa moderna em dois blocos
      const P: Parte[] = [{ pos: caixa(-0.46, 0, -0.34, 0.14, 0.62, 0.34), cor: BRANCO }, { pos: caixa(-0.1, 0.62, -0.3, 0.46, 1.2, 0.34), cor: '#e9e4d8' }, { pos: caixa(0.14, 0, -0.2, 0.46, 0.62, 0.2), cor: '#8a6a45' }];
      P.push({ pos: placa(-0.4, 0.15, 0.08, 0.5, 0.341), cor: '#5a86b0' }, { pos: placa(-0.04, 0.75, 0.4, 1.05, 0.341), cor: '#5a86b0' });
      return { paredes: juntar(P), telhado: juntar([{ pos: caixa(-0.14, 1.2, -0.34, 0.5, 1.25, 0.38), cor: BRANCO }, { pos: caixa(-0.5, 0.62, -0.38, -0.08, 0.66, 0.38), cor: BRANCO }]) };
    }
    default: { // 10: casa de vila comprida com alpendre
      const P: Parte[] = [{ pos: caixa(-0.5, 0, -0.28, 0.5, 0.46, 0.28), cor: BRANCO }];
      for (const x of [-0.4, -0.15, 0.1]) P.push({ pos: placa(x, 0.14, x + 0.16, 0.34, 0.281), cor: JAN });
      P.push({ pos: placa(0.32, 0, 0.44, 0.34, 0.282), cor: PORTA });
      for (const x of [-0.45, 0, 0.45]) P.push({ pos: cilindro(0.018, 0.018, 0.42, 5, 0, x, 0.44), cor: '#f4f1e8' });
      return { paredes: juntar(P), telhado: juntar([{ pos: telhado2(0.56, 0.48, 0.46, 0.78), cor: BRANCO }]) };
    }
  }
}
/** quintal: piso do lote + cerca baixa nas laterais e no fundo */
export function geoQuintal() {
  return juntar([
    { pos: caixa(-0.62, 0, -0.56, 0.62, 0.015, 0.56, false), cor: BRANCO },
    { pos: caixa(-0.62, 0.015, -0.56, 0.62, 0.1, -0.53), cor: '#e9e4d8' },
    { pos: caixa(-0.62, 0.015, -0.56, -0.59, 0.1, 0.4), cor: '#e9e4d8' },
    { pos: caixa(0.59, 0.015, -0.56, 0.62, 0.1, 0.4), cor: '#e9e4d8' },
  ]);
}

export function geoArvoreCidade(palma: boolean) {
  if (palma) {
    const P: Parte[] = [{ pos: cilindro(0.03, 0.045, 0.9, 5), cor: '#8b6b4a' }];
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const g = new T.BoxGeometry(0.42, 0.02, 0.1).toNonIndexed(); g.translate(0.21, 0, 0); g.rotateZ(-0.35); g.rotateY(a); g.translate(0, 0.9, 0); P.push({ pos: Array.from(g.attributes.position.array as Float32Array), cor: '#4f9c3f' }); }
    return juntar(P);
  }
  const copa = new T.IcosahedronGeometry(0.38, 0).toNonIndexed(); copa.translate(0, 0.62, 0);
  return juntar([{ pos: Array.from(copa.attributes.position.array as Float32Array), cor: '#ffffff' }, { pos: cilindro(0.04, 0.06, 0.32, 5), cor: '#b08a6a' }]);
}

export function geoPraca() {
  return juntar([
    { pos: disco(1, 32, 0.004), cor: '#97cf72' },
    { pos: anel(0.88, 1.0, 32, 0.006), cor: '#dfdedc' },
    { pos: disco(0.42, 24, 0.016), cor: '#e9e4d8' },
  ]);
}

export function geoIgreja() {
  return juntar([
    { pos: caixa(-0.38, 0, -0.55, 0.38, 0.75, 0.55), cor: '#f4f1e8' },
    { pos: telhado4(0.45, 0.62, 0.75, 1.1, 1).map((v, i) => (i % 3 === 0 ? v : v)), cor: '#c8572f' },
    { pos: caixa(-0.2, 0, 0.5, 0.2, 1.5, 0.85), cor: '#f4f1e8' },
    { pos: cone(0.2, 0.5, 4, 1.5, 0, 0.675), cor: '#c8572f' },
    { pos: caixa(-0.015, 2.0, 0.665, 0.015, 2.25, 0.685), cor: '#e8b84b' },
    { pos: caixa(-0.08, 2.12, 0.665, 0.08, 2.15, 0.685), cor: '#e8b84b' },
    { pos: placa(-0.08, 0, 0.08, 0.3, 0.851), cor: PORTA },
  ]);
}

/** prefeitura: prédio neoclássico branco com colunas, cúpula e mastro com bandeira */
export function geoPrefeitura() {
  const P: Parte[] = [
    { pos: caixa(-0.9, 0, -0.55, 0.9, 0.08, 0.75), cor: '#e9e4d8' },
    { pos: caixa(-0.8, 0.08, -0.45, 0.8, 0.72, 0.4), cor: '#fbf8f0' },
    { pos: caixa(-0.84, 0.72, -0.49, 0.84, 0.8, 0.44), cor: '#e3dccb' },
    { pos: caixa(-0.3, 0.8, -0.3, 0.3, 1.05, 0.3), cor: '#fbf8f0' },
    { pos: caixa(-0.36, 0.08, 0.4, 0.36, 0.14, 0.7), cor: '#e9e4d8' },
    { pos: telhado2(0.38, 0.16, 0.64, 0.86).map((v, i) => (i % 3 === 2 ? v + 0.56 : v)), cor: '#fbf8f0' },
  ];
  for (let c = 0; c < 6; c++) P.push({ pos: cilindro(0.035, 0.035, 0.5, 8, 0.14, -0.3 + c * 0.12, 0.62), cor: '#ffffff' });
  for (const x of [-0.62, -0.45, 0.45, 0.62]) for (const y of [0.25, 0.48]) P.push({ pos: placa(x - 0.05, y, x + 0.05, y + 0.14, 0.401), cor: '#3f5670' });
  P.push({ pos: cone(0.24, 0.3, 12, 1.05), cor: '#7fa8cc' }, { pos: cilindro(0.012, 0.012, 0.9, 4, 0.08, 0.7, 0.62), cor: '#e6e6e6' }, { pos: caixa(0.71, 0.78, 0.615, 0.98, 0.95, 0.625, false), cor: '#3a9d5d' });
  return juntar(P);
}
