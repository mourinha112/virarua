/* Modo filme (?filme): o jogo vira uma "placa" de vídeo determinística para o video-studio.
   Sem HUD, sem laço próprio: quem manda é o filme, quadro a quadro, por window.__filme.quadro(estado, t). */
import type { Mundo } from './mundo/mundo';
import type { Alvo } from './mundo/camera';

export function ativarFilme(mundo: Mundo, app: Promise<unknown>) {
  document.documentElement.classList.add('filme');
  const w = window as any;
  const api = {
    pronto: app.then(() => { mundo.parar(); }),
    /** estado de câmera que enquadra o Brasil inteiro (mesmo cálculo do botão "Brasil") */
    brasil(): Alvo {
      const cam = mundo.camera, [x0, y0, x1, y1] = cam.box, phi = 64;
      return { fx: (x0 + x1) / 2, fy: (y0 + y1) / 2 - 230, ld: Math.log(cam.dFit(phi)), phi, psi: 0 };
    },
    /** cidade + casas (posição real do layout) para a coreografia */
    cidade(ibge: number) {
      const { dados } = w.ctx, c = dados.POR_IBGE.get(ibge); if (!c) return null;
      const L = w.__cid3d.layout(ibge);
      const casas = Array.from({ length: c.n }, (_, k) => ({ gi: c.ini + k, handle: dados.USR[c.ini + k], ...(w.__cid3d.posicaoCasa(c.ini + k) || { x: c.x, y: c.y }) }));
      return { ibge, nome: c.nome, uf: c.uf, x: L ? L.cx : c.x, y: L ? L.cy : c.y, raio: L ? L.raio : 4, casas };
    },
    /** congela a cidade e as vizinhas construídas, para o quadro não depender do caminho da câmera */
    fixar(ibge: number, n = 12) { const c = w.ctx.dados.POR_IBGE.get(ibge); w.__cid3d.fixar(c ? w.__cid3d.vizinhasDe(c, n) : null); },
    quadro(st: Alvo, t: number, fps = 30) { mundo.filmar(st, t, fps); },
    projetar(x: number, y: number, alt = 0) { return mundo.camera.projetar(x, y, alt); },
  };
  w.__filme = api;
  return api;
}
