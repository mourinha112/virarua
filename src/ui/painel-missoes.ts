/* Painel da Fase 3: missões do dia (com desafio validado no servidor), progresso visual, obra da rua e competição.
   Usa só classes existentes de estilo.css. Montado por quem integra os painéis: montarPainelMissoes(corpo, ctx). */
import type { Ctx } from './app';
import { el, botao, toast } from './dom';
import { recompensasApi, type DesafioUI, type MissaoUI } from '../api/recompensas';

const MOTIVO: Record<string, string> = {
  fora_do_elenco: 'XP ganho; a rua só conta pontos de quem estava no elenco do início da semana',
  mudou_de_rua: 'XP ganho; seus pontos desta semana ficam com a rua do seu elenco',
  teto_diario: 'XP ganho; você já deu os 30 pontos de hoje para a rua',
};
const EMOTE: Record<string, string> = { acenar: 'acenar', comemorar: 'comemorar', sentar: 'sentar', palmas: 'palmas', coracao: 'coração', rir: 'rir' };

function barra(pct: number, rotulo: string) {
  const b = el('div', 'barra'); b.setAttribute('role', 'progressbar'); b.setAttribute('aria-label', rotulo);
  b.setAttribute('aria-valuemin', '0'); b.setAttribute('aria-valuemax', '100'); b.setAttribute('aria-valuenow', String(Math.round(pct)));
  const i = el('i'); i.style.width = Math.max(0, Math.min(100, pct)) + '%'; b.append(i); return b;
}
function linha(esq: string | HTMLElement, dir?: string | HTMLElement) {
  const l = el('div', 'linha'); l.append(typeof esq === 'string' ? el('span', '', esq) : esq); if (dir !== undefined) l.append(typeof dir === 'string' ? el('b', '', dir) : dir); return l;
}

const FERRAMENTA: Record<string, string> = { martelo: '🔨 martelo', tijolo: '🧱 tijolo', tinta: '🪣 tinta', serra: '🪚 serra', muda: '🌱 muda', lampada: '💡 lâmpada' };
const rotulo = (k: string) => FERRAMENTA[k] || EMOTE[k] || k;
const ICONE: Record<string, string> = { 'obra.etapa': '🧩', 'obra.material': '🚚', 'obra.ferramentas': '🧰', 'desafio.curto': '➗', 'atividade.praca': '💃', 'quiz.brasil': '🇧🇷', 'quiz.jogo': '❓' };

