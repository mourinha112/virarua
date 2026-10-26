/* Obras das ruas no mapa: canteiro (tapume, cones, areia, tijolos e guindaste) que vai virando a obra de verdade
   a cada etapa — jardim, banco, praça iluminada, pista de skate e biblioteca. Obra pronta fica na rua para sempre
   (as duas últimas aparecem). Lugar: lote vazio mais perto das casas da rua (recalculado quando a cidade cresce).
   Só de perto (mesma distância dos avatares); dados públicos de GET /api/obras. */
import * as T from 'three';
import { CEL, type LayoutCidade } from './cidade';
import { ehTerra } from './terreno';

type Fonte = { visiveis: { ibge: number }[]; layout: (ibge: number) => LayoutCidade | null };
export type ObraMapa = { modelo: string; titulo: string; status: 'em_obra' | 'concluida'; etapa: number; etapas: number; pct: number };
type RuaObras = { id: string; nome: string; ibge: number; lotes: number[]; obras: ObraMapa[] };

const mats = new Map<string, T.Material>();
function mat(h: string, brilho = false) {
  const k = h + (brilho ? '!' : ''); let m = mats.get(k);
  if (!m) { m = brilho ? new T.MeshBasicMaterial({ color: h, toneMapped: false }) : new T.MeshStandardMaterial({ color: h, roughness: 0.85 }); mats.set(k, m); }
  return m;
}
const GEO = { caixa: new T.BoxGeometry(1, 1, 1), cil: new T.CylinderGeometry(0.5, 0.5, 1, 10), cone: new T.ConeGeometry(0.5, 1, 10), bola: new T.SphereGeometry(0.5, 10, 8) };
function p(g: T.Group, geo: keyof typeof GEO, cor: string, s: [number, number, number], pos: [number, number, number], brilho = false) {
  const m = new T.Mesh(GEO[geo], mat(cor, brilho)); m.scale.set(...s); m.position.set(...pos); m.castShadow = !brilho; g.add(m); return m;
}

/* ---------- canteiro de obras (some quando a obra fica pronta) ---------- */
function canteiro(g: T.Group, grande: boolean, etapa: number) {
  const H = 0.11, L = 0.46;
  // tapume em 3 lados (a frente fica aberta), com faixa listrada
  for (const [x, z, rot] of [[0, -L, 0], [-L, 0, Math.PI / 2], [L, 0, Math.PI / 2]] as [number, number, number][]) {
    const t = p(g, 'caixa', '#f2c230', [0.92, H, 0.02], [x, H / 2, z]); t.rotation.y = rot;
    const f = p(g, 'caixa', '#2b2b30', [0.92, 0.022, 0.024], [x, H * 0.7, z]); f.rotation.y = rot;
  }
  // cones na frente
  for (const x of [-0.32, 0, 0.32]) { p(g, 'cone', '#ff7a1a', [0.06, 0.1, 0.06], [x, 0.05, L + 0.02]); p(g, 'cil', '#ffffff', [0.045, 0.015, 0.045], [x, 0.06, L + 0.02]); }
  // monte de areia e pilha de tijolos (diminuem conforme a obra avança)
  const sobra = Math.max(0.35, 1 - etapa * 0.25);
  p(g, 'cone', '#d9b46a', [0.22 * sobra, 0.12 * sobra, 0.22 * sobra], [-0.3, 0.06 * sobra, -0.28]);
  for (let i = 0; i < Math.round(4 * sobra); i++) p(g, 'caixa', '#b5502f', [0.1, 0.04, 0.05], [0.3, 0.02 + (i >> 1) * 0.04, -0.3 + (i & 1) * 0.06]);
  // carrinho de mão
  p(g, 'caixa', '#3a86ff', [0.1, 0.04, 0.07], [0.32, 0.05, 0.2]); p(g, 'cil', '#222', [0.04, 0.02, 0.04], [0.37, 0.02, 0.2]).rotation.z = Math.PI / 2;
  // guindaste nas obras grandes: torre amarela, braço e cabo; gira devagar
  if (grande) {
    const gu = new T.Group(); gu.position.set(-0.36, 0, 0.3); g.add(gu);
    p(gu, 'caixa', '#f2b705', [0.05, 0.95, 0.05], [0, 0.475, 0]);
    const braco = new T.Group(); braco.position.y = 0.95; gu.add(braco);
    p(braco, 'caixa', '#f2b705', [0.62, 0.04, 0.04], [0.2, 0, 0]); p(braco, 'caixa', '#555', [0.1, 0.07, 0.07], [-0.13, -0.02, 0]);
    p(braco, 'cil', '#333', [0.006, 0.4, 0.006], [0.42, -0.2, 0]); p(braco, 'caixa', '#b5502f', [0.07, 0.05, 0.07], [0.42, -0.42, 0]);
    g.userData.braco = braco;
  }
  // placa "OBRA DA RUA"
  p(g, 'cil', '#777', [0.012, 0.2, 0.012], [0.42, 0.1, 0.42]); p(g, 'caixa', '#e63946', [0.16, 0.08, 0.01], [0.42, 0.2, 0.43]);
}

