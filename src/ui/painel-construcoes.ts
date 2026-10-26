/* "O que dá pra construir": catálogo de tudo que nasce no mapa e quanto precisa — casa (seus pontos), obra da rua
   (pontos dos vizinhos), prefeitura e aeroporto (casas na cidade) e o pet. Mostra o progresso de quem está logado
   (ou do @ lembrado neste aparelho). Os números vêm das mesmas regras do mapa. */
import type { Ctx } from './app';
import { el, botao } from './dom';
import { api } from '../api/cliente';
import { recompensasApi } from '../api/recompensas';
import { NIVEIS } from '../jogo/regras';
import { META_AEROPORTO } from '../mundo/aeroportos';

const fmt = new Intl.NumberFormat('pt-BR');
const VILA_ATE = 25, META_PET = 50;
const CASAS: { nivel: number; ic: string; nome: string }[] = [
  { nivel: 1, ic: '🏠', nome: 'casinha térrea' }, { nivel: 3, ic: '🏡', nome: 'sobrado' }, { nivel: 7, ic: '🏘️', nome: 'casa alta de laje' },
  { nivel: 12, ic: '🏢', nome: 'prédio de 5 andares' }, { nivel: 20, ic: '🏙️', nome: 'torre de vidro' },
];
const OBRAS: { ic: string; nome: string; etapas: string }[] = [
  { ic: '🌷', nome: 'Jardim da rua', etapas: 'terra → mudas → flores e cerca' },
  { ic: '🪑', nome: 'Banco da amizade', etapas: 'base → assento → pintura e placa' },
  { ic: '💡', nome: 'Praça iluminada', etapas: 'postes → fiação → luzes acesas' },
  { ic: '🛹', nome: 'Pista de skate', etapas: 'terra → rampas → acabamento' },
  { ic: '📚', nome: 'Biblioteca virtual', etapas: 'paredes → estantes → telhado e luz' },
];

function item(ic: string, nome: string, req: string, atual: number | null, meta: number, extra?: string) {
  const ok = atual !== null && atual >= meta;
  const l = el('div', 'rk' + (ok ? ' eu' : ''));
  const nm = el('span', 'nome'); nm.append(el('b', '', `${ic} ${nome}`), el('small', '', req + (extra ? ' · ' + extra : '')));
  l.append(el('span', 'pos', ok ? '✅' : atual === null ? '·' : '🔒'), nm, el('span', 'n', atual === null ? '' : ok ? 'liberado' : `${fmt.format(atual)}/${fmt.format(meta)}`));
  return l;
}
function barra(f: number) { const b = el('div', 'barra'); const i = el('i'); i.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; b.append(i); return b; }

export async function montarPainelConstrucoes(c: HTMLElement, ctx: Ctx, abrir: (id: string, o?: any) => void) {
  const st = el('p', 'nota', 'carregando…'); c.append(st);
  const eu = await api.eu();
  let pts: number | null = null, ibge: number | null = null, rua: string | null = null;
  if (eu.ok && eu.casa) {
    const rec = await api.recompensas();
    pts = rec.ok ? rec.resumo.xp_total : (eu.casa as any).xp || 0; ibge = eu.casa.cidade.ibge; rua = eu.rua?.id || null;
  } else { const gi = ctx.eu(); if (gi >= 0) { pts = ctx.dados.p.tot[gi]; ibge = ctx.dados.CID[ctx.dados.CID_DE[gi]].ibge; } }
  st.remove();
  const cid = ibge ? ctx.dados.POR_IBGE.get(ibge) : null;

  // 1) casa
  const s1 = el('div', 'cartao-b am'); s1.append(el('h2', '', '🏠 sua casa · cresce com os SEUS pontos'));
  s1.append(el('p', 'nota', 'missões, trabalho e ajudar a obra dão pontos. A casa nunca encolhe.'));
  for (const k of CASAS) s1.append(item(k.ic, k.nome, `a partir do nível ${k.nivel}`, pts, NIVEIS[k.nivel - 1].min));
  s1.append(item('👑', 'palácio do presidente', 'só quem vence a eleição de presidente', null, 1));
  c.append(s1);

  // 2) pet
  const sp = el('div', 'cartao-b'); sp.append(el('h2', '', '🐾 seu pet'));
  sp.append(item('🐶', 'cachorro ou gato na frente da casa', `${META_PET} pontos`, pts, META_PET));
  sp.append(botao('btn mini', 'abrir meu pet', () => abrir('pet'))); c.append(sp);

  // 3) obra da rua
  const s2 = el('div', 'cartao-b'); s2.append(el('h2', '', '🏗️ obras da rua · pontos dos VIZINHOS juntos'));
  s2.append(el('p', 'nota', 'cada missão de obra leva +10. A obra precisa de 6 pontos por morador (mínimo 30) e ninguém faz mais da metade sozinho. Pronta, ela fica no mapa pra sempre e a próxima começa.'));
  const atualObra = el('div'); s2.append(atualObra);
  OBRAS.forEach((o, i) => { const l = el('div', 'rk'); const nm = el('span', 'nome'); nm.append(el('b', '', `${o.ic} ${o.nome}`), el('small', '', o.etapas)); l.append(el('span', 'pos', String(i + 1)), nm); s2.append(l); });
  s2.append(botao('btn mini prim', 'fazer missões de obra', () => abrir('missoes')));
  c.append(s2);
  if (rua) void recompensasApi.obra(rua).then((r) => {
    if (!r.ok) return; const o = r.obra;
    atualObra.append(el('p', '', `agora na sua rua: ${o.titulo} · ${o.progresso}/${o.meta}`), barra(o.progresso / o.meta),
      el('p', 'nota', `prontas: ${o.concluidas.length ? o.concluidas.map((x) => x.titulo).join(', ') : 'nenhuma ainda'}`));
  });

  // 4) cidade
  const s3 = el('div', 'cartao-b'); s3.append(el('h2', '', `🏙️ ${cid ? cid.nome : 'sua cidade'} · casas na cidade`));
  s3.append(el('p', 'nota', 'cada pessoa que comenta a cidade num post do @viraruajogo vira uma casa. Chame a galera da sua cidade!'));
  const n = cid ? cid.n : null;
  s3.append(item('🏘️', 'vila com pracinha', 'a 1ª casa', n, 1));
  s3.append(item('🏛️', 'prefeitura, praça e rotatória', `${VILA_ATE} casas`, n, VILA_ATE));
  s3.append(item('🏪', 'lojas na praça (6 vagas)', 'cidade com prefeitura', n, VILA_ATE));
  s3.append(item('✈️', 'aeroporto com aviões', `${fmt.format(META_AEROPORTO)} casas`, n, META_AEROPORTO));
  if (n !== null && n < META_AEROPORTO) s3.append(el('p', 'nota', `faltam ${fmt.format(META_AEROPORTO - n)} casas para o aeroporto de ${cid!.nome}.`), barra(n / META_AEROPORTO));
  c.append(s3);

  // 5) rua e cargos
  const s4 = el('div', 'cartao-b'); s4.append(el('h2', '', '🏆 conquistas da semana'));
  s4.append(item('🏆', 'troféu de rua campeã', 'rua com mais pontos da cidade na semana (3+ moradores)', null, 1));
  s4.append(item('🗳️', 'líder, prefeito ou presidente', 'eleição de seg a dom; o cargo muda a sua casa', null, 1));
  s4.append(botao('btn mini', 'ver eleições', () => abrir('eleicoes')));
  c.append(s4);
}
