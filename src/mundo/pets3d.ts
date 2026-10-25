/* Pets das casas (gato ou cachorro) na frente de cada casa, só de perto (mesma distância dos avatares).
   Lê as cidades visíveis e os lotes de cidades3d (layout público) e busca no servidor os pets dessas cidades.
   Peças low-poly com geometria e material compartilhados; rabo abana e o bicho respira. */
import * as T from 'three';
import type { LayoutCidade } from './cidade';
import { petsApi, type PetMapa } from '../api/cliente';

type Fonte = { visiveis: { ibge: number }[]; layout: (ibge: number) => LayoutCidade | null };

const COR: Record<string, [string, string]> = {   // [corpo, detalhe]
  laranja: ['#e8913a', '#f6e3c8'], cinza: ['#9a9ea6', '#d9dbe0'], preto: ['#2b2b30', '#4a4a52'], branco: ['#f3f1ea', '#e2b8b0'], siames: ['#ead9bf', '#5a4636'],
  caramelo: ['#c98a3e', '#f0d2a0'], marrom: ['#6e4a2f', '#a27454'], malhado: ['#f2efe6', '#3b2d24'],
};
const mats = new Map<string, T.MeshStandardMaterial>();
const mat = (h: string) => { let m = mats.get(h); if (!m) { m = new T.MeshStandardMaterial({ color: h, roughness: 0.85 }); mats.set(h, m); } return m; };
const G = {
  caixa: new T.BoxGeometry(1, 1, 1), cil: new T.CylinderGeometry(0.5, 0.5, 1, 8), cone: new T.ConeGeometry(0.5, 1, 4), bola: new T.SphereGeometry(0.5, 10, 8),
};
function peca(geo: T.BufferGeometry, cor: string, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const m = new T.Mesh(geo, mat(cor)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; return m;
}

/** modelo em unidades "de bicho" (~1 = comprimento do corpo), olhando para +z */
export function criarPet(especie: string, cor: string): T.Group {
  const [c1, c2] = COR[cor] || COR.caramelo, olho = '#1b1b1f', nariz = especie === 'gato' ? '#e58a9a' : '#1b1b1f';
  const g = new T.Group(), corpo = new T.Group(); g.add(corpo);
  const gato = especie === 'gato';
  const L = gato ? 0.85 : 1, A = gato ? 0.42 : 0.5, P = gato ? 0.38 : 0.46;   // comprimento, altura e largura do corpo
  const perna = gato ? 0.36 : 0.4;
  corpo.add(peca(G.caixa, c1, P, A, L, 0, perna + A / 2, 0));
  if (cor === 'malhado' || cor === 'siames') corpo.add(peca(G.caixa, c2, P * 1.02, A * 0.5, L * 0.35, 0, perna + A * 0.8, -L * 0.1));
  else corpo.add(peca(G.caixa, c2, P * 0.8, A * 0.3, L * 0.6, 0, perna + 0.04, 0.05));   // barriga clara
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) corpo.add(peca(G.cil, cor === 'siames' ? c2 : c1, 0.13, perna, 0.13, sx * P * 0.32, perna / 2, sz * L * 0.36));
  // cabeça
  const cab = new T.Group(); cab.position.set(0, perna + A * (gato ? 1.05 : 1.15), L / 2 + (gato ? 0.12 : 0.16)); corpo.add(cab);
  const H = gato ? 0.46 : 0.52;
  cab.add(peca(G.caixa, cor === 'siames' ? c2 : c1, H, H * 0.9, H * 0.85, 0, 0, 0));
  if (gato) {
    for (const s of [-1, 1]) { const o = peca(G.cone, cor === 'siames' ? c2 : c1, 0.16, 0.24, 0.1, s * H * 0.3, H * 0.55, -0.02); o.rotation.y = Math.PI / 4; cab.add(o); }
    cab.add(peca(G.caixa, c2 === '#5a4636' ? c1 : c2, H * 0.5, H * 0.32, 0.06, 0, -H * 0.18, H * 0.44));
  } else {
    cab.add(peca(G.caixa, c2, H * 0.55, H * 0.42, 0.26, 0, -H * 0.2, H * 0.5));   // focinho
    for (const s of [-1, 1]) { const o = peca(G.caixa, cor === 'branco' ? '#c9a27a' : cor === 'malhado' ? c2 : c1, 0.12, 0.3, 0.2, s * H * 0.55, H * 0.1, -0.02); o.rotation.z = s * 0.25; cab.add(o); }
  }
  cab.add(peca(G.bola, nariz, 0.09, 0.07, 0.07, 0, gato ? -H * 0.08 : -H * 0.05, gato ? H * 0.47 : H * 0.64));
  for (const s of [-1, 1]) cab.add(peca(G.bola, olho, 0.08, 0.09, 0.05, s * H * 0.22, H * 0.12, H * 0.43));
  // rabo: pivô na traseira
  const rabo = new T.Group(); rabo.position.set(0, perna + A * 0.8, -L / 2); corpo.add(rabo);
  const tl = gato ? 0.62 : 0.34, tr = peca(G.cil, cor === 'siames' ? c2 : c1, 0.09, tl, 0.09, 0, tl / 2, 0); rabo.add(tr);
  rabo.rotation.x = gato ? -0.25 : -0.7;
  g.userData = { rabo, corpo, cab, gato, fase: Math.random() * 6.28 };
  return g;
}