/* ---------- as obras: peças liberadas por etapa (0..n); pronta = tudo + brilho ---------- */
function jardim(g: T.Group, e: number, pronta: boolean) {
  p(g, 'caixa', '#7a5230', [0.8, 0.02, 0.6], [0, 0.01, 0]);                     // terra preparada
  if (e >= 1) for (let i = 0; i < 12; i++) p(g, 'cone', '#4f9c3f', [0.05, 0.08, 0.05], [-0.33 + (i % 6) * 0.13, 0.05, -0.18 + Math.floor(i / 6) * 0.36]);
  if (e >= 2 || pronta) {
    const F = ['#e63946', '#ffd23f', '#e58ab5', '#9b6fd1', '#ffffff'];
    for (let i = 0; i < 12; i++) p(g, 'bola', F[i % F.length], [0.06, 0.06, 0.06], [-0.33 + (i % 6) * 0.13, 0.1, -0.18 + Math.floor(i / 6) * 0.36]);
    p(g, 'bola', '#4f9c3f', [0.26, 0.24, 0.26], [0, 0.12, 0]);
  }
  if (pronta) for (const [x, z, w, d] of [[0, -0.32, 0.86, 0.02], [0, 0.32, 0.86, 0.02], [-0.43, 0, 0.02, 0.64], [0.43, 0, 0.02, 0.64]]) p(g, 'caixa', '#ffffff', [w, 0.06, d], [x, 0.03, z]);
}
function banco(g: T.Group, e: number, pronta: boolean) {
  const mad = pronta ? '#e63946' : '#a0703e';
  if (e >= 1 || pronta) for (const x of [-0.25, 0.25]) p(g, 'caixa', '#5a3a22', [0.05, 0.12, 0.16], [x, 0.06, 0]);
  if (e >= 2 || pronta) { p(g, 'caixa', mad, [0.62, 0.03, 0.18], [0, 0.13, 0]); p(g, 'caixa', mad, [0.62, 0.12, 0.03], [0, 0.22, -0.08]); }
  if (pronta) { p(g, 'cil', '#555', [0.015, 0.3, 0.015], [0.38, 0.15, 0.05]); p(g, 'caixa', '#2a9d8f', [0.14, 0.08, 0.01], [0.38, 0.3, 0.06]); p(g, 'bola', '#4f9c3f', [0.2, 0.2, 0.2], [-0.4, 0.1, -0.2]); }
}
function pracaLuz(g: T.Group, e: number, pronta: boolean) {
  p(g, 'caixa', '#cfc8b8', [0.8, 0.015, 0.7], [0, 0.008, 0]);
  const postes: [number, number][] = [[-0.33, -0.28], [0.33, -0.28], [-0.33, 0.28], [0.33, 0.28]];
  if (e >= 1 || pronta) for (const [x, z] of postes) { p(g, 'cil', '#2c3342', [0.025, 0.4, 0.025], [x, 0.2, z]); p(g, 'bola', pronta ? '#fff2a8' : '#999', [0.07, 0.07, 0.07], [x, 0.42, z], pronta); }
  if (e >= 2 || pronta) for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
    const [x1, z1] = postes[a], [x2, z2] = postes[b];
    for (let k = 1; k < 6; k++) { const t = k / 6; p(g, 'bola', pronta ? ['#ff5d5d', '#ffd23f', '#3a86ff', '#7ae582'][k % 4] : '#666', [0.03, 0.03, 0.03], [x1 + (x2 - x1) * t, 0.36 - Math.sin(t * Math.PI) * 0.05, z1 + (z2 - z1) * t], pronta); }
  }
  if (pronta) p(g, 'cil', '#8fc468', [0.3, 0.03, 0.3], [0, 0.03, 0]);
}
function skate(g: T.Group, e: number, pronta: boolean) {
  const conc = e >= 3 || pronta ? '#b9bfc8' : '#9a8a70';
  p(g, 'caixa', conc, [0.86, 0.02, 0.7], [0, 0.01, 0]);
  if (e >= 1 || pronta) { const r1 = p(g, 'caixa', conc, [0.24, 0.16, 0.6], [-0.3, 0.06, 0]); r1.rotation.z = -0.55; const r2 = p(g, 'caixa', conc, [0.24, 0.16, 0.6], [0.3, 0.06, 0]); r2.rotation.z = 0.55; }
  if (e >= 2 || pronta) { p(g, 'caixa', conc, [0.2, 0.06, 0.2], [0, 0.03, 0]); p(g, 'cil', '#555', [0.01, 0.4, 0.01], [0, 0.07, -0.2]).rotation.x = Math.PI / 2; }
  if (pronta) { p(g, 'caixa', '#ff7a1a', [0.12, 0.012, 0.04], [0.1, 0.08, 0.15]); p(g, 'caixa', '#3a86ff', [0.02, 0.05, 0.6], [-0.43, 0.04, 0]); p(g, 'caixa', '#e63946', [0.02, 0.05, 0.6], [0.43, 0.04, 0]); }
}
function biblioteca(g: T.Group, e: number, pronta: boolean) {
  const al = e >= 2 || pronta ? 0.36 : e >= 1 ? 0.2 : 0.06;
  p(g, 'caixa', '#cfc8b8', [0.66, 0.02, 0.5], [0, 0.01, 0]);
  p(g, 'caixa', pronta ? '#f4ecd8' : '#d0c4a8', [0.6, al, 0.42], [0, al / 2 + 0.02, -0.02]);
  if (e >= 1 || pronta) for (let i = 0; i < 3; i++) p(g, 'caixa', ['#e63946', '#3a86ff', '#2a9d8f'][i], [0.12, 0.1, 0.01], [-0.18 + i * 0.18, 0.12, 0.2]);
  if (pronta) {
    const tel = p(g, 'cone', '#3d5a80', [0.5, 0.18, 0.5], [0, al + 0.11, -0.02]); tel.rotation.y = Math.PI / 4; tel.scale.set(0.6 * 1.25, 0.18, 0.46 * 1.25);
    p(g, 'caixa', '#1e2430', [0.12, 0.16, 0.01], [0, 0.1, 0.2]);
    for (const x of [-0.24, 0.24]) p(g, 'cil', '#ffffff', [0.03, al, 0.03], [x, al / 2 + 0.02, 0.21]);
    p(g, 'bola', '#ffd23f', [0.06, 0.06, 0.06], [0, al + 0.04, 0.2], true);
  }
}
const OBRAS: Record<string, { f: (g: T.Group, e: number, pronta: boolean) => void; grande: boolean }> = {
  jardim: { f: jardim, grande: false }, banco: { f: banco, grande: false }, praca_luz: { f: pracaLuz, grande: true },
  skate: { f: skate, grande: true }, biblioteca: { f: biblioteca, grande: true },
};

