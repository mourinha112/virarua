/* Cartões flutuantes: casa (@), cidade, estado e o aviso de "não achei". */
import type { Ctx } from './app';
import type { Cidade } from '../dados/dados';
import { fmtN, MUNICIPIOS } from '../dados/dados';
import { CARGOS, NIVEIS, CORES_PAREDE, CORES_TELHADO, proximoFechamento } from '../jogo/regras';
import { el, botao, botaoFechar, toast, ICONES } from './dom';
import { COMO_GANHAR } from './painel-pontos';

const nomeCargo = (l: string | null, c?: Cidade) => {
  if (!l) return '';
  const n = CARGOS[l as keyof typeof CARGOS].nome;
  return l === 'M' || l === 'V' ? `${n} de ${c?.nome ?? ''}` : l === 'G' || l === 'D' ? `${n} de ${c?.uf ?? ''}` : n;
};

function ranqueCidade(ctx: Ctx, c: Cidade) {
  const D = ctx.dados.p, l: number[] = []; for (let g = c.ini; g < c.ini + c.n; g++) l.push(g);
  return l.sort((a, b) => D.pts[b] - D.pts[a] || a - b);
}
function linhaPessoa(ctx: Ctx, gi: number, pos?: number, extra?: string) {
  const D = ctx.dados.p, b = botao('rk' + (pos === 1 ? ' p1' : pos === 2 ? ' p2' : pos === 3 ? ' p3' : '') + (gi === ctx.eu() ? ' eu' : ''), '', () => ctx.mostrarCasa(gi));
  if (pos) b.append(el('span', 'pos', pos));
  const nm = el('span', 'nome'); nm.append(el('b', '', '@' + ctx.dados.USR[gi]), el('small', '', extra ?? (nomeCargo(ctx.dados.cargo(gi), ctx.dados.CID[ctx.dados.CID_DE[gi]]) || 'morador')));
  b.append(nm, el('span', 'n', fmtN(D.pts[gi])));
  return b;
}
function quadro(cls: string, rotulo: string, valor: HTMLElement | string) {
  const d = el('div', 'pf-q ' + cls), v = el('div', 'pf-v'); if (typeof valor === 'string') v.textContent = valor; else v.append(valor);
  d.append(v, el('span', 'pf-r', rotulo)); return d;
}
function casaIcone(nv: number) {
  const s = el('span'); s.innerHTML = ICONES.casa; const svg = s.firstElementChild as SVGElement;
  svg.setAttribute('style', `width:${24 + Math.min(16, nv)}px;height:${24 + Math.min(16, nv)}px;fill:none;stroke:#1e2430;stroke-width:2`);
  return s;
}
function relogio(fim: number) {
  const s = el('span');
  const pinta = () => { const ms = Math.max(0, fim - Date.now()), d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000); s.textContent = `${d ? d + 'd ' : ''}${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}min`; };
  pinta(); const t = setInterval(() => { if (!s.isConnected) clearInterval(t); else pinta(); }, 30000);
  return s;
}

