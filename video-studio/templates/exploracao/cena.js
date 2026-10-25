/* exploracao@1 — o mapa cresceu: cidades com casas e visitas da semana (números do snapshot) */
SMN.montar('exploracao', {
  evidencia(I, F, a) {
    const el = a.h('div'); el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.alignItems = 'center'; el.style.gap = '26px';
    const t0 = a.P.evidencia[0];
    const c1 = a.h('div', 'cartao'); c1.style.textAlign = 'center';
    const n1 = a.h('div', 'numero', '0'); c1.append(n1, a.h('div', 'rotulo', 'cidades com casas'));
    a.contador(n1, 0, Number(a.metrica('cidades_com_casas')), t0 + 0.1, t0 + 1.4);
    const c2 = a.h('div', 'pilula'); const n2 = a.h('span', null, '0'); c2.append(n2, a.h('span', null, ' visitas nesta semana'));
    a.contador(n2, 0, Number(a.metrica('visitas_semana')), t0 + 0.8, t0 + 2.0);
    F.trilha(c2, 'x', [[t0 + 0.7, 700], [t0 + 1.0, 0, 'whip']]);
    el.append(c1, c2);
    return { el, top: 380 };
  },
});
