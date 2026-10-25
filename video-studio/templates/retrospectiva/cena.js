/* retrospectiva@1 — o que a cidade/o país construiu: três números reais em sequência (um herói por vez) */
SMN.montar('retrospectiva', {
  evidencia(I, F, a) {
    const el = a.h('div'); el.style.position = 'relative'; el.style.width = '820px'; el.style.height = '700px';
    const [t0, t1] = a.P.evidencia, passo = (t1 - t0) / 3;
    [['casas_reivindicadas', 'casas reivindicadas', '#ffd23f'], ['ruas_ativas', 'ruas ativas', '#4fb7f0'], ['obras_concluidas', 'obras concluídas', '#78ad54']].forEach(([k, rot, cor], i) => {
      const c = a.h('div', 'cartao'); Object.assign(c.style, { position: 'absolute', left: '50%', top: '80px', textAlign: 'center', background: cor, minWidth: '600px' }); c.dataset.base = 'translateX(-50%)';
      const n = a.h('div', 'numero', '0'); c.append(n, a.h('div', 'rotulo', rot));
      const em = t0 + i * passo, ate = i === 2 ? Infinity : em + passo;
      F.janela(c, em, ate).trilha(c, 'x', [[em, 820], [em + 0.35, 0, 'whip'], ...(ate !== Infinity ? [[ate - 0.25, 0], [ate, -820, 'accelExit']] : [])]);
      a.contador(n, 0, Number(a.metrica(k)), em + 0.2, em + Math.min(1.2, passo - 0.3));
      el.appendChild(c);
    });
    return { el, top: 330 };
  },
});