/** placa com o nome da obra e a % (canvas), virada pra frente */
function placa(texto: string, sub: string, pronta: boolean) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160; const k = cv.getContext('2d')!;
  k.fillStyle = pronta ? '#2a9d8f' : '#f2c230'; k.beginPath(); k.roundRect(6, 6, 500, 148, 28); k.fill();
  k.fillStyle = pronta ? '#ffffff' : '#1e2430'; k.textAlign = 'center'; k.textBaseline = 'middle';
  k.font = '400 50px "Lilita One", sans-serif'; k.fillText(texto.slice(0, 22), 256, 60); k.font = '900 34px Nunito, sans-serif'; k.fillText(sub, 256, 118);
  const tx = new T.CanvasTexture(cv); tx.colorSpace = T.SRGBColorSpace;
  const m = new T.Mesh(new T.PlaneGeometry(0.9, 0.28), new T.MeshBasicMaterial({ map: tx, transparent: true, side: T.DoubleSide, toneMapped: false }));
  return m;
}

export function criarObra(o: ObraMapa) {
  const g = new T.Group(); const def = OBRAS[o.modelo] || OBRAS.jardim;
  const pronta = o.status === 'concluida';
  def.f(g, pronta ? o.etapas : o.etapa, pronta);
  if (!pronta) canteiro(g, def.grande, o.etapa);
  const pl = placa(pronta ? o.titulo : '🚧 ' + o.titulo, pronta ? '✨ pronta' : `etapa ${Math.min(o.etapa + 1, o.etapas)}/${o.etapas} · ${o.pct}%`, pronta);
  pl.position.set(0, pronta ? 0.75 : 1.15, 0.1); g.add(pl); g.userData.placa = pl;
  return g;
}

