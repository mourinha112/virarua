/* Chuva de baús (todo dia 20h–20h15, Brasília): baús dourados caem nas cidades visíveis, na frente de casas
   sorteadas pelo dia (mesmo sorteio para todo mundo). Toque no baú = +5 XP (o servidor confere janela e limite). */
import * as T from 'three';
import type { LayoutCidade } from './cidade';
type Fonte = { visiveis: { ibge: number }[]; layout: (ibge: number) => LayoutCidade | null };

const mB = new T.MeshStandardMaterial({ color: '#8a5a2b', roughness: 0.7 });
const mO = new T.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.3, metalness: 0.4, emissive: '#7a5a00', emissiveIntensity: 0.5 });
const mL = new T.MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide });
const cx = new T.BoxGeometry(1, 1, 1), luz = new T.CylinderGeometry(0.5, 0.9, 1, 12, 1, true);
function bau() {
  const g = new T.Group(), b = new T.Group(); g.add(b);
  const p = (m: T.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => { const o = new T.Mesh(cx, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.castShadow = true; b.add(o); };
  p(mB, 0.5, 0.3, 0.34, 0, 0.15, 0); p(mB, 0.52, 0.12, 0.36, 0, 0.36, 0);
  p(mO, 0.54, 0.05, 0.05, 0, 0.3, 0.16); p(mO, 0.06, 0.32, 0.37, -0.2, 0.2, 0); p(mO, 0.06, 0.32, 0.37, 0.2, 0.2, 0); p(mO, 0.1, 0.1, 0.04, 0, 0.26, 0.19);
  const l = new T.Mesh(luz, mL); l.scale.set(0.16, 3, 0.16); l.position.y = 1.6; g.add(l);
  b.scale.setScalar(0.6);
  g.userData = { b, l, f: Math.random() * 6 };
  return g;
}
/** sorteio determinístico (mesmo para todos): lotes da cidade no dia */
function sorteio(dia: string, ibge: number, n: number, total: number) {
  let h = 2166136261; for (const ch of dia + ':' + ibge) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const out: number[] = [], usados = new Set<number>();
  for (let k = 0; out.length < Math.min(n, total) && k < n * 8; k++) { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; const i = (h >>> 0) % total; if (!usados.has(i)) { usados.add(i); out.push(i); } }
  return out;
}

export function criarChuva(scene: T.Scene, fonte: Fonte) {
  const raiz = new T.Group(); raiz.name = 'chuva'; scene.add(raiz);
  const vivos = new Map<string, { g: T.Group; ibge: number; idx: number; x: number; y: number; t0: number }>();
  let estado = { ativa: false, dia: '', porCidade: 6 }, pegos = new Set<string>(), sig = '';
  function montar() {
    const quero = new Set<string>();
    if (estado.ativa) for (const c of fonte.visiveis.slice(0, 12)) {
      const L = fonte.layout(c.ibge); if (!L || !L.lotes.length) continue;
      sorteio(estado.dia, c.ibge, estado.porCidade, L.lotes.length).forEach((li, idx) => {
        const k = `${c.ibge}:${idx}`; if (pegos.has(k)) return; quero.add(k);
        if (vivos.has(k)) return;
        const lo = L.lotes[li], x = lo.x + Math.sin(lo.yaw) * 0.95, y = lo.y - Math.cos(lo.yaw) * 0.95;
        const g = bau(); g.position.set(x, 6, -y); g.rotation.y = lo.yaw; raiz.add(g);
        vivos.set(k, { g, ibge: c.ibge, idx, x, y, t0: -1 - idx * 0.25 });
      });
    }
    for (const [k, v] of vivos) if (!quero.has(k)) { raiz.remove(v.g); vivos.delete(k); }
  }
  return {
    raiz,
    definir(e: { ativa: boolean; dia: string; porCidade: number; meus?: string[] }) { estado = e; if (e.meus) pegos = new Set(e.meus); sig = ''; },
    pegou(ibge: number, idx: number) { pegos.add(`${ibge}:${idx}`); sig = ''; },
    passo(agora: number, dist: number) {
      raiz.visible = estado.ativa && dist < 220;
      if (!raiz.visible) return;
      const s = fonte.visiveis.map((c) => c.ibge).join(',') + '|' + pegos.size;
      if (s !== sig) { sig = s; montar(); }
      for (const v of vivos.values()) {
        if (v.t0 < 0) v.t0 = agora - v.t0 - 1;   // começa a cair agora (relógio do mundo), um atrás do outro
        const t = agora - v.t0, u = v.g.userData;
        v.g.position.y = t < 1.2 ? Math.max(0, 6 * (1 - t / 1.2) ** 2) : Math.abs(Math.sin(agora * 3 + u.f)) * 0.12;   // cai do céu e quica
        u.b.rotation.y = Math.sin(agora * 1.5 + u.f) * 0.4;
        u.l.material.opacity = 0.4 + Math.sin(agora * 4 + u.f) * 0.15;
      }
    },
    /** toque perto de um baú (px) → devolve o baú */
    achar(x: number, y: number, proj: (a: number, b: number, h?: number) => [number, number, boolean]) {
      if (!raiz.visible) return null;
      let melhor: { ibge: number; idx: number } | null = null, md = 56;
      for (const v of vivos.values()) { const [px, py, ok] = proj(v.x, v.y, 0.3); const d = Math.hypot(px - x, py - y); if (ok && d < md) { md = d; melhor = { ibge: v.ibge, idx: v.idx }; } }
      return melhor;
    },
    quantos: () => vivos.size,
  };
}
