/* Painéis "lojas" e "seu negócio no mapa" no formato da referência visual (layout e textos próprios). */
import type { Ctx } from './app';
import { MUN, MUNICIPIOS, semAcento, normHandle } from '../dados/dados';
import { el, botao, toast } from './dom';
import { api } from '../api/cliente';

/** WhatsApp da equipe (pagamento e montagem das lojas) */
const ZAP_EQUIPE = '5521986131173';

const LUPA = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const TIPO_NOME: Record<string, string> = { pet: 'Pet shop', cafe: 'Cafeteria', lanchonete: 'Lanchonete', restaurante: 'Restaurante', acai: 'Açaí / sorveteria', loja: 'Loja', eventos: 'Espaço de eventos', mercado: 'Mercado / padaria', tech: 'Informática' };
const pill = (t: string, cls = '') => el('span', 'pt-pill ' + cls, t);
const dataBR = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

export function painelLojas(c: HTMLElement, ctx: Ctx, fechar: () => void) {
  const D = ctx.dados.p;
  const hero = el('section', 'lj-hero');
  hero.append(el('h2', 'out lj-tit', 'Conheça as lojas e ganhe pontos'));
  const p = el('p', 'lj-txt');
  p.append('marque o @ da loja num comentário de qualquer post do @viraruajogo = ', pill('+10 XP'), ' (1 vez por loja). Seguir não dá ponto: o Instagram não deixa conferir quem segue.');
  hero.append(p);
  c.append(hero);

  let modo: 'perto' | 'todas' = 'todas';
  const seg = el('div', 'lj-seg');
  const bPerto = botao('lj-tg', 'perto de mim', () => { modo = 'perto'; pinta(); }), bTodas = botao('lj-tg on', 'todas', () => { modo = 'todas'; pinta(); });
  seg.append(bPerto, bTodas); c.append(seg);
  const busca = el('label', 'lj-busca'); const ic = el('span', 'ic'); ic.innerHTML = LUPA; const inp = el('input'); inp.placeholder = 'buscar loja ou cidade'; inp.setAttribute('aria-label', 'buscar loja ou cidade'); busca.append(ic, inp); c.append(busca);
  const lista = el('div', 'lj-lista'); c.append(lista);

  function pinta() {
    bPerto.classList.toggle('on', modo === 'perto'); bTodas.classList.toggle('on', modo === 'todas');
    lista.innerHTML = '';
    const t = semAcento(inp.value);
    let l = D.lojas.filter((x) => !t || semAcento(x.nome + ' ' + (MUN.get(x.ibge)?.nome || '') + ' ' + (MUN.get(x.ibge)?.uf || '')).includes(t));
    if (modo === 'perto') {
      const gi = ctx.eu(); const cid = gi >= 0 ? ctx.dados.CID[ctx.dados.CID_DE[gi]] : null;
      if (!cid) { lista.append(el('p', 'msg', 'escreva o seu @ na busca do mapa para ver as lojas perto da sua casa.')); return; }
      l = l.slice().sort((a, b) => { const ma = MUN.get(a.ibge)!, mb = MUN.get(b.ibge)!; return Math.hypot(ma.x - cid.x, ma.y - cid.y) - Math.hypot(mb.x - cid.x, mb.y - cid.y); });
    }
    if (!l.length) lista.append(el('p', 'msg', 'nenhuma loja encontrada.'));
    for (const x of l) {
      const m = MUN.get(x.ibge);
      const card = el('article', 'lj-card');
      const dot = el('span', 'lj-dot'); dot.style.background = x.cor;
      const tx = el('div', 'lj-tx');
      tx.append(el('b', 'lj-nome', x.nome), el('span', 'lj-sub', `${TIPO_NOME[x.tipo] || x.tipo} · ${m?.nome}-${m?.uf}`));
      if (x.desc) tx.append(el('span', 'lj-desc', x.desc));
      const ch = el('div', 'lj-chips'); ch.append(pill(x.ig ? `marque @${x.ig}: +10 XP` : 'patrocinado', 'am'), el('span', 'lj-ate', 'até ' + dataBR(x.ate))); tx.append(ch);
      const vis = botao('btn prim lj-vis', 'visitar', () => { fechar(); ctx.visitarLoja(x); });
      card.append(dot, tx, vis); lista.append(card);
    }
  }
  inp.oninput = pinta; pinta();
}

