/* Botão de perfil no topo (canto esquerdo): @ + pontos totais; abre "Minha Casa".
   Aviso de eleição: quando a pessoa logada tem vaga aberta para se candidatar ou votação aberta sem voto,
   mostra um cartão uma vez por eleição e fase (lembrado neste aparelho). */
import type { Ctx } from './app';
import { el, botao } from './dom';
import { api } from '../api/cliente';
import { eleicoesApi, type EleicaoV } from '../api/eleicoes';

const fmt = new Intl.NumberFormat('pt-BR');
const fmtData = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const lembrar = (k: string) => { try { if (localStorage.getItem(k)) return false; localStorage.setItem(k, '1'); return true; } catch { return true; } };

export function montarPerfil(ctx: Ctx) {
  const b = el('button', 'perfil-bt'); b.type = 'button'; b.setAttribute('aria-label', 'meu perfil e meus pontos');
  const ini = el('span', 'perfil-av', '?'), txt = el('span', 'perfil-tx'), nome = el('b', '', 'entrar'), pts = el('small', '', 'minha casa');
  txt.append(nome, pts); b.append(ini, txt);
  b.onclick = () => ctx.paineis.abrir('casa');
  document.getElementById('topo')!.append(b);

  async function atualizar() {
    const eu = await api.eu();
    if (eu.ok && eu.casa) {
      const h = eu.usuario?.usuario_instagram || eu.usuario?.nome_publico || 'você';
      const rec = await api.recompensas().catch(() => null);
      const total = rec?.ok ? rec.resumo.xp_total : (eu.casa as any).xp || 0;   // houses.xp espelha o ledger: não somar
      ini.textContent = String(h).slice(0, 1).toUpperCase(); nome.textContent = '@' + h; pts.textContent = `⭐ ${fmt.format(total)} pts`;
      b.classList.add('on');
      void avisoEleicao(ctx);
      return;
    }
    // sem conta: se a pessoa já disse o @ dela neste aparelho, mostra os pontos públicos
    const gi = ctx.eu();
    if (gi >= 0) { const h = ctx.dados.USR[gi]; ini.textContent = h.slice(0, 1).toUpperCase(); nome.textContent = '@' + h; pts.textContent = `⭐ ${fmt.format(ctx.dados.p.tot[gi])} pts`; }
    b.classList.remove('on');
  }
  (window as any).__atualizarPerfil = atualizar;
  void atualizar();
}

/** escolhe UMA eleição para avisar: votação aberta sem voto vem antes de vaga para candidatura */
async function avisoEleicao(ctx: Ctx) {
  const r = await eleicoesApi.listar();
  if (!r.ok || r.publico) return;
  const votar = r.eleicoes.find((e) => e.status === 'votacao' && !e.meuVoto && e.souEleitor !== false && e.candidatos.length > 0);
  const concorrer = r.eleicoes.find((e) => e.status === 'inscricoes' && e.turno === 1 && !e.minhaCandidatura);
  const e = votar || concorrer; if (!e) return;
  if (!lembrar(`smn_aviso_elei:${e.id}:${e.status}`)) return;
  mostrarAviso(ctx, e, !!votar);
}

function mostrarAviso(ctx: Ctx, e: EleicaoV, ehVoto: boolean) {
  const fundo = el('div', 'pop-fundo'); const pop = el('div', 'pop cartao-b escuro'); pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true');
  const fechar = () => fundo.remove();
  fundo.onclick = (ev) => { if (ev.target === fundo) fechar(); };
  pop.append(el('div', 'pop-ic', ehVoto ? '🗳️' : '📣'));
  if (ehVoto) {
    pop.append(el('h2', '', `votação aberta: ${e.cargoNome}`), el('p', '', `${e.escopoNome} · ${e.candidatos.length} candidato(s). Seu voto vale 1 e dá pra trocar até ${fmtData.format(new Date(e.prazos.votacaoFecha))}.`));
  } else {
    pop.append(el('h2', '', `vaga aberta: ${e.cargoNome}`), el('p', '', `${e.escopoNome} · ${e.candidatos.length ? e.candidatos.length + ' candidato(s) até agora' : 'ninguém se candidatou ainda: a vaga pode ser sua'}. Inscrições até ${fmtData.format(new Date(e.prazos.inscricoesFecham))}.`));
  }
  pop.append(el('p', 'nota', 'eleição virtual do jogo, sem vínculo com eleições reais.'));
  const bts = el('div', 'hub-bts');
  bts.append(
    botao('btn prim', ehVoto ? 'votar agora' : 'quero me candidatar', () => { fechar(); ctx.paineis.abrir('eleicoes', { cargo: e.cargo }); }),
    botao('btn', 'depois', fechar),
  );
  pop.append(bts); fundo.append(pop); document.body.append(fundo);
}
