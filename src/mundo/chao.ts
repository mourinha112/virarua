/* Material do chão: grama que muda com a mata e a secura, grade sutil, pontinhos de mata quando perto,
   tinta por UF quando longe e sombra das nuvens. Injetado num MeshStandardMaterial via onBeforeCompile. */
import * as T from 'three';
import type { MapaMata } from './biomas';
import { TERRENO, COR_UF } from './terreno';

export const NUV_N = 16;

export type Chao = ReturnType<typeof criarMaterialChao>;

export function criarMaterialChao(mata: MapaMata, A: (hex: string) => T.Color) {
  const uni = {
    uDens: { value: mata.tex },
    uBio: { value: mata.texBio }, uBioK: { value: 0.82 },
    uBox: { value: new T.Vector4(mata.box[0], mata.box[1], mata.box[2], mata.box[3]) },
    uGrass: { value: A('#80b75a') }, uGrassDry: { value: A('#9cb85a') }, uGrassDeep: { value: A('#5f9b47') },
    uTree: { value: A('#3f7f3a') }, uGridC: { value: A('#b6e08c') },
    uTint: { value: 0 },
    uUF: { value: (() => { const t = new T.DataTexture(new Uint8Array(32 * 4), 32, 1, T.RGBAFormat); TERRENO.ufs.forEach((u, i) => { const c = A(COR_UF[u.uf] || '#9b9d39'); t.image.data[i * 4] = Math.min(255, c.r * 255); t.image.data[i * 4 + 1] = Math.min(255, c.g * 255); t.image.data[i * 4 + 2] = Math.min(255, c.b * 255); t.image.data[i * 4 + 3] = 255; }); t.needsUpdate = true; t.magFilter = T.NearestFilter; t.minFilter = T.NearestFilter; return t; })() },
    uCl: { value: Array.from({ length: NUV_N }, () => new T.Vector4(0, -1e6, 1, 0)) },
    uTimeG: { value: 0 },
  };
  const mat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp;
        uniform sampler2D uDens; uniform sampler2D uBio; uniform float uBioK; uniform sampler2D uUF; uniform vec4 uBox;
        uniform vec3 uGrass, uGrassDry, uGrassDeep, uTree, uGridC; uniform float uTint, uTimeG;
        uniform vec4 uCl[${NUV_N}];
        float hash3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float gridL(vec2 P, float cel, float px){ vec2 f = abs(fract(P / cel) - 0.5) * cel; float d = min(f.x, f.y); float w = max(px * 0.9, cel * 0.01); return 1.0 - smoothstep(0.0, w, d); }
        float matinha(vec2 P, float cd, float dn){ vec2 c = floor(P / cd); vec2 f = fract(P / cd) - 0.5; float r = hash3(vec3(c, 1.0)); float ok = step(r, dn * 1.25); vec2 o = vec2(hash3(vec3(c, 2.0)), hash3(vec3(c, 3.0))) - 0.5; float rad = 0.15 + 0.14 * hash3(vec3(c, 4.0)); return ok * (1.0 - smoothstep(rad * 0.7, rad, length(f - o * 0.6))); }
        float nuvemSombra(vec2 P){ float s = 0.0; for (int i = 0; i < ${NUV_N}; i++) { vec4 c = uCl[i]; float d = distance(P, c.xy); s = max(s, (1.0 - smoothstep(0.3 * c.z, c.z, d)) * c.w); } return s; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 P = vec2(vWp.x, -vWp.z);
          vec2 uv = (P - uBox.xy) / uBox.zw;
          vec4 dm = texture2D(uDens, uv);
          float dn = dm.r, dr = dm.g;
          vec3 base = mix(uGrass, uGrassDry, 0.45 * dr);
          base = mix(base, uGrassDeep, 0.7 * smoothstep(0.5, 1.0, dn));
          base = mix(base, texture2D(uBio, uv).rgb, uBioK * dm.a);
          float px = max(fwidth(P.x), fwidth(P.y));
          // grade em duas oitavas
          float cA = exp2(floor(log2(max(px * 64.0, 0.001)))); float cB = cA * 2.0;
          float tA = fract(log2(max(px * 64.0, 0.001)));
          float g = mix(gridL(P, cA, px), gridL(P, cB, px), tA) * 0.6 + gridL(P, cB, px) * 0.4;
          base = mix(base, uGridC, 0.17 * g);
          // pontinhos de mata (só quando perto o bastante)
          float vis = smoothstep(0.14, 0.09, px) * smoothstep(0.02, 0.035, px);
          if (vis > 0.0) {
            float cd = 0.02 * exp2(floor(log2(max(px * 250.0, 0.01))));
            float m = max(matinha(P, cd, dn), matinha(P + 13.7, cd * 2.0, dn) * 0.8);
            base = mix(base, uTree, 0.72 * m * vis);
          }
          base *= 1.0 - 0.11 * nuvemSombra(P);
          if (uTint > 0.0) { vec3 cuf = texture2D(uUF, vec2((dm.b * 255.0 / 8.0 + 0.5) / 32.0, 0.5)).rgb; base = mix(base, cuf, uTint * dm.a); }
          diffuseColor.rgb = base;
        }`);
  };
  return { mat, uni };
}
