/* Fitas (ribbons) no chão com largura mínima em PIXELS: costa, rios, divisas, ruas.
   Cada ponto da polilinha vira 2 vértices; o vertex shader abre a fita para max(meia-largura em km, N px · km/px). */
import * as T from 'three';

export type Pt = [number, number];
export type Linha = { pts: Pt[]; hw: number; fechada?: boolean };

/** uPx = km por pixel a 1 km de distância (atualizado pelo mundo a cada quadro). Compartilhado por todas as fitas. */
export const UPX = { value: 0.001 };

export function fitaGeo(linhas: Linha[], y = 0) {
  const pos: number[] = [], nrm: number[] = [], side: number[] = [], w: number[] = [], u: number[] = [], idx: number[] = [];
  let base = 0;
  for (const L of linhas) {
    let pts = L.pts; if (pts.length < 2) continue;
    if (L.fechada) pts = [...pts, pts[0]];
    const n = pts.length; let acc = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const a = pts[i > 0 ? i - 1 : (L.fechada ? n - 2 : 0)], b = pts[i < n - 1 ? i + 1 : (L.fechada ? 1 : n - 1)];
      // normal média dos dois segmentos com fator de cotovelo (não afina nas curvas)
      let d1x = p[0] - a[0], d1y = p[1] - a[1], d2x = b[0] - p[0], d2y = b[1] - p[1];
      const l1 = Math.hypot(d1x, d1y) || 1, l2 = Math.hypot(d2x, d2y) || 1;
      d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;
      if (i === 0 && !L.fechada) { d1x = d2x; d1y = d2y; }
      if (i === n - 1 && !L.fechada) { d2x = d1x; d2y = d1y; }
      let tx = d1x + d2x, ty = d1y + d2y; const lt = Math.hypot(tx, ty) || 1; tx /= lt; ty /= lt;
      const cosT = d1x * d2x + d1y * d2y, m = Math.min(2, Math.max(1, 1 / Math.max(0.5, Math.sqrt((1 + cosT) / 2))));
      const nx = -ty * m, ny = tx * m;
      if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      for (const s of [-1, 1]) { pos.push(p[0], y, -p[1]); nrm.push(nx, ny); side.push(s); w.push(L.hw); u.push(acc); }
      if (i < n - 1) { const k = base + i * 2; idx.push(k, k + 1, k + 3, k, k + 3, k + 2); }
    }
    base += n * 2;
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('aN', new T.Float32BufferAttribute(nrm, 2));
  g.setAttribute('aSide', new T.Float32BufferAttribute(side, 1));
  g.setAttribute('aW', new T.Float32BufferAttribute(w, 1));
  g.setAttribute('aU', new T.Float32BufferAttribute(u, 1));
  g.setIndex(base > 65535 ? new T.Uint32BufferAttribute(idx, 1) : new T.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += 50;
  return g;
}

export type FitaOpts = { cor: string; alpha?: number; minPx?: number; lift?: number; tracejado?: number; tracejadoPx?: number; fadePx?: number };

export function fitaMat(o: FitaOpts) {
  return new T.ShaderMaterial({
    uniforms: {
      uColor: { value: new T.Color(o.cor) }, uAlpha: { value: o.alpha ?? 1 }, uMinPx: { value: o.minPx ?? 2 },
      uPx: UPX, uLift: { value: o.lift ?? 0.0003 }, uDash: { value: o.tracejado ?? 0 }, uDashPx: { value: o.tracejadoPx ?? 0 }, uFadePx: { value: o.fadePx ?? 0 },
    },
    vertexShader: `
      attribute vec2 aN; attribute float aSide; attribute float aW; attribute float aU;
      uniform float uMinPx, uPx, uLift; varying float vU; varying float vPx; varying float vKm;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float d = distance(cameraPosition, wp.xyz);
        float px = uPx * d;                       // km por pixel neste ponto
        float hw = max(aW, uMinPx * 0.5 * px);
        wp.x += aN.x * aSide * hw; wp.z -= aN.y * aSide * hw;
        wp.y += d * uLift;
        vU = aU; vPx = (aW * 2.0) / px; vKm = px;          // largura real em px (para o fade)
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha, uDash, uDashPx, uFadePx; varying float vU; varying float vPx; varying float vKm;
      void main(){
        if (uDash > 0.0 && fract(vU / uDash) > 0.5) discard;
        if (uDashPx > 0.0 && fract(vU / (vKm * uDashPx)) > 0.55) discard;
        float a = uAlpha;
        if (uFadePx > 0.0) a *= smoothstep(uFadePx * 0.5, uFadePx, vPx);
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false,
  });
}

export function fita(linhas: Linha[], o: FitaOpts, ordem: number, y = 0) {
  const m = new T.Mesh(fitaGeo(linhas, y), fitaMat(o));
  m.renderOrder = ordem; m.frustumCulled = false;
  return m;
}