/* ---------- lugar no mapa ---------- */
function lugares(L: LayoutCidade, lotes: number[], n: number, ocupado: Set<string>) {
  const ca = Math.cos(L.ang), sa = Math.sin(L.ang);
  const W = (i: number, j: number): [number, number] => [L.cx + (i * ca - j * sa) * CEL, L.cy + (i * sa + j * ca) * CEL];
  const celula = (x: number, y: number) => { const dx = x - L.cx, dy = y - L.cy; return [Math.round((dx * ca + dy * sa) / CEL), Math.round((-dx * sa + dy * ca) / CEL)]; };
  const minhas = lotes.map((k) => L.lotes[k]).filter(Boolean); if (!minhas.length) return [];
  const ci = minhas.reduce((s, l) => s + l.i, 0) / minhas.length, cj = minhas.reduce((s, l) => s + l.j, 0) / minhas.length;
  const tomado = new Set(ocupado); for (const l of L.lotes) tomado.add(l.i + ',' + l.j);
  for (const a of [...L.arvores, ...L.verdes]) { const [i, j] = celula(a.x, a.y); tomado.add(i + ',' + j); }
  const cand: { i: number; j: number; d: number }[] = [];
  const R = 5;
  for (let j = Math.floor(cj) - R; j <= Math.ceil(cj) + R; j++) for (let i = Math.floor(ci) - R; i <= Math.ceil(ci) + R; i++) {
    const mi = ((i % 4) + 4) % 4, mj = ((j % 4) + 4) % 4; if (mi === 0 || mj === 0) continue;   // linha de rua
    if (tomado.has(i + ',' + j) || Math.hypot(i, j) < L.praca.r / CEL + 1.75) continue;
    const [x, y] = W(i, j); const m = CEL * 0.5; if (!(ehTerra(x, y) && ehTerra(x + m, y + m) && ehTerra(x - m, y - m))) continue;
    cand.push({ i, j, d: Math.hypot(i - ci, j - cj) });
  }
  cand.sort((a, b) => a.d - b.d);
  const out: { x: number; y: number; yaw: number; chave: string }[] = [];
  for (const c of cand) {
    if (out.length >= n) break;
    const mi = ((c.i % 4) + 4) % 4, mj = ((c.j % 4) + 4) % 4;
    // frente para a rua mais próxima (miolo da quadra: para o centro da rua da casa mais perto)
    let di = 0, dj = 0; if (mi === 1) di = -1; else if (mi === 3) di = 1; else if (mj === 1) dj = -1; else if (mj === 3) dj = 1;
    const dx = di * ca - dj * sa, dy = di * sa + dj * ca;
    const [x, y] = W(c.i, c.j); tomado.add(c.i + ',' + c.j); ocupado.add(c.i + ',' + c.j);
    out.push({ x, y, yaw: di || dj ? Math.atan2(dx, -dy) : 0, chave: c.i + ',' + c.j });
  }
  return out;
}