export function cartaoCasa(ctx: Ctx, gi: number) {
  const { dados } = ctx, D = dados.p, h = dados.USR[gi], c = dados.CID[dados.CID_DE[gi]], nv = dados.NV[gi], cg = dados.cargo(gi);
  const cart = el('div', 'cart pessoa');
  cart.append(botaoFechar(() => ctx.fecharCartao()));
  cart.append(el('h2', 'ct-h1', '@' + h));
  const sub = el('div', 'ct-sub');
  sub.append(botao('lk', c.nome, () => ctx.mostrarCidade(c)), el('span', 'sep', '›'), botao('lk', c.uf, () => ctx.mostrarEstado(c.uf)));
  if (cg) sub.append(el('span', 'etiq' + (cg === 'M' || cg === 'P' || cg === 'G' ? ' am' : ''), nomeCargo(cg, c).split(' de ')[0]));
  if (D.demo) sub.append(el('span', 'etiq vd', 'fictício'));
  cart.append(sub);

  const rank = ranqueCidade(ctx, c), posC = rank.indexOf(gi) + 1;
  const tr = el('div', 'pf-tr');
  tr.append(quadro('pf-casa', 'nível ' + nv, casaIcone(nv)), quadro('pf-t1', 'na cidade', '#' + fmtN(posC)), quadro('pf-fogo', 'pts na semana', fmtN(D.pts[gi])));
  cart.append(tr);

  const fr = D.frases[h]; if (fr) { const f = el('p', 'msg'); f.append(el('b', '', '“' + fr + '”')); cart.append(f); }

  // ações
  const acoes = el('div', 'acoes');
  acoes.append(botao('btn prim bloco', 'votar na eleição da semana', () => ctx.paineis.abrir('eleicoes', { alvo: gi })));
  cart.append(acoes);

  // nível e próximo
  const prox = NIVEIS[nv] as (typeof NIVEIS)[number] | undefined, atual = NIVEIS[nv - 1];
  const bn = el('section', 'bloco am'); bn.append(el('h3', '', 'sua casa cresce'));
  const pg = el('div', 'pts-grande'); pg.append(el('b', '', fmtN(D.tot[gi])), el('span', '', 'pontos no total · ' + atual.nome)); bn.append(pg);
  if (prox) {
    const f = (D.tot[gi] - atual.min) / Math.max(1, prox.min - atual.min);
    const bar = el('div', 'barra'); const i = el('i'); i.style.width = Math.round(Math.min(1, f) * 100) + '%'; bar.append(i); bn.append(bar);
    bn.append(el('p', 'nota', `faltam ${fmtN(prox.min - D.tot[gi])} pontos para "${prox.nome}" (nível ${nv + 1}) · o nível nunca diminui`));
  } else bn.append(el('p', 'nota', 'nível máximo: topo do Brasil'));
  const esc = el('div', 'escada');
  const ini = Math.max(0, Math.min(NIVEIS.length - 5, nv - 3));
  for (let k = ini; k < ini + 5; k++) { const d = el('div', 'dg' + (k + 1 === nv ? ' on' : '')); const i = el('i'); i.style.height = 10 + (k - ini) * 8 + 'px'; d.append(i, el('span', '', String(k + 1))); esc.append(d); }
  bn.append(esc); cart.append(bn);

  // cidade
  const bc = el('section', 'bloco'); bc.append(el('h3', '', 'na cidade'));
  const pref = rank[0];
  if (pref === gi) bc.append(el('p', 'msg ok', `você é quem mais pontuou em ${c.nome} nesta semana`));
  else {
    bc.append(el('p', 'msg', `faltam ${fmtN(D.pts[pref] - D.pts[gi] + 1)} pontos pra liderar ${c.nome}`));
    bc.append(linhaPessoa(ctx, pref, 1));
  }
  const fecha = el('p', 'nota'); fecha.append('a semana fecha domingo às 21h (Brasília) · faltam ', relogio(proximoFechamento()));
  bc.append(fecha); cart.append(bc);

  // como ganhar pontos
  const bp = el('section', 'bloco'); bp.append(el('h3', '', 'como ganhar pontos'));
  for (const [ic, t, v] of COMO_GANHAR) { const l = el('div', 'linha'); l.append(el('span', '', `${ic} ${t}`), el('b', '', v)); bp.append(l); }
  bp.append(botao('btn mini', '📊 meus pontos', () => ctx.paineis.abrir('pontos')));
  cart.append(bp);

  // é minha
  const be = el('section', 'bloco');
  if (ctx.eu() === gi) {
    be.append(el('p', 'msg', 'você marcou esta casa como sua neste aparelho.'));
    be.append(botao('btn mini', 'não sou eu', () => { ctx.esquecerEu(); toast('ok, esqueci'); ctx.mostrarCasa(gi, false); }));
  } else be.append(botao('btn mini', 'esta casa é minha', () => { ctx.lembrarEu(gi); toast('anotado neste aparelho · para editar a casa, reivindique pelo Instagram'); ctx.mostrarCasa(gi, false); }));
  be.append(botao('btn mini', 'reivindicar pelo Instagram', () => ctx.paineis.abrir('reivindicar', { gi })));
  be.append(botao('btn mini', 'compartilhar', () => compartilhar(`Minha casa no Seu Mundo Novo: @${h}`, location.origin + '/?u=' + encodeURIComponent(h))));
  cart.append(be);
  return cart;
}

