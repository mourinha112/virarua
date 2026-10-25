/* Lojas patrocinadas em 3D: prédio comercial com vitrine, toldo listrado na cor da marca, letreiro com o nome
   (textura de canvas) e um "mascote" gigante no telhado conforme o tipo (pet shop, café, lanchonete, açaí...).
   Arte própria do projeto. Medidas em km, frente = +z. */
import * as T from 'three';
import type { Loja } from '../dados/formato';
import { caixa, cilindro, cone, juntar, placa } from './geometrias';

export type Parte = { pos: number[]; cor: string };
const esfera = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, det = 1) => { const g = new T.IcosahedronGeometry(r, det).toNonIndexed(); g.scale(sx, sy, sz); g.translate(x, y, z); return Array.from(g.attributes.position.array as Float32Array); };
export const girar = (pos: number[], ry: number, rx = 0, rz = 0) => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); return Array.from(g.attributes.position.array as Float32Array); };
const mover = (pos: number[], x: number, y: number, z: number) => pos.map((v, i) => v + (i % 3 === 0 ? x : i % 3 === 1 ? y : z));

/* ---------- mascotes (no telhado, base em y = 0) ---------- */
function cachorro(): Parte[] {
  const M = '#9a6a3c', E = '#6b4526', C = '#f2e3c8';
  return [
    { pos: esfera(0.24, 0, 0.3, 0, 1, 1.15, 0.9), cor: M },              // corpo sentado
    { pos: esfera(0.2, 0, 0.66, 0.08, 1, 1, 1), cor: M },                // cabeça
    { pos: esfera(0.1, 0, 0.6, 0.24, 1, 0.8, 1.1), cor: C },             // focinho
    { pos: esfera(0.04, 0, 0.64, 0.34), cor: '#1e2430' },                // nariz
    { pos: esfera(0.08, -0.19, 0.6, 0.04, 0.6, 1.6, 0.8), cor: E },      // orelhas
    { pos: esfera(0.08, 0.19, 0.6, 0.04, 0.6, 1.6, 0.8), cor: E },
    { pos: esfera(0.03, -0.08, 0.72, 0.2), cor: '#1e2430' }, { pos: esfera(0.03, 0.08, 0.72, 0.2), cor: '#1e2430' },
    { pos: cilindro(0.17, 0.17, 0.05, 12, 0.48, 0, 0.04), cor: '#2a9db0' }, // coleira
    { pos: esfera(0.08, -0.12, 0.08, 0.2, 0.8, 0.7, 1.2), cor: M }, { pos: esfera(0.08, 0.12, 0.08, 0.2, 0.8, 0.7, 1.2), cor: M },
    { pos: mover(girar(cilindro(0.025, 0.04, 0.26, 5), 0, -0.9), 0.18, 0.18, -0.2), cor: M }, // rabo
  ];
}
function gato(): Parte[] {
  const G = '#5d6470', B = '#f4f1e8';
  return [
    { pos: esfera(0.13, 0, 0.18, 0, 1, 1.3, 0.85), cor: G }, { pos: esfera(0.08, 0, 0.18, 0.09, 1, 1.4, 0.4), cor: B },
    { pos: esfera(0.11, 0, 0.42, 0.02), cor: G },
    { pos: cone(0.045, 0.1, 4, 0.48, -0.07, 0.02), cor: G }, { pos: cone(0.045, 0.1, 4, 0.48, 0.07, 0.02), cor: G },
    { pos: esfera(0.022, -0.04, 0.45, 0.11), cor: '#3dbb6a' }, { pos: esfera(0.022, 0.04, 0.45, 0.11), cor: '#3dbb6a' },
    { pos: mover(girar(cilindro(0.02, 0.02, 0.3, 5), 0, -0.4), 0.12, 0.12, -0.12), cor: G },
  ];
}
function osso(): Parte[] {
  const O = '#efe2bd';
  return [{ pos: girar(cilindro(0.05, 0.05, 0.5, 8, -0.25), 0, 0, Math.PI / 2), cor: O }, ...[-0.27, 0.27].flatMap((x) => [{ pos: esfera(0.07, x, 0.05, -0.05), cor: O }, { pos: esfera(0.07, x, 0.05, 0.05), cor: O }])].map((p) => ({ ...p, pos: mover(p.pos, 0, 0.06, 0) }));
}
function xicara(): Parte[] {
  return [
    { pos: cilindro(0.2, 0.26, 0.36, 16, 0), cor: '#ffffff' }, { pos: cilindro(0.23, 0.23, 0.02, 16, 0.34), cor: '#5a3a24' },
    { pos: Array.from(new T.TorusGeometry(0.1, 0.03, 6, 12).toNonIndexed().translate(0.28, 0.2, 0).attributes.position.array as Float32Array), cor: '#ffffff' },
    { pos: cilindro(0.34, 0.36, 0.03, 16, 0), cor: '#e9e4d8' },
    { pos: esfera(0.06, 0.02, 0.5, 0), cor: '#f4f6f8' }, { pos: esfera(0.05, -0.04, 0.62, 0.02), cor: '#f4f6f8' }, { pos: esfera(0.04, 0.03, 0.72, 0), cor: '#f4f6f8' },
  ];
}
function hamburguer(): Parte[] {
  return [
    { pos: esfera(0.3, 0, 0.36, 0, 1, 0.5, 1), cor: '#e3a14a' }, { pos: cilindro(0.31, 0.31, 0.06, 14, 0.24), cor: '#f2c230' },
    { pos: cilindro(0.3, 0.3, 0.1, 14, 0.13), cor: '#6b3b1f' }, { pos: cilindro(0.32, 0.32, 0.03, 14, 0.1), cor: '#5aa247' },
    { pos: cilindro(0.29, 0.29, 0.1, 14, 0), cor: '#e3a14a' },
  ];
}
function acai(): Parte[] {
  return [
    { pos: cilindro(0.18, 0.3, 0.26, 14, 0), cor: '#ffffff' }, { pos: esfera(0.27, 0, 0.27, 0, 1, 0.45, 1), cor: '#5b2a6e' },
    ...[[-0.1, 0.06], [0.08, -0.08], [0.02, 0.12]].map(([x, z]) => ({ pos: esfera(0.05, x, 0.4, z), cor: '#d9453a' })),
    { pos: esfera(0.06, 0.12, 0.38, 0.05, 1.4, 0.5, 1), cor: '#f2d160' },
  ];
}
function sacola(cor: string): Parte[] {
  return [{ pos: caixa(-0.22, 0, -0.12, 0.22, 0.5, 0.12), cor }, { pos: mover(Array.from(new T.TorusGeometry(0.12, 0.02, 6, 12, Math.PI).toNonIndexed().attributes.position.array as Float32Array), 0, 0.5, 0), cor: '#1e2430' }];
}

