/* Avatares 3D baixo-poli, no mesmo estilo das casas (geometrias.ts: triângulos soltos, cor por vértice, flatShading,
   cores compensadas para o ACES com A()). Peças modulares próprias (sem asset de terceiros): tronco por roupa,
   cabelos por estilo, acessórios, calçados. Tudo instanciado (um InstancedMesh por peça, cor por instância).

   SEM joystick, física ou pathfinding: o avatar aparece num slot do destino com um teletransporte curto
   (encolhe/expande + anel no chão) e faz animações pequenas: idle, aceno, comemorar, sentar.
   prefers-reduced-motion: sem balanço/pulo/teletransporte animado; aceno vira pose parada.

   Uso no mundo (coordenadas do mapa em km: x leste, y norte; no Three = (x, 0, −y)):
     const av = criarAvatares({ escala: 0.22, maxRender: 60 }); scene.add(av.raiz);
     const pos = slotsDoDestino('city_square', 30, { x, y, yaw: 0, raio: 1.2 });
     av.definir(presentes.map(p => ({ id: p.userId, config: p.avatar, ...pos[p.slot] })));
     av.animar(userId, 'aceno');                  // quando chegar um emote
     no loop: av.passo(segundos);  ao sair da cena: av.dispose()
   Prévia isolada (editor): criarPreviaAvatar(canvas, config) em painel-avatar.ts usa este mesmo módulo. */
import * as T from 'three';
import { caixa, cilindro, juntar, placa } from './geometrias';
import { A } from './cores';

export type ConfigAvatar = { pele: string; cabelo: string; cor_cabelo: string; roupa: string; cor_roupa: string; acessorio: string; calcado: string };
export type Animacao = 'idle' | 'aceno' | 'comemorar' | 'sentar';
export type AvatarNaCena = { id: string; config: ConfigAvatar | null; x: number; y: number; yaw?: number };

export const PADRAO: ConfigAvatar = { pele: 'pele.3', cabelo: 'cabelo.curto', cor_cabelo: 'cor_cabelo.castanho', roupa: 'roupa.camiseta', cor_roupa: 'cor_roupa.amarelo', acessorio: 'acessorio.nenhum', calcado: 'calcado.tenis' };

/** paleta das peças tingíveis (hex que se quer VER; A() compensa iluminação + ACES) */
export const CORES: Record<string, string> = {
  'pele.1': '#f7dcc4', 'pele.2': '#efc39c', 'pele.3': '#d9a273', 'pele.4': '#b97c4f', 'pele.5': '#8d5a36', 'pele.6': '#5e3a22',
  'cor_cabelo.preto': '#2a2523', 'cor_cabelo.castanho': '#6b4428', 'cor_cabelo.loiro': '#e8c068', 'cor_cabelo.ruivo': '#c4572c', 'cor_cabelo.colorido': '#8338ec',
  'cor_roupa.amarelo': '#ffd23f', 'cor_roupa.azul': '#4fb7f0', 'cor_roupa.verde': '#78ad54', 'cor_roupa.vermelho': '#e63946', 'cor_roupa.preto': '#3a3f4a', 'cor_roupa.branco': '#f4f1e8',
};
const CALCA = '#3f5670', OLHO = '#1e2430', BRANCO = '#ffffff';

type Parte = { pos: number[]; cor: string };
const ico = (r: number, x: number, y: number, z: number, det = 0) => { const g = new T.IcosahedronGeometry(r, det); g.translate(x, y, z); return Array.from(g.attributes.position.array as Float32Array); };

