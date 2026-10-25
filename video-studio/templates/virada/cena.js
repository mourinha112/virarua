/* virada@1 — a liderança mudou entre dois snapshots do placar PARCIAL. Nunca anuncia vencedor. */
SMN.montar('virada', {
  evidencia(I, F, a) {
    const el = a.h('div'); el.style.position = 'relative'; el.style.width = '820px'; el.style.height = '640px';
    const t0 = a.P.evidencia[0], tv = t0 + 0.9, perfis = I.permitted_public_profiles;
    const nome = (i, pad) => (perfis[i] ? perfis[i].nome_publico : pad);
    const a1 = a.h('div', 'pilula', nome(0, 'quem liderava')), a2 = a.h('div', 'pilula', nome(1, 'quem virou'));
    for (const p of [a1, a2]) Object.assign(p.style, { position: 'absolute', left: '50%', fontSize: '50px', whiteSpace: 'nowrap' }), p.dataset.base = 'translateX(-50%)';
    a1.style.top = '0px'; a2.style.top = '150px'; a2.style.background = '#ffd23f';
    // troca de posição: o 2º sobe, o 1º desce (cut no movimento)
    F.trilha(a2, 'y', [[tv, 0], [tv + 0.45, -150, 'whip']]).trilha(a1, 'y', [[tv, 0], [tv + 0.45, 150, 'whip']]);
    F.trilha(a2, 'scale', [[tv + 0.45, 1], [tv + 0.6, 1.12, 'softLand'], [tv + 0.9, 1, 'softInOut']]);
    const seta = a.h('div', 'numero', '↑'); Object.assign(seta.style, { position: 'absolute', left: '40px', top: '20px', fontSize: '160px' });
    F.janela(seta, tv, Infinity).trilha(seta, 'y', [[tv, 120], [tv + 0.4, 0, 'softLand']]);
    const c = a.h('div', 'cartao'); Object.assign(c.style, { position: 'absolute', left: '50%', top: '250px', textAlign: 'center' }); c.dataset.base = 'translateX(-50%)';
    const n = a.h('div', 'numero', '0'); c.append(n, a.h('div', 'rotulo', 'votos de diferença agora'));
    a.contador(n, 0, Number(a.metrica('diferenca_votos')), tv + 0.5, tv + 1.4);
    F.trilha(c, 'opacity', [[tv + 0.4, 0], [tv + 0.55, 1]]);
    el.append(a1, a2, seta, c);
    return { el, top: 390 };
  },
});