const PAREDE: Record<string, string> = { pet: '#e7f4f6', cafe: '#f4ead8', lanchonete: '#f6e3c3', acai: '#efe4f7', loja: '#f4e6e6', restaurante: '#f6e3c3', eventos: '#e3e8f4' };

export function letreiro(nome: string, cor: string) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = cor; g.fillRect(0, 0, 512, 14); g.fillRect(0, 114, 512, 14);
  g.strokeStyle = '#1e2430'; g.lineWidth = 8; g.strokeRect(4, 4, 504, 120);
  let fs = 74; g.font = `900 ${fs}px Nunito, system-ui, sans-serif`; while (g.measureText(nome).width > 470 && fs > 30) { fs -= 4; g.font = `900 ${fs}px Nunito, system-ui, sans-serif`; }
  g.fillStyle = cor; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(nome, 256, 68);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function criarLoja3D(l: Loja, A: (hex: string) => T.Color): T.Group {
  const g = new T.Group(); g.name = 'loja:' + l.id;
  const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const parede = PAREDE[l.tipo] || '#f4f1e8';
  const corpo: Parte[] = [
    { pos: caixa(-0.85, 0, -0.75, 0.85, 0.04, 0.95, false), cor: '#dfdedc' },           // calçada
    { pos: caixa(-0.7, 0.04, -0.6, 0.7, 1.05, 0.55), cor: parede },                      // prédio
    { pos: caixa(-0.74, 1.05, -0.64, 0.74, 1.13, 0.59), cor: '#5d6570' },               // laje (telhado escuro)
    { pos: placa(-0.62, 0.1, 0.22, 0.62, 0.551), cor: '#7fa8cc' },                      // vitrine
    { pos: placa(0.3, 0.06, 0.6, 0.62, 0.552), cor: '#3f5670' },                         // porta de vidro
    { pos: caixa(-0.7, 0.04, 0.55, -0.66, 0.66, 0.6), cor: l.cor }, { pos: caixa(0.66, 0.04, 0.55, 0.7, 0.66, 0.6), cor: l.cor },
  ];
  g.add(new T.Mesh(juntar(corpo), mat));
  // toldo listrado: faixas alternando cor da marca e branco, inclinado para fora
  const toldo: Parte[] = [];
  const n = 9; for (let i = 0; i < n; i++) { const x0 = -0.72 + (i * 1.44) / n, x1 = x0 + 1.44 / n; toldo.push({ pos: girar(caixa(x0, -0.015, 0, x1, 0.015, 0.34), 0, 0.42), cor: i % 2 ? '#ffffff' : l.cor }); }
  const mt = new T.Mesh(juntar(toldo), mat); mt.position.set(0, 0.74, 0.56); g.add(mt);
  // letreiro
  const sl = new T.Mesh(new T.PlaneGeometry(1.36, 0.34), new T.MeshBasicMaterial({ map: letreiro(l.nome, l.cor), toneMapped: false }));
  sl.position.set(0, 0.88, 0.562); g.add(sl);
  // logo de verdade da loja: placa no telhado (no lugar do mascote genérico)
  if (l.logo) {
    const tx = new T.TextureLoader().load(l.logo); tx.colorSpace = T.SRGBColorSpace; tx.anisotropy = 4;
    const pl = new T.Mesh(new T.PlaneGeometry(1.3, 1.3), new T.MeshBasicMaterial({ map: tx, transparent: true, alphaTest: 0.4, toneMapped: false, side: T.DoubleSide }));
    pl.position.set(0, 1.86, -0.12); g.add(pl);
    const hastes: Parte[] = [-0.42, 0.42].map((x) => ({ pos: caixa(x - 0.03, 1.13, -0.18, x + 0.03, 1.5, -0.12), cor: '#3a404c' }));
    g.add(new T.Mesh(juntar(hastes), mat));
  }
  // mascote
  let masc: Parte[] = [];
  if (l.logo) masc = [];
  else if (l.tipo === 'pet') { masc = [...cachorro().map((p) => ({ ...p, pos: mover(p.pos, -0.28, 0, 0) })), ...gato().map((p) => ({ ...p, pos: mover(p.pos, 0.36, 0, -0.15) })), ...osso().map((p) => ({ ...p, pos: mover(p.pos, 0.05, 0, 0.32) })), { pos: cilindro(0.09, 0.07, 0.05, 10, 0, -0.45, 0.35), cor: '#2a9db0' }, { pos: esfera(0.07, -0.45, 0.05, 0.35, 1, 0.3, 1), cor: '#6b3b1f' }]; }
  else if (l.tipo === 'cafe') masc = xicara();
  else if (l.tipo === 'lanchonete' || l.tipo === 'restaurante') masc = hamburguer();
  else if (l.tipo === 'acai') masc = acai();
  else masc = sacola(l.cor);
  if (masc.length) {
    const mm = new T.Mesh(juntar(masc), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }));
    mm.position.set(0, 1.13, -0.05); mm.scale.setScalar(1.25); mm.userData.anima = 'flutua'; g.add(mm);
  }
  // pino azul com estrela (sprite sempre virado para a câmera)
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 96; const k = cv.getContext('2d')!;
  k.fillStyle = '#1e2430'; k.fillRect(30, 50, 4, 44);
  k.beginPath(); k.arc(32, 30, 27, 0, Math.PI * 2); k.fillStyle = '#ffffff'; k.fill(); k.beginPath(); k.arc(32, 30, 23, 0, Math.PI * 2); k.fillStyle = '#2f80ed'; k.fill();
  k.fillStyle = '#ffffff'; k.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 6 : 14, a = -Math.PI / 2 + (i * Math.PI) / 5; k[i ? 'lineTo' : 'moveTo'](32 + Math.cos(a) * r, 30 + Math.sin(a) * r); } k.closePath(); k.fill();
  const tp = new T.CanvasTexture(cv); tp.colorSpace = T.SRGBColorSpace;
  const pino = new T.Sprite(new T.SpriteMaterial({ map: tp, depthTest: false, toneMapped: false })); pino.scale.set(0.42, 0.63, 1); pino.position.set(0.55, 2.2, 0.2); pino.renderOrder = 40; g.add(pino);
  g.traverse((o) => { if ((o as T.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  void A;
  return g;
}
