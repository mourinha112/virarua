/* Nuvens: sprites de "bolinhas" pintadas em canvas, vento lento, sombra projetada no chão (uniforms uCl do chão). */
import * as T from 'three';
import { SUN_DIR } from './cores';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function texPuff() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  const bolas = [[60, 80, 38], [100, 62, 46], [148, 58, 50], [192, 74, 40], [128, 86, 44], [84, 92, 32], [172, 92, 34], [38, 96, 24], [218, 96, 24]];
  for (const [x, y, r] of bolas) {
    const gr = g.createRadialGradient(x, y - r * 0.3, r * 0.2, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.75, 'rgba(245,249,255,0.98)'); gr.addColorStop(1, 'rgba(220,232,245,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // base levemente azulada
  g.globalCompositeOperation = 'source-atop'; const lg = g.createLinearGradient(0, 60, 0, 128); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(190,210,235,0.55)'); g.fillStyle = lg; g.fillRect(0, 0, 256, 128);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}

export function criarNuvens(scene: T.Scene, uCl: { value: T.Vector4[] }, n = 8) {
  const tex = texPuff();
  const r = rng(20261014), ALT = 380, ENV = 5600;
  const nuvens: { x: number; x0: number; z: number; v: number; puffs: { s: T.Sprite; ox: number; oz: number; r: number }[] }[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = (r() - 0.5) * 5200; const nu = { x: x0, x0, z: (r() - 0.5) * 5200, v: 3.2 + 2.4 * r(), puffs: [] as any[] };
    for (let j = 0; j < 3; j++) {
      const rad = 70 + 70 * r();
      const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
      s.scale.set(4.2 * rad * 0.5, 2.1 * rad * 0.5, 1); s.renderOrder = 20;
      scene.add(s); nu.puffs.push({ s, ox: (j - 1) * rad * 0.9, oz: (r() - 0.5) * rad * 0.6, r: rad });
    }
    nuvens.push(nu);
  }
  const sombra = new T.Vector2(-SUN_DIR.x / SUN_DIR.y * ALT, -SUN_DIR.z / SUN_DIR.y * ALT);
  return {
    /** posição em função do tempo absoluto (modo filme): sem acumular dt */
    em(t: number, hCam: number) {
      for (const nu of nuvens) nu.x = ((((nu.x0 + nu.v * t) + ENV / 2) % ENV) + ENV) % ENV - ENV / 2;
      this.passo(0, hCam);
    },
    passo(dt: number, hCam: number) {
      const vis = hCam > 450;
      let k = 0;
      for (const nu of nuvens) {
        nu.x += nu.v * dt; if (nu.x > ENV / 2) nu.x -= ENV;
        for (const p of nu.puffs) {
          p.s.visible = vis;
          p.s.position.set(nu.x + p.ox, ALT, nu.z + p.oz);
          (p.s.material as T.SpriteMaterial).opacity = 0.85 * Math.min(1, (hCam - 450) / 400);
          if (k < uCl.value.length) { uCl.value[k].set(nu.x + p.ox + sombra.x, -(nu.z + p.oz + sombra.y), p.r * 0.9, vis ? 0.9 : 0); k++; }
        }
      }
    },
  };
}
