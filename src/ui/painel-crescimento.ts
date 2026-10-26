/* Painéis de crescimento: ⚔️ guerra de cidades, 🗝️ caça ao tesouro e 🎨 enfeites da casa (com a 🔥 ofensiva).
   Tudo vem do servidor; aqui só desenha e manda a escolha. */
import type { Ctx } from './app';
import { el, botao, toast } from './dom';
import { api } from '../api/cliente';
import { crescimentoApi, type CidadeGuerra } from '../api/crescimento';
import { MUNICIPIOS, semAcento } from '../dados/dados';
import './crescimento.css';

const fmt = (n: number) => n.toLocaleString('pt-BR');
export const pts = (n: number) => `${fmt(n)} ${n === 1 ? 'ponto' : 'pontos'}`;
const SITE = 'https://virarua.com.br';
const MEDALHA = ['🥇', '🥈', '🥉'];
const dataCurta = (d: string) => d.split('-').reverse().slice(0, 2).join('/');

/** compartilha pelo menu do celular; sem ele, abre o WhatsApp com o texto */
export async function compartilharTexto(texto: string, url = SITE) {
  const nav = navigator as any;
  if (nav.share) { try { await nav.share({ text: texto, url }); return; } catch { /* cancelou */ return; } }
  window.open('https://wa.me/?text=' + encodeURIComponent(texto + ' ' + url), '_blank', 'noopener');
}

async function minhaCidade(ctx: Ctx): Promise<number | null> {
  const eu = await api.eu(); if (eu.ok && eu.casa) return eu.casa.cidade.ibge;
  const gi = ctx.eu(); return gi >= 0 ? ctx.dados.CID[ctx.dados.CID_DE[gi]].ibge : null;
}