/* ---------- geometrias (altura total ≈ 1, base no chão, frente = +z) ---------- */
function geoPernas() { return juntar([{ pos: caixa(-0.13, 0.08, -0.07, -0.02, 0.4, 0.07), cor: CALCA }, { pos: caixa(0.02, 0.08, -0.07, 0.13, 0.4, 0.07), cor: CALCA }]); }
function geoCalcado(t: string) {
  const P: Parte[] = [];
  for (const x0 of [-0.14, 0.01]) {
    if (t === 'calcado.bota') P.push({ pos: caixa(x0, 0, -0.08, x0 + 0.13, 0.16, 0.11), cor: '#8a6a45' }, { pos: caixa(x0, 0, -0.08, x0 + 0.13, 0.025, 0.11), cor: '#3a2a1c' });
    else if (t === 'calcado.chinelo') P.push({ pos: caixa(x0, 0, -0.08, x0 + 0.13, 0.025, 0.12), cor: '#4fb7f0' }, { pos: caixa(x0 + 0.05, 0.025, 0.0, x0 + 0.08, 0.06, 0.08), cor: BRANCO });
    else P.push({ pos: caixa(x0, 0, -0.08, x0 + 0.13, 0.09, 0.12), cor: BRANCO }, { pos: caixa(x0, 0, -0.08, x0 + 0.13, 0.025, 0.12), cor: '#c9ced6' });
  }
  return juntar(P);
}
/** tronco tingido pela cor da roupa (vértices brancos); detalhes fixos em outras cores */
function geoTronco(r: string) {
  switch (r) {
    case 'roupa.moletom': return juntar([{ pos: caixa(-0.19, 0.36, -0.12, 0.19, 0.74, 0.12), cor: BRANCO }, { pos: caixa(-0.13, 0.62, -0.17, 0.13, 0.76, -0.1), cor: '#e9e4d8' }, { pos: placa(-0.09, 0.42, 0.09, 0.52, 0.121), cor: '#e9e4d8' }]);
    case 'roupa.vestido': return juntar([{ pos: cilindro(0.22, 0.15, 0.42, 7, 0.3), cor: BRANCO }, { pos: caixa(-0.16, 0.56, -0.1, 0.16, 0.74, 0.1), cor: BRANCO }]);
    case 'roupa.camisa': return juntar([{ pos: caixa(-0.18, 0.37, -0.11, 0.18, 0.73, 0.11), cor: BRANCO }, { pos: placa(-0.02, 0.4, 0.02, 0.7, 0.111), cor: '#e9e4d8' }, { pos: caixa(-0.1, 0.7, 0.04, 0.1, 0.76, 0.12), cor: '#f4f1e8' }]);
    case 'roupa.regata': return juntar([{ pos: caixa(-0.15, 0.37, -0.1, 0.15, 0.72, 0.1), cor: BRANCO }]);
    default: return juntar([{ pos: caixa(-0.17, 0.37, -0.11, 0.17, 0.73, 0.11), cor: BRANCO }]);   // camiseta
  }
}
/** manga (tingida pela roupa) e mão (tingida pela pele): pivô no ombro (0,0,0), braço pendurado para −y */
function geoManga() { return juntar([{ pos: caixa(-0.045, -0.16, -0.05, 0.045, 0.02, 0.05), cor: BRANCO }]); }
function geoMao() { return juntar([{ pos: caixa(-0.04, -0.3, -0.045, 0.04, -0.16, 0.045), cor: BRANCO }]); }
function geoCabeca() {
  return juntar([
    { pos: ico(0.15, 0, 0.88, 0, 1), cor: BRANCO },
    { pos: caixa(-0.05, 0.72, -0.05, 0.05, 0.78, 0.05), cor: BRANCO },                       // pescoço
    { pos: placa(-0.075, 0.875, -0.04, 0.915, 0.148), cor: OLHO }, { pos: placa(0.04, 0.875, 0.075, 0.915, 0.148), cor: OLHO },
    { pos: placa(-0.03, 0.82, 0.03, 0.835, 0.147), cor: '#c8572f' },                           // boca
  ]);
}
function geoCabelo(e: string) {
  const topo = (h = 0.06) => caixa(-0.16, 0.92, -0.16, 0.16, 0.98 + h, 0.12);
  switch (e) {
    case 'cabelo.longo': return juntar([{ pos: topo(), cor: BRANCO }, { pos: caixa(-0.165, 0.6, -0.17, 0.165, 0.98, -0.06), cor: BRANCO }, { pos: caixa(-0.17, 0.66, -0.12, -0.13, 0.95, 0.06), cor: BRANCO }, { pos: caixa(0.13, 0.66, -0.12, 0.17, 0.95, 0.06), cor: BRANCO }]);
    case 'cabelo.cacheado': { const P: Parte[] = []; for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; P.push({ pos: ico(0.07, Math.cos(a) * 0.12, 0.98 + (k % 2) * 0.03, Math.sin(a) * 0.12 - 0.02), cor: BRANCO }); } P.push({ pos: ico(0.09, 0, 1.03, -0.02), cor: BRANCO }); return juntar(P); }
    case 'cabelo.crespo': return juntar([{ pos: ico(0.2, 0, 0.99, -0.03, 1), cor: BRANCO }]);
    case 'cabelo.raspado': return juntar([{ pos: caixa(-0.152, 0.93, -0.152, 0.152, 1.0, 0.1), cor: BRANCO }]);
    case 'cabelo.coque': return juntar([{ pos: topo(0.03), cor: BRANCO }, { pos: ico(0.08, 0, 1.08, -0.08), cor: BRANCO }]);
    case 'cabelo.trancas': return juntar([{ pos: topo(0.03), cor: BRANCO }, { pos: caixa(-0.14, 0.58, -0.17, -0.08, 0.95, -0.11), cor: BRANCO }, { pos: caixa(0.08, 0.58, -0.17, 0.14, 0.95, -0.11), cor: BRANCO }, { pos: ico(0.035, -0.11, 0.57, -0.14), cor: '#ffd23f' }, { pos: ico(0.035, 0.11, 0.57, -0.14), cor: '#ffd23f' }]);
    default: return juntar([{ pos: topo(), cor: BRANCO }, { pos: caixa(-0.16, 0.8, -0.165, 0.16, 0.95, -0.1), cor: BRANCO }]);   // curto
  }
}
function geoAcessorio(a: string): T.BufferGeometry | null {
  switch (a) {
    case 'acessorio.bone': return juntar([{ pos: caixa(-0.165, 0.97, -0.16, 0.165, 1.06, 0.13), cor: '#e63946' }, { pos: caixa(-0.13, 0.97, 0.12, 0.13, 0.99, 0.25), cor: '#e63946' }, { pos: cilindro(0.02, 0.02, 0.02, 5, 1.06), cor: BRANCO }]);
    case 'acessorio.oculos': return juntar([{ pos: caixa(-0.1, 0.86, 0.15, -0.02, 0.93, 0.165), cor: OLHO }, { pos: caixa(0.02, 0.86, 0.15, 0.1, 0.93, 0.165), cor: OLHO }, { pos: caixa(-0.02, 0.9, 0.15, 0.02, 0.915, 0.165), cor: OLHO }]);
    case 'acessorio.fone': return juntar([{ pos: caixa(-0.17, 1.0, -0.03, 0.17, 1.04, 0.03), cor: OLHO }, { pos: caixa(-0.19, 0.83, -0.05, -0.14, 0.94, 0.05), cor: OLHO }, { pos: caixa(0.14, 0.83, -0.05, 0.19, 0.94, 0.05), cor: OLHO }, { pos: caixa(-0.18, 0.94, -0.025, -0.15, 1.02, 0.025), cor: OLHO }, { pos: caixa(0.15, 0.94, -0.025, 0.18, 1.02, 0.025), cor: OLHO }]);
    default: return null;
  }
}
const ROUPAS = ['roupa.camiseta', 'roupa.moletom', 'roupa.vestido', 'roupa.camisa', 'roupa.regata'];
const CABELOS = ['cabelo.curto', 'cabelo.longo', 'cabelo.cacheado', 'cabelo.crespo', 'cabelo.raspado', 'cabelo.coque', 'cabelo.trancas'];
const ACESSORIOS = ['acessorio.bone', 'acessorio.oculos', 'acessorio.fone'];
const CALCADOS = ['calcado.tenis', 'calcado.chinelo', 'calcado.bota'];

