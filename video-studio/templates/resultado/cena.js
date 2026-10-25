/* resultado@1 — resultado OFICIAL do jogo: apuração concluída, cargo, quem foi eleito, duração do mandato.
   O contrato só aceita election_status = 'oficial' para este template. */
SMN.montar('resultado', {
  evidencia(I, F, a) {
    const el = a.h('div'); el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.alignItems = 'center'; el.style.gap = '24px';
    const t0 = a.P.evidencia[0];
    const medalha = a.h('div'); medalha.innerHTML = '<svg viewBox="0 0 200 220" width="240" height="264" aria-hidden="true"><path d="M60 0h80l-20 70H80Z" fill="#3a86ff" stroke="#1e2430" stroke-width="8" stroke-linejoin="round"/><circle cx="100" cy="135" r="72" fill="#ffd23f" stroke="#1e2430" stroke-width="10"/><path d="M100 92l13 27 30 4-22 21 5 30-26-14-26 14 5-30-22-21 30-4Z" fill="#fff" stroke="#1e2430" stroke-width="7" stroke-linejoin="round"/></svg>';
    F.trilha(medalha, 'scale', [[t0, 3.5], [t0 + 0.35, 1, 'crashIn']]).trilha(medalha, 'opacity', [[t0, 0], [t0 + 0.1, 1]]);
    const cargo = a.h('div', 'pilula', `${a.fmt(a.metrica('cargo'))} virtual`); cargo.style.fontSize = '44px';
    const nome = a.h('div', 'gancho', a.fmt(a.metrica('vencedor'))); nome.style.fontSize = '76px';
    F.trilha(nome, 'y', [[t0 + 0.4, 200], [t0 + 0.75, 0, 'softLand']]).trilha(nome, 'opacity', [[t0 + 0.4, 0], [t0 + 0.5, 1]]);
    const mand = a.h('div', 'pilula'); const n = a.h('span', null, '0'); mand.append(a.h('span', null, 'mandato de '), n, a.h('span', null, ' dias'));
    a.contador(n, 0, Number(a.metrica('mandato_dias')), t0 + 0.9, t0 + 1.5);
    el.append(medalha, cargo, nome, mand);
    return { el, top: 290 };
  },
});
