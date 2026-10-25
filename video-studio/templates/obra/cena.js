/* obra@1 — antes/depois da rua: duas imagens de snapshots reais com data, cortina do antes para o depois */
SMN.montar('obra', {
  evidencia(I, F, a) {
    const A = I.before_after_assets.antes, B = I.before_after_assets.depois;
    const el = a.h('div', 'cartao'); el.style.padding = '18px'; el.style.width = '820px';
    const quadro = a.h('div'); quadro.style.position = 'relative'; quadro.style.height = '640px'; quadro.style.borderRadius = '22px'; quadro.style.overflow = 'hidden'; quadro.style.border = '5px solid #1e2430';
    const mk = (asset) => { const i = a.h('img'); i.src = a.resolverSrc(asset.src); i.alt = ''; Object.assign(i.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' }); return i; };
    const ia = mk(A), ib = mk(B); quadro.append(ia, ib);
    const t0 = a.P.evidencia[0], tw = t0 + 1.6;
    // cortina: o depois entra da direita para a esquerda (função pura de t)
    F.render((t) => { const p = SMN.valor([[tw, 0], [tw + 0.9, 1, 'whip']], t); ib.style.clipPath = `inset(0 0 0 ${(1 - p) * 100}%)`; });
    const dat = (x) => a.dataHora(x.data, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const rot = a.h('div', 'pilula'); rot.style.position = 'absolute'; rot.style.left = '18px'; rot.style.bottom = '18px';
    F.render((t) => { rot.textContent = t < tw + 0.45 ? `antes · ${dat(A)}` : `depois · ${dat(B)}`; });
    quadro.appendChild(rot);
    if (A.placeholder || B.placeholder) { const ph = a.h('div', 'pilula', 'imagens provisórias'); Object.assign(ph.style, { position: 'absolute', right: '18px', top: '18px', background: '#e63946', color: '#fff' }); quadro.appendChild(ph); }
    const n = a.h('div', 'rotulo'); n.style.marginTop = '16px'; const v = a.h('span', null, '');
    n.append(v, a.h('span', null, ' casas reivindicadas'));
    const de = Number(a.metrica('casas_antes')), ate = Number(a.metrica('casas_depois'));
    F.render((t) => { v.textContent = t < tw ? a.fmt(de) : a.fmt(Math.round(de + (ate - de) * SMN.valor([[tw, 0], [tw + 1.2, 1, 'softLand']], t))); });
    el.append(quadro, n);
    return { el, top: 290 };
  },
});
