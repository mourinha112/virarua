/* Barra de abas e painéis de tela cheia. Cada painel é montado sob demanda e redesenhado ao abrir. */
import type { Ctx } from './app';
import type { Cidade } from '../dados/dados';
import { fmtN, MUN, normHandle, semAcento } from '../dados/dados';
import { CARGOS, NIVEIS, PONTOS, VOTO, proximoFechamento } from '../jogo/regras';
import { $, el, botao, botaoFechar, toast, ICONES } from './dom';
import { api } from '../api/cliente';
import { montarPainelRua } from './painel-rua';
import { montarPainelAvatar } from './painel-avatar';
import { montarPainelEleicoes } from './painel-eleicoes';
import { montarPainelPet } from './painel-pet';
import { montarPainelConstrucoes } from './painel-construcoes';
import { montarPainelPontos } from './painel-pontos';
import { montarPainelGuerra, montarPainelTesouro, montarPainelEnfeites } from './painel-crescimento';
import { montarPainelMissoes } from './painel-missoes';
import { montarPainelLoja } from './painel-loja';
import { painelLojas, painelNegocio } from './painel-lojas-neg';
import { compartilharCartao } from './cartao-story';
import { montarHub } from './painel-hub';
import { montarJornal } from './jornal';
import { abrirStory } from './story';
import { montarPainelApp } from './painel-app';

export type Paineis = { abrir(id: string, opts?: any): void; fechar(id?: string): void; fecharTopo(): boolean; ativo(): string | null };
type Def = { titulo: string; desenhar(corpo: HTMLElement, opts: any): void | Promise<void>; ajuda?: boolean };

const TABS: { id: string; rot: string; ic: string }[] = [
  { id: 'ranking', rot: 'placar', ic: 'trofeu' },
  { id: 'eleicoes', rot: 'palácio', ic: 'palacio' },
  { id: 'lojas', rot: 'lojas', ic: 'loja' },
  { id: 'casa', rot: 'minha casa', ic: 'casa' },
  { id: 'como', rot: 'como funciona', ic: 'ajuda' },
  { id: 'app', rot: 'app', ic: 'app' },
];