export function criarPets(scene: T.Scene, fonte: Fonte) {
  const raiz = new T.Group(); raiz.name = 'pets'; scene.add(raiz);
  const cache = new Map<number, { em: number; pets: PetMapa[] }>();
  const vivos = new Map<string, T.Group>();
  let sig = '', ultima = 0, buscando = false, sujo = true;

  async function buscar(ibges: number[]) {
    const falta = ibges.filter((i) => { const c = cache.get(i); return !c || performance.now() - c.em > 90_000; });
    if (!falta.length || buscando) return;
    buscando = true;
    const r = await petsApi.daCidade(falta.slice(0, 30)).catch(() => null);
    buscando = false;
    if (!r || !r.ok) { for (const i of falta) cache.set(i, { em: performance.now(), pets: cache.get(i)?.pets || [] }); return; }
    for (const i of falta.slice(0, 30)) cache.set(i, { em: performance.now(), pets: r.pets.filter((p) => p.ibge === i) });
    sujo = true;
  }

  function montar() {
    sujo = false;
    const quero = new Set<string>();
    for (const c of fonte.visiveis) {
      const L = fonte.layout(c.ibge); const lista = cache.get(c.ibge)?.pets; if (!L || !lista) continue;
      for (const p of lista) {
        const lo = L.lotes[p.lote]; if (!lo) continue;
        const k = `${p.ibge}:${p.lote}:${p.especie}:${p.cor}`; quero.add(k);
        let g = vivos.get(k);
        if (!g) { g = criarPet(p.especie, p.cor); g.scale.setScalar(0.16); vivos.set(k, g); raiz.add(g); }
        // na frente da casa, um pouco para o lado (o dono fica no meio)
        const fx = Math.sin(lo.yaw), fy = -Math.cos(lo.yaw), sx = Math.cos(lo.yaw), sy = Math.sin(lo.yaw);
        g.position.set(lo.x + fx * 0.62 + sx * 0.3, 0, -(lo.y + fy * 0.62 + sy * 0.3));
        g.rotation.y = lo.yaw + 0.5; g.userData.yaw0 = g.rotation.y;
      }
    }
    for (const [k, g] of vivos) if (!quero.has(k)) { raiz.remove(g); vivos.delete(k); }
  }

  return {
    raiz,
    passo(agora: number, dist: number) {
      raiz.visible = dist < 120;
      if (!raiz.visible) return;
      const s = fonte.visiveis.map((c) => c.ibge).join(',');
      if (s !== sig || agora - ultima > 30) { sig = s; ultima = agora; sujo = true; void buscar(fonte.visiveis.map((c) => c.ibge)); }
      if (sujo) montar();
      for (const g of vivos.values()) {
        const u = g.userData, t = agora + u.fase;
        u.rabo.rotation.z = Math.sin(t * (u.gato ? 2.2 : 9)) * (u.gato ? 0.35 : 0.55);
        u.corpo.scale.y = 1 + Math.sin(t * 2.4) * 0.025;
        u.cab.rotation.y = Math.sin(t * 0.45) * 0.5;
      }
    },
    /** depois de adotar/trocar: esquece o cache da cidade para buscar de novo */
    recarregar(ibge?: number) { if (ibge) cache.delete(ibge); else cache.clear(); ultima = 0; },
  };
}
