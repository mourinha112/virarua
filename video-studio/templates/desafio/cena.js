/* desafio@1 — meta da rua com barra de progresso real e prazo */
SMN.montar('desafio', {
  evidencia(I, F, a) {
    const meta = Number(a.metrica('meta')), feito = Number(a.metrica('progresso')), prazo = a.metrica('prazo');
    const el = a.h('div', 'cartao'); el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.alignItems = 'center'; el.style.gap = '24px';
    const t0 = a.P.evidencia[0];
    const num = a.h('div', 'numero'); num.style.fontSize = '160px';
    const nf = a.h('span', null, '0'); num.append(nf, a.h('span', null, ` / ${a.fmt(meta)}`));
    a.contador(nf, 0, feito, t0 + 0.2, t0 + 1.6);
    const barra = a.h('div', 'barra'), fill = a.h('i'); barra.appendChild(fill);
    const alvo = Math.max(0, Math.min(1, meta > 0 ? feito / meta : 0));
    F.render((t) => { fill.style.width = (alvo * 100 * SMN.valor([[t0 + 0.2, 0], [t0 + 1.6, 1, 'softLand']], t)).toFixed(2) + '%'; });
    el.append(num, barra, a.h('div', 'pilula', 'até ' + a.dataHora(prazo, { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
    return { el, top: 360 };
  },
});
