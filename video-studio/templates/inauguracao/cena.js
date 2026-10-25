/* inauguracao@1 — estabelecimento patrocinado aprovado: local, cidade, horário e identificação publicitária visível */
SMN.montar('inauguracao', {
  evidencia(I, F, a) {
    const el = a.h('div', 'cartao'); el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.alignItems = 'center'; el.style.gap = '20px'; el.style.width = '800px';
    const t0 = a.P.evidencia[0], horario = a.metrica('horario');
    const pat = a.h('div', 'pilula', 'patrocinado · ' + I.sponsorship_label); pat.style.background = '#ffd23f';
    const nome = a.h('div', 'numero', a.fmt(a.metrica('local'))); nome.style.fontSize = '96px'; nome.style.textAlign = 'center';
    const dia = a.h('div', 'rotulo', a.dataHora(horario, { weekday: 'long', day: '2-digit', month: 'long' }));
    const hora = a.h('div', 'numero', a.dataHora(horario, { hour: '2-digit', minute: '2-digit' })); hora.style.fontSize = '170px';
    F.trilha(nome, 'scale', [[t0, 1.5], [t0 + 0.4, 1, 'softLand']]).trilha(hora, 'y', [[t0 + 0.5, 160], [t0 + 0.85, 0, 'snapSettle']]).trilha(hora, 'opacity', [[t0 + 0.5, 0], [t0 + 0.6, 1]]);
    el.append(pat, nome, dia, hora, a.h('div', 'rotulo', `${I.scope.nome}${I.scope.uf ? ' · ' + I.scope.uf : ''} · horário de Brasília`));
    return { el, top: 300 };
  },
});
