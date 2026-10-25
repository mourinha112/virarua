/* runtime.js — runtime de cena seek-safe do Seu Mundo Novo (sem dependências, sem GSAP).
 *
 * CONTRATO DE SEEK (o mesmo de motionmaxxing/scripts/render.mjs, para os templates rodarem nos dois renderers):
 *   window.__duration  = duração em segundos
 *   window.__seek(t)   = desenha o quadro do instante t (função pura de t: pular para t == tocar até t)
 *   window.__ready     = Promise resolvida quando fontes e imagens carregaram
 * Nenhum relógio real: nada de Date.now(), requestAnimationFrame, CSS animation/transition. O renderer controla o tempo.
 *
 * As 12 curvas de easing abaixo foram copiadas de Motionmaxxing (runtime/motion.js, commit 8c8ec0f, Apache-2.0,
 * © Tejas Makwana) — curvas medidas quadro a quadro em 53 filmes profissionais. Ver video-studio/NOTICE.
 */
(function (root) {
  'use strict';
  const powerOut = (p) => (t) => 1 - Math.pow(1 - t, p);
  const powerIn = (p) => (t) => Math.pow(t, p);
  const expoOut = (k) => { const d = 1 - Math.exp(-k); return (t) => (1 - Math.exp(-k * t)) / d; };
  const snapRamp = (w, tau) => { const n = w * (1 - Math.exp(-1 / tau)) + (1 - w); return (t) => (w * (1 - Math.exp(-t / tau)) + (1 - w) * t) / n; };
  const snapOver = (A, ta, td) => { const f = (t) => (1 + A * Math.exp(-t / td)) * (1 - Math.exp(-t / ta)); const n = f(1); return (t) => f(t) / n; };
  const spring = (c, om) => { const f = (t) => 1 - Math.exp(-c * t) * (Math.cos(om * t) + (c / om) * Math.sin(om * t)); const n = f(1); return (t) => f(t) / n; };
  const smoothP = (p) => (t) => { const a = Math.pow(t, p), b = Math.pow(1 - t, p); return a / (a + b); };
  const guard = (f) => (t) => (t <= 0 ? 0 : t >= 1 ? 1 : f(t));
  const EASE = {
    crashIn: guard(snapOver(2.0, 0.19, 0.218)), popOver: guard(spring(2.67, 4.36)), bounceHard: guard(spring(1.34, 5.07)),
    snapSettle: guard(snapRamp(0.942, 0.118)), softLand: guard(expoOut(3.41)), whip: guard(powerOut(2.52)), glide: guard(powerOut(1.7)),
    cruise: guard((t) => t), softInOut: guard(smoothP(1.42)), gentleIn: guard(powerIn(2.07)), accelExit: guard(powerIn(2.6)), crashOut: guard(powerIn(3.97)),
  };
  const E = (e) => (typeof e === 'function' ? e : EASE[e] || EASE.cruise);

  const PADRAO = { x: 0, y: 0, scale: 1, rot: 0, opacity: 1, blur: 0 };

  /** valor de uma trilha em t. keys: [[t, valor, ease?]] — ease pertence ao segmento que TERMINA naquela chave */
  function valor(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1, ez] = keys[i];
      if (t <= t1) { const [t0, v0] = keys[i - 1]; const p = t1 === t0 ? 1 : (t - t0) / (t1 - t0); return v0 + (v1 - v0) * E(ez)(p); }
    }
    return keys[keys.length - 1][1];
  }

  function filme(opts) {
    const dur = opts.duracao, fps = opts.fps || 30;
    const els = new Map();       // el → {trilhas: {prop: keys}, janelas: [[t0,t1]]}
    const rend = [];             // renderizadores (t) => void
    const ent = (el) => { if (!els.has(el)) els.set(el, { trilhas: {}, janelas: null }); return els.get(el); };
    const F = {
      dur, fps,
      /** anima propriedade (x, y, scale, rot, opacity, blur) por chaves em segundos */
      trilha(el, prop, keys) { const k = keys.slice().sort((a, b) => a[0] - b[0]); ent(el).trilhas[prop] = k; return F; },
      /** visível só dentro de [t0, t1) (corte seco: corta no movimento, não no repouso) */
      janela(el, t0, t1 = Infinity) { const e = ent(el); (e.janelas || (e.janelas = [])).push([t0, t1]); return F; },
      /** elemento numa janela [em, ate): chega desacelerando de maior que o natural (nada cresce do zero) e sai
          acelerando (medido: pousar desacelera, sair acelera). ate = Infinity → fica até o fim. */
      cena(el, em, ate = Infinity, o = {}) {
        const fe = (o.quadrosEntra || 12) / fps, fs = (o.quadrosSai || 9) / fps;
        const de = o.de || { scale: 1.45 }, para = o.para || { y: -160 };
        const props = new Set([...Object.keys(de), ...Object.keys(para), 'opacity']);
        for (const p of props) {
          const ks = [[em, p === 'opacity' ? 0 : (de[p] ?? PADRAO[p])], [em + (p === 'opacity' ? Math.min(fe, 5 / fps) : fe), PADRAO[p], p === 'opacity' ? 'cruise' : (o.ease || 'softLand')]];
          if (ate !== Infinity) ks.push([ate - fs, PADRAO[p]], [ate, p === 'opacity' ? (o.someNoFim ? 0 : 1) : (para[p] ?? PADRAO[p]), 'accelExit']);
          F.trilha(el, p, ks);
        }
        return F.janela(el, em, ate);
      },
      render(fn) { rend.push(fn); return F; },
      seek(t) {
        for (const [el, e] of els) {
          if (e.janelas) { const vis = e.janelas.some(([a, b]) => t >= a && t < b); if (el.__disp === undefined) el.__disp = el.style.display; el.style.display = vis ? el.__disp : 'none'; if (!vis) continue; }   // display (não visibility): filho nunca reaparece com o pai fora da janela
          const v = { ...PADRAO };
          for (const [p, ks] of Object.entries(e.trilhas)) v[p] = valor(ks, t);
          const base = el.dataset.base || '';
          el.style.transform = `${base} translate(${v.x}px, ${v.y}px) rotate(${v.rot}deg) scale(${v.scale})`;
          el.style.opacity = String(Math.max(0, Math.min(1, v.opacity)));
          el.style.filter = v.blur > 0.01 ? `blur(${v.blur}px)` : 'none';
        }
        for (const fn of rend) fn(t);
      },
    };
    return F;
  }

  /** tempos das quatro partes (0–2 s consequência, 2–7 s evidência, 7–12 s ação, CTA no fim), escalados pela duração */
  function partes(D) {
    const cta = D - (D >= 15 ? 3 : D >= 12 ? 2.5 : 2);
    const acao = Math.round((2 + (cta - 2) * 0.5) * 30) / 30;
    return { gancho: [0, 2], evidencia: [2, acao], acao: [acao, cta], cta: [cta, D] };
  }

  /** carrega fontes e imagens antes do primeiro quadro */
  function pronto() {
    const imgs = [...document.images].map((i) => (i.complete ? (i.decode ? i.decode().catch(() => {}) : 0) : new Promise((r) => { i.onload = i.onerror = r; })));
    return Promise.all([document.fonts ? document.fonts.ready : 0, ...imgs]).then(() => {
      const fontes = document.fonts ? { titulo: document.fonts.check('80px "Lilita One"'), texto: document.fonts.check('900 40px "Nunito"') } : {};
      root.__fontes = fontes; return fontes;
    });
  }

  root.SMN = Object.assign(root.SMN || {}, { ease: EASE, filme, partes, valor, pronto });
})(window);
