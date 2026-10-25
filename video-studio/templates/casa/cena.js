/* casa@1 — nascimento da casa: cenário vazio → casa → avatar → instrução de entrada */
SMN.montar('casa', {
  evidencia(I, F, a) {
    const el = a.h('div'); el.innerHTML = a.casaSVG('#e63946');
    const [t0] = a.P.evidencia, svg = el.firstElementChild;
    const chao = svg.querySelector('.chao'), paredes = svg.querySelector('.paredes'), tel = svg.querySelector('.telhado');
    for (const g of [chao, paredes, tel]) g.style.transformBox = 'fill-box', g.style.transformOrigin = '50% 100%';
    F.trilha(chao, 'scale', [[t0, 1.6], [t0 + 0.35, 1, 'softLand']]).trilha(chao, 'opacity', [[t0, 0], [t0 + 0.15, 1]]);
    F.trilha(paredes, 'y', [[t0 + 0.3, 240], [t0 + 0.7, 0, 'snapSettle']]).trilha(paredes, 'opacity', [[t0 + 0.3, 0], [t0 + 0.4, 1]]);
    F.trilha(tel, 'scale', [[t0 + 0.75, 3.2], [t0 + 1.1, 1, 'crashIn']]).trilha(tel, 'opacity', [[t0 + 0.75, 0], [t0 + 0.85, 1]]);
    const n = a.h('div', 'pilula'); const num = a.h('span', null, '0'); n.append(num, a.h('span', null, ' casas reivindicadas'));
    a.contador(num, 0, Number(a.metrica('moradores_reivindicados')), t0 + 1.1, t0 + 2.2);
    el.append(n);
    return { el, top: 300 };
  },
  acao(I, F, a) {
    const el = a.h('div'); el.style.display = 'flex'; el.style.alignItems = 'flex-end'; el.style.gap = '20px';
    const casa = a.h('div'); casa.innerHTML = a.casaSVG('#3a86ff'); casa.firstElementChild.setAttribute('width', '360'); casa.firstElementChild.setAttribute('height', '342');
    const av = a.h('div'); av.innerHTML = a.avatarSVG(I.permitted_public_profiles[0]?.avatar);
    F.trilha(av, 'y', [[a.P.acao[0] + 0.2, 220], [a.P.acao[0] + 0.6, 0, 'softLand']]);
    el.append(casa, av);
    return { el, top: 330 };
  },
});