/* ---------------- seu negócio no mapa (3 passos) ---------------- */
const TIPOS_NEG: [string, string][] = [['mercado', 'Mercado / padaria'], ['lanchonete', 'Lanchonete / restaurante'], ['acai', 'Açaí / sorveteria'], ['academia', 'Academia / esporte'], ['oficina', 'Oficina / auto / moto'], ['tech', 'Celular / informática / TI'], ['servico', 'Serviço / escritório / escola'], ['roupa', 'Loja de roupa']];
const MAIS_TIPOS: [string, string][] = [['cafe', 'Cafeteria'], ['pet', 'Pet shop / veterinário'], ['beleza', 'Salão / barbearia / estética'], ['flores', 'Flores / presentes'], ['criador', 'Página / criador de conteúdo']];
const CORES_MARCA = ['#e63946', '#f4a261', '#ffd23f', '#2a9d8f', '#3a86ff', '#8338ec', '#ff5d8f', '#1e2430'];
const PRECOS = [{ ate: 100000, valor: 49, plano: 'Plano Interior', rot: 'cidade até 100 mil habitantes' }, { ate: 1000000, valor: 69, plano: 'Plano Cidades Grandes', rot: 'cidade de 100 mil a 1 milhão' }, { ate: Infinity, valor: 99, plano: 'Plano Metrópoles', rot: 'cidade com mais de 1 milhão' }];
const PROIBIDOS = 'aposta/bet, IPTV ou pirataria, conteúdo adulto, político, partido ou candidato, armas, remédio controlado';