const reduzido = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Estado = { id: string; cfg: ConfigAvatar; x: number; y: number; yaw: number; anim: Animacao; animT0: number; chegada: number; saida: number; fase: number };

export function criarAvatares(opts: { escala?: number; maxRender?: number } = {}) {
  const escala = opts.escala ?? 0.22, max = opts.maxRender ?? 60;
  const raiz = new T.Group(); raiz.name = 'avatares';
  const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const M = new Map<string, T.InstancedMesh>();
  const novo = (k: string, g: T.BufferGeometry, cap = max) => { const m = new T.InstancedMesh(g, mat, cap); m.count = 0; m.castShadow = true; m.frustumCulled = false; m.setColorAt(0, new T.Color(1, 1, 1)); raiz.add(m); M.set(k, m); };
  novo('pernas', geoPernas()); novo('cabeca', geoCabeca()); novo('manga', geoManga(), max * 2); novo('mao', geoMao(), max * 2);
  for (const r of ROUPAS) novo(r, geoTronco(r));
  for (const c of CABELOS) novo(c, geoCabelo(c));
  for (const a of ACESSORIOS) { const g = geoAcessorio(a); if (g) novo(a, g); }
  for (const c of CALCADOS) novo(c, geoCalcado(c));
  const anel = new T.Mesh(new T.RingGeometry(0.28, 0.4, 24).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0, depthWrite: false }));
  const aneis = new T.InstancedMesh(anel.geometry, anel.material as T.Material, max); aneis.count = 0; aneis.frustumCulled = false; raiz.add(aneis);

  const corCache = new Map<string, T.Color>();
  const cor = (k: string, fallback: string) => { const hex = CORES[k] || fallback; let c = corCache.get(hex); if (!c) { c = A(hex); corCache.set(hex, c); } return c; };
  const branco = new T.Color(1, 1, 1);

  const vivos = new Map<string, Estado>();
  let agora = 0;
  const _m = new T.Matrix4(), _l = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _p = new T.Vector3(), _s = new T.Vector3();

  function definir(lista: AvatarNaCena[]) {
    const ids = new Set<string>();
    for (const a of lista.slice(0, max)) {
      ids.add(a.id);
      const cfg = { ...PADRAO, ...(a.config || {}) } as ConfigAvatar;
      const v = vivos.get(a.id);
      if (!v || v.saida) vivos.set(a.id, { id: a.id, cfg, x: a.x, y: a.y, yaw: a.yaw ?? 0, anim: 'idle', animT0: agora, chegada: agora, saida: 0, fase: Math.random() * 6 });
      else {
        if (Math.abs(v.x - a.x) + Math.abs(v.y - a.y) > 1e-6) v.chegada = agora;   // mudou de slot: teletransporte curto
        v.x = a.x; v.y = a.y; v.yaw = a.yaw ?? v.yaw; v.cfg = cfg;
      }
    }
    for (const [id, v] of vivos) if (!ids.has(id) && !v.saida) v.saida = agora;
  }
  function animar(id: string, anim: Animacao) { const v = vivos.get(id); if (v) { v.anim = anim; v.animT0 = agora; } }

  function por(k: string, matriz: T.Matrix4, c: T.Color) { const m = M.get(k); if (!m || m.count >= m.instanceMatrix.count) return; m.setMatrixAt(m.count, matriz); m.setColorAt(m.count, c); m.count++; }

  function passo(tSeg: number) {
    agora = tSeg; const rm = reduzido();
    for (const m of M.values()) m.count = 0;
    aneis.count = 0;
    const TP = rm ? 0 : 0.35;
    for (const [id, v] of vivos) {
      let s = 1;
      if (v.saida) { const k = TP ? (agora - v.saida) / 0.25 : 1; if (k >= 1) { vivos.delete(id); continue; } s = 1 - k; }
      else if (TP && agora - v.chegada < TP) { const k = (agora - v.chegada) / TP; s = k < 0.6 ? k / 0.6 * 1.12 : 1.12 - 0.12 * ((k - 0.6) / 0.4); }
      // animação
      const ta = agora - v.animT0; let anim = v.anim;
      if (anim !== 'idle' && anim !== 'sentar' && ta > 2.2) { v.anim = 'idle'; anim = 'idle'; }
      const bob = rm ? 0 : Math.sin(agora * 2.2 + v.fase) * 0.012;
      const pulo = anim === 'comemorar' && !rm ? Math.abs(Math.sin(ta * 7)) * 0.12 : 0;
      const sent = anim === 'sentar' ? -0.26 : 0;
      _q.setFromEuler(_e.set(0, v.yaw, 0));
      _m.compose(_p.set(v.x, (bob + pulo + sent) * escala, -v.y), _q, _s.set(escala * s, escala * s * (TP && s !== 1 ? 2 - s : 1), escala * s));
      const base = _m.clone();
      const pele = cor(v.cfg.pele, '#d9a273'), roupa = cor(v.cfg.cor_roupa, '#ffd23f'), cab = cor(v.cfg.cor_cabelo, '#6b4428');
      // pernas e pés (sentado: dobra no quadril para a frente)
      if (anim === 'sentar') {
        _l.makeTranslation(0, 0.4, 0).multiply(new T.Matrix4().makeRotationX(-Math.PI / 2)).multiply(new T.Matrix4().makeTranslation(0, -0.4, 0));
        const pern = base.clone().multiply(_l); por('pernas', pern, branco); por(CALCADOS.includes(v.cfg.calcado) ? v.cfg.calcado : 'calcado.tenis', pern, branco);
      } else { por('pernas', base, branco); por(CALCADOS.includes(v.cfg.calcado) ? v.cfg.calcado : 'calcado.tenis', base, branco); }
      por(ROUPAS.includes(v.cfg.roupa) ? v.cfg.roupa : 'roupa.camiseta', base, roupa);
      por('cabeca', base, pele);
      por(CABELOS.includes(v.cfg.cabelo) ? v.cfg.cabelo : 'cabelo.curto', base, cab);
      if (M.has(v.cfg.acessorio)) por(v.cfg.acessorio, base, branco);
      // braços: pivô no ombro
      const largura = v.cfg.roupa === 'roupa.moletom' ? 0.235 : v.cfg.roupa === 'roupa.regata' ? 0.195 : 0.215;
      for (const lado of [-1, 1]) {
        let rz = lado * 0.08, rx = 0;
        if (anim === 'aceno' && lado === 1) { rz = rm ? 2.6 : 2.4 + Math.sin(ta * 10) * 0.35; }
        else if (anim === 'comemorar') { rz = lado * (rm ? 2.7 : 2.5 + Math.sin(ta * 9) * 0.2); }
        else if (anim === 'sentar') { rx = -0.6; }
        else if (!rm) rx = Math.sin(agora * 2.2 + v.fase + lado) * 0.05;
        _l.compose(_p.set(lado * largura, 0.7, 0), _q.setFromEuler(_e.set(rx, 0, rz)), _s.set(1, 1, 1));
        const b = base.clone().multiply(_l);
        por('manga', b, v.cfg.roupa === 'roupa.regata' ? pele : roupa); por('mao', b, pele);
      }
      // anel do teletransporte
      if (TP && (agora - v.chegada < TP || v.saida)) {
        const k = v.saida ? (agora - v.saida) / 0.25 : (agora - v.chegada) / TP;
        _m.compose(_p.set(v.x, 0.01, -v.y), _q.identity(), _s.setScalar(escala * (0.8 + k * 1.4)));
        aneis.setMatrixAt(aneis.count++, _m);
        (aneis.material as T.MeshBasicMaterial).opacity = 0.75 * (1 - k);
      }
    }
    for (const m of M.values()) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    aneis.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    for (const m of M.values()) { m.geometry.dispose(); m.dispose(); }
    aneis.geometry.dispose(); (aneis.material as T.Material).dispose(); mat.dispose();
    raiz.removeFromParent(); vivos.clear();
  }
  return { raiz, definir, animar, passo, dispose, get quantos() { return vivos.size; } };
}
export type Avatares = ReturnType<typeof criarAvatares>;