export function montarPaineis(ctx: Ctx): Paineis {
  const { dados } = ctx, D = dados.p;
  const raiz = $('paineis'); const secoes = new Map<string, HTMLElement>(); let aberto: string | null = null;
  let descarte: { dispose(): void } | null = null;

  const DEFS: Record<string, Def> = {
    casa: { titulo: 'minha casa', desenhar: (c) => minhaCasa(c) },
    eleicoes: { titulo: 'palácio', desenhar: (c, o) => eleicoes(c, o) },
    ranking: { titulo: 'placar', desenhar: (c, o) => ranking(c, o) },
    app: { titulo: 'app', desenhar: (c) => montarPainelApp(c) },
    lojas: { titulo: 'lojas', desenhar: (c) => painelLojas(c, ctx, () => fechar()) },
    como: { titulo: 'como funciona', desenhar: (c) => como(c) },
    negocio: { titulo: 'seu negócio no mapa', desenhar: (c, o) => painelNegocio(c, o, secoes.get('negocio')!.querySelector('h1') as HTMLElement) },
    reivindicar: { titulo: 'reivindicar casa', desenhar: (c, o) => reivindicar(c, o) },
    ruas: { titulo: 'minha rua', desenhar: (c, o) => montarPainelRua(c, { ruaId: o?.ruaId, ibge: o?.cid?.ibge, cidadeNome: o?.cid?.nome, abrirAvatar: () => abrir('avatar'), aoMudarDeRua: () => toast('mudança registrada: sua casa e seu avatar vão junto') }) },
    avatar: { titulo: 'meu avatar', desenhar: async (c) => { descarte?.dispose(); descarte = await montarPainelAvatar(c, { abrirReivindicar: () => abrir('reivindicar', { gi: ctx.eu() }), aoSalvar: () => { toast('avatar salvo'); (window as any).__carregarEu?.(); } }); } },
    missoes: { titulo: 'missões do dia', desenhar: (c) => montarPainelMissoes(c, ctx) },
    pet: { titulo: 'meu pet', desenhar: (c) => montarPainelPet(c, abrir) },
    guerra: { titulo: 'guerra de cidades', desenhar: (c) => montarPainelGuerra(c, ctx, fechar) },
    tesouro: { titulo: 'caça ao tesouro', desenhar: (c) => montarPainelTesouro(c, ctx, abrir) },
    enfeites: { titulo: 'ofensiva e enfeites', desenhar: (c) => montarPainelEnfeites(c, abrir) },
    pontos: { titulo: 'meus pontos', desenhar: (c) => montarPainelPontos(c, abrir) },
    construcoes: { titulo: 'o que dá pra construir', desenhar: (c) => montarPainelConstrucoes(c, ctx, abrir) },
    videos: { titulo: 'destaques da semana', desenhar: (c) => videos(c) },
    notificacoes: { titulo: 'notificações', desenhar: (c) => notificacoes(c) },
    jornal: { titulo: 'jornal do dia', desenhar: (c) => montarJornal(c, ctx, abrir, fechar) },
    loja: { titulo: 'loja', desenhar: (c, o) => montarPainelLoja(c, ctx, o?.id) },
  };

  /* explicação em 3 passos no topo dos sistemas que confundem */
  const EXPLICA: Record<string, { tit: string; passos: [string, string][] }> = {
    casa: { tit: 'como funciona a sua casa', passos: [['💬', 'comentou a cidade num post do @viraruajogo: a casa nasce no mapa'], ['⭐', 'missões, trabalho, amigos marcados e visitas dão XP: a casa sobe de nível e nunca encolhe'], ['🔔', 'quem visita toca a sua campainha e curte: +1 pra você cada']] },
    ruas: { tit: 'como funciona a sua rua', passos: [['🏠', 'toda casa fica numa rua da cidade (até 24 casas por rua)'], ['🤝', 'chame amigos com o convite: eles viram seus vizinhos e aparecem online na rua'], ['🏆', 'a rua faz missões juntas, constrói a obra e disputa o troféu da semana']] },
    pet: { tit: 'como ganhar o seu pet', passos: [['⭐', 'junte pontos com missões, trabalho e obra da rua'], ['🔓', 'chegou na meta: escolha gato ou cachorro, a cor e o nome'], ['🏠', 'ele fica na frente da sua casa no mapa e todo mundo vê']] },
    avatar: { tit: 'o seu avatar', passos: [['🎨', 'escolha pele, cabelo, roupa, cores e acessório'], ['💾', 'salve: ele aparece na frente da sua casa no mapa'], ['👋', 'quando você entra, seus vizinhos te veem online e podem acenar']] },
  };
  function explicacao(c: HTMLElement, id: string) {
    const e = EXPLICA[id]; if (!e) return;
    const b = el('div', 'cartao-b expl'); b.append(el('h2', '', e.tit));
    for (const [ic, t] of e.passos) { const l = el('div', 'expl-p'); l.append(el('span', 'expl-ic', ic), el('span', '', t)); b.append(l); }
    if (id === 'casa') b.append(botao('btn mini', '▶ ver o passo a passo', () => { fechar(); abrirStory(ctx, 1); }));
    c.append(b);
  }

  /* ---------- barra ---------- */
  const tab = $('tabbar');
  for (const t of TABS) {
    const b = botao('tab', '', () => clicarTab(t.id), t.rot);
    b.dataset.tab = t.id;
    const ic = el('span', 'ico'); ic.innerHTML = ICONES[t.ic]; b.append(ic, el('span', '', t.rot));
    if (t.id === 'lojas' && D.lojas.length) b.append(el('i', 'selo'));
    tab.append(b);
  }
  function pintarTabs() { tab.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === aberto || (b.dataset.tab === 'casa' && aberto === null && ctx.sel?.tipo === 'casa' && ctx.sel.gi === ctx.eu()))); }
  function clicarTab(id: string) {
    if (aberto === id) { fechar(); return; }
    if (id === 'como') { fechar(); abrirStory(ctx); return; }
    abrir(id);
  }
  $('abrirNegocio').onclick = () => abrir('negocio');

  /* ---------- abrir/fechar ---------- */
  function abrir(id: string, opts: any = {}) {
    const def = DEFS[id]; if (!def) return;
    if (aberto && aberto !== id) secoes.get(aberto)!.hidden = true;
    let s = secoes.get(id);
    if (!s) {
      s = el('section', 'painel'); s.id = 'p-' + id; s.setAttribute('aria-label', def.titulo);
      const topo = el('header', 'painel-topo');
      if (def.ajuda) topo.append(botao('fechar ajuda-rk', '?', () => abrir('como'), 'como funciona'));
      topo.append(el('h1', 'out', def.titulo), botaoFechar(() => fechar(), 'voltar pro mapa'));
      s.append(topo, el('div', 'painel-corpo')); raiz.append(s); secoes.set(id, s);
    }
    s.hidden = false; aberto = id;
    const corpo = s.querySelector('.painel-corpo') as HTMLElement; corpo.innerHTML = ''; corpo.scrollTop = 0;
    explicacao(corpo, id);
    void def.desenhar(corpo, opts);
    pintarTabs();
  }
  function fechar(id?: string) { const k = id || aberto; if (!k) return; const s = secoes.get(k); if (s) s.hidden = true; if (aberto === k) aberto = null; pintarTabs(); }

  /* ---------- Minha Casa ---------- */
  function pedirEu(c: HTMLElement, depois: () => void) {
    const box = el('div', 'cartao-b');
    box.append(el('h2', '', 'Qual é o seu @?'), el('p', 'nota', 'digite o @ que comentou a cidade. Para editar a casa, reivindique pelo Instagram.'));
    const f = el('div', 'form-campo'); const inp = el('input'); inp.placeholder = '@ seu @ do Instagram'; inp.autocapitalize = 'none'; inp.setAttribute('autocomplete', 'off'); f.append(inp); box.append(f);
    const msg = el('p', 'msg');
    const ok = botao('btn prim bloco', 'Continuar', () => {
      const h = normHandle(inp.value), gi = dados.POR_HANDLE.get(h);
      if (gi === undefined) { msg.className = 'msg erro'; msg.textContent = 'não achei esse @ no mapa. Comente sua cidade e UF em qualquer post do @viraruajogo para ganhar a casa.'; return; }
      ctx.lembrarEu(gi); depois();
    });
    inp.onkeydown = (e) => { if (e.key === 'Enter') ok.click(); };
    box.append(el('div', 'form-campo'), ok, msg); c.append(box); setTimeout(() => inp.focus(), 50);
  }
  async function minhaCasa(c: HTMLElement) {
    // conta real (sessão no servidor): casa, rua, avatar e eleição da rua
    const eu = await api.eu();
    if (eu.ok && eu.casa) { await montarHub(c, ctx, abrir, fechar, eu); return; }
    if ((import.meta as any).env?.DEV) {
      const t = el('div', 'cartao-b papel');
      t.append(el('h2', '', 'testar logado (desenvolvimento)'), el('p', 'nota', 'cria uma conta de teste com casa reivindicada, avatar e 5 vizinhos na mesma rua, para você experimentar avatar, rua e eleição de rua sem o Instagram.'));
      const sel = el('select', 'frase-inp');
      for (const [ib, n] of [[3304557, 'Rio de Janeiro - RJ'], [3301702, 'Duque de Caxias - RJ'], [3550308, 'São Paulo - SP'], [3205309, 'Vitória - ES'], [3205200, 'Vila Velha - ES']] as [number, string][]) { const o = el('option', '', n); o.value = String(ib); sel.append(o); }
      const msg = el('p', 'msg');
      t.append(sel, botao('btn prim bloco', 'entrar como teste', async () => { msg.textContent = 'criando…'; const r = await api.devEntrar(Number(sel.value)); if (!r.ok) { msg.className = 'msg erro'; msg.textContent = r.erro; return; } toast('entrou como teste em ' + r.cidade); (window as any).__carregarEu?.(); abrir('casa'); }), msg);
      c.append(t);
    }
    const gi = ctx.eu();
    if (gi < 0) { pedirEu(c, () => abrir('casa')); return; }
    const h = dados.USR[gi], cid = dados.CID[dados.CID_DE[gi]], nv = dados.NV[gi];
    const top = el('div', 'cartao-b am');
    top.append(el('h2', '', '@' + h), el('p', '', `${cid.nome} · ${cid.uf} · nível ${nv} (${NIVEIS[nv - 1].nome})`));
    top.append(botao('btn bloco', 'ver minha casa no mapa', () => { fechar(); ctx.mostrarCasa(gi); }));
    c.append(top);
    const av = el('div', 'cartao-b'); av.append(el('h2', '', 'avatar, rua e missões'), el('p', 'nota', 'editar avatar e participar da rua exigem a casa reivindicada pelo Instagram.'));
    const lin = el('div', 'linha'); lin.append(botao('btn mini prim', 'meu avatar', () => abrir('avatar')), botao('btn mini', 'minha rua', () => abrir('ruas', { cid })), botao('btn mini', 'missões do dia', () => abrir('missoes')));
    av.append(lin, botao('btn mini', 'reivindicar minha casa', () => abrir('reivindicar', { gi })));
    c.append(av);
    const pt = el('div', 'cartao-b');
    pt.append(el('h2', '', 'pontos'));
    for (const [r, v] of [['nesta semana', D.pts[gi]], ['no total (XP)', D.tot[gi]]] as [string, number][]) { const l = el('div', 'linha'); l.append(el('span', '', r), el('b', '', fmtN(v))); pt.append(l); }
    c.append(pt);
    c.append(botao('btn mini', 'trocar @', () => { ctx.esquecerEu(); abrir('casa'); }));
  }

  /* ---------- Palácio: relógio da eleição, quem manda em cada cargo e as eleições virtuais ---------- */
  async function eleicoes(c: HTMLElement, o: { alvo?: number; cargo?: string }) {
    const fim = proximoFechamento(), SEMANA = 7 * 86400_000;
    const hero = el('div', 'cartao-b pl-hero');
    hero.append(el('h2', '', 'eleição toda semana'), el('p', 'pl-sub', 'cargos do jogo, sem vínculo com eleições reais · próxima apuração em'));
    const big = el('div', 'pl-cont'), bar = el('div', 'pl-barra'), bi = el('i'); bar.append(bi);
    hero.append(big, el('p', 'pl-quando', 'domingo às 21h (Brasília)'), bar,
      el('p', 'pl-txt', 'Segunda a quinta: candidaturas. Sexta a domingo: votação, 1 voto por cargo. Domingo às 21h o placar fecha e quem tiver mais votos assume a semana seguinte. Missão, comentário e amigo marcado dão pontos pra campanha.'));
    const pinta = () => {
      const ms = Math.max(0, fim - Date.now()), d = Math.floor(ms / 86400_000), h = Math.floor((ms % 86400_000) / 3600_000), m = Math.floor((ms % 3600_000) / 60_000), sg = Math.floor((ms % 60_000) / 1000);
      big.textContent = `${d ? d + 'd ' : ''}${h}h ${String(m).padStart(2, '0')}min ${String(sg).padStart(2, '0')}s`;
      bi.style.width = Math.round((1 - ms / SEMANA) * 100) + '%';
    };
    pinta(); const t = setInterval(() => (big.isConnected ? pinta() : clearInterval(t)), 1000);
    if (dados.presidente >= 0) { const g = dados.presidente, cp = dados.CID[dados.CID_DE[g]]; const p = el('p', 'pl-txt'); p.append('Nesta semana, quem lidera o Brasil é ', el('b', '', '@' + dados.USR[g]), ` (${cp.nome} · ${cp.uf}) com ${fmtN(D.pts[g])} pts.`); hero.append(p); }
    c.append(hero);

    // quem manda: grade de cargos + detalhe do escolhido
    const ICO: Record<string, string> = { P: '👑', G: '🏰', S: '⭐', D: '📜', M: '🏛️', V: '🗳️' };
    const PLURAL: Record<string, string> = { P: 'presidente', G: 'governadores', S: 'senadores', D: 'deputados', M: 'prefeitos', V: 'vereadores' };
    const porCargo = new Map<string, number[]>(); for (let g = 0; g < D.n; g++) { const k = D.cg[g]; if (k && k !== ' ') { if (!porCargo.has(k)) porCargo.set(k, []); porCargo.get(k)!.push(g); } }
    const grade = el('div', 'cartao-b pl-cargos'); grade.append(el('h3', 'pl-h3', '☆ quem manda'));
    const bts = el('div', 'pl-grade'); grade.append(bts);
    const det = el('div', 'pl-det');
    const desenhar = (k: string) => {
      bts.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      det.innerHTML = '';
      const lista = (porCargo.get(k) || []).slice().sort((a, b) => D.pts[b] - D.pts[a]);
      if (!lista.length) { const v = el('div', 'cartao-b'); v.append(el('h2', '', `nenhum ${CARGOS[k as keyof typeof CARGOS].nome} ainda`), el('p', 'nota', 'a vaga está aberta: candidate-se na eleição virtual aqui embaixo.')); det.append(v); return; }
      if (k === 'P') {
        const g = lista[0], cp = dados.CID[dados.CID_DE[g]], v = el('div', 'cartao-b pl-pres');
        v.append(el('small', 'pl-cargo', '☆ presidente(a) do Brasil'), el('div', 'pl-arroba', '@' + dados.USR[g]), el('p', 'pl-de', `${cp.nome} · ${cp.uf}`));
        const st = el('div', 'pl-st'); const q2 = (n: string, r: string) => { const d = el('div'); d.append(el('b', '', n), el('small', '', r)); st.append(d); };
        q2(fmtN(D.pts[g]), 'pts na semana'); q2(fmtN(D.tot[g]), 'XP no total'); v.append(st);
        const fr = D.frases[dados.USR[g]]; if (fr) v.append(el('p', 'pl-frase', '“' + fr + '”'));
        v.append(botao('btn prim bloco', 'ver a casa no mapa', () => { fechar(); ctx.mostrarCasa(g); }));
        det.append(v); return;
      }
      const v = el('div', 'cartao-b'); v.append(el('h2', '', `${PLURAL[k]} · ${fmtN(lista.length)}`));
      const max = D.pts[lista[0]] || 1;
      lista.slice(0, 15).forEach((g, i) => {
        const b = botao('v3-bar', '', () => { fechar(); ctx.mostrarCasa(g); });
        const cid = dados.CID[dados.CID_DE[g]];
        const bb = el('span', 'b'); bb.append(el('b', '', '@' + dados.USR[g]), el('small', '', `${cid.nome} · ${cid.uf}`)); const br = el('i'); const s = el('s'); s.style.width = Math.round((D.pts[g] / max) * 100) + '%'; br.append(s); bb.append(br);
        b.append(el('span', 'pos', i + 1), bb, el('span', 'n', fmtN(D.pts[g]) + ' pts')); v.append(b);
      });
      det.append(v);
    };
    for (const k of ['P', 'G', 'S', 'D', 'M', 'V']) {
      const b = botao('pl-bt', '', () => desenhar(k)); b.dataset.k = k;
      const n = porCargo.get(k)?.length || 0;
      b.append(el('span', 'pl-ic', ICO[k]), el('b', '', PLURAL[k]), el('small', '', k === 'P' ? (n ? 'do Brasil' : 'vaga') : n ? fmtN(n) : 'vaga'));
      bts.append(b);
    }
    c.append(grade, det); desenhar('P');

    const oficial = el('div'); c.append(oficial); montarPainelEleicoes(oficial, ctx, o?.cargo as any, () => abrir('casa'));
    if (o?.alvo !== undefined) toast(`para votar em @${dados.USR[o.alvo]}, ele precisa estar inscrito como candidato`, 4000);
  }

  /* ---------- Ranking ---------- */
  function ranking(c: HTMLElement, o: { cid?: Cidade }) {
    const eu = ctx.eu();
    const seg = el('div', 'seg'); const corpo = el('div'); c.append(el('div', 'centro'), seg, corpo);
    const cidRef = o?.cid || (eu >= 0 ? dados.CID[dados.CID_DE[eu]] : dados.ORDEM[0]);
    if (!cidRef) { const v = el('div', 'cartao-b'); v.append(el('h2', '', 'o ranking começa agora'), el('p', 'nota', 'ainda não tem nenhuma casa no mapa. Comente sua cidade no post do jogo no Instagram e seja o primeiro morador do Brasil virtual.')); corpo.append(v); return; }
    const escopos = [['cidade', 'Cidade'], ['estado', 'Estado'], ['brasil', 'Brasil']];
    const desenhar = (k: string) => {
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      corpo.innerHTML = '';
      let lista: number[] = [];
      let titulo = '';
      if (k === 'cidade') { for (let g = cidRef.ini; g < cidRef.ini + cidRef.n; g++) lista.push(g); titulo = `${cidRef.nome} · ${cidRef.uf}`; }
      else if (k === 'estado') { for (const ci of dados.ESTADOS.get(cidRef.uf)!.cidades) for (let g = ci.ini; g < ci.ini + ci.n; g++) lista.push(g); titulo = dados.ESTADOS.get(cidRef.uf)!.nome; }
      else { for (let g = 0; g < D.n; g++) lista.push(g); titulo = 'Brasil'; }
      lista.sort((a, b) => D.pts[b] - D.pts[a] || a - b);
      const cab = el('div', 'cartao-b'); cab.append(el('h2', '', titulo), el('p', 'nota', `${fmtN(lista.length)} moradores · ${fmtN(lista.reduce((s, g) => s + D.pts[g], 0))} pontos na semana`));
      if (k === 'cidade') cab.append(botao('btn mini', 'outra cidade', () => { fechar(); $('q').focus(); }), botao('btn mini', 'ver no mapa', () => { fechar(); ctx.mostrarCidade(cidRef); }));
      corpo.append(cab);
      if (lista[0] !== undefined) {
        const ch = botao('rk-chefe', '', () => { fechar(); ctx.mostrarCasa(lista[0]); });
        const t = el('span'); t.append(el('small', '', k === 'cidade' ? `prefeito de ${cidRef.nome}` : k === 'estado' ? `governador de ${cidRef.uf}` : 'presidente do Brasil'), el('b', '', '@' + dados.USR[lista[0]]));
        const n = el('span', 'n'); n.append(fmtN(D.pts[lista[0]]), el('small', '', ' pontos'));
        ch.append(t, n); corpo.append(ch);
      }
      const box = el('div', 'cartao-b');
      lista.slice(0, 100).forEach((g, i) => {
        const b = botao('rk' + (i < 3 ? ' p' + (i + 1) : '') + (g === eu ? ' eu' : ''), '', () => { fechar(); ctx.mostrarCasa(g); });
        const cg = dados.cargo(g); const nm = el('span', 'nome'); nm.append(el('b', '', '@' + dados.USR[g]), el('small', '', cg ? CARGOS[cg].nome : 'morador'));
        b.append(el('span', 'pos', i + 1), nm, el('span', 'n', fmtN(D.pts[g]))); box.append(b);
      });
      corpo.append(box);
      if (eu >= 0) {
        const pos = lista.indexOf(eu) + 1;
        if (pos > 100) { const me = el('div', 'cartao-b papel'); me.append(el('p', '', `você: @${dados.USR[eu]} · #${fmtN(pos)} · ${fmtN(D.pts[eu])} pontos`)); corpo.append(me); }
      }
    };
    for (const [k, r] of escopos) { const b = botao('', r, () => desenhar(k)); b.dataset.k = k; seg.append(b); }
    desenhar(o?.cid ? 'cidade' : eu >= 0 ? 'cidade' : 'brasil');
  }

  /* ---------- Lojas ---------- */
  function lojas(c: HTMLElement) {
    const hero = el('div', 'cartao-b papel');
    hero.append(el('h2', '', 'visite as lojas do mapa'), el('p', 'nota', 'cada loja é um espaço patrocinado e identificado. Marcar o @ da loja num comentário de um post do jogo vale +10 XP (1 vez por loja).'));
    c.append(hero);
    const busca = el('input'); busca.placeholder = 'buscar loja ou cidade'; busca.className = 'frase-inp'; c.append(busca);
    const lista = el('div'); c.append(lista);
    const pinta = () => {
      lista.innerHTML = ''; const t = semAcento(busca.value);
      const l = D.lojas.filter((x) => !t || semAcento(x.nome + ' ' + (MUN.get(x.ibge)?.nome || '')).includes(t));
      if (!l.length) lista.append(el('p', 'msg', 'nenhuma loja encontrada.'));
      for (const x of l) {
        const m = MUN.get(x.ibge); const card = el('div', 'cartao-b'); const it = el('div', 'lj-item'); const bola = el('span', 'bola'); bola.style.background = x.cor;
        const tx = el('span', 't'); tx.append(el('b', '', x.nome), el('small', '', `${x.tipo} · ${m?.nome}-${m?.uf} · até ${x.ate.split('-').reverse().slice(0, 2).join('/')}`));
        it.append(bola, tx, botao('btn mini prim', 'visitar', () => { fechar(); const cc = dados.POR_IBGE.get(x.ibge); if (cc) ctx.mostrarCidade(cc); }));
        card.append(it, el('p', 'nota', x.desc), el('span', 'etiq am', 'patrocinado')); lista.append(card);
      }
    };
    busca.oninput = pinta; pinta();
  }

  /* ---------- Como funciona ---------- */
  function como(c: HTMLElement) {
    const o = el('div', 'cartao-b cs-obj'); o.append(el('small', '', 'O OBJETIVO'), el('h2', '', 'construir o Brasil virtual e cuidar da sua cidade'), el('p', '', 'comenta sua cidade → ganha sua casa → ganha pontos e ajuda sua rua e sua cidade → a cada semana tem eleição virtual e competição de ruas · domingo 21h fecha e começa de novo'));
    c.append(o);
    const card = (tit: string, ic: string, itens: string[], escuro = false) => { const s = el('div', 'cartao-b cs-c' + (escuro ? ' escuro' : '')); const h = el('h3'); const i = el('span', 'cs-ic'); i.innerHTML = ICONES[ic]; h.append(i, tit); const ul = el('ul'); for (const t of itens) ul.append(el('li', '', t)); s.append(h, ul); c.append(s); };
    card('sua casa', 'casa', ['comenta sua cidade e UF em qualquer post do @viraruajogo', `a casa nasce na hora com ${PONTOS.casa} pontos`, 'cresce com os seus pontos e nunca encolhe', 'para editar e ter avatar, reivindique pelo Instagram (link privado)']);
    card('sua rua', 'rua', ['toda casa fica numa rua virtual da sua cidade', 'ruas disputam um troféu semanal com missões', 'competição de ruas não escolhe prefeito']);
    card('eleição virtual', 'urna', ['cargos do jogo: líder da rua, prefeito e presidente', 'um voto por eleitor em cada eleição, pode trocar até fechar', 'pontos, compartilhamentos e pagamentos não mudam o peso do voto', 'eleição sem quorum deixa o cargo vago, sem inventar vencedor'], true);
    const duv = el('div', 'cartao-b'); duv.append(el('h2', '', 'dúvidas'));
    for (const [p, r] of [
      ['quem vê meu voto?', 'ninguém vê em quem você votou: só os totais aparecem.'],
      ['zerou meus pontos?', 'domingo zera só os pontos da semana. Casa, nível e XP ficam.'],
      ['não recebi os pontos', 'missão e trabalho entram na hora. Comentário e loja marcada entram quando o comentário chega (alguns minutos). Amigo marcado só conta quando ele confirma a casa. Veja tudo em "meus pontos".'],
      ['é eleição de verdade?', 'não. É um jogo, sem nenhum vínculo com governo ou eleição real.'],
      ['e o app?', 'no celular, use "adicionar à tela inicial": vira app com ícone e tela cheia.'],
    ]) { const q = el('div', 'cs-q'); q.append(el('b', '', p), el('span', '', r)); duv.append(q); }
    c.append(duv);
    const nv = el('div', 'cartao-b'); nv.append(el('h2', '', 'níveis da casa'));
    for (const i of [0, 9, 19, 29, 39, 49]) { const l = el('div', 'linha'); l.append(el('span', '', `${i + 1} · ${NIVEIS[i].nome}`), el('b', '', fmtN(NIVEIS[i].min) + '+ pts')); nv.append(l); }
    c.append(nv);
  }

  /* ---------- Seu negócio no mapa ---------- */
  function negocio(c: HTMLElement, o: { ibge?: number }) {
    const box = el('div', 'cartao-b');
    box.append(el('h2', '', 'Assim o seu negócio aparece no mapa'), el('p', 'nota', 'vira um prédio com selo "patrocinado" na cidade escolhida. Estar no mapa é um cenário virtual: não afirma presença física.'));
    const campos: [string, string, string][] = [['cidade', 'digite a cidade', 'cidade'], ['nome', 'ex.: Padaria do Zé', 'nome do negócio'], ['ig', 'seunegocio', '@ do Instagram do negócio'], ['zap', '(27) 99999-0000', 'WhatsApp do negócio']];
    const vals: Record<string, HTMLInputElement> = {};
    for (const [k, ph, rot] of campos) { const f = el('div', 'form-campo'); const lb = el('label', '', rot); const i = el('input'); i.placeholder = ph; vals[k] = i; f.append(lb, i); box.append(f); }
    if (o?.ibge) { const m = MUN.get(o.ibge); if (m) vals.cidade.value = `${m.nome} - ${m.uf}`; }
    const tipos = el('div', 'tipos'); let tipo = 'cafe';
    for (const [k, n] of [['cafe', 'Cafeteria'], ['restaurante', 'Restaurante'], ['loja', 'Loja'], ['pet', 'Pet shop'], ['eventos', 'Espaço de eventos']]) { const b = botao(k === tipo ? 'on' : '', n, () => { tipo = k; tipos.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }); tipos.append(b); }
    const ft = el('div', 'form-campo'); ft.append(el('label', '', 'tipo'), tipos); box.append(ft);
    const msg = el('p', 'msg');
    box.append(botao('btn prim bloco', 'enviar para análise', async () => {
      if (!vals.nome.value.trim() || !vals.cidade.value.trim()) { msg.className = 'msg erro'; msg.textContent = 'preencha cidade e nome do negócio.'; return; }
      const r = await api.pedidoNegocio({ cidade: vals.cidade.value, nome: vals.nome.value, ig: vals.ig.value, zap: vals.zap.value, tipo });
      msg.className = 'msg ' + (r.ok ? 'ok' : 'erro'); msg.textContent = r.ok ? `pedido ${r.codigo} recebido. A equipe verifica o negócio antes de publicar; nada é cobrado automaticamente.` : r.erro || 'não consegui enviar agora.';
    }), msg);
    c.append(box);
    c.append(el('p', 'nota', 'não aceitamos apostas, IPTV/pirataria, conteúdo adulto, política partidária, armas ou remédio controlado. Bares e promoções de bebida ficam desabilitados até a revisão de faixa etária.'));
  }

  /* ---------- Notificações ---------- */
  async function notificacoes(c: HTMLElement) {
    const r = await fetch('/api/notificacoes', { credentials: 'same-origin' }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) { c.append(el('p', 'msg', 'entre na sua conta para ver as notificações.')); return; }
    if (!r.itens.length) c.append(el('div', 'cartao-b', 'nada novo por aqui. Quando sua rua eleger um líder, a obra ficar pronta ou alguém entrar na sua empresa, aparece aqui.'));
    for (const n of r.itens) {
      const b = el('button', 'cartao-b notif' + (n.lida ? '' : ' nova')); (b as HTMLButtonElement).type = 'button';
      b.append(el('b', '', n.titulo), el('span', '', n.texto), el('small', 'nota', new Date(n.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })));
      b.onclick = () => { if (!n.acao) return; if (n.acao.startsWith('u:')) { fechar(); ctx.buscar('@' + n.acao.slice(2)); } else abrir(n.acao); }; c.append(b);
    }
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|; )smn_csrf=([^;]+)/)?.[1] || '');
    void fetch('/api/notificacoes/lidas', { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf': csrf } }).then(() => (window as any).__pollNotif?.());
  }

  /* ---------- Destaques da semana (vídeos gerados pelo estúdio) ---------- */
  function videos(c: HTMLElement) {
    c.append(el('p', 'nota', 'vídeos gerados automaticamente pelo estúdio a partir do que aconteceu no jogo. Estes são de DEMONSTRAÇÃO, com dados fictícios.'));
    for (const [arq, tit] of [['casa', 'nasceu uma casa nova'], ['votacao', 'disputa apertada na eleição virtual'], ['resultado', 'resultado da eleição virtual']]) {
      const b = el('div', 'cartao-b'); b.append(el('h2', '', tit));
      const v = el('video'); v.src = '/videos/' + arq + '.mp4'; v.poster = '/videos/' + arq + '.jpg'; v.controls = true; v.playsInline = true; v.preload = 'none'; v.style.cssText = 'width:100%;max-height:70vh;border:3px solid var(--ink);border-radius:16px;background:#000';
      b.append(v); c.append(b);
    }
  }

  /* ---------- Reivindicar (fluxo oficial: link privado do Instagram ou código) ---------- */
  function reivindicar(c: HTMLElement, o: { gi?: number }) {
    const box = el('div', 'cartao-b');
    box.append(el('h2', '', 'reivindicar a casa'), el('p', '', 'digitar um @ nunca libera a casa. A prova é feita pelo Instagram oficial do jogo:'));
    const ol = el('ol'); for (const t of ['quando você comenta a cidade em qualquer post do @viraruajogo, o jogo responde no privado com um link de uso único;', 'abra o link e confirme: a casa fica sua e libera avatar, frase e decoração;', 'se o link não chegar, gere um código aqui e mande do seu perfil em qualquer post do @viraruajogo.']) ol.append(el('li', '', t));
    box.append(ol);
    // o código é gerado e conferido na página de reivindicar (copiar, conferência automática e confirmação)
    box.append(Object.assign(el('a', 'btn prim bloco', 'gerar código de verificação'), { href: '/reivindicar.html' }));
    c.append(box);
  }

  /* ---------- Ruas ---------- */
  async function ruas(c: HTMLElement, o: { cid?: Cidade }) {
    const cid = o?.cid || dados.CID[dados.CID_DE[Math.max(0, ctx.eu())]];
    const box = el('div', 'cartao-b'); box.append(el('h2', '', `ruas de ${cid.nome}`)); const st = el('p', 'nota', 'carregando…'); box.append(st); c.append(box);
    const r = await api.ruasDaCidade(cid.ibge); st.remove();
    if (!r.ok) { box.append(el('p', 'msg erro', r.erro || 'servidor indisponível.')); return; }
    if (!r.ruas.length) box.append(el('p', 'msg', 'nenhuma rua com morador reivindicado ainda. A primeira casa reivindicada abre a primeira rua pública.'));
    for (const ru of r.ruas) { const l = el('div', 'linha'); l.append(el('span', '', `${ru.nome} · ${ru.status}`), el('b', '', `${ru.ocupadas}/${ru.capacidade}`)); box.append(l); }
  }

  return { abrir, fechar, fecharTopo: () => { if (aberto) { fechar(); return true; } return false; }, ativo: () => aberto };
}