export function montarPainelMissoes(corpo: HTMLElement, ctx?: Ctx) {
  corpo.innerHTML = '';
  const topo = el('div', 'bloco am'), secObra = el('div', 'bloco'), lista = el('div', 'bloco'), obra = el('div', 'bloco'), comp = el('div', 'bloco');
  corpo.append(topo, secObra, lista, obra, comp);
  topo.append(el('p', 'nota', 'carregando missões…'));
  void desenhar();

  async function desenhar() {
    const r = await recompensasApi.missoes();
    if (!r.ok) { topo.innerHTML = ''; topo.append(el('p', 'msg erro', r.erro)); secObra.hidden = lista.hidden = obra.hidden = comp.hidden = true; return; }
    const total = r.missoes.length, feitas = r.missoes.filter((m) => m.concluida).length;
    topo.innerHTML = ''; lista.innerHTML = ''; secObra.innerHTML = '';
    const pts = el('div', 'pts-grande'); pts.append(el('b', '', `${feitas}/${total}`), el('span', '', 'missões de hoje'));
    topo.append(el('h3', '', feitas === total ? '🎉 tudo feito hoje! volte amanhã' : 'seu dia'), pts, barra((feitas / Math.max(1, total)) * 100, 'missões concluídas hoje'),
      linha('⭐ XP hoje (teto ' + r.resumo.teto_xp_dia + ')', `${r.resumo.xp_hoje}`),
      linha('🏆 pontos dados pra rua hoje', `${r.resumo.contribuicao_hoje}/${r.resumo.teto_contribuicao_dia}`),
      linha('XP total', `${r.resumo.xp_total}`));
    if (!r.morador) { lista.append(el('h3', '', 'missões'), el('p', 'msg erro', 'reivindique a sua casa para fazer missões.')); secObra.hidden = obra.hidden = comp.hidden = true; return; }
    const cartoes = new Map<string, HTMLElement>();
    const prox = r.missoes.find((m) => !m.concluida && (r.rua || !m.id.startsWith('obra.')));
    if (prox) topo.append(botao('btn prim bloco', `▶ fazer a próxima: ${ICONE[prox.id] || '⭐'} ${prox.titulo}`, () => { const b = cartoes.get(prox.id)?.querySelector<HTMLButtonElement>('button.fazer'); b?.scrollIntoView({ behavior: 'smooth', block: 'center' }); b?.click(); }));
    if (ctx) topo.append(botao('btn bloco', '🏛️ o que dá pra construir (e quanto precisa)', () => ctx.paineis.abrir('construcoes')));

    const deObra = r.missoes.filter((m) => m.id.startsWith('obra.')), outras = r.missoes.filter((m) => !m.id.startsWith('obra.'));
    secObra.append(el('h3', '', '🏗️ ajude a obra da sua rua'));
    if (!r.rua) secObra.append(el('p', 'nota', 'entre numa rua para liberar as missões de obra.'));
    else {
      secObra.append(el('p', 'nota', 'cada missão daqui leva +10 pra obra. A obra aparece no mapa, perto das casas da rua, e cresce a cada etapa.'));
      const mini = el('div'); secObra.append(mini); void miniObra(mini, r.rua);
    }
    for (const m of deObra) { const cd = cartaoMissao(m, !!r.rua); cartoes.set(m.id, cd); secObra.append(cd); }
    lista.append(el('h3', '', '⭐ missões do dia'));
    for (const m of outras) { const cd = cartaoMissao(m, !!r.rua); cartoes.set(m.id, cd); lista.append(cd); }
    lista.append(el('p', 'nota', 'missões são curtas. Até 30 pontos por dia vão pra competição da rua; o XP vai pra sua casa e pro seu pet.'));
    if (r.rua) { obra.hidden = comp.hidden = false; void desenharObra(r.rua); void desenharCompeticao(r.rua); }
    else { obra.hidden = true; comp.hidden = true; }
  }

  async function miniObra(c: HTMLElement, rua: string) {
    const r = await recompensasApi.obra(rua); if (!r.ok) return;
    const o = r.obra; const l = el('div', 'linha'); l.append(el('b', '', o.titulo), el('span', 'chip am', `etapa ${Math.min(o.etapa_atual + 1, o.etapas.length)} de ${o.etapas.length}`));
    c.append(l, barra((100 * o.progresso) / o.meta, 'progresso da obra'), el('small', 'nota', `${o.progresso}/${o.meta} · agora: ${o.etapas[o.etapa_atual]?.nome || 'pronta!'}`));
    c.append(botao('btn mini', '📍 ver a obra no mapa', () => { (window as any).__irMinhaCasa?.(); }));
  }

  function cartaoMissao(m: MissaoUI, temRua: boolean) {
    const wrap = el('div', 'cartao-b missao' + (m.concluida ? ' feita' : ''));
    const box = el('div', 'linha'); const info = el('div');
    const obraM = m.id.startsWith('obra.');
    info.append(el('b', '', `${ICONE[m.id] || '⭐'} ${m.titulo}`), el('br'), el('small', '', m.descricao));
    const premios = el('div', 'voto-chips'); premios.append(el('span', 'chip', '+5 XP'));
    if (temRua) premios.append(el('span', 'chip', '+10 rua'));
    if (obraM && temRua) premios.append(el('span', 'chip am', '+10 obra'));
    info.append(premios);
    if (m.concluida && m.motivo_sem_ponto) info.append(el('small', '', MOTIVO[m.motivo_sem_ponto] || ''));
    box.append(info);
    if (m.concluida) box.append(el('span', 'chip am', '✅ feita'));
    else if (obraM && !temRua) box.append(el('span', 'chip', '🔒 precisa de rua'));
    else {
      const b = botao('btn mini prim fazer', 'fazer', async () => {
        b.disabled = true; const d = await recompensasApi.desafio(m.id);
        if (!d.ok) { b.disabled = false; toast(d.erro); return; }
        wrap.append(areaDesafio(m, d.desafio)); b.hidden = true;
      });
      box.append(b);
    }
    wrap.append(box);
    return wrap;
  }

  /** desenha o desafio emitido pelo servidor; a resposta volta para o servidor validar */
  function areaDesafio(m: MissaoUI, d: DesafioUI) {
    const box = el('div', 'bloco'); const msg = el('p', 'msg'); const e = d.enunciado;
    const enviar = async (resposta: unknown) => {
      msg.className = 'msg'; msg.textContent = 'conferindo…';
      const r = await recompensasApi.concluir(m.id, d.id, resposta);
      if (!r.ok) { msg.className = 'msg erro'; msg.textContent = r.erro; return; }
      const xp = r.recompensas.find((x) => x.sistema === 'xp'), rua = r.recompensas.find((x) => x.sistema === 'contribuicao'), ob = (r as any).obra;
      const txtObra = ob?.ok && ob.quantidade ? ` · +${ob.quantidade} na obra 🏗️` : ob && !ob.ok ? ' · ' + ob.motivo : '';
      toast(r.ja_concluida ? 'essa missão já estava feita hoje' : `+${xp?.quantidade ?? 0} XP${rua?.quantidade ? ` · +${rua.quantidade} pra rua` : ''}${txtObra}`, 3500);
      (window as any).__obras3d?.recarregar(); (window as any).__atualizarPerfil?.();
      void desenhar();
    };
    box.append(el('b', '', e.pergunta || 'desafio'));
    if (d.tipo === 'conta' || d.tipo === 'peca') {
      if (e.padrao) box.append(el('p', 'pts-grande', e.padrao.join(' ')));
      const ops = el('div', 'hub-bts'); for (const o of e.opcoes) ops.append(botao('btn', String(o), () => enviar(o)));
      box.append(ops);
    } else if (d.tipo === 'sequencia') {
      const alvo = el('p', '', 'ordem: ' + e.sequencia.map(rotulo).join(' → '));
      const escolhidos: string[] = []; const atual = el('p', 'nota', 'você: —');
      const ops = el('div', 'hub-bts');
      for (const o of e.opcoes) ops.append(botao('btn', rotulo(o), () => {
        escolhidos.push(o); atual.textContent = 'você: ' + escolhidos.map(rotulo).join(' → ');
        if (escolhidos.length === e.sequencia.length) { void enviar([...escolhidos]); escolhidos.length = 0; }
      }));
      box.append(alvo, ops, atual, el('p', 'nota', 'faça com calma: respostas instantâneas não valem.'));
    } else if (d.tipo === 'quiz') {
      const resp: (number | null)[] = e.perguntas.map(() => null);
      const enviarB = botao('btn prim bloco', 'enviar respostas', () => enviar(resp)); enviarB.disabled = true;
      e.perguntas.forEach((q: { p: string; opcoes: string[] }, i: number) => {
        const bl = el('div', 'bloco'); bl.append(el('p', '', `${i + 1}. ${q.p}`));
        const ops = el('div', 'hub-bts');
        q.opcoes.forEach((o, k) => { const b = botao('btn', o, () => { resp[i] = k; ops.querySelectorAll('button').forEach((x) => x.classList.toggle('prim', x === b)); enviarB.disabled = resp.some((x) => x === null); }); ops.append(b); });
        bl.append(ops); box.append(bl);
      });
      box.append(enviarB, el('p', 'nota', 'uma tentativa só: se errar, amanhã tem outro.'));
    } else box.append(el('p', 'nota', 'este tipo de desafio abre pelo evento correspondente.'));
    box.append(msg);
    return box;
  }

  async function desenharObra(rua: string) {
    const r = await recompensasApi.obra(rua); obra.innerHTML = '';
    obra.append(el('h3', '', 'obra da rua'));
    if (!r.ok) { obra.append(el('p', 'msg erro', r.erro)); return; }
    const o = r.obra; const pct = (100 * o.progresso) / o.meta;
    obra.append(linha(o.titulo, `${o.progresso}/${o.meta}`), barra(pct, 'progresso da obra'));
    for (const [i, et] of o.etapas.entries()) obra.append(linha(`${i + 1}. ${et.nome}`, et.concluida ? el('span', 'chip am', 'pronta') : el('span', 'chip', 'em obra')));
    obra.append(linha('sua parte', `${o.minha_parte}/${o.meu_limite}`), linha('vizinhos que ajudaram', String(o.ajudantes)), el('p', 'nota', o.regras + '. A obra fica mesmo se a rua perder a semana.'));
    if (o.concluidas.length) obra.append(el('p', 'nota', 'já construídas: ' + o.concluidas.map((x) => x.titulo).join(', ')));
  }

  async function desenharCompeticao(rua: string) {
    const r = await recompensasApi.competicao(rua); comp.innerHTML = '';
    comp.append(el('h3', '', 'semana das ruas'));
    if (!r.ok) { comp.append(el('p', 'msg erro', r.erro)); return; }
    const exp = el('p', 'msg'); exp.append(el('b', '', 'Ruas disputam troféu; pessoas disputam cargos. '), document.createTextNode('Vencer o ranking não elege ninguém.'));
    comp.append(exp);
    if (r.eu?.aviso) comp.append(el('p', 'nota', r.eu.aviso));
    if (!r.participa || !r.entrada) comp.append(el('p', 'nota', r.motivo || 'sua rua entra na próxima temporada.'));
    else if (r.entrada.modo === 'competitivo' && r.ranking) {
      comp.append(linha(el('span', 'etiq', 'divisão ' + r.entrada.divisao), `${r.entrada.pontos} pts · ${r.entrada.participacao_pct}% participaram`));
      for (const x of r.ranking) {
        const nome = el('span', '', `${x.colocacao_atual}º ${x.nome}`); if (x.street_id === rua) nome.append(el('small', '', ' (sua rua)'));
        comp.append(linha(nome, `${x.pontos} pts · ${x.elenco} moradores`));
      }
      comp.append(el('p', 'nota', 'empate divide a colocação e o prêmio. Prêmio: troféu, faixa de campeã por uma semana e decoração — nada de dinheiro.'));
    } else if (r.cooperativo) {
      comp.append(linha(el('span', 'etiq am', 'meta cooperativa'), `${r.cooperativo.pontos}/${r.cooperativo.meta}`), barra(r.cooperativo.pct, 'meta cooperativa da rua'), el('p', 'nota', r.cooperativo.motivo));
      if (r.liga_regional) {
        comp.append(el('p', 'nota', r.liga_regional.rotulo));
        for (const x of r.liga_regional.ruas) comp.append(linha(`${x.nome} · ${x.cidade}`, `${x.pontos} pts`));
      }
    }
    if (r.trofeus.length) comp.append(el('p', 'nota', 'conquistas: ' + r.trofeus.map((t) => `${t.tipo} (${t.semana})`).join(', ')));
    const reg = el('details'); reg.append(el('summary', '', 'regras e limites'));
    const ul = el('ul'); for (const t of r.regras) ul.append(el('li', 'nota', t)); reg.append(ul); comp.append(reg);
  }
}
