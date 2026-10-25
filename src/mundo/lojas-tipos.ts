/* Modelos especiais de loja por tipo (arte própria): academia de 2 andares com vidro, mercado com toldo e
   caixotes, loja de tecnologia com vitrine azul. Medidas em km, frente = +z. */
import * as T from 'three';
import type { Loja } from '../dados/formato';
import { caixa, cilindro, juntar, placa } from './geometrias';
import { letreiro, girar, type Parte } from './lojas3d';

const girarZ = (pos: number[], a: number) => girar(pos, 0, 0, a);
const mover = (pos: number[], x: number, y: number, z: number) => pos.map((v, i) => v + (i % 3 === 0 ? x : i % 3 === 1 ? y : z));

function vidro(w: number, h: number, cor = '#9fd3f0') {
  return new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshPhysicalMaterial({ color: cor, transparent: true, opacity: 0.3, roughness: 0.05, side: T.DoubleSide, depthWrite: false }));
}
function selo(g: T.Group, l: Loja, y: number, z: number, w = 1.36) {
  const sl = new T.Mesh(new T.PlaneGeometry(w, 0.34), new T.MeshBasicMaterial({ map: letreiro(l.nome, l.cor), toneMapped: false }));
  sl.position.set(0, y, z); g.add(sl);
}
function pino(g: T.Group, y: number) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 96; const k = cv.getContext('2d')!;
  k.fillStyle = '#1e2430'; k.fillRect(30, 50, 4, 44); k.beginPath(); k.arc(32, 30, 27, 0, 7); k.fillStyle = '#fff'; k.fill();
  k.beginPath(); k.arc(32, 30, 23, 0, 7); k.fillStyle = '#2f80ed'; k.fill(); k.fillStyle = '#fff'; k.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 6 : 14, a = -Math.PI / 2 + (i * Math.PI) / 5; k[i ? 'lineTo' : 'moveTo'](32 + Math.cos(a) * r, 30 + Math.sin(a) * r); }
  k.closePath(); k.fill();
  const tp = new T.CanvasTexture(cv); tp.colorSpace = T.SRGBColorSpace;
  const s = new T.Sprite(new T.SpriteMaterial({ map: tp, depthTest: false, toneMapped: false })); s.scale.set(0.42, 0.63, 1); s.position.set(0.55, y, 0.2); s.renderOrder = 40; g.add(s);
}
const fim = (g: T.Group) => { g.traverse((o) => { if ((o as T.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return g; };
const matV = (r = 0.85) => new T.MeshStandardMaterial({ vertexColors: true, roughness: r, flatShading: true });

/** Academia: 2 andares, fachada de vidro mostrando esteiras, bike e halteres; haltere gigante no telhado. */
export function criarAcademia(l: Loja): T.Group {
  const g = new T.Group(); g.name = 'loja:' + l.id;
  const P: Parte[] = [
    { pos: caixa(-0.95, 0, -0.75, 0.95, 0.04, 1.0, false), cor: '#dfdedc' },
    { pos: caixa(-0.8, 0.04, -0.6, 0.8, 0.06, 0.55, false), cor: '#5d6570' },
    { pos: caixa(-0.8, 0.86, -0.6, 0.8, 0.92, 0.55), cor: '#e9e4d8' },
    { pos: caixa(-0.84, 1.7, -0.64, 0.84, 1.8, 0.6), cor: '#2c3342' },
    { pos: caixa(-0.8, 0.04, -0.6, 0.8, 1.7, -0.54), cor: '#f4f1e8' },
    { pos: caixa(-0.8, 0.04, -0.6, -0.74, 1.7, 0.55), cor: l.cor },
    { pos: caixa(0.74, 0.04, -0.6, 0.8, 1.7, 0.55), cor: l.cor },
  ];
  for (const x of [-0.5, -0.15, 0.2]) P.push(
    { pos: caixa(x - 0.1, 0.06, -0.2, x + 0.1, 0.12, 0.15), cor: '#1e2430' },
    { pos: caixa(x - 0.1, 0.12, -0.24, x + 0.1, 0.36, -0.2), cor: '#3a3f46' },
    { pos: caixa(x - 0.08, 0.34, -0.26, x + 0.08, 0.4, -0.16), cor: '#4fb7f0' });
  P.push({ pos: caixa(0.45, 0.06, -0.1, 0.6, 0.26, 0.05), cor: '#e63946' }, { pos: caixa(0.48, 0.26, -0.12, 0.57, 0.3, -0.04), cor: '#1e2430' });
  P.push({ pos: caixa(-0.62, 0.92, -0.4, 0.62, 1.0, -0.3), cor: '#2c3342' });
  for (let k = 0; k < 6; k++) P.push({ pos: cilindro(0.05, 0.05, 0.05, 10, 1.0, -0.5 + k * 0.2, -0.35), cor: k % 2 ? '#e63946' : '#1e2430' });
  P.push({ pos: caixa(0.1, 0.92, 0.0, 0.5, 0.98, 0.12), cor: '#1e2430' }, { pos: caixa(0.15, 0.98, -0.02, 0.45, 1.02, 0.14), cor: l.cor });
  g.add(new T.Mesh(juntar(P), matV()));
  for (const [y, h] of [[0.45, 0.8], [1.31, 0.78]] as const) { const v = vidro(1.48, h); v.position.set(0, y, 0.551); g.add(v); }
  const cx: Parte[] = []; for (const x of [-0.74, -0.25, 0.25, 0.74]) cx.push({ pos: caixa(x - 0.015, 0.06, 0.54, x + 0.015, 1.7, 0.565), cor: '#2c3342' });
  g.add(new T.Mesh(juntar(cx), matV()));
  selo(g, l, 1.98, 0.3, 1.5);
  const H: Parte[] = [{ pos: girarZ(cilindro(0.05, 0.05, 1.0, 8, -0.5), Math.PI / 2), cor: '#9aa3ae' }];
  for (const s of [-1, 1]) for (const o of [0, 0.1]) H.push({ pos: mover(girarZ(cilindro(0.2 - o * 0.6, 0.2 - o * 0.6, 0.08, 14, -0.04), Math.PI / 2), s * (0.38 + o), 0, 0), cor: '#1e2430' });
  const hm = new T.Mesh(juntar(H), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5, flatShading: true }));
  hm.position.set(0, 2.25, -0.1); hm.userData.anima = 'flutua'; g.add(hm);
  pino(g, 2.9);
  return fim(g);
}

/** Mercado: galpão largo com toldo comprido, caixotes de frutas na calçada e carrinho no telhado. */
export function criarMercado(l: Loja): T.Group {
  const g = new T.Group(); g.name = 'loja:' + l.id;
  const P: Parte[] = [
    { pos: caixa(-1.15, 0, -0.75, 1.15, 0.04, 1.05, false), cor: '#dfdedc' },
    { pos: caixa(-1.0, 0.04, -0.6, 1.0, 0.95, 0.55), cor: '#f2f8ea' },
    { pos: caixa(-1.04, 0.95, -0.64, 1.04, 1.02, 0.59), cor: '#5d6570' },
    { pos: placa(-0.9, 0.08, 0.9, 0.6, 0.551), cor: '#7fa8cc' },
  ];
  const frutas = ['#e63946', '#ffd23f', '#78ad54', '#f4a261', '#e63946', '#78ad54'];
  for (let i = 0; i < 6; i++) { const x = -0.85 + i * 0.34; P.push({ pos: caixa(x - 0.13, 0.04, 0.7, x + 0.13, 0.16, 0.92), cor: '#b08a5a' }, { pos: caixa(x - 0.11, 0.16, 0.72, x + 0.11, 0.22, 0.9), cor: frutas[i] }); }
  g.add(new T.Mesh(juntar(P), matV(0.9)));
  const toldo: Parte[] = []; const n = 13;
  for (let i = 0; i < n; i++) { const x0 = -1.02 + (i * 2.04) / n; toldo.push({ pos: girar(caixa(x0, -0.015, 0, x0 + 2.04 / n, 0.015, 0.42), 0, 0.38), cor: i % 2 ? '#ffffff' : l.cor }); }
  const mt = new T.Mesh(juntar(toldo), matV(0.9)); mt.position.set(0, 0.68, 0.56); g.add(mt);
  selo(g, l, 0.85, 0.562, 1.7);
  const C: Parte[] = [{ pos: caixa(-0.3, 0.12, -0.18, 0.3, 0.45, 0.18), cor: '#c9ced6' }, { pos: caixa(-0.34, 0.45, -0.2, 0.34, 0.5, 0.2), cor: '#9aa3ae' }, { pos: caixa(0.3, 0.3, -0.02, 0.5, 0.34, 0.02), cor: '#9aa3ae' }];
  for (const [x, z] of [[-0.22, -0.12], [0.22, -0.12], [-0.22, 0.12], [0.22, 0.12]]) C.push({ pos: mover(girarZ(cilindro(0.06, 0.06, 0.04, 10, -0.02), Math.PI / 2), x, 0.06, z), cor: '#1e2430' });
  C.push({ pos: caixa(-0.2, 0.45, -0.1, 0.0, 0.62, 0.1), cor: '#e63946' }, { pos: caixa(0.02, 0.45, -0.08, 0.2, 0.58, 0.1), cor: '#ffd23f' });
  const cm = new T.Mesh(juntar(C), matV(0.6)); cm.position.set(0, 1.02, -0.1); cm.scale.setScalar(1.3); cm.userData.anima = 'flutua'; g.add(cm);
  pino(g, 2.1);
  return fim(g);
}

/** Tecnologia: prédio escuro com vitrine azul, faixa neon na cor da marca e celular gigante no telhado. */
export function criarTech(l: Loja): T.Group {
  const g = new T.Group(); g.name = 'loja:' + l.id;
  const P: Parte[] = [{ pos: caixa(-0.85, 0, -0.75, 0.85, 0.04, 0.95, false), cor: '#dfdedc' }, { pos: caixa(-0.7, 0.04, -0.6, 0.7, 1.15, 0.55), cor: '#2c3342' }, { pos: caixa(-0.74, 1.15, -0.64, 0.74, 1.22, 0.59), cor: '#1e2430' }];
  for (const x of [-0.45, -0.15, 0.15, 0.45]) P.push({ pos: caixa(x - 0.1, 0.06, -0.2, x + 0.1, 0.3, 0.0), cor: '#e9e4d8' }, { pos: caixa(x - 0.06, 0.3, -0.12, x + 0.06, 0.48, -0.1), cor: '#1e2430' });
  g.add(new T.Mesh(juntar(P), matV(0.6)));
  const v = vidro(1.36, 0.8, '#4fb7f0'); v.position.set(0, 0.48, 0.551); g.add(v);
  const neon = new T.Mesh(new T.BoxGeometry(1.4, 0.04, 0.03), new T.MeshBasicMaterial({ color: l.cor, toneMapped: false })); neon.position.set(0, 0.9, 0.57); g.add(neon);
  selo(g, l, 1.04, 0.562);
  const cel: Parte[] = [{ pos: caixa(-0.25, 0, -0.04, 0.25, 0.9, 0.04), cor: '#1e2430' }, { pos: placa(-0.21, 0.06, 0.21, 0.84, 0.041), cor: '#4fb7f0' }];
  const cm = new T.Mesh(juntar(cel), matV(0.3)); cm.position.set(0, 1.22, -0.1); cm.userData.anima = 'flutua'; g.add(cm);
  pino(g, 2.4);
  return fim(g);
}

/** Empresa virtual de morador: escritório de 3 andares com janelas em fita, letreiro e logo cúbico girando. */
export function criarEscritorio(l: Loja): T.Group {
  const g = new T.Group(); g.name = 'empresa:' + l.id;
  const P: Parte[] = [
    { pos: caixa(-0.85, 0, -0.75, 0.85, 0.04, 0.95, false), cor: '#dfdedc' },
    { pos: caixa(-0.65, 0.04, -0.55, 0.65, 2.1, 0.5), cor: '#f4f6f8' },
    { pos: caixa(-0.69, 2.1, -0.59, 0.69, 2.18, 0.54), cor: '#2c3342' },
    { pos: caixa(-0.66, 0.04, 0.45, -0.58, 2.1, 0.52), cor: l.cor }, { pos: caixa(0.58, 0.04, 0.45, 0.66, 2.1, 0.52), cor: l.cor },
    { pos: placa(-0.2, 0.04, 0.2, 0.45, 0.501), cor: '#3f5670' },
  ];
  for (let a = 0; a < 3; a++) { const y = 0.62 + a * 0.5; P.push({ pos: placa(-0.55, y, 0.55, y + 0.26, 0.501), cor: '#7fa8cc' }, { pos: placa(0.55, y, -0.55, y + 0.26, -0.551), cor: '#7fa8cc' }); }
  g.add(new T.Mesh(juntar(P), matV(0.7)));
  selo(g, l, 0.5 + 0.01, 0.53, 1.2);
  const logo = new T.Mesh(new T.BoxGeometry(0.42, 0.42, 0.42), new T.MeshStandardMaterial({ color: l.cor, roughness: 0.4 }));
  logo.position.set(0, 2.5, 0); logo.userData.anima = 'gira'; g.add(logo);
  pino(g, 3.0);
  return fim(g);
}