/** posições dos slots de um destino em volta de uma origem (km). Praça/evento: anéis voltados ao centro;
    estabelecimento: mesas de 4; casa: meia-lua na frente; rua: duas calçadas. Determinístico: slot k → mesma posição. */
export function slotsDoDestino(tipo: string, n: number, o: { x: number; y: number; yaw?: number; raio?: number }) {
  const R = o.raio ?? 1, yaw = o.yaw ?? 0, out: { x: number; y: number; yaw: number }[] = [];
  const rot = (lx: number, ly: number) => { const c = Math.cos(-yaw), s = Math.sin(-yaw); return { x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c }; };
  // yaw do avatar no Three: frente (+z local) aponta para (sin θ, −cos θ) no mapa → olhar para (dx,dy): θ = atan2(dx, −dy)
  const olhar = (p: { x: number; y: number }, alvo: { x: number; y: number }) => Math.atan2(alvo.x - p.x, -(alvo.y - p.y));
  for (let k = 0; k < n; k++) {
    let p: { x: number; y: number }, alvo = { x: o.x, y: o.y };
    if (tipo === 'venue') { const mesa = Math.floor(k / 4), lug = k % 4, cols = Math.max(1, Math.ceil(Math.sqrt(n / 4))); const mx = ((mesa % cols) - (cols - 1) / 2) * R * 0.7, my = (Math.floor(mesa / cols) - (Math.ceil(n / 4 / cols) - 1) / 2) * R * 0.7; const a = lug * Math.PI / 2 + Math.PI / 4; const c = rot(mx, my); p = rot(mx + Math.cos(a) * R * 0.18, my + Math.sin(a) * R * 0.18); alvo = c; }
    else if (tipo === 'house') { const a = Math.PI * (0.15 + 0.7 * (n === 1 ? 0.5 : k / (n - 1))); p = rot(Math.cos(a) * R * 0.6, -Math.sin(a) * R * 0.6 - R * 0.3); alvo = rot(0, -R * 0.3); }
    else if (tipo === 'street') { const lado = k % 2 ? 1 : -1, i = Math.floor(k / 2), m = Math.ceil(n / 2); p = rot(((i - (m - 1) / 2) / Math.max(1, m)) * R * 2, lado * R * 0.18); alvo = rot(((i - (m - 1) / 2) / Math.max(1, m)) * R * 2, 0); }
    else { let anelI = 0, primeiro = 0, cap = 8; while (k >= primeiro + cap) { primeiro += cap; anelI++; cap = 8 + anelI * 6; } const a = ((k - primeiro) / cap) * Math.PI * 2 + anelI * 0.4; const r = R * (0.35 + anelI * 0.22); p = rot(Math.cos(a) * r, Math.sin(a) * r); }
    out.push({ x: p.x, y: p.y, yaw: olhar(p, alvo) });
  }
  return out;
}