export function painelNegocio(c: HTMLElement, o: { ibge?: number }, titulo: HTMLElement) {
  const st = { passo: 1, ibge: o?.ibge || 0, nome: '', ig: '', zap: '', tipo: '', cor: CORES_MARCA[0], aceite: false };
  // título com "mapa" em amarelo e os 3 pontinhos de passo
  titulo.innerHTML = ''; titulo.append('seu negócio no ', el('span', 'amarelo', 'mapa'));
  const pontos = el('div', 'neg-passos'); c.append(pontos);
  const caixa = el('section', 'neg-caixa'); c.append(caixa);
  const pintaPassos = () => { pontos.innerHTML = ''; for (let i = 1; i <= 3; i++) pontos.append(el('i', i === st.passo ? 'on' : '')); };

  function previa() {
    const w = el('div', 'neg-prev-w');
    w.append(el('p', 'neg-prev-t', 'Assim o seu negócio aparece no mapa'));
    const pv = el('div', 'neg-prev'); pv.style.background = st.cor + '26';
    const ic = el('span', 'neg-ic'); ic.style.background = st.cor; ic.append(el('i'), el('i'));
    const t = el('div'); t.append(el('b', '', st.nome || 'seu negócio'), el('small', '', st.ibge ? `${MUN.get(st.ibge)?.nome} · ${MUN.get(st.ibge)?.uf}` : 'assim ele aparece no mapa'));
    pv.append(ic, t, el('span', 'neg-tag', 'patrocinado'));
    w.append(pv, el('hr', 'neg-hr')); return w;
  }
  const campo = (rot: string, dica: string | null, input: HTMLElement) => { const f = el('div', 'form-campo'); f.append(el('label', '', rot)); if (dica) f.append(el('small', '', dica)); f.append(input); return f; };

  function passo1() {
    caixa.innerHTML = ''; caixa.append(previa());
    caixa.append(el('p', 'neg-intro', 'Seu negócio vira um prédio com selo patrocinado na cidade que você escolher. Leva 1 minuto.'));
    caixa.append(el('p', 'neg-preco-pill', 'a partir de R$ 49 · pagamento único no Pix · 10 dias no mapa'));
    // cidade com sugestões
    const ci = el('input'); ci.placeholder = 'digite a cidade ou a UF'; if (st.ibge) { const m = MUN.get(st.ibge)!; ci.value = `${m.nome} - ${m.uf}`; }
    const sug = el('ul', 'neg-sug'); sug.hidden = true;
    ci.oninput = () => {
      const t = semAcento(ci.value.replace(/-.*/, '')); sug.innerHTML = ''; st.ibge = 0;
      if (t.length < 2) { sug.hidden = true; return; }
      const l = MUNICIPIOS.filter((m) => m.k.startsWith(t)).sort((a, b) => b.pop - a.pop).slice(0, 6);
      for (const m of l) { const li = el('li', '', `${m.nome} - ${m.uf}`); li.onpointerdown = (e) => { e.preventDefault(); st.ibge = m.ibge; ci.value = `${m.nome} - ${m.uf}`; sug.hidden = true; passo1(); }; sug.append(li); }
      sug.hidden = !l.length;
    };
    const fc = campo('cidade', 'a cidade onde o selo aparece. O preço depende do tamanho dela.', ci); fc.append(sug); caixa.append(fc);
    const no = el('input'); no.placeholder = 'ex.: Padaria do Zé'; no.value = st.nome; no.maxLength = 40; no.oninput = () => { st.nome = no.value; const b = caixa.querySelector('.neg-prev b'); if (b) b.textContent = st.nome || 'seu negócio'; };
    caixa.append(campo('nome do negócio', null, no));
    const igw = el('label', 'neg-at'); const ig = el('input'); ig.placeholder = 'seunegocio'; ig.value = st.ig; ig.autocapitalize = 'none'; ig.oninput = () => { st.ig = normHandle(ig.value); }; igw.append(el('span', '', '@'), ig);
    caixa.append(campo('@ do Instagram do negócio', null, igw));
    // tipos
    const tp = el('div', 'tipos neg-tipos'); let abertos = false;
    const pintaTipos = () => {
      tp.innerHTML = '';
      for (const [k, n] of [...TIPOS_NEG, ...(abertos ? MAIS_TIPOS : [])]) tp.append(botao(st.tipo === k ? 'on' : '', n, () => { st.tipo = k; pintaTipos(); }));
      if (!abertos) tp.append(botao('mais', '+ mais tipos', () => { abertos = true; pintaTipos(); }));
      tp.append(botao(st.tipo === 'outro' ? 'on' : '', 'Outro', () => { st.tipo = 'outro'; pintaTipos(); }));
    };
    pintaTipos(); caixa.append(campo('tipo de negócio', null, tp));
    // cor
    const cs = el('div', 'neg-cores');
    const pintaCores = () => {
      cs.innerHTML = '';
      for (const h of CORES_MARCA) { const b = botao('neg-cor' + (st.cor === h ? ' on' : ''), '', () => { st.cor = h; pintaCores(); const pv = caixa.querySelector('.neg-prev') as HTMLElement; if (pv) { pv.style.background = h + '26'; (pv.querySelector('.neg-ic') as HTMLElement).style.background = h; } }, 'cor ' + h); b.style.background = h; cs.append(b); }
      const lab = el('label', 'neg-cor neg-cor-mais' + (!CORES_MARCA.includes(st.cor) ? ' on' : '')); lab.title = 'outra cor'; const pk = el('input'); pk.type = 'color'; pk.value = st.cor; pk.oninput = () => { st.cor = pk.value; pintaCores(); }; lab.append(pk, el('span', '', '+')); cs.append(lab);
    };
    pintaCores(); const fcor = campo('cor da sua marca', null, cs); fcor.append(el('small', '', 'não achou a sua? toca no + e escolhe qualquer cor.')); caixa.append(fcor);
    const zp = el('input'); zp.placeholder = '(27) 99999-0000'; zp.inputMode = 'tel'; zp.value = st.zap; zp.oninput = () => { st.zap = zp.value.replace(/\D/g, ''); };
    caixa.append(campo('WhatsApp do negócio', 'com DDD. É o número do botão "chamar no WhatsApp" da sua loja no mapa.', zp));
    const ac = el('label', 'neg-aceite'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = st.aceite; cb.onchange = () => { st.aceite = cb.checked; };
    ac.append(cb, el('span', '', `Meu negócio não é ${PROIBIDOS} nem coisa parecida. Sei que a equipe pode recusar e devolver o valor.`)); caixa.append(ac);
    const msg = el('p', 'msg');
    caixa.append(botao('btn prim bloco', 'ver o preço', () => {
      const erro = !st.ibge ? 'escolha a cidade na lista' : st.nome.trim().length < 2 ? 'escreva o nome do negócio' : !st.tipo ? 'escolha o tipo de negócio' : st.zap.length < 10 ? 'confira o WhatsApp com DDD' : !st.aceite ? 'marque a declaração' : '';
      if (erro) { msg.className = 'msg erro'; msg.textContent = erro; return; }
      st.passo = 2; render();
    }), msg);
  }

  function passo2() {
    caixa.innerHTML = ''; caixa.append(previa());
    const m = MUN.get(st.ibge)!; const faixa = PRECOS.find((p) => m.pop <= p.ate)!;
    caixa.append(el('h3', 'neg-h', `${faixa.plano} · ${m.nome}`));
    const pr = el('div', 'neg-valor'); pr.append(el('small', '', 'pagamento único'), el('b', '', `R$ ${faixa.valor}`), el('small', '', '10 dias no mapa')); caixa.append(pr);
    caixa.append(el('p', 'nota', `${faixa.rot} (${m.pop.toLocaleString('pt-BR')} habitantes, IBGE).`));
    const ul = el('ul', 'neg-pacote');
    for (const t of [`a galera de ${m.nome} te acha no mapa, com o seu @ e o letreiro do negócio`, 'quem marca o seu @ num comentário do jogo ganha +10 pontos', '10 dias no mapa 3D com selo "patrocinado"', 'a equipe confere cada pedido antes de publicar']) ul.append(el('li', '', t));
    caixa.append(ul);
    const l = el('div', 'linha'); l.append(botao('btn mini', '← voltar', () => { st.passo = 1; render(); }), botao('btn prim', 'continuar', () => { st.passo = 3; render(); }));
    caixa.append(l);
  }

  // pagamento e criação da loja são combinados no WhatsApp da equipe (o pedido fica registrado, se o servidor aceitar)
  async function passo3() {
    caixa.innerHTML = ''; caixa.append(previa());
    const msg = el('p', 'nota', 'preparando o pedido…'); caixa.append(msg);
    const m = MUN.get(st.ibge)!; const faixa = PRECOS.find((p) => m.pop <= p.ate)!;
    const r = await api.pedidoNegocio({ cidade: `${m.nome} - ${m.uf}`, nome: st.nome, ig: st.ig, zap: st.zap, tipo: st.tipo }).catch(() => ({ ok: false } as any));
    msg.remove();
    const texto = [
      'Oi! Quero colocar minha loja no mapa do ViraRua 🏪',
      `Negócio: ${st.nome}`, `Tipo: ${st.tipo}`, `Cidade: ${m.nome} - ${m.uf}`,
      st.ig ? `Instagram: @${st.ig.replace(/^@/, '')}` : '', `Meu WhatsApp: ${st.zap}`,
      `Plano: ${faixa.plano} · R$ ${faixa.valor} · 10 dias`, r.ok && r.codigo ? `Código do pedido: ${r.codigo}` : '',
    ].filter(Boolean).join('\n');
    const link = `https://wa.me/${ZAP_EQUIPE}?text=${encodeURIComponent(texto)}`;
    caixa.append(el('h3', 'neg-h', 'falta só o pagamento'));
    if (r.ok && r.codigo) caixa.append(el('p', 'neg-codigo', r.codigo));
    caixa.append(el('p', '', 'Toque no botão abaixo pra falar com a equipe no WhatsApp. A gente combina o pagamento no Pix e monta a sua loja no mapa.'));
    caixa.append(Object.assign(el('a', 'btn prim bloco', 'chamar no WhatsApp'), { href: link, target: '_blank', rel: 'noopener noreferrer' }));
    caixa.append(botao('btn mini', '← voltar', () => { st.passo = 2; render(); }));
    window.open(link, '_blank', 'noopener');
  }

  function render() { pintaPassos(); if (st.passo === 1) passo1(); else if (st.passo === 2) passo2(); else void passo3(); c.scrollTop = 0; }
  render();
}
