/* Enfeites das casas (horta, bandeira do time, carro, piscina), a 🔥 chama da ofensiva e o Natal no mapa
   (árvore iluminada na praça + pisca-pisca nas casas, de 1/12 a 6/1 ou com ?natal na URL).
   Camada separada de cidades3d: lê só o layout público (lotes, praça) das cidades visíveis. Só de perto. */
import * as T from 'three';
import type { LayoutCidade } from './cidade';
import { CEL } from './cidade';
import { extrasDaCidade } from './obras3d';
import { geoPrefeitura } from './geometrias';
import { crescimentoApi, type EnfeiteMapa } from '../api/crescimento';
type Fonte = { visiveis: { ibge: number }[]; layout: (ibge: number) => LayoutCidade | null };

const mats = new Map<string, T.Material>();
const mat = (h: string, brilho = false) => {
  const k = h + (brilho ? '!' : ''); let m = mats.get(k);
  if (!m) { m = brilho ? new T.MeshBasicMaterial({ color: h }) : new T.MeshStandardMaterial({ color: h, roughness: 0.8 }); mats.set(k, m); }
  return m;
};
const G = { caixa: new T.BoxGeometry(1, 1, 1), cil: new T.CylinderGeometry(0.5, 0.5, 1, 8), cone: new T.ConeGeometry(0.5, 1, 8), bola: new T.SphereGeometry(0.5, 8, 6) };
function p(geo: T.BufferGeometry, cor: string, sx: number, sy: number, sz: number, x: number, y: number, z: number, brilho = false) {
  const m = new T.Mesh(geo, mat(cor, brilho)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); if (!brilho) m.castShadow = true; return m;
}

/* peças em unidades de "lote" (~1 = largura de uma casa térrea); olham para +z (frente da casa) */
function horta() {
  const g = new T.Group(); g.add(p(G.caixa, '#7a4e2d', 0.5, 0.06, 0.36, 0, 0.03, 0));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) g.add(p(G.bola, j ? '#3f9e3a' : '#e8873a', 0.1, 0.09, 0.1, -0.16 + i * 0.16, 0.1, -0.08 + j * 0.16));
  return g;
}
function bandeira(cores: string | null) {
  const [a, b] = (cores || '#e63946-#1b1b1f').split('-');
  const g = new T.Group(); g.add(p(G.cil, '#d9dbe0', 0.03, 0.9, 0.03, 0, 0.45, 0));
  const pano = new T.Group(); pano.position.set(0, 0.78, 0); g.add(pano);
  pano.add(p(G.caixa, a, 0.3, 0.09, 0.01, 0.15, 0.045, 0), p(G.caixa, b, 0.3, 0.09, 0.01, 0.15, -0.045, 0));
  g.userData.pano = pano; return g;
}
function carro() {
  const cores = ['#e63946', '#1d4ed8', '#f4f4f4', '#1b1b1f', '#ffd23f'];
  const g = new T.Group(), cor = cores[Math.floor(Math.random() * cores.length)];
  g.add(p(G.caixa, cor, 0.26, 0.1, 0.46, 0, 0.09, 0), p(G.caixa, cor, 0.22, 0.09, 0.24, 0, 0.18, -0.03), p(G.caixa, '#9fd3f5', 0.23, 0.07, 0.02, 0, 0.18, 0.1));
  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) { const r = p(G.cil, '#222', 0.08, 0.04, 0.08, x * 0.13, 0.04, z * 0.15); r.rotation.z = Math.PI / 2; g.add(r); }
  return g;
}
function piscina() {
  const g = new T.Group(); g.add(p(G.caixa, '#f1efe6', 0.5, 0.05, 0.34, 0, 0.025, 0), p(G.caixa, '#3ab0e8', 0.42, 0.055, 0.26, 0, 0.03, 0));
  g.add(p(G.cil, '#ff5d8f', 0.08, 0.025, 0.08, 0.08, 0.065, 0.03));   // boia
  return g;
}
function chama(nivel: number) {
  const g = new T.Group(); g.add(p(G.cil, '#5b4636', 0.16, 0.07, 0.16, 0, 0.035, 0));
  const fogo = new T.Group(); fogo.position.y = 0.07; g.add(fogo);
  const cores = ['#ffd23f', '#ff8a1f', '#e63946'];
  for (let i = 0; i < 2 + nivel; i++) fogo.add(p(G.cone, cores[i % 3], 0.11 - i * 0.01, 0.2 + nivel * 0.06 - i * 0.03, 0.11 - i * 0.01, (i - 1) * 0.03, 0.1 + i * 0.01, 0, true));
  g.userData.fogo = fogo; return g;
}
function arvoreNatal() {
  const g = new T.Group(); g.add(p(G.cil, '#6e4a2f', 0.12, 0.25, 0.12, 0, 0.12, 0));
  for (let i = 0; i < 3; i++) g.add(p(G.cone, '#1f7a3a', 0.9 - i * 0.24, 0.55, 0.9 - i * 0.24, 0, 0.45 + i * 0.32, 0));
  g.add(p(G.bola, '#ffd23f', 0.16, 0.16, 0.16, 0, 1.38, 0, true));
  const luzes = new T.Group(); g.add(luzes); const cores = ['#e63946', '#ffd23f', '#4fb7f0', '#ffffff'];
  for (let i = 0; i < 18; i++) { const a = i * 2.4, h = 0.35 + (i / 18) * 0.85, r = 0.42 * (1 - (h - 0.3) / 1.1) + 0.05; luzes.add(p(G.bola, cores[i % 4], 0.06, 0.06, 0.06, Math.cos(a) * r, h, Math.sin(a) * r, true)); }
  g.userData.luzes = luzes; return g;
}
function piscaPisca() {
  const g = new T.Group(); const cores = ['#e63946', '#ffd23f', '#4fb7f0', '#78ad54'];
  for (let i = 0; i < 7; i++) g.add(p(G.bola, cores[i % 4], 0.045, 0.045, 0.045, -0.36 + i * 0.12, 0.04 * Math.sin(i * 1.3), 0, true));
  g.userData.luzes = g; return g;
}

