/* Raios de luz ciano saindo de cidades "em alta" (vista de longe), como colunas finas que somem para o alto. */
import * as T from 'three';

export function criarRaios(cidades: { x: number; y: number }[]) {
  const geo = new T.CylinderGeometry(1, 1, 1, 8, 1, true); geo.translate(0, 0.5, 0);
  const mat = new T.ShaderMaterial({
    uniforms: { uA: { value: 1 }, uT: { value: 0 } },
    vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uA, uT; varying float vY; void main(){ float a = (1.0 - vY) * (1.0 - vY) * uA * (0.75 + 0.25 * sin(uT * 2.0 + vY * 6.0)); gl_FragColor = vec4(0.55, 0.95, 1.0, a * 0.95); }',
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false,
  });
  const mesh = new T.InstancedMesh(geo, mat, Math.max(1, cidades.length)); mesh.frustumCulled = false; mesh.renderOrder = 25;
  const m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3();
  cidades.forEach((c, i) => { const inc = new T.Euler(0.12 * Math.sin(i * 7.1), 0, 0.12 * Math.cos(i * 3.3)); q.setFromEuler(inc); m4.compose(p.set(c.x, 0, -c.y), q, s.set(8, 700 + (i % 5) * 120, 8)); mesh.setMatrixAt(i, m4); });
  mesh.count = cidades.length; mesh.instanceMatrix.needsUpdate = true;
  return { mesh, passo(dist: number, t: number) { const a = Math.min(1, Math.max(0, (dist - 700) / 900)); mat.uniforms.uA.value = a; mat.uniforms.uT.value = t; mesh.visible = a > 0.01; } };
}
