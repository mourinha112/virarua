/* convite@1 — convite de rua: moradores e vagas REALMENTE disponíveis (sem mostrar quem não autorizou) */
SMN.montar('convite', {
  evidencia(I, F, a) {
    const moradores = Number(a.metrica('moradores')), vagas = Number(a.metrica('vagas'));
    const total = moradores + vagas, cap = 40, mostra = Math.min(total, cap);
    const el = a.h('div', 'cartao'); el.style.width = '820px';
    const grade = a.h('div'); grade.style.display = 'grid'; grade.style.gridTemplateColumns = 'repeat(8, 1fr)'; grade.style.gap = '14px';
    const t0 = a.P.evidencia[0];
    for (let i = 0; i < mostra; i++) {
      const ocupada = i < Math.round(moradores * mostra / Math.max(total, 1));
      const c = a.h('div'); c.style.height = '70px'; c.style.borderRadius = '16px'; c.style.border = ocupada ? '5px solid #1e2430' : '5px dashed #1e2430';
      c.style.background = ocupada ? '#ffd23f' : '#eef3f8';
      F.trilha(c, 'scale', [[t0 + 0.02 * i, 1.6], [t0 + 0.02 * i + 0.3, 1, 'softLand']]).trilha(c, 'opacity', [[t0 + 0.02 * i, 0], [t0 + 0.02 * i + 0.1, 1]]);
      if (!ocupada) F.trilha(c, 'scale', [[t0 + 1.4, 1], [t0 + 1.7, 1.12, 'softInOut'], [t0 + 2.0, 1, 'softInOut']]);
      grade.appendChild(c);
    }
    const leg = a.h('div', 'rotulo'); leg.style.marginTop = '22px';
    const nm = a.h('span', null, '0'), nv = a.h('span', null, '0');
    leg.append(nm, a.h('span', null, ' moradores · '), nv, a.h('span', null, ' vagas livres'));
    a.contador(nm, 0, moradores, t0 + 0.3, t0 + 1.3); a.contador(nv, 0, vagas, t0 + 0.8, t0 + 1.8);
    el.append(grade, leg);
    if (total > cap) el.appendChild(a.h('div', 'rotulo', `(cada quadrado ≈ ${Math.ceil(total / cap)} casas)`));
    return { el, top: 330 };
  },
});
