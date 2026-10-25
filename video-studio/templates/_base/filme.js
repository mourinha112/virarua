/* filme.js — casca comum dos 12 templates: fundo (captura do jogo), selos obrigatórios, as quatro partes
 * (0–2 s consequência · 2–7 s evidência · 7–12 s ação · CTA único), carimbo de demonstração e data dos dados.
 * Cada template só fornece a EVIDÊNCIA visual (templates/<id>/cena.js). Todo texto de input entra por textContent
 * (nunca innerHTML). Determinístico: tudo é função de t. */
(function (root) {
  'use strict';
  const SMN = root.SMN;
  const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = String(txt); return e; };
  const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v));
  const TZ = 'America/Sao_Paulo';
  const dataHora = (iso, o) => { const d = new Date(iso); return Number.isNaN(+d) ? String(iso) : d.toLocaleString('pt-BR', Object.assign({ timeZone: TZ }, o)); };
  const metrica = (I, k) => { const m = I.metrics.find((x) => x.chave === k); return m ? m.valor : null; };
  const resolverSrc = (src) => (/^(https?:|file:|data:)/.test(src) ? src : '../../' + src.replace(/^\/+/, ''));

  /** contador que anda por quadro e pousa no valor real */
  function contador(F, el, de, ate, t0, t1, ease) {
    F.render((t) => { const p = SMN.valor([[t0, 0], [t1, 1, ease || 'softLand']], t); el.textContent = fmt(Math.round(de + (ate - de) * p)); });
  }

  /* --- casa e avatar no estilo do jogo (cores de listas fechadas; nenhum texto de input vai para SVG) --- */
  const PELE = { 'pele.1': '#f6d7b8', 'pele.2': '#eebf94', 'pele.3': '#d69a6a', 'pele.4': '#b07649', 'pele.5': '#8a5a36', 'pele.6': '#5e3b22' };
  const COR = { amarelo: '#ffd23f', azul: '#3a86ff', verde: '#4f9c3f', vermelho: '#e63946', preto: '#2b2f3a', branco: '#ffffff', castanho: '#6b4226', loiro: '#e9c46a', ruivo: '#c8553d', colorido: '#8338ec' };
  const cor = (id, pad) => COR[String(id || '').split('.')[1]] || pad;
  function casaSVG(telhado) {
    return `<svg viewBox="0 0 400 380" width="520" height="494" aria-hidden="true">
      <g class="chao"><ellipse cx="200" cy="350" rx="190" ry="28" fill="#4f9c3f" stroke="#1e2430" stroke-width="8"/></g>
      <g class="paredes"><rect x="70" y="170" width="260" height="175" rx="10" fill="#fff" stroke="#1e2430" stroke-width="10"/>
        <rect x="170" y="245" width="62" height="100" rx="6" fill="#ffd23f" stroke="#1e2430" stroke-width="9"/>
        <rect x="98" y="205" width="52" height="46" rx="6" fill="#b3d1ee" stroke="#1e2430" stroke-width="8"/><rect x="252" y="205" width="52" height="46" rx="6" fill="#b3d1ee" stroke="#1e2430" stroke-width="8"/></g>
      <g class="telhado"><path d="M40 182 200 50 360 182Z" fill="${telhado}" stroke="#1e2430" stroke-width="10" stroke-linejoin="round"/></g></svg>`;
  }
  function avatarSVG(cfg) {
    cfg = cfg || {}; const pele = PELE[cfg.pele] || PELE['pele.3'];
    const cabelo = cor(cfg.cor_cabelo, '#6b4226'), roupa = cor(cfg.cor_roupa, '#ffd23f');
    const bone = cfg.acessorio === 'acessorio.bone', oculos = cfg.acessorio === 'acessorio.oculos';
    return `<svg viewBox="0 0 200 320" width="260" height="416" aria-hidden="true">
      <rect x="52" y="150" width="96" height="120" rx="34" fill="${roupa}" stroke="#1e2430" stroke-width="8"/>
      <rect x="62" y="262" width="30" height="46" rx="12" fill="#2b2f3a" stroke="#1e2430" stroke-width="7"/><rect x="108" y="262" width="30" height="46" rx="12" fill="#2b2f3a" stroke="#1e2430" stroke-width="7"/>
      <circle cx="100" cy="92" r="58" fill="${pele}" stroke="#1e2430" stroke-width="8"/>
      <path d="M44 86c4-40 30-58 56-58s52 18 56 58c-16-14-34-20-56-20s-40 6-56 20Z" fill="${cabelo}" stroke="#1e2430" stroke-width="7" stroke-linejoin="round"/>
      <circle cx="80" cy="98" r="7" fill="#1e2430"/><circle cx="120" cy="98" r="7" fill="#1e2430"/><path d="M84 122q16 12 32 0" fill="none" stroke="#1e2430" stroke-width="6" stroke-linecap="round"/>
      ${bone ? '<path d="M40 70h120v-8c0-26-26-40-60-40S40 36 40 62Z" fill="#3a86ff" stroke="#1e2430" stroke-width="7"/><rect x="100" y="62" width="76" height="14" rx="7" fill="#3a86ff" stroke="#1e2430" stroke-width="6"/>' : ''}
      ${oculos ? '<g fill="none" stroke="#1e2430" stroke-width="6"><circle cx="80" cy="98" r="16"/><circle cx="120" cy="98" r="16"/><path d="M96 98h8"/></g>' : ''}
    </svg>`;
  }

  /** monta o filme. cena(I, F, api) devolve elementos de evidência/ação já animados. */
  SMN.montar = function (id, cena) {
    const I = root.__INPUT__;
    const palco = document.getElementById('palco');
    if (!I) { palco.appendChild(h('div', 'placeholder-aviso', 'sem __INPUT__: use o renderer (npm run render)')); root.__duration = 1; root.__seek = () => {}; root.__ready = Promise.resolve(); return; }
    if (I.template_id !== id) throw new Error(`template ${id} recebeu input de ${I.template_id}`);
    const D = I.duration_s, P = SMN.partes(D), F = SMN.filme({ duracao: D, fps: 30 });

    // fundo: captura do jogo real, câmera em deriva lenta (nunca quadro morto)
    if (I.background_asset) {
      const img = h('img', 'fundo'); img.src = resolverSrc(I.background_asset.src); img.alt = ''; palco.appendChild(img);
      F.trilha(img, 'scale', [[0, 1.0], [D, 1.14, 'cruise']]).trilha(img, 'y', [[0, 0], [D, -60, 'cruise']]);
      if (I.background_asset.placeholder) palco.appendChild(h('div', 'placeholder-aviso', 'imagem provisória (placeholder)'));
    }
    palco.appendChild(h('div', 'vinheta'));

    const api = { h, fmt, dataHora, metrica: (k) => metrica(I, k), contador: (el, de, ate, t0, t1, e) => contador(F, el, de, ate, t0, t1, e), casaSVG, avatarSVG, P, D, palco, resolverSrc };
    const bloco = (top) => { const b = h('div', 'bloco'); b.style.top = top + 'px'; palco.appendChild(b); return b; };

    // 0–2 s: consequência (chega já em movimento: o quadro 0 está no meio da chegada)
    const g = bloco(560); g.appendChild(h('div', 'gancho', I.lines.gancho));
    F.cena(g, -4 / 30, P.gancho[1], { de: { scale: 1.6, y: -40 }, para: { y: -220 } });

    // 2–7 s: evidência (visual do template + legenda com o número real)
    const ev = cena.evidencia ? cena.evidencia(I, F, api) : null;
    if (ev) { const b = bloco(Math.max(ev.top || 380, 380)); b.appendChild(ev.el); F.cena(b, P.evidencia[0], P.evidencia[1], ev.anim || { de: { y: 260 }, para: { x: -900 } }); }
    const le = bloco(1150); le.appendChild(h('div', 'legenda', I.lines.evidencia));
    F.cena(le, P.evidencia[0] + 0.25, P.evidencia[1], { de: { y: 220 }, para: { x: -900 } });

    // 7–12 s: ação
    const ac = cena.acao ? cena.acao(I, F, api) : null;
    if (ac) { const b = bloco(Math.max(ac.top || 400, 380)); b.appendChild(ac.el); F.cena(b, P.acao[0], P.acao[1], ac.anim || { de: { x: 900 }, para: { y: -200 } }); }
    const la = bloco(ac ? 1120 : 760); la.appendChild(h('div', 'legenda', I.lines.acao));
    F.cena(la, P.acao[0] + 0.15, P.acao[1], { de: { x: 900 }, para: { y: -200 } });

    // final: UM CTA (pousa e respira; segura no máx. ~1,4 s parado — a deriva do fundo continua)
    const c = bloco(700); const marca = h('div', 'marca', 'Seu Mundo Novo'); const cta = h('div', 'cta', I.cta.texto);
    c.appendChild(marca); c.appendChild(h('div', null, ' ')); c.appendChild(cta);
    F.cena(c, P.cta[0], Infinity, { de: { scale: 1.7 }, quadrosEntra: 14 });
    F.trilha(cta, 'scale', [[P.cta[0] + 0.6, 1], [P.cta[0] + 1.0, 1.06, 'softInOut'], [P.cta[0] + 1.4, 1, 'softInOut']]);

    // selos e rodapé de dados: sempre visíveis
    const selos = h('div', 'selos'); selos.appendChild(h('span', 'selo virtual', 'jogo virtual'));
    if (I.sponsorship_label) selos.appendChild(h('span', 'selo patrocinado', 'patrocinado · ' + I.sponsorship_label));
    if (I.election_status === 'em_andamento' || I.election_status === 'provisorio') selos.appendChild(h('span', 'selo', 'placar parcial'));
    if (I.election_status === 'oficial') selos.appendChild(h('span', 'selo', 'resultado oficial do jogo'));
    palco.appendChild(selos);
    palco.appendChild(h('div', 'data', `${I.scope.nome}${I.scope.uf ? ' · ' + I.scope.uf : ''} · dados de ${dataHora(I.data_timestamp, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`));
    if (I.demo) { selos.prepend(h('span', 'selo demo', 'DEMONSTRAÇÃO · dados fictícios')); const cd = h('div', 'carimbo-demo'); cd.appendChild(h('span', null, 'DEMONSTRAÇÃO · dados fictícios')); palco.appendChild(cd); }

    root.__duration = D;
    root.__seek = (t) => F.seek(t);
    root.__partes = P;
    /** textos visíveis no instante t (testes e inspeção: o vídeo mostra o snapshot real) */
    root.__textos = (t) => { F.seek(t); return [...palco.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim() && e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && e.closest('.bloco, .selos, .data, .carimbo-demo')).map((e) => e.textContent.trim()); };
    root.__ready = SMN.pronto().then((f) => { F.seek(0); return f; });
  };
})(window);
