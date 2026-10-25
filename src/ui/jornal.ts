/* Jornal do dia: manchetes geradas dos FATOS do jogo (nada inventado). Botão flutuante 📰 com bolinha quando há
   edição nova no dia. Cada matéria tem um botão que leva ao lugar no mapa ou ao painel. */
import type { Ctx } from './app';
import { el, botao, $ } from './dom';
import { fmtN, MUN } from '../dados/dados';
import { CARGOS, proximoFechamento } from '../jogo/regras';
import { META_AEROPORTO } from '../mundo/aeroportos';

const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const LS = 'smn_jornal_lido';
async function get(url: string) { try { const r = await fetch('/api' + url, { credentials: 'same-origin' }); const j = await r.json(); return j?.ok ? j : null; } catch { return null; } }

export function iniciarJornal(ctx: Ctx) {
  const b = el('button', 'jornal-fab'); (b as HTMLButtonElement).type = 'button'; b.setAttribute('aria-label', 'jornal do dia');
  b.innerHTML = '<span aria-hidden="true">📰</span><b>jornal</b><i></i>';
  const lido = (() => { try { return localStorage.getItem(LS) === hojeBR(); } catch { return false; } })();
  if (lido) b.querySelector('i')!.remove();
  b.onclick = () => { try { localStorage.setItem(LS, hojeBR()); } catch { /* ok */ } b.querySelector('i')?.remove(); ctx.paineis.abrir('jornal'); };
  $('app').append(b);
}

export async function montarJornal(c: HTMLElement, ctx: Ctx, abrir: (id: string, o?: any) => void, fechar: () => void) {
  const D = ctx.dados, P = D.p;
  const data = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const cab = el('header', 'jn-cab'); cab.append(el('small', '', data + (P.demo ? ' · edição de demonstração' : '')), el('h2', 'jn-nome', 'O DIÁRIO DO MUNDO NOVO'), el('small', '', 'notícias do Brasil virtual · jogo, sem vínculo com fatos reais'));
  c.append(cab);
  const materia = (chapeu: string, titulo: string, texto: string, acao?: [string, () => void], destaque = false) => {
    const m = el('article', 'jn-mat' + (destaque ? ' dest' : '')); m.append(el('span', 'jn-chapeu', chapeu), el('h3', '', titulo), el('p', '', texto));
    if (acao) m.append(botao('btn mini', acao[0], acao[1])); c.append(m);
  };

  // manchete: cidade que mais pontuou na semana
  const top = [...D.CID].sort((a, b) => b.pts - a.pts);
  const c1 = top[0];
  if (!c1) materia('manchete', 'o Brasil virtual abriu: quem vai ser o primeiro morador?', 'o mapa está zerado. Comente sua cidade e UF no post do jogo no Instagram e sua casa nasce aqui, na sua cidade. A primeira casa de cada cidade é a da fundadora ou do fundador.', undefined, true);
  if (c1) materia('manchete', `${c1.nome} lidera o Brasil virtual nesta semana`, `com ${fmtN(c1.pts)} pontos somados por ${fmtN(c1.n)} moradores, ${c1.nome} (${c1.uf}) está no topo. Logo atrás vêm ${top[1]?.nome} e ${top[2]?.nome}.`, ['ver a cidade', () => { fechar(); ctx.mostrarCidade(c1); }], true);

  // eleição clássica da semana (por pontos)
  if (D.presidente >= 0) { const gi = D.presidente, ci = D.CID[D.CID_DE[gi]]; materia('poder', `@${D.USR[gi]} segue como ${CARGOS.P.nome} da semana`, `morador de ${ci.nome}, soma ${fmtN(P.pts[gi])} pontos. A semana fecha domingo às 21h (Brasília): ainda dá tempo de virar.`, ['ver o ranking', () => abrir('ranking')]); }

  // sua rua e a eleição da rua (conta logada)
  const [rv, el1, emps] = await Promise.all([get('/rua-viva'), get('/eleicoes'), get('/empresas/mapa')]);
  if (rv?.rua) {
    const on = rv.moradores.filter((m: any) => m.user_id !== rv.eu && m.estado !== 'offline').length;
    const e = rv.eleicao;
    const txt = e && e.estado === 'votacao' ? `${e.votaram} de ${e.eleitorado} moradores já votaram para líder da rua${e.quorum > e.votaram ? `; faltam ${e.quorum - e.votaram} para o quorum` : ''}.` : `${rv.moradores.length} moradores na rua, ${on} online agora.`;
    materia('sua rua', `${rv.rua.nome}: ${e && e.estado === 'votacao' ? 'eleição esquentando' : 'movimento na vizinhança'}`, txt, ['abrir minha casa', () => abrir('casa')], true);
    if (rv.campeas?.length) materia('esporte', 'tem rua campeã na sua cidade', `${rv.campeas.map((x: any) => x.nome).join(', ')} levou o troféu da competição de ruas.`);
  }
  const lider = rv?.rua && el1?.eleicoes?.find((e: any) => e.cargo === 'lider');
  if (lider && lider.candidatos?.length) materia('eleição virtual', `${lider.candidatos.length} candidatos disputam a liderança da sua rua`, `${lider.candidatos.map((k: any) => '@' + k.handle).join(' e ')} estão na disputa. Cada morador vota 1 vez e pode trocar até domingo 20h.`, ['votar', () => abrir('casa')]);

  // aeroporto: quem já tem e quem está perto
  const com = D.CID.filter((x) => x.n >= META_AEROPORTO), perto = D.CID.filter((x) => x.n < META_AEROPORTO).sort((a, b) => b.n - a.n)[0];
  materia('transporte', com.length ? `${com.length} cidades já têm aeroporto` : 'a corrida pelo primeiro aeroporto', `${com.map((x) => x.nome).join(', ') || 'nenhuma ainda'}${perto ? `. ${perto.nome} está mais perto de ganhar o seu: faltam ${fmtN(META_AEROPORTO - perto.n)} moradores.` : '.'}`, perto ? ['ver ' + perto.nome, () => { fechar(); ctx.mostrarCidade(perto); }] : undefined);

  // comércio: lojas patrocinadas e empresas de moradores
  if (P.lojas.length) { const l = P.lojas[P.lojas.length - 1], m = MUN.get(l.ibge); materia('comércio', `${l.nome} abre as portas em ${m?.nome}`, `${l.desc} Espaço patrocinado e identificado no mapa.`, ['visitar', () => { fechar(); ctx.visitarLoja(l); }]); }
  if (emps?.empresas?.length) { const e = emps.empresas[emps.empresas.length - 1]; materia('economia', `nova empresa de morador: ${e.nome}`, `do ramo de ${e.ramo}, em ${MUN.get(e.ibge)?.nome}. Já são ${emps.empresas.length} empresas virtuais no jogo.`); }

  // relógio da semana
  const ms = proximoFechamento() - Date.now(), d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
  materia('agenda', `a semana fecha em ${d}d ${h}h`, 'domingo às 21h saem os resultados: cargos da semana, rua campeã e ranking. Novas eleições começam na segunda.');
}