/** prévia isolada (editor de avatar): cena própria, luz e tone mapping iguais aos do mapa. Devolve controle + dispose. */
export function criarPreviaAvatar(canvas: HTMLCanvasElement, config: ConfigAvatar) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new T.Scene();
  scene.add(new T.HemisphereLight('#f3f5ff', '#c6d79c', 1.9));
  const sol = new T.DirectionalLight('#ffe6c6', 1.7); sol.position.set(-0.62, 0.56, 0.6).multiplyScalar(10); scene.add(sol);
  const chao = new T.Mesh(new T.CircleGeometry(0.42, 28).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({ color: A('#97cc72'), roughness: 1, flatShading: true }));
  scene.add(chao);
  const cam = new T.PerspectiveCamera(30, 1, 0.05, 20); cam.position.set(0, 0.75, 2.6); cam.lookAt(0, 0.52, 0);
  const av = criarAvatares({ escala: 1, maxRender: 1 }); scene.add(av.raiz);
  let cfg = config, giro = 0.35, raf = 0, t0 = performance.now(), vivo = true;
  av.definir([{ id: 'eu', config: cfg, x: 0, y: 0, yaw: giro }]);
  const tam = () => { const w = canvas.clientWidth || 260, h = canvas.clientHeight || 260; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(tam) : null; ro?.observe(canvas); tam();
  const quadro = () => {
    if (!vivo) return;
    if (!canvas.isConnected) { dispose(); return; }
    const t = (performance.now() - t0) / 1000;
    av.passo(t); renderer.render(scene, cam);
    raf = requestAnimationFrame(quadro);
  };
  raf = requestAnimationFrame(quadro);
  function dispose() { vivo = false; cancelAnimationFrame(raf); ro?.disconnect(); av.dispose(); chao.geometry.dispose(); (chao.material as T.Material).dispose(); renderer.dispose(); }
  return {
    definir(c: ConfigAvatar) { cfg = c; av.definir([{ id: 'eu', config: cfg, x: 0, y: 0, yaw: giro }]); },
    girar(d: number) { giro += d; av.definir([{ id: 'eu', config: cfg, x: 0, y: 0, yaw: giro }]); },
    animar(a: Animacao) { av.animar('eu', a); },
    dispose,
  };
}

