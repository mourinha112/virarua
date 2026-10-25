/* Marcadores de cidade: pontos em tamanho de tela (px). Branco = cidade com casas; amarelo com casinha = cidade grande
   ou selecionada. Somem suavemente quando a cidade 3D aparece de perto. */
import * as T from 'three';

export type ItemMarcador = { x: number; y: number; n: number; amarelo: boolean };

export function raioMarcadorPx(n: number) { return Math.max(3, Math.min(11, 2.6 + 0.5 * Math.sqrt(n))); }

export function criarMarcadores(renderer: T.WebGLRenderer) {
  const mat = new T.ShaderMaterial({
    uniforms: { uDpr: { value: renderer.getPixelRatio() }, uAlpha: { value: 1 }, uEsc: { value: 1 }, uK: { value: 1e9 } },
    vertexShader: `
      attribute float aR; attribute float aTipo; attribute float aOn; attribute float aRank;
      uniform float uDpr, uEsc, uK; varying float vTipo; varying float vOn;
      void main(){
        vTipo = aTipo; vOn = aOn * ((aTipo > 0.5 || aRank < uK) ? 1.0 : 0.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float r = aTipo > 0.5 ? max(aR, 8.0) : aR;
        if (vOn < 0.5) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        gl_PointSize = (r * 2.0 + 3.0) * uDpr * uEsc;
      }`,
    fragmentShader: `
      uniform float uAlpha; varying float vTipo; varying float vOn;
      float box(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
      void main(){
        vec2 q = gl_PointCoord * 2.0 - 1.0; q.y = -q.y;
        float d = length(q);
        float aa = fwidth(d) * 1.2;
        if (d > 1.0) discard;
        vec3 ink = vec3(0.118, 0.141, 0.188);
        vec3 c;
        if (vTipo > 0.5) {
          vec3 am = vec3(1.0, 0.824, 0.247);
          c = mix(am, ink, smoothstep(0.78 - aa, 0.78, d));
          // casinha: corpo + telhado
          vec2 p = q * 1.25;
          float corpo = box(p - vec2(0.0, -0.2), vec2(0.34, 0.26));
          float telh = max(abs(p.x) * 0.9 + (p.y - 0.42), -(p.y - 0.02));
          float casa = min(corpo, telh);
          c = mix(c, ink, (1.0 - smoothstep(-aa, aa, casa)) * step(d, 0.78));
          float porta = box(p - vec2(0.0, -0.3), vec2(0.09, 0.16));
          c = mix(c, am, (1.0 - smoothstep(-aa, aa, porta)) * step(d, 0.78));
        } else {
          c = mix(vec3(1.0), ink, smoothstep(0.62 - aa, 0.62, d));
        }
        float a = (1.0 - smoothstep(1.0 - aa, 1.0, d)) * uAlpha * vOn;
        if (a < 0.01) discard;
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
  });
  // cor dos vetores em sRGB "crus": o colorspace_fragment converteria; usamos valores já em linear aproximado
  const pts = new T.Points(new T.BufferGeometry(), mat);
  pts.frustumCulled = false; pts.renderOrder = 30;
  let itens: ItemMarcador[] = [];
  return {
    pts, mat,
    definir(lista: ItemMarcador[]) {
      itens = lista;
      const n = lista.length, pos = new Float32Array(n * 3), r = new Float32Array(n), t = new Float32Array(n), on = new Float32Array(n).fill(1), rk = new Float32Array(n);
      const ordem = lista.map((m, i) => [m.n, i]).sort((a, b) => b[0] - a[0]);
      // amarelos por último (ficam por cima)
      lista.sort((a, b) => Number(a.amarelo) - Number(b.amarelo) || a.n - b.n);
      const pos0 = new Map(lista.map((m, i) => [m, i]));
      lista.forEach((m, i) => { pos[i * 3] = m.x; pos[i * 3 + 1] = 0.6; pos[i * 3 + 2] = -m.y; r[i] = raioMarcadorPx(m.n); t[i] = m.amarelo ? 1 : 0; });
      [...lista].sort((a, b) => b.n - a.n).forEach((m, k) => { rk[pos0.get(m)!] = k; });
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aR', new T.BufferAttribute(r, 1)); g.setAttribute('aTipo', new T.BufferAttribute(t, 1)); g.setAttribute('aOn', new T.BufferAttribute(on, 1)); g.setAttribute('aRank', new T.BufferAttribute(rk, 1));
      pts.geometry.dispose(); pts.geometry = g;
    },
    get itens() { return itens; },
    /** alpha geral (some de perto) e escala (encolhe um pouco quando o Brasil inteiro aparece no celular) */
    passo(dist: number, dpr: number, esc = 1) {
      mat.uniforms.uDpr.value = dpr; mat.uniforms.uEsc.value = esc;
      const a = Math.min(1, Math.max(0, (dist - 60) / 140));
      // quantas cidades mostrar: de longe só as maiores; perto todas
      mat.uniforms.uK.value = dist > 6000 ? 260 : dist > 3500 ? 520 : dist > 2000 ? 1100 : dist > 1000 ? 2600 : 1e9;
      mat.uniforms.uAlpha.value = a; pts.visible = a > 0.01;
    },
  };
}
