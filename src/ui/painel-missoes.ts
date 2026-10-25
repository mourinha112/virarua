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

export function montarPainelMissoes(corpo: HTMLElement, _ctx?: Ctx) {
  corpo.innerHTML = '';
  const topo = el('div', 'bloco am'), lista = el('div', 'bloco'), obra = el('div', 'bloco'), comp = el('div', 'bloco');
  corpo.append(topo, lista, obra, comp);
  topo.append(el('p', 'nota', 'carregando missões…'));
  void desenhar();

  async function desenhar() {
    const r = await recompensasApi.missoes();
    if (!r.ok) { topo.innerHTML = ''; topo.append(el('p', 'msg erro', r.erro)); lista.hidden = obra.hidden = comp.hidden = true; return; }
    const feitas = r.missoes.filter((m) => m.concluida).length;
    topo.innerHTML = ''; lista.innerHTML = '';
    const pts = el('div', 'pts-grande'); pts.append(el('b', '', `${feitas}/3`), el('span', '', 'missões de hoje'));
    topo.append(el('h3', '', 'seu dia'), pts, barra((feitas / 3) * 100, 'missões concluídas hoje'),
      linha('XP hoje (teto ' + r.resumo.teto_xp_dia + ')', `${r.resumo.xp_hoje}`),
      linha('pontos dados para a rua hoje', `${r.resumo.contribuicao_hoje}/${r.resumo.teto_contribuicao_dia}`),
      linha('XP total da casa', `${r.resumo.xp_total}`),
      el('p', 'nota', 'missões são curtas e sem obrigação de postar nada. Ficar dias sem entrar não tira a sua casa.'));
    if (!r.morador) { lista.append(el('h3', '', 'missões'), el('p', 'msg erro', 'reivindique a sua casa para fazer missões.')); obra.hidden = comp.hidden = true; return; }
    lista.append(el('h3', '', 'missões do dia'));
    for (const m of r.missoes) lista.append(cartaoMissao(m));
    if (r.rua) { obra.hidden = comp.hidden = false; void desenharObra(r.rua); void desenharCompeticao(r.rua); }
    else { obra.innerHTML = ''; obra.append(el('h3', '', 'obra da rua'), el('p', 'nota', 'entre numa rua para ajudar a obra comunitária e disputar a semana.')); comp.hidden = true; }
  }

  function cartaoMissao(m: MissaoUI) {
    const box = el('div', 'linha'); const info = el('div');
    info.append(el('b', '', m.titulo), el('br'), el('small', '', m.descricao));
    if (m.concluida && m.motivo_sem_ponto) info.append(el('br'), el('small', '', MOTIVO[m.motivo_sem_ponto] || ''));
    box.append(info);
    if (m.concluida) box.append(el('span', 'chip am', m.pontuou_rua ? 'feita · +10 rua' : 'feita'));
    else {
      const area = el('div');
      const b = botao('btn mini prim', 'fazer', async () => {
        b.disabled = true; const d = await recompensasApi.desafio(m.id);
        if (!d.ok) { b.disabled = false; toast(d.erro); return; }
        box.after(areaDesafio(m, d.desafio)); b.hidden = true;
      });
      area.append(b); box.append(area);
    }
    return box;
  }

  /** desenha o desafio emitido pelo servidor; a resposta volta para o servidor validar */
  function areaDesafio(m: MissaoUI, d: DesafioUI) {
    const box = el('div', 'cartao-b'); const msg = el('p', 'msg'); const e = d.enunciado;
    const enviar = async (resposta: unknown) => {
      msg.className = 'msg'; msg.textContent = 'conferindo…';
      const r = await recompensasApi.concluir(m.id, d.id, resposta);
      if (!r.ok) { msg.className = 'msg erro'; msg.textContent = r.erro; return; }
      const xp = r.recompensas.find((x) => x.sistema === 'xp'), rua = r.recompensas.find((x) => x.sistema === 'contribuicao');
      toast(r.ja_concluida ? 'essa missão já estava feita hoje' : `+${xp?.quantidade ?? 0} XP${rua?.quantidade ? ` · +${rua.quantidade} para a rua` : ''}`);
      void desenhar();
    };
    box.append(el('b', '', e.pergunta || 'desafio'));
    if (d.tipo === 'conta' || d.tipo === 'peca') {
      if (e.padrao) box.append(el('p', 'pts-grande', e.padrao.join(' ')));
      const ops = el('div'); for (const o of e.opcoes) ops.append(botao('btn mini', String(o), () => enviar(o)), document.createTextNode(' '));
      box.append(ops);
    } else if (d.tipo === 'sequencia') {
      const alvo = el('p', 'nota', 'sequência: ' + e.sequencia.map((s: string) => EMOTE[s] || s).join(' → '));
      const escolhidos: string[] = []; const atual = el('p', 'nota', 'você: —');
      const ops = el('div');
      for (const o of e.opcoes) ops.append(botao('btn mini', EMOTE[o] || o, () => {
        escolhidos.push(o); atual.textContent = 'você: ' + escolhidos.map((s) => EMOTE[s] || s).join(' → ');
        if (escolhidos.length === e.sequencia.length) { void enviar([...escolhidos]); escolhidos.length = 0; }
      }), document.createTextNode(' '));
      box.append(alvo, ops, atual, el('p', 'nota', 'faça com calma: respostas instantâneas não valem.'));
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