export async function compartilhar(texto: string, url: string) {
  try { if (navigator.share) { await navigator.share({ text: texto, url }); return; } } catch { return; }
  try { await navigator.clipboard.writeText(url); toast('link copiado'); } catch { toast(url, 5000); }
}

export function cartaoCidade(ctx: Ctx, c: Cidade) {
  const { dados } = ctx, D = dados.p;
  const cart = el('div', 'cart');
  cart.append(botaoFechar(() => ctx.fecharCartao()));
  cart.append(el('h2', 'ct-h1', c.nome));
  const sub = el('div', 'ct-sub'); sub.append(botao('lk', dados.ESTADOS.get(c.uf)?.nome || c.uf, () => ctx.mostrarEstado(c.uf)), el('span', 'sep', '·'), el('span', '', `#${fmtN(ctx.posicaoCidade(c))} no Brasil`)); cart.append(sub);
  const tr = el('div', 'pf-tr');
  tr.append(quadro('pf-casa', c.n === 1 ? 'casa' : 'casas', fmtN(c.n)), quadro('pf-t1', 'pts na semana', fmtN(c.pts)), quadro('pf-fogo', 'habitantes (IBGE)', c.pop >= 1e6 ? (c.pop / 1e6).toFixed(1).replace('.', ',') + ' mi' : c.pop >= 1e3 ? Math.round(c.pop / 1e3) + ' mil' : String(c.pop)));
  cart.append(tr);

  { const meta = 400, b = el('section', 'bloco'); b.append(el('h3', '', '✈️ meta da cidade: aeroporto'));
    if (c.n >= meta) b.append(el('p', 'msg ok', `${c.nome} já tem aeroporto! Os aviões ligam a cidade às outras metrópoles do jogo.`));
    else { const bar = el('div', 'barra'); const i = el('i'); i.style.width = Math.round((c.n / meta) * 100) + '%'; bar.append(i); b.append(bar, el('p', 'nota', `${fmtN(c.n)} de ${meta} casas · faltam ${fmtN(meta - c.n)} moradores para a cidade ganhar aeroporto. Chame os amigos!`)); }
    cart.append(b); }
  const rank = ranqueCidade(ctx, c);
  const bm = el('section', 'bloco am'); bm.append(el('h3', '', 'quem manda'));
  if (rank.length) bm.append(linhaPessoa(ctx, rank[0], undefined, 'prefeito'));
  if (rank.length > 1) bm.append(linhaPessoa(ctx, rank[1], undefined, 'vice'));
  bm.append(linhaPessoa(ctx, c.fund, undefined, 'fundador'));
  cart.append(bm);

  const br = el('section', 'bloco'); br.append(el('h3', '', 'moradores que mais pontuaram'));
  rank.slice(0, 5).forEach((g, i) => br.append(linhaPessoa(ctx, g, i + 1)));
  const ac = el('div', 'linha');
  ac.append(botao('btn mini', 'ranking', () => ctx.paineis.abrir('ranking', { cid: c })), botao('btn mini', 'ver no mapa', () => ctx.mostrarCidade(c)), botao('btn mini', 'ruas', () => ctx.paineis.abrir('ruas', { cid: c })));
  br.append(ac); cart.append(br);

  const lojas = D.lojas.filter((l) => l.ibge === c.ibge);
  const bl = el('section', 'bloco'); bl.append(el('h3', '', 'lojas no mapa'));
  for (const l of lojas) { const li = el('div', 'lj-item'); const bola = el('span', 'bola'); bola.style.background = l.cor; const t = el('span', 't'); t.append(el('b', '', l.nome), el('small', '', 'patrocinado · ' + l.desc)); li.append(bola, t); bl.append(li); }
  bl.append(botao('btn mini', 'coloque seu negócio aqui', () => ctx.paineis.abrir('negocio', { ibge: c.ibge })));
  cart.append(bl);
  return cart;
}