/* ---------------- ⚔️ guerra de cidades ---------------- */
export async function montarPainelGuerra(c: HTMLElement, ctx: Ctx, fechar: () => void) {
  const st = el('p', 'nota', 'carregando o placar…'); c.append(st);
  const ibge = await minhaCidade(ctx);
  const r = await crescimentoApi.guerra(ibge || undefined); st.remove();
  if (!r.ok) { c.append(el('p', 'msg erro', r.erro)); return; }
  const verCidade = (i: number) => { const cid = ctx.dados.POR_IBGE.get(i); if (cid) { fechar(); ctx.mostrarCidade(cid); } };

  const hero = el('div', 'cr-hero gu'); hero.append(el('small', '', 'SEMANA ' + dataCurta(r.semana) + ' · FECHA DOMINGO 21H'), el('h2', '', '⚔️ GUERRA DE CIDADES'),
    el('p', '', 'cada casa nova na cidade vale 10 pontos e todo XP dos moradores conta. Chame a sua cidade inteira!'));
  c.append(hero);

  if (r.minha) {
    const m = r.minha, me = el('div', 'cartao-b am cr-minha');
    me.append(el('h2', '', `${m.nome}-${m.uf} está em #${m.pos}`), el('p', '', `${fmt(m.pts)} pontos · ${m.casas_novas} casas novas · ${fmt(m.xp)} XP dos moradores`));
    if (m.acima) {
      const vs = el('div', 'cr-vs'); vs.append(el('b', '', `${m.nome}`), el('span', '', 'VS'), el('b', '', `${m.acima.nome}-${m.acima.uf}`));
      me.append(vs, el('p', 'cr-falta', `${m.falta === 1 ? 'falta' : 'faltam'} ${pts(m.falta)} pra passar ${m.acima.nome}!`));
    } else me.append(el('p', 'cr-falta', `👑 ${m.nome} é a nº 1 do Brasil nesta semana!`));
    if (m.abaixo) me.append(el('p', 'nota', `logo atrás: ${m.abaixo.nome}-${m.abaixo.uf} com ${fmt(m.abaixo.pts)} pts. Não deixa passar!`));
    const txt = m.acima ? `⚔️ ${m.nome} tá em #${m.pos} na guerra de cidades do ViraRua e ${m.falta === 1 ? 'falta 1 ponto' : `faltam ${m.falta} pontos`} pra passar ${m.acima.nome}! Comenta "${m.nome} ${m.uf}" no @viraruajogo e ganha sua casa no mapa 🏠` : `👑 ${m.nome} é a nº 1 do Brasil no ViraRua! Comenta "${m.nome} ${m.uf}" no @viraruajogo e defende a cidade 🏠`;
    const bts = el('div', 'hub-bts'); bts.append(botao('btn prim', '📣 chamar a cidade', () => void compartilharTexto(txt)), botao('btn', 'ver no mapa', () => verCidade(m.ibge)));
    me.append(bts); c.append(me);
    if (r.meu_estado) c.append(el('p', 'nota cr-uf', `${r.meu_estado.uf} está em #${r.meu_estado.pos} entre os estados com ${fmt(r.meu_estado.pts)} pontos.`));
  } else c.append(el('p', 'msg', 'comente a sua cidade e UF num post do @viraruajogo para entrar na guerra.'));

  if (r.eventos.length) {
    const ev = el('div', 'cartao-b cr-ev'); ev.append(el('h2', '', '🔥 ultrapassagens'));
    for (const e of r.eventos.slice(0, 6)) ev.append(el('p', '', `${e.a} passou ${e.b} → #${e.pos}`));
    c.append(ev);
  }

  const abas = el('div', 'lj-seg'); const caixa = el('div');
  const linha = (pos: number, nome: string, pts: number, sub: string, eu: boolean, onclick?: () => void) => {
    const l = el('div', 'rk' + (eu ? ' eu' : '')); const nm = el('span', 'nome'); nm.append(el('b', '', nome), el('small', '', sub));
    l.append(el('span', 'pos', MEDALHA[pos - 1] || String(pos)), nm, el('span', 'n', fmt(pts))); if (onclick) { l.style.cursor = 'pointer'; l.onclick = onclick; } return l;
  };
  const cidades = () => { caixa.innerHTML = ''; r.cidades.forEach((x: CidadeGuerra, i) => caixa.append(linha(i + 1, `${x.nome}-${x.uf}`, x.pts, `${x.casas_novas} casas novas · ${x.moradores} moradores`, x.ibge === ibge, () => verCidade(x.ibge)))); if (!r.cidades.length) caixa.append(el('p', 'nota', 'a semana começou agora: a primeira cidade a pontuar lidera!')); };
  const estados = () => { caixa.innerHTML = ''; r.estados.forEach((x, i) => caixa.append(linha(i + 1, x.uf, x.pts, `${x.cidades} cidades no mapa`, x.uf === r.minha?.uf))); };
  const b1 = botao('lj-tg on', '🏙️ cidades', () => { b1.classList.add('on'); b2.classList.remove('on'); cidades(); }), b2 = botao('lj-tg', '🗺️ estados', () => { b2.classList.add('on'); b1.classList.remove('on'); estados(); });
  abas.append(b1, b2); c.append(abas, caixa); cidades();
}

