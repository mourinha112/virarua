/* avatar@1 — o morador da casa: editor de avatar trocando peças (catálogo real do jogo), número real de avatares */
SMN.montar('avatar', {
  evidencia(I, F, a) {
    const el = a.h('div'); el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.alignItems = 'center'; el.style.gap = '22px';
    const base = I.permitted_public_profiles[0]?.avatar || { pele: 'pele.3', cor_cabelo: 'cor_cabelo.castanho', cor_roupa: 'cor_roupa.amarelo', acessorio: 'acessorio.nenhum' };
    // quatro trocas determinísticas de peça (itens do catálogo seed), uma a cada 0,6 s
    const variantes = [base, { ...base, cor_roupa: 'cor_roupa.azul' }, { ...base, cor_roupa: 'cor_roupa.verde', acessorio: 'acessorio.bone' }, { ...base, cor_cabelo: 'cor_cabelo.preto', cor_roupa: 'cor_roupa.vermelho', acessorio: 'acessorio.oculos' }];
    const caixa = a.h('div', 'cartao'); caixa.style.position = 'relative'; caixa.style.width = '360px'; caixa.style.height = '470px';
    const t0 = a.P.evidencia[0];
    variantes.forEach((v, i) => {
      const d = a.h('div'); d.innerHTML = a.avatarSVG(v); d.style.position = 'absolute'; d.style.left = '50px'; d.style.top = '20px';
      const em = t0 + i * 0.6, ate = i === variantes.length - 1 ? Infinity : em + 0.6;
      F.janela(d, i === 0 ? -1 : em, ate); F.trilha(d, 'scale', [[em, 1.12], [em + 0.25, 1, 'softLand']]);
      caixa.appendChild(d);
    });
    const p = a.h('div', 'pilula'); const n = a.h('span', null, '0'); p.append(n, a.h('span', null, ' avatares montados'));
    a.contador(n, 0, Number(a.metrica('avatares_salvos')), t0 + 0.4, t0 + 2.0);
    el.append(caixa, p);
    return { el, top: 320 };
  },
  acao(I, F, a) {
    const el = a.h('div'); el.style.display = 'flex'; el.style.gap = '18px'; el.style.flexWrap = 'wrap'; el.style.justifyContent = 'center';
    ['cabelo', 'roupa', 'acessório', 'calçado'].forEach((t, i) => { const p = a.h('span', 'pilula', t); F.trilha(p, 'y', [[a.P.acao[0] + i * 0.12, 160], [a.P.acao[0] + i * 0.12 + 0.35, 0, 'softLand']]); el.appendChild(p); });
    return { el, top: 520 };
  },
});
