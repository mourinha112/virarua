/* votacao@1 — disputa apertada: escopo, diferença real de votos agregados, prazo, selo "placar parcial".
   Sem barras inventadas: só a diferença publicável. Nomes só de quem autorizou aparecer. */
SMN.montar('votacao', {
  evidencia(I, F, a) {
    const el = a.h('div'); el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.alignItems = 'center'; el.style.gap = '22px';
    const t0 = a.P.evidencia[0], perfis = I.permitted_public_profiles;
    const nome = (i) => (perfis[i] ? perfis[i].nome_publico : (i === 0 ? '1º lugar' : '2º lugar'));
    const p1 = a.h('div', 'pilula', nome(0)), p2 = a.h('div', 'pilula', nome(1));
    p1.style.fontSize = p2.style.fontSize = '48px'; p1.style.background = '#ffd23f';
    F.trilha(p1, 'x', [[t0, -800], [t0 + 0.4, 0, 'whip']]).trilha(p2, 'x', [[t0 + 0.15, 800], [t0 + 0.55, 0, 'whip']]);
    const c = a.h('div', 'cartao'); c.style.textAlign = 'center';
    const n = a.h('div', 'numero', '0'); c.append(n, a.h('div', 'rotulo', 'votos de diferença'));
    a.contador(n, 0, Number(a.metrica('diferenca_votos')), t0 + 0.6, t0 + 1.6);
    const info = a.h('div', 'pilula', `${a.fmt(a.metrica('candidaturas'))} candidaturas · fecha ${a.dataHora(a.metrica('prazo'), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`);
    info.style.fontSize = '32px';
    el.append(p1, c, p2, info);
    return { el, top: 300 };
  },
});
