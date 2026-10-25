/* Aeroportos: meta coletiva da cidade (libera com META_AEROPORTO casas). Cada aeroporto liberado ganha pista,
   terminal e torre na periferia; aviões voam em arco entre aeroportos, decolando e pousando. Arte própria. */
import * as T from 'three';
import { caixa, cilindro, juntar, placa } from './geometrias';
import { ehTerra } from './terreno';

export const META_AEROPORTO = 400;
type Cid = { ibge: number; nome: string; x: number; y: number; n: number };
export type Aeroporto = { ibge: number; nome: string; x: number; y: number; yaw: number };

const matV = () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });

function geoAeroporto() {
  const P: { pos: number[]; cor: string }[] = [
    { pos: caixa(-6, 0, -1.6, 6, 0.01, 1.6, false), cor: '#9ccf7a' },          // área gramada
    { pos: caixa(-5.5, 0.01, -0.45, 5.5, 0.03, 0.45, false), cor: '#5d6266' },  // pista
    { pos: caixa(-2.5, 0.01, 0.45, 2.5, 0.025, 0.75, false), cor: '#6b7075' },  // taxiway
    { pos: caixa(-2.2, 0.01, 0.75, 2.2, 0.025, 1.4, false), cor: '#8b9096' },   // pátio
    { pos: caixa(-1.6, 0.025, 1.0, 1.6, 0.5, 1.5), cor: '#f4f6f8' },            // terminal
    { pos: placa(-1.5, 0.12, 1.5, 0.4, 0.999), cor: '#7fa8cc' },
    { pos: caixa(-1.7, 0.5, 0.95, 1.7, 0.56, 1.55), cor: '#4f6f94' },
    { pos: cilindro(0.12, 0.12, 1.4, 8, 0.02, 2.3, 1.2), cor: '#e9e4d8' },     // torre
    { pos: cilindro(0.3, 0.26, 0.28, 8, 1.42, 2.3, 1.2), cor: '#5a86b0' },
    { pos: cilindro(0.32, 0.32, 0.05, 8, 1.7, 2.3, 1.2), cor: '#2c3342' },
  ];
  for (let i = -5; i <= 5; i += 0.9) P.push({ pos: caixa(i - 0.25, 0.031, -0.04, i + 0.25, 0.035, 0.04, false), cor: '#ffffff' });
  for (const s of [-1, 1]) P.push({ pos: caixa(s * 5.3 - 0.06, 0.031, -0.4, s * 5.3 + 0.06, 0.035, 0.4, false), cor: '#ffffff' });
  return juntar(P);
}
export function geoAviao() {
  const P = [
    { pos: caixa(-0.75, -0.02, -0.12, 0.75, 0.02, 0.12), cor: '#e9eef4' },      // asas (ao longo de x)
    { pos: caixa(-0.25, 0.0, 0.42, 0.25, 0.03, 0.55), cor: '#e9eef4' },          // estabilizador
    { pos: caixa(-0.02, 0.0, 0.42, 0.02, 0.25, 0.55), cor: '#ffd23f' },          // leme (amarelo, cor do jogo)
  ];
  const fus = new T.CylinderGeometry(0.08, 0.06, 1.1, 8).toNonIndexed(); fus.rotateX(Math.PI / 2);
  return juntar([{ pos: Array.from(fus.attributes.position.array as Float32Array), cor: '#ffffff' }, ...P]);
}