/* ---------------- 🗝️ caça ao tesouro ---------------- */
const CALOR: Record<string, string> = { achou: '🎉 ACHOU!', fervendo: '🔥🔥 fervendo', quente: '🔥 quente', morno: '🌤️ morno', frio: '🥶 frio' };
export async function montarPainelTesouro(c: HTMLElement, ctx: Ctx, abrir: (id: string, o?: any) => void) {
  c.innerHTML = '';
  const st = el('p', 'nota', 'procurando o mapa do tesouro…'); c.append(st);
  const [r, eu] = await Promise.all([crescimentoApi.tesouro(), api.eu()]); st.remove();
  if (!r.ok) { c.append(el('p', 'msg erro', r.erro)); return; }
  const hero = el('div', 'cr-hero te'); hero.append(el('small', '', 'BAÚ DA SEMANA · ACABA DOMINGO 23H59'), el('h2', '', '🗝️ CAÇA AO TESOURO'),
    el('p', '', `tem um baú escondido numa cidade do Brasil. Sai uma dica nova por dia (aqui e nos stories do @viraruajogo). Você tem ${r.max_dia} pás por dia. Quem achar primeiro ganha +50 XP!`));
  c.append(hero);

  const dk = el('div', 'cartao-b am'); dk.append(el('h2', '', `📜 dicas (${r.dicas.length} de ${r.total_dicas})`));
  r.dicas.forEach((d, i) => dk.append(el('p', 'cr-dica', `${i + 1}. ${d}`)));
  if (r.dicas.length < r.total_dicas) dk.append(el('p', 'nota', 'amanhã sai mais uma dica.'));
  c.append(dk);

  const ca = el('div', 'cartao-b');
  if (r.eu?.achou) {
    ca.append(el('h2', '', `🏆 você achou! (${r.eu.ordem}º lugar)`), el('p', '', `o baú estava em ${r.cidade}. Não conta pra ninguém 🤫`));
    ca.append(botao('btn prim', '📣 contar que achei', () => void compartilharTexto(`🗝️ Achei o baú do tesouro do ViraRua em ${r.eu!.ordem}º lugar! Duvido você achar 😎 As dicas estão no @viraruajogo`)));
  } else if (!eu.ok || !eu.casa) {
    ca.append(el('h2', '', '⛏️ cavar'), el('p', 'nota', 'pra cavar você precisa da sua casa confirmada.'), botao('btn prim', 'reivindicar minha casa', () => abrir('reivindicar')));
  } else {
    ca.append(el('h2', '', `⛏️ cavar · ${r.eu!.restam} ${r.eu!.restam === 1 ? 'pá' : 'pás'} hoje`));
    const busca = el('input', 'cr-busca') as HTMLInputElement; busca.placeholder = 'digite a cidade (ex.: Búzios)'; busca.setAttribute('aria-label', 'cidade para cavar');
    const lista = el('div', 'cr-sug'); const msg = el('p', 'msg');
    busca.oninput = () => {
      lista.innerHTML = ''; const t = semAcento(busca.value); if (t.length < 2) return;
      for (const m of MUNICIPIOS.filter((x) => x.k.includes(t)).sort((a, b) => (a.k.startsWith(t) ? 0 : 1) - (b.k.startsWith(t) ? 0 : 1) || b.pop - a.pop).slice(0, 6)) {
        lista.append(botao('btn mini', `⛏️ ${m.nome}-${m.uf}`, async (ev) => {
          (ev.currentTarget as HTMLButtonElement).disabled = true; msg.className = 'msg'; msg.textContent = 'cavando…';
          const x = await crescimentoApi.cavar(m.ibge);
          if (!x.ok) { msg.className = 'msg erro'; msg.textContent = x.erro; return; }
          if (x.premio) { toast(`🎉 ACHOU O BAÚ! +${x.premio.xp} XP`, 5000); (window as any).__atualizarPerfil?.(); }
          else toast(`${CALOR[x.calor]} · ${x.cidade} fica a ${fmt(x.km)} km do baú`, 4000);
          void montarPainelTesouro(c, ctx, abrir);
        }));
      }
    };
    if (r.eu!.restam > 0) ca.append(busca, lista, msg);
    else ca.append(el('p', 'msg', 'suas pás de hoje acabaram. Amanhã tem mais pás e dica nova!'));
    if (r.eu!.cavadas.length) {
      ca.append(el('h3', '', 'onde você já cavou'));
      for (const k of r.eu!.cavadas) { const l = el('div', 'linha'); l.append(el('span', '', `${k.nome}-${k.uf}`), el('b', '', `${CALOR[k.calor]} · ${fmt(k.km)} km`)); ca.append(l); }
      ca.append(el('p', 'nota', 'quanto mais quente, mais perto. Use os km pra triangular!'));
    }
  }
  c.append(ca);

  const ac = el('div', 'cartao-b'); ac.append(el('h2', '', '🏆 quem já achou'));
  if (!r.achados.length) ac.append(el('p', 'nota', 'ninguém ainda. Pode ser você!'));
  for (const a of r.achados) { const l = el('div', 'linha'); l.append(el('span', '', `${MEDALHA[a.ordem - 1] || a.ordem + 'º'} @${a.nome}`), el('b', '', a.ordem === 1 ? '+50 XP' : '+20 XP')); ac.append(l); }
  c.append(ac);
  c.append(botao('btn bloco', '📣 chamar amigos pra caçar', () => void compartilharTexto('🗝️ Tem um baú do tesouro escondido numa cidade do Brasil no ViraRua! As dicas saem no @viraruajogo. Bora achar primeiro?')));
}

