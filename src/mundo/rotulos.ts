/* Rótulos HTML sobre o canvas (estados, cidades, @ das casas), com prioridade e colisão. Pool de divs reaproveitado. */
export type Rotulo = { id: string; x: number; y: number; alt?: number; txt: string; sub?: string; cls: string; pri: number; dy?: number; ic?: string; html?: string; larg?: number };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

type Projetar = (x: number, y: number, alt?: number) => [number, number, boolean];

export function criarRotulos(camada: HTMLElement) {
  const pool = new Map<string, { el: HTMLDivElement; usado: number; txt: string; sub: string }>();
  let quadro = 0;
  const reserva: { x0: number; y0: number; x1: number; y1: number }[] = [];

  function el(id: string, r: Rotulo) {
    let p = pool.get(id);
    if (!p) {
      const d = document.createElement('div'); d.className = 'rt ' + r.cls; d.setAttribute('aria-hidden', 'true');
      camada.append(d); p = { el: d, usado: 0, txt: '', sub: '' }; pool.set(id, p);
      requestAnimationFrame(() => d.classList.add('on'));
    }
    const chaveTxt = r.html ?? r.txt;
    if (p.txt !== chaveTxt || p.sub !== (r.sub || '')) {
      p.el.textContent = '';
      if (r.html) { p.el.innerHTML = r.html; p.txt = chaveTxt; p.sub = r.sub || ''; p.el.className = 'rt on ' + r.cls; return p; }
      const b = document.createElement('b'); if (r.ic) { const i = document.createElement('span'); i.className = 'ic'; i.textContent = r.ic; b.append(i); } b.append(r.txt); p.el.append(b);
      if (r.sub) { const s = document.createElement('i'); s.textContent = r.sub; p.el.append(s); }
      p.txt = chaveTxt; p.sub = r.sub || '';
    }
    p.el.className = 'rt on ' + r.cls;
    return p;
  }

  return {
    /** áreas da tela que os rótulos devem evitar (topo, barra, cartão) */
    reservar(r: { x0: number; y0: number; x1: number; y1: number }[]) { reserva.length = 0; reserva.push(...r); },
    desenhar(lista: Rotulo[], projetar: Projetar, w: number, h: number, max: number) {
      quadro++;
      const ocupados = [...reserva];
      const ord = lista.slice().sort((a, b) => b.pri - a.pri);
      let n = 0;
      for (const r of ord) {
        if (n >= max) break;
        const [px, py0, frente] = projetar(r.x, r.y, r.alt ?? 0); if (!frente) continue;
        const py = py0 + (r.dy ?? 0);
        if (px < -40 || px > w + 40 || py < -20 || py > h + 20) continue;
        const largura = r.larg ?? Math.max(r.txt.length + (r.ic ? 2 : 0), (r.sub || '').length * 0.8) * (r.cls.includes('uf') ? 8 : 7.6) + 12, altura = r.html ? 44 : r.sub ? 34 : 20;
        const caixa = { x0: px - largura / 2, y0: py - altura, x1: px + largura / 2, y1: py };
        if (ocupados.some((o) => caixa.x0 < o.x1 + 4 && caixa.x1 > o.x0 - 4 && caixa.y0 < o.y1 + 3 && caixa.y1 > o.y0 - 3)) continue;
        ocupados.push(caixa); n++;
        const p = el(r.id, r); p.usado = quadro;
        p.el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -100%)`;
      }
      for (const [id, p] of pool) {
        if (p.usado === quadro) continue;
        p.el.classList.remove('on');
        if (quadro - p.usado > 240) { p.el.remove(); pool.delete(id); }
      }
    },
  };
}
