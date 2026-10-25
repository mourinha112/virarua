/* agenda@1 — evento público com horário confirmado: folha de calendário + hora de Brasília */
SMN.montar('agenda', {
  evidencia(I, F, a) {
    const inicio = a.metrica('inicio'), t0 = a.P.evidencia[0];
    const el = a.h('div'); el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.alignItems = 'center'; el.style.gap = '26px';
    const folha = a.h('div', 'cartao'); Object.assign(folha.style, { width: '420px', padding: '0', overflow: 'hidden', textAlign: 'center' });
    const topo = a.h('div', 'rotulo', a.dataHora(inicio, { month: 'long' })); Object.assign(topo.style, { background: '#e63946', color: '#fff', padding: '14px', borderBottom: '5px solid #1e2430' });
    const dia = a.h('div', 'numero', a.dataHora(inicio, { day: '2-digit' })); dia.style.padding = '10px 0 0';
    const sem = a.h('div', 'rotulo', a.dataHora(inicio, { weekday: 'long' })); sem.style.paddingBottom = '20px';
    folha.append(topo, dia, sem);
    F.trilha(folha, 'rot', [[t0, -14], [t0 + 0.45, 0, 'softLand']]).trilha(folha, 'y', [[t0, -500], [t0 + 0.45, 0, 'whip']]);
    const hora = a.h('div', 'gancho', a.dataHora(inicio, { hour: '2-digit', minute: '2-digit' }) + ' · Brasília');
    F.trilha(hora, 'scale', [[t0 + 0.55, 1.6], [t0 + 0.9, 1, 'softLand']]).trilha(hora, 'opacity', [[t0 + 0.55, 0], [t0 + 0.65, 1]]);
    el.append(folha, hora);
    return { el, top: 330 };
  },
});