/** lugares fixos de cada cidade fora das ruas e dos lotes: [0] prefeitura da vila, [1] árvore de Natal.
    As obras nunca usam essas células (cache por layout). */
const extras = new WeakMap<LayoutCidade, { x: number; y: number; yaw: number; chave: string }[]>();
export function extrasDaCidade(L: LayoutCidade) {
  let e = extras.get(L);
  if (!e) { e = lugares(L, L.lotes.map((_, k) => k), 2, new Set()); extras.set(L, e); }
  return e;
}

export function criarObras(scene: T.Scene, fonte: Fonte) {
  const raiz = new T.Group(); raiz.name = 'obras'; scene.add(raiz);
  const cache = new Map<number, { em: number; ruas: RuaObras[] }>();
  const vivos = new Map<string, T.Group>();
  let sig = '', ultima = 0, buscando = false, sujo = true;

  async function buscar(ibges: number[]) {
    const falta = ibges.filter((i) => { const c = cache.get(i); return !c || performance.now() - c.em > 90_000; }).slice(0, 30);
    if (!falta.length || buscando) return;
    buscando = true;
    const r: any = await fetch('/api/obras?ibge=' + falta.join(','), { credentials: 'same-origin' }).then((x) => x.json()).catch(() => null);
    buscando = false;
    for (const i of falta) cache.set(i, { em: performance.now(), ruas: r?.ok ? (r.ruas as RuaObras[]).filter((x) => x.ibge === i) : cache.get(i)?.ruas || [] });
    sujo = true;
  }

  function montar() {
    sujo = false;
    const quero = new Set<string>();
    for (const c of fonte.visiveis) {
      const L = fonte.layout(c.ibge); const ruas = cache.get(c.ibge)?.ruas; if (!L || !ruas) continue;
      const ocupado = new Set<string>(extrasDaCidade(L).map((x) => x.chave));
      for (const rua of ruas) {
        const pos = lugares(L, rua.lotes, rua.obras.length, ocupado);
        rua.obras.forEach((o, k) => {
          const lp = pos[k]; if (!lp) return;
          const chave = `${rua.id}:${o.modelo}:${o.status}:${o.etapa}:${o.pct}:${lp.chave}`; quero.add(chave);
          let g = vivos.get(chave);
          if (!g) { g = criarObra(o); g.scale.setScalar(CEL * 0.95); g.position.set(lp.x, 0, -lp.y); g.rotation.y = lp.yaw; vivos.set(chave, g); raiz.add(g); }
        });
      }
    }
    for (const [k, g] of vivos) if (!quero.has(k)) { raiz.remove(g); vivos.delete(k); }
  }

  return {
    raiz,
    passo(agora: number, dist: number, cam?: T.Camera) {
      raiz.visible = dist < 160;
      if (!raiz.visible) return;
      const s = fonte.visiveis.map((c) => c.ibge).join(',');
      if (s !== sig || agora - ultima > 45) { sig = s; ultima = agora; void buscar(fonte.visiveis.map((c) => c.ibge)); }
      if (sujo) montar();
      for (const g of vivos.values()) {
        if (g.userData.braco) g.userData.braco.rotation.y = Math.sin(agora * 0.3 + g.position.x) * 1.2;
        if (cam && g.userData.placa) { const pl = g.userData.placa as T.Mesh; pl.quaternion.copy(cam.quaternion); pl.quaternion.premultiply(g.quaternion.clone().invert()); }
      }
    },
    recarregar() { cache.clear(); ultima = 0; },
  };
}
