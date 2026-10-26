/* "Meus pontos": como ganhar (só o que o servidor confere de verdade), de onde veio cada XP,
   amigos marcados no Instagram e o extrato das últimas entradas. Sem login mostra só o "como ganhar". */
import { el, botao } from './dom';
import { api } from '../api/cliente';
import { recompensasApi, type ExtratoUI } from '../api/recompensas';

const fmt = (n: number) => n.toLocaleString('pt-BR');
export const COMO_GANHAR: [string, string, string][] = [
  ['✅', 'cada missão do dia', '+5 XP (e +10 pra rua)'],
  ['💼', 'trabalhar no dia', '+10 XP'],
  ['💬', 'comentar num post do @viraruajogo', '+5 XP por post, 1 vez por dia'],
  ['🤝', 'marcar um @amigo que ainda não joga, e ele ganhar a casa', '+50 XP por amigo'],
  ['🏪', 'marcar o @ de uma loja do mapa num comentário do jogo', '+10 XP, 1 vez por loja'],
  ['🎉', 'eventos da cidade e da semana', 'varia'],
];
const FONTE: Record<string, string> = { missao: '✅ missões', trabalho: '💼 trabalho', comentario: '💬 comentários', amigo: '🤝 amigos', loja: '🏪 lojas marcadas', evento: '🎉 eventos', obra: '🏗️ obra', competicao: '🏆 competição' };

function rotulo(x: ExtratoUI) {
  if (x.regra_id.startsWith('xp5_comentario')) return '💬 comentou num post do jogo';
  if (x.regra_id.startsWith('xp50_amigo')) return `🤝 @${x.dados?.amigo || 'amigo'} entrou no jogo`;
  if (x.regra_id.startsWith('xp10_loja')) return `🏪 marcou @${x.evento_ref.replace(/^loja:/, '')}`;
  if (x.evento_ref === 'trabalho') return '💼 trabalhou';
  if (x.origem === 'missao') return '✅ missão ' + (x.evento_ref.split(':')[1] || '');
  return FONTE[x.origem] || x.origem;
}

export function blocoComoGanhar() {
  const s = el('div', 'cartao-b am'); s.append(el('h2', '', '⭐ como ganhar pontos'));
  for (const [ic, t, v] of COMO_GANHAR) { const l = el('div', 'linha'); l.append(el('span', '', `${ic} ${t}`), el('b', '', v)); s.append(l); }
  s.append(el('p', 'nota', 'pra marcar: escreva @nomedoamigo no comentário de qualquer post do @viraruajogo. Vale pra quem marcou primeiro e só se o amigo ainda não tinha casa. Os pontos entram quando o amigo confirma a casa dele.'));
  s.append(el('p', 'nota', 'teto de 100 XP por dia. Seguir uma loja não dá ponto: o Instagram não deixa a gente conferir quem segue.'));
  return s;
}

export async function montarPainelPontos(c: HTMLElement, abrir: (id: string, o?: any) => void) {
  const st = el('p', 'nota', 'carregando…'); c.append(st);
  const eu = await api.eu();
  const r = eu.ok && eu.casa ? await recompensasApi.pontos() : null;
  st.remove();
  if (!r || !r.ok) {
    c.append(blocoComoGanhar());
    const s = el('div', 'cartao-b'); s.append(el('p', 'nota', 'pra somar pontos você precisa reivindicar a sua casa pelo Instagram.'), botao('btn prim', 'reivindicar minha casa', () => abrir('reivindicar')));
    c.append(s); return;
  }
  const t = el('div', 'cartao-b'); t.append(el('h2', '', '📊 meus pontos'));
  const g = el('div', 'pts-grande'); g.append(el('b', '', fmt(r.resumo.xp_total)), el('span', '', 'XP no total')); t.append(g);
  const l = el('div', 'linha'); l.append(el('span', '', 'hoje'), el('b', '', `${r.resumo.xp_hoje} de ${r.resumo.teto_xp_dia}`)); t.append(l);
  const max = Math.max(1, ...r.fontes.map((f) => f.xp));
  if (r.fontes.length) {
    t.append(el('h3', '', 'de onde vieram'));
    for (const f of r.fontes) {
      const ln = el('div', 'linha'); ln.append(el('span', '', `${FONTE[f.fonte] || f.fonte} (${f.vezes}x)`), el('b', '', fmt(f.xp)));
      const b = el('div', 'barra'); const i = el('i'); i.style.width = Math.round((100 * f.xp) / max) + '%'; b.append(i); t.append(ln, b);
    }
  } else t.append(el('p', 'nota', 'nenhum ponto ainda. Comece pelas missões do dia!'));
  t.append(botao('btn mini prim', 'fazer missões', () => abrir('missoes')));
  c.append(t);

  const am = el('div', 'cartao-b'); am.append(el('h2', '', '🤝 amigos que você marcou'));
  if (!r.amigos.length) am.append(el('p', 'nota', 'ninguém ainda. Marque @amigos nos comentários dos posts do jogo: +50 XP por amigo que ganhar a casa.'));
  for (const a of r.amigos) { const ln = el('div', 'linha'); ln.append(el('span', '', '@' + a.amigo), el('b', '', a.estado === 'pago' ? '✅ +50' : '⏳ esperando ele entrar')); am.append(ln); }
  c.append(am);

  c.append(blocoComoGanhar());

  if (r.extrato.length) {
    const ex = el('div', 'cartao-b'); ex.append(el('h2', '', '🧾 últimos pontos'));
    for (const x of r.extrato) { const ln = el('div', 'linha'); ln.append(el('span', '', `${x.quando} · ${rotulo(x)}`), el('b', '', `+${x.quantidade}` + (x.limitado ? ' (teto)' : ''))); ex.append(ln); }
    c.append(ex);
  }
}