export function cartaoEstado(ctx: Ctx, uf: string) {
  const { dados } = ctx, e = dados.ESTADOS.get(uf);
  const cart = el('div', 'cart');
  cart.append(botaoFechar(() => ctx.fecharCartao()));
  cart.append(el('h2', 'ct-h1', e?.nome || uf));
  const total = MUNICIPIOS.filter((m) => m.uf === uf).length;
  const sub = el('div', 'ct-sub'); sub.append(el('span', '', `estado · ${fmtN(e?.cidades.length || 0)} de ${fmtN(total)} cidades com casa`)); cart.append(sub);
  const tr = el('div', 'pf-tr');
  tr.append(quadro('pf-casa', 'casas', fmtN(e?.casas || 0)), quadro('pf-t1', 'pts na semana', fmtN(e?.pts || 0)), quadro('pf-fogo', 'cidades', fmtN(e?.cidades.length || 0)));
  cart.append(tr);
  if (e && e.gov >= 0) { const b = el('section', 'bloco am'); b.append(el('h3', '', 'governador da semana'), linhaPessoa(ctx, e.gov)); cart.append(b); }
  const bc = el('section', 'bloco'); bc.append(el('h3', '', 'cidades com mais casas'));
  for (const c of (e?.cidades || []).slice().sort((a, b) => b.n - a.n).slice(0, 6)) {
    const b = botao('rk', '', () => ctx.mostrarCidade(c)); const nm = el('span', 'nome'); nm.append(el('b', '', c.nome), el('small', '', `${fmtN(c.pts)} pts na semana`)); b.append(nm, el('span', 'n', fmtN(c.n))); bc.append(b);
  }
  cart.append(bc);
  return cart;
}

export function avisoNaoAchei(txt: string) {
  const cart = el('div', 'cart nao');
  cart.append(el('h2', 'ct-h1', `não achei "${txt}"`));
  cart.append(el('p', 'msg', 'comenta o nome da sua cidade e a UF em qualquer post do @viraruajogo e a sua casa aparece aqui.'));
  cart.append(el('p', 'nota', 'confere se o @ está igualzinho ao do Instagram, ou digita o nome de uma cidade ou estado.'));
  return cart;
}

export const _cores = { CORES_PAREDE, CORES_TELHADO };

const TIPO_NOME: Record<string, string> = { academia: 'Academia', mercado: 'Mercado', tech: 'Assistência técnica', pet: 'Pet shop', cafe: 'Cafeteria', lanchonete: 'Lanchonete', restaurante: 'Restaurante', acai: 'Açaí', loja: 'Loja', eventos: 'Espaço de eventos' };