/* ---------------- 🎨 enfeites + 🔥 ofensiva ---------------- */
const ICONE_ENF: Record<string, string> = { horta: '🥬', bandeira: '🚩', carro: '🚗', piscina: '🏊' };
const TIMES: [string, string, string][] = [['vermelho e preto', '#e63946', '#1b1b1f'], ['preto e branco', '#1b1b1f', '#ffffff'], ['verde e branco', '#2a9d4f', '#ffffff'], ['tricolor', '#8b1e2d', '#2a9d4f'],
  ['azul e branco', '#1d4ed8', '#ffffff'], ['vermelho e branco', '#e63946', '#ffffff'], ['verde e amarelo', '#2a9d4f', '#ffd23f'], ['azul e preto', '#1d4ed8', '#1b1b1f'], ['amarelo e preto', '#ffd23f', '#1b1b1f'], ['roxo e branco', '#7c3aed', '#ffffff']];
export const CHAMA = ['', '🔥 chama acesa', '🔥🔥 chama forte', '🔥🔥🔥 chama lendária'];

export async function montarPainelEnfeites(c: HTMLElement, abrir: (id: string, o?: any) => void) {
  c.innerHTML = '';
  const r = await crescimentoApi.decor();
  if (!r.ok) { c.append(el('p', 'msg erro', r.erro === 'erro 401' ? 'entre com a sua casa confirmada para enfeitar.' : r.erro), botao('btn prim', 'reivindicar minha casa', () => abrir('reivindicar'))); return; }
  const of = r.ofensiva;
  const fo = el('div', 'cartao-b am cr-of'); fo.append(el('h2', '', `🔥 ofensiva: ${of.dias} ${of.dias === 1 ? 'dia' : 'dias'} seguidos`));
  fo.append(el('p', '', of.hoje ? 'hoje já está garantido ✅' : of.dias ? '⚠️ faça 1 missão hoje ou a chama apaga!' : 'faça 1 missão por dia pra acender a chama na sua casa.'));
  const mar = el('div', 'cr-marcos'); for (const [n, xp, t] of [[3, 10, 'chama acesa'], [7, 20, 'chama forte'], [30, 50, 'chama lendária']] as [number, number, string][]) { const k = el('span', 'cr-marco' + (of.dias >= n ? ' ok' : '')); k.append(el('b', '', `${n} dias`), el('small', '', `${t} · +${xp} XP`)); mar.append(k); }
  fo.append(mar);
  if (!of.hoje) fo.append(botao('btn prim', 'fazer missão agora', () => abrir('missoes')));
  c.append(fo);

  const escolhidos = new Set(r.escolhidos); let bandeira = r.bandeira || `${TIMES[0][1]}-${TIMES[0][2]}`;
  const en = el('div', 'cartao-b'); en.append(el('h2', '', '🎨 enfeites da casa'), el('p', 'nota', 'liberam com XP e aparecem na sua casa no mapa pra todo mundo ver.'));
  for (const e of r.enfeites) {
    const l = el('label', 'cr-enf' + (e.liberado ? '' : ' trancado'));
    const cb = el('input') as HTMLInputElement; cb.type = 'checkbox'; cb.checked = escolhidos.has(e.id); cb.disabled = !e.liberado;
    cb.onchange = () => { if (cb.checked) escolhidos.add(e.id); else escolhidos.delete(e.id); };
    l.append(cb, el('span', 'cr-enf-ic', ICONE_ENF[e.id] || '✨'), el('b', '', e.nome), el('small', '', e.liberado ? 'liberado' : `🔒 ${e.meta} XP (você tem ${r.xp})`));
    en.append(l);
  }
  const bl = el('div', 'cr-times'); en.append(el('h3', '', '🚩 cores da bandeira'), bl);
  const pinta = () => bl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.v === bandeira));
  for (const [nome, a, b] of TIMES) { const bt = botao('cr-time', '', () => { bandeira = `${a}-${b}`; pinta(); }, nome); bt.dataset.v = `${a}-${b}`; bt.style.background = `linear-gradient(90deg, ${a} 50%, ${b} 50%)`; bl.append(bt); }
  pinta();
  const msg = el('p', 'msg');
  en.append(botao('btn prim bloco', 'salvar enfeites', async () => {
    const x = await crescimentoApi.salvarDecor([...escolhidos], bandeira);
    if (!x.ok) { msg.className = 'msg erro'; msg.textContent = x.erro; return; }
    toast('enfeites salvos! veja a sua casa no mapa'); (window as any).__enfeites3d?.recarregar();
  }), msg);
  c.append(en);
  c.append(botao('btn bloco', '⭐ como ganhar mais XP', () => abrir('pontos')));
}