let geoPref: T.BufferGeometry | null = null;
const matPref = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
function prefeitura() { const g = new T.Group(); const m = new T.Mesh(geoPref ??= geoPrefeitura(), matPref); m.castShadow = true; g.add(m); return g; }

export const natalAtivo = () => /[?&]natal\b/.test(location.search) || (() => { const d = new Date(Date.now() - 3 * 3600_000).toISOString().slice(5, 10); return d >= '12-01' || d <= '01-06'; })();

/** escala: 1 unidade de peça = ESC km (mesma ordem de grandeza da casa térrea no lote) */
const ESC = 1.0;
/** posição relativa ao lote: f = para a frente da casa, s = para o lado */
const LUGAR: Record<string, [number, number]> = { horta: [-0.5, -0.42], piscina: [-0.5, 0.42], carro: [0.55, -0.42], bandeira: [0.5, 0.5], chama: [0.78, -0.12], pisca: [0.46, 0] };

export function criarEnfeites(scene: T.Scene, fonte: Fonte) {
  const raiz = new T.Group(); raiz.name = 'enfeites'; scene.add(raiz);
  const cache = new Map<number, { em: number; casas: EnfeiteMapa[] }>();
  const vivos = new Map<string, T.Group>();
  const natal = natalAtivo();
  let sig = '', ultima = 0, buscando = false, sujo = true;
  async function buscar(ibges: number[]) {
    const falta = ibges.filter((i) => { const c = cache.get(i); return !c || performance.now() - c.em > 90_000; }).slice(0, 30);
    if (!falta.length || buscando) return;
    buscando = true;
    const r = await crescimentoApi.enfeites(falta).catch(() => null);
    buscando = false;
    for (const i of falta) cache.set(i, { em: performance.now(), casas: r && r.ok ? r.casas.filter((x) => x.ibge === i) : cache.get(i)?.casas || [] });
    sujo = true;
  }
  const por = (lo: { x: number; y: number; yaw: number }, [f, s]: [number, number]) => {
    const fx = Math.sin(lo.yaw), fy = -Math.cos(lo.yaw), sx = Math.cos(lo.yaw), sy = Math.sin(lo.yaw);
    return new T.Vector3(lo.x + (fx * f + sx * s) * ESC, 0, -(lo.y + (fy * f + sy * s) * ESC));
  };
  function colocar(k: string, criar: () => T.Group, pos: T.Vector3, yaw: number, quero: Set<string>) {
    quero.add(k); let g = vivos.get(k);
    if (!g) { g = criar(); g.scale.setScalar(ESC); vivos.set(k, g); raiz.add(g); }
    g.position.copy(pos); g.rotation.y = yaw;
  }
  function montar() {
    sujo = false;
    const quero = new Set<string>();
    for (const c of fonte.visiveis) {
      const L = fonte.layout(c.ibge); if (!L) continue;
      for (const h of cache.get(c.ibge)?.casas || []) {
        const lo = L.lotes[h.lote]; if (!lo) continue;
        for (const it of h.itens) {
          const fab = it === 'horta' ? horta : it === 'carro' ? carro : it === 'piscina' ? piscina : it === 'bandeira' ? () => bandeira(h.bandeira) : null;
          if (fab && LUGAR[it]) colocar(`${c.ibge}:${h.lote}:${it}:${it === 'bandeira' ? h.bandeira : ''}`, fab, por(lo, LUGAR[it]), lo.yaw, quero);
        }
        if (h.chama) colocar(`${c.ibge}:${h.lote}:chama:${h.chama}`, () => chama(h.chama), por(lo, LUGAR.chama), lo.yaw, quero);
      }
      // vila (sem prefeitura no layout): prefeitura própria num terreno livre perto do centro, fora das ruas
      const ex = extrasDaCidade(L);
      if (!L.igreja && L.lotes.length && ex[0]) { colocar(`${c.ibge}:prefeitura`, prefeitura, new T.Vector3(ex[0].x, 0, -ex[0].y), ex[0].yaw, quero); vivos.get(`${c.ibge}:prefeitura`)!.scale.setScalar(CEL * 0.6); }
      if (natal && ex[1]) {
        colocar(`${c.ibge}:natal`, arvoreNatal, new T.Vector3(ex[1].x, 0, -ex[1].y), 0, quero);
        vivos.get(`${c.ibge}:natal`)!.scale.setScalar(CEL * 0.75);
        L.lotes.forEach((lo, i) => { if (i < 80) colocar(`${c.ibge}:${i}:pisca`, piscaPisca, por(lo, LUGAR.pisca).setY(0.62 * ESC), lo.yaw, quero); });
      }
    }
    for (const [k, g] of vivos) if (!quero.has(k)) { raiz.remove(g); vivos.delete(k); }
  }
  return {
    raiz,
    passo(agora: number, dist: number) {
      raiz.visible = dist < 160;
      if (!raiz.visible) return;
      const s = fonte.visiveis.map((c) => c.ibge).join(',');
      if (s !== sig || agora - ultima > 30) { sig = s; ultima = agora; sujo = true; void buscar(fonte.visiveis.map((c) => c.ibge)); }
      if (sujo) montar();
      for (const g of vivos.values()) {
        const u = g.userData;
        if (u.fogo) { u.fogo.scale.y = 1 + Math.sin(agora * 9 + g.id) * 0.15; u.fogo.rotation.y = agora * 1.5; }
        if (u.pano) u.pano.rotation.y = Math.sin(agora * 2.5 + g.id) * 0.35;
        if (u.luzes) u.luzes.children.forEach((l: T.Object3D, i: number) => { l.visible = ((Math.floor(agora * 2) + i) % 3) !== 0; });
      }
    },
    recarregar(ibge?: number) { if (ibge) cache.delete(ibge); else cache.clear(); ultima = 0; },
  };
}