export function cartaoLoja(ctx: Ctx, l: import('../dados/formato').Loja) {
  const c = ctx.dados.POR_IBGE.get(l.ibge);
  const cart = el('div', 'cart loja');
  cart.append(botaoFechar(() => ctx.fecharCartao()));
  // cabeçalho: logo em quadrado arredondado (iniciais na cor da marca) + nome + tipo/cidade
  const cab = el('div', 'loja-cab'); cart.style.setProperty('--marca', l.cor);
  if (l.logo) cart.classList.add('com-logo');
  const logo = el('div', 'loja-logo'); logo.style.background = l.cor;
  if (l.logo) { const im = el('img') as HTMLImageElement; im.src = l.logo; im.alt = 'logo ' + l.nome; im.loading = 'lazy'; logo.append(im); logo.style.background = '#fff'; }
  else logo.textContent = l.nome.split(/\s+/).filter((p) => p.length > 2 || /^[A-Z]/.test(p)).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  const tt = el('div', 'loja-tt'); tt.append(el('h2', 'ct-h1', l.nome));
  const sub = el('div', 'ct-sub'); sub.append(el('span', '', TIPO_NOME[l.tipo] || l.tipo), el('span', 'sep', '·'));
  if (c) sub.append(botao('lk', c.nome, () => ctx.mostrarCidade(c)), el('span', 'sep', '›'), botao('lk', c.uf, () => ctx.mostrarEstado(c.uf)));
  tt.append(sub); cab.append(logo, tt); cart.append(cab);
  // vitrine para o empresário: alcance na cidade (dados do jogo; métricas reais vêm do painel do estabelecimento)
  if (c) {
    const st = el('div', 'loja-stats');
    const it = (n: string, t: string) => { const d = el('div'); d.append(el('b', '', n), el('span', '', t)); st.append(d); };
    it(fmtN(c.n), 'moradores na cidade'); it(fmtN(c.pts), 'pontos na semana'); it('+10', 'XP por marcar o @');
    cart.append(st);
  }
  const pat = el('div', 'loja-pat'); pat.innerHTML = ICONES.loja; pat.append(el('b', 'etiq ink', 'patrocinado'), el('span', '', 'no mapa até ' + l.ate.split('-').reverse().slice(0, 2).join('/')));
  cart.append(pat);
  cart.append(el('p', 'loja-desc', l.desc));
  // loja de verdade: endereço, como chegar, horário e WhatsApp
  if (l.end || l.zap || l.hor) {
    const inf = el('div', 'loja-info');
    if (l.end) {
      const lin = el('div', 'li'); lin.append(el('span', 'ic', '📍'), el('span', '', l.end));
      const mapa = el('a', 'btn mini') as HTMLAnchorElement; mapa.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(l.nome + ' ' + l.end); mapa.target = '_blank'; mapa.rel = 'noopener nofollow'; mapa.textContent = 'como chegar';
      lin.append(mapa); inf.append(lin);
    }
    if (l.hor) { const lin = el('div', 'li'); lin.append(el('span', 'ic', '🕘'), el('span', '', l.hor)); inf.append(lin); }
    if (l.zap) {
      const z = el('a', 'btn bloco loja-zap') as HTMLAnchorElement; z.href = 'https://wa.me/' + l.zap + '?text=' + encodeURIComponent('Oi! Vi a ' + l.nome + ' no mapa do Seu Mundo Novo 🐾'); z.target = '_blank'; z.rel = 'noopener nofollow sponsored';
      z.append(el('b', '', 'chamar no WhatsApp'), el('small', '', '(' + l.zap.slice(2, 4) + ') ' + l.zap.slice(4, -4) + '-' + l.zap.slice(-4)));
      inf.append(z);
    }
    cart.append(inf);
  }
  if (l.ig) {
    const a = el('a', 'btn prim bloco loja-seguir'); a.href = 'https://www.instagram.com/' + l.ig + '/'; a.target = '_blank'; a.rel = 'noopener nofollow sponsored';
    a.append(el('b', '', 'ver @' + l.ig), el('small', '', 'no Instagram'));
    cart.append(a);
    const gi = ctx.eu();
    if (gi >= 0) { const q = el('div', 'loja-eu'); q.append(el('span', '', 'você: @' + ctx.dados.USR[gi] + ' · '), botao('btn mini', 'não sou eu', () => { ctx.esquecerEu(); ctx.abrirCartao(cartaoLoja(ctx, l)); })); cart.append(q); }
    const mk = el('div', 'loja-marca'); mk.append(el('span', '', `marca @${l.ig} num comentário de um post do jogo: +10 XP (1 vez)`), botao('btn mini prim', 'copiar @', async () => { try { await navigator.clipboard.writeText('@' + l.ig); toast('@ copiado'); } catch { toast('@' + l.ig); } }));
    cart.append(mk);
  } else cart.append(el('p', 'nota', 'loja de demonstração (fictícia): sem perfil externo.'));
  cart.append(botao('btn bloco', 'entrar na loja', () => ctx.paineis.abrir('loja', { id: l.id })));
  cart.append(botao('btn bloco', '+ seu negócio nesta cidade', () => ctx.paineis.abrir('negocio', { ibge: l.ibge })));
  return cart;
}
