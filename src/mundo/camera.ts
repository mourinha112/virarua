/* Câmera: foco (fx, fy em km), log-distância, inclinação (phi) e rumo (psi), cada um com mola criticamente amortecida. */
import * as T from 'three';

export type Alvo = { fx: number; fy: number; ld: number; phi: number; psi: number };
const DEG = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class Camera {
  cam = new T.PerspectiveCamera(50, 1, 0.5, 60000);
  st: Alvo = { fx: 0, fy: 0, ld: Math.log(9000), phi: 55, psi: 0 };
  alvo: Alvo = { ...this.st };
  vel: Alvo = { fx: 0, fy: 0, ld: 0, phi: 0, psi: 0 };
  lim = { ldMin: Math.log(6), ldMax: Math.log(14000), phiMin: 22, phiMax: 78 };
  box: [number, number, number, number];
  voo = false;
  w = 1; h = 1;
  /** fração da tela ocupada por painéis (0..1) para o "fit" do Brasil não ficar embaixo do cartão */
  margem = { topo: 0, base: 0 };
  constructor(box: [number, number, number, number]) { this.box = box; }

  /** inclinação automática: de cima quando longe, mais deitada quando perto */
  phiAuto(ld: number) { return 36 + 32 * sstep(Math.log(20), Math.log(6000), ld); }

  /** distância em que o Brasil inteiro cabe na área livre */
  dFit(phi = 55) {
    // ajusta a distância projetando os cantos da caixa com a câmera de teste até caber na área livre (2 iterações)
    const [x0, y0, x1, y1] = this.box, W = x1 - x0, H = y1 - y0;
    const fov = this.cam.fov * DEG;
    let d = Math.max(H, W / (this.w / this.h)) / (2 * Math.tan(fov / 2));
    const salvo = { ...this.st };
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const livreT = this.h * this.margem.topo * 0.85, livreB = this.h * this.margem.base * 0.15, livreX = 8;
    for (let it = 0; it < 3; it++) {
      Object.assign(this.st, { fx: cx, fy: cy - 230, ld: Math.log(d), phi, psi: 0 }); this.aplicar(0);
      let mx = 0, my = 0;
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [cx, y0], [cx, y1], [x0, cy], [x1, cy]] as [number, number][]) {
        const [px, py] = this.projetar(x, y, 0);
        const ex = Math.max((livreX - px) / (this.w / 2), (px - (this.w - livreX)) / (this.w / 2));
        const ey = Math.max((livreT - py) / (this.h / 2), (py - (this.h - livreB)) / (this.h / 2));
        mx = Math.max(mx, ex + 1); my = Math.max(my, ey + 1);
      }
      d *= Math.max(mx, my) * 1.02;
    }
    Object.assign(this.st, salvo); this.aplicar(0);
    return d;
  }

  brasil(rapido = false) {
    const [x0, y0, x1, y1] = this.box;
    const phi = 64, d = this.dFit(phi);
    this.voar({ fx: (x0 + x1) / 2, fy: (y0 + y1) / 2 - 230, ld: Math.log(d), phi, psi: 0 }, rapido);
  }

  voar(p: Partial<Alvo>, rapido = false) {
    Object.assign(this.alvo, p);
    this.alvo.ld = clamp(this.alvo.ld, this.lim.ldMin, this.lim.ldMax);
    this.alvo.phi = clamp(this.alvo.phi, this.lim.phiMin, this.lim.phiMax);
    this.voo = true; this.rapido = rapido;
  }
  rapido = false;
  /** mexeu na mão: a mola para de voar e aceita o estado atual como alvo */
  pegar() { this.voo = false; Object.assign(this.alvo, this.st); }

  limitar() {
    const [x0, y0, x1, y1] = this.box, m = 300;
    this.alvo.fx = clamp(this.alvo.fx, x0 - m, x1 + m); this.alvo.fy = clamp(this.alvo.fy, y0 - m, y1 + m);
    this.alvo.ld = clamp(this.alvo.ld, this.lim.ldMin, this.lim.ldMax);
    this.alvo.phi = clamp(this.alvo.phi, this.lim.phiMin, this.lim.phiMax);
  }

  private mola(k: keyof Alvo, dt: number, w: number) {
    // mola criticamente amortecida (ω = w): x'' = -ω² (x - alvo) - 2ω x'
    const x = this.st[k], a = this.alvo[k], v = this.vel[k];
    const nv = (v - w * w * (x - a) * dt) / (1 + 2 * w * dt + w * w * dt * dt);
    this.vel[k] = nv; this.st[k] = x + nv * dt;
  }

  passo(dt: number) {
    this.limitar();
    const w = this.voo ? (this.rapido ? 9 : 4.5) : 14;
    // sub-passos de até 20 ms: se o quadro demorou (aba em segundo plano), a mola avança o tempo real mesmo assim
    let resta = Math.min(1, dt);
    while (resta > 0) { const h = Math.min(0.02, resta); resta -= h; for (const k of ['fx', 'fy', 'ld', 'phi', 'psi'] as (keyof Alvo)[]) this.mola(k, h, w); }
    if (this.voo && Math.abs(this.st.ld - this.alvo.ld) < 0.01 && Math.hypot(this.st.fx - this.alvo.fx, this.st.fy - this.alvo.fy) < 0.5) this.voo = false;
    // "corcova" do voo: sobe um pouco enquanto se desloca para longe
    const rem = Math.hypot(this.alvo.fx - this.st.fx, this.alvo.fy - this.st.fy);
    const hump = this.voo ? Math.min(1.2, rem / Math.max(60, Math.exp(this.st.ld))) : 0;
    this.aplicar(hump);
  }

  aplicar(hump = 0) {
    const d = Math.exp(this.st.ld + hump), phi = this.st.phi * DEG, psi = this.st.psi * DEG;
    const cx = this.st.fx, cz = -this.st.fy;
    const y = d * Math.sin(phi), r = d * Math.cos(phi);
    this.cam.position.set(cx + r * Math.sin(psi), y, cz + r * Math.cos(psi));
    this.cam.lookAt(cx, 0, cz);
    this.cam.near = Math.max(0.3, d * 0.02); this.cam.far = Math.max(3000, d * 6 + 6000);
    this.cam.updateProjectionMatrix();
  }

  dimensionar(w: number, h: number) { this.w = w; this.h = h; this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }

  /** distância atual (km) */
  get dist() { return Math.exp(this.st.ld); }
  /** km por pixel no plano do foco */
  kmPorPx() { return (2 * Math.tan((this.cam.fov * DEG) / 2) * this.dist) / Math.max(1, this.h); }

  /** ponto do chão (km) sob o pixel (cx, cy) */
  private _ray = new T.Raycaster(); private _plano = new T.Plane(new T.Vector3(0, 1, 0), 0); private _hit = new T.Vector3();
  chaoEm(cx: number, cy: number): [number, number] | null {
    this._ray.setFromCamera(new T.Vector2((cx / this.w) * 2 - 1, -(cy / this.h) * 2 + 1), this.cam);
    const p = this._ray.ray.intersectPlane(this._plano, this._hit);
    return p ? [p.x, -p.z] : null;
  }
  private _pv = new T.Vector3();
  /** projeta (x, y km, altura) em pixels */
  projetar(x: number, y: number, alt = 0): [number, number, boolean] {
    this._pv.set(x, alt, -y).project(this.cam);
    return [((this._pv.x + 1) / 2) * this.w, ((1 - this._pv.y) / 2) * this.h, this._pv.z < 1];
  }

  /** zoom com âncora: o ponto do chão sob o cursor fica parado */
  zoomEm(cx: number, cy: number, fator: number) {
    const antes = this.chaoEm(cx, cy);
    this.alvo.ld = clamp(this.alvo.ld + Math.log(fator), this.lim.ldMin, this.lim.ldMax);
    this.alvo.phi = this.phiAuto(this.alvo.ld);
    if (!antes) return;
    // simula o estado alvo para achar o deslocamento de foco que mantém o ponto sob o cursor
    const salvo = { ...this.st }; Object.assign(this.st, { ld: this.alvo.ld, phi: this.alvo.phi });
    this.aplicar(0);
    const depois = this.chaoEm(cx, cy);
    Object.assign(this.st, salvo); this.aplicar(0);
    if (depois) { this.alvo.fx += antes[0] - depois[0]; this.alvo.fy += antes[1] - depois[1]; }
    this.voo = false;
  }
}