export function criarAeroportos(scene: T.Scene, cidades: Cid[]) {
  const raiz = new T.Group(); raiz.name = 'aeroportos'; scene.add(raiz);
  const lista: Aeroporto[] = [];
  const raio = (n: number) => 1.25 * (Math.sqrt(n / 0.5) * 0.75 + 4);
  const livre = (x: number, y: number, f = 4) => cidades.every((o) => Math.hypot(o.x - x, o.y - y) > raio(o.n) + f);
  for (const c of cidades.filter((x) => x.n >= META_AEROPORTO)) {
    const R0 = raio(c.n) + 9;
    // direção com terra firme para a pista inteira
    let ok: Aeroporto | null = null;
    for (let k = 0; k < 128 && !ok; k++) {
      const R = R0 + Math.floor(k / 16) * 8, a = ((c.ibge % 16) + k) / 16 * Math.PI * 2, x = c.x + Math.cos(a) * R, y = c.y + Math.sin(a) * R;
      const yaw = a + Math.PI / 2, dx = Math.sin(yaw) * 6, dy = -Math.cos(yaw) * 6;
      if (ehTerra(x, y) && ehTerra(x + dx, y + dy) && ehTerra(x - dx, y - dy) && livre(x, y, 5) && livre(x + dx, y + dy, 4) && livre(x - dx, y - dy, 4)) ok = { ibge: c.ibge, nome: c.nome, x, y, yaw };
    }
    if (ok) lista.push(ok);
  }
  const geo = geoAeroporto();
  const inst = new T.InstancedMesh(geo, matV(), Math.max(1, lista.length)); inst.receiveShadow = true; inst.castShadow = true;
  const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(1, 1, 1), p = new T.Vector3();
  lista.forEach((a, i) => { q.setFromAxisAngle(new T.Vector3(0, 1, 0), a.yaw + Math.PI / 2); m.compose(p.set(a.x, 0, -a.y), q, s); inst.setMatrixAt(i, m); });
  inst.count = lista.length; raiz.add(inst);
  // avião estacionado no pátio de cada aeroporto (mesma rotação do aeroporto + deslocamento local)
  const parado = new T.InstancedMesh(geoAviao(), matV(), Math.max(1, lista.length)); parado.castShadow = true;
  const local = new T.Matrix4().makeTranslation(-0.9, 0.14, 1.05).multiply(new T.Matrix4().makeRotationY(Math.PI / 2));
  lista.forEach((a, i) => { q.setFromAxisAngle(new T.Vector3(0, 1, 0), a.yaw + Math.PI / 2); m.compose(p.set(a.x, 0, -a.y), q, s); parado.setMatrixAt(i, m.clone().multiply(local)); });
  parado.count = lista.length; raiz.add(parado);

  // aviões: rotas entre pares de aeroportos (fase: taxi → decola → cruzeiro em arco → pousa)
  const N = Math.min(24, lista.length * 3);
  const avioes = new T.InstancedMesh(geoAviao(), matV(), Math.max(1, N)); avioes.castShadow = true; raiz.add(avioes);
  const rotas = Array.from({ length: N }, (_, i) => { const a = lista[i % lista.length], b = lista[(i * 7 + 3) % lista.length] === a ? lista[(i + 1) % lista.length] : lista[(i * 7 + 3) % lista.length]; return { a, b, dur: 40 + ((i * 13) % 30), t0: i * 5.3 }; });
  return {
    raiz, lista,
    passo(t: number, dist: number) {
      raiz.visible = dist < 4000;
      if (!lista.length) return;
      const esc = Math.max(1, dist * 0.004);
      rotas.forEach((r, i) => {
        if (!r.b || r.a === r.b) { avioes.setMatrixAt(i, m.makeScale(0, 0, 0)); return; }
        const f = ((t + r.t0) % r.dur) / r.dur, d = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
        const x = r.a.x + (r.b.x - r.a.x) * f, y = r.a.y + (r.b.y - r.a.y) * f;
        const alt = Math.sin(Math.PI * f) * Math.min(60, 4 + d * 0.06) + 0.15;
        const yaw = Math.atan2(r.b.x - r.a.x, r.b.y - r.a.y);
        const pitch = Math.cos(Math.PI * f) * 0.25;
        q.setFromEuler(new T.Euler(-pitch, yaw + Math.PI, 0, 'YXZ'));
        m.compose(p.set(x, alt, -y), q, s.set(esc, esc, esc)); avioes.setMatrixAt(i, m);
      });
      avioes.count = N; avioes.instanceMatrix.needsUpdate = true;
      s.set(1, 1, 1);
    },
  };
}
