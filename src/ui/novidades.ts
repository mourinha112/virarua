/* Hype: pop-up "NOVIDADES" (1 vez por versão), atalhos fixos ⚔️ guerra / 🗝️ tesouro, avisos ao vivo de
   ultrapassagem na guerra de cidades e o link "vem ser meu vizinho" (?convite=). */
import type { Ctx } from './app';
import { el, botao, toast, $, quandoLivre } from './dom';
import { api } from '../api/cliente';
import { social } from '../api/social';
import { crescimentoApi } from '../api/crescimento';
import './crescimento.css';

const VERSAO = '2026-10-26';
const LS_VISTO = 'smn_novidades', LS_EVENTO = 'smn_guerra_ultimo', LS_CONVITE = 'smn_convite';
const ler = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravar = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem storage */ } };
const ehNatal = () => { const d = new Date(Date.now() - 3 * 3600_000).toISOString().slice(5, 10); return d >= '12-01' || d <= '01-06'; };

export const NOVIDADES: { ic: string; tit: string; txt: string; painel: string; bt: string }[] = [
  { ic: '⚔️', tit: 'Guerra de cidades', txt: 'sua cidade contra o Brasil. Toda casa nova e todo XP contam. Quem lidera a semana?', painel: 'guerra', bt: 'ver placar' },
  { ic: '🗝️', tit: 'Caça ao tesouro', txt: 'um baú escondido numa cidade. Dica nova todo dia e 5 pás por dia. O 1º leva +50 XP.', painel: 'tesouro', bt: 'caçar' },
  { ic: '📣', tit: 'Marque amigos e ganhe', txt: '+5 XP por @amigo marcado nos posts e +50 quando ele ganhar a casa.', painel: 'pontos', bt: 'ver pontos' },
  { ic: '📨', tit: 'Vem ser meu vizinho', txt: 'seu link pessoal: quem entra cai na SUA rua e você ganha +20 XP.', painel: 'casa', bt: 'pegar link' },
  { ic: '🔥', tit: 'Ofensiva', txt: 'missão todo dia acende uma chama na sua casa. 3, 7 e 30 dias dão bônus.', painel: 'enfeites', bt: 'ver chama' },
  { ic: '🎨', tit: 'Enfeites da casa', txt: 'horta, bandeira do seu time, carro e piscina. Liberam com XP.', painel: 'enfeites', bt: 'enfeitar' },
  ...(ehNatal() ? [{ ic: '🎄', tit: 'Natal no mapa', txt: 'cidades iluminadas, árvore na praça e missão especial de presentes.', painel: 'missoes', bt: 'missão' }] : []),
];

function popup(ctx: Ctx) {
  const fundo = el('div', 'nv-fundo'); fundo.setAttribute('role', 'dialog'); fundo.setAttribute('aria-modal', 'true'); fundo.setAttribute('aria-label', 'novidades do jogo');
  const cx = el('div', 'nv-caixa');
  const fechar = () => { gravar(LS_VISTO, VERSAO); fundo.remove(); };
  const topo = el('div', 'nv-topo'); topo.append(el('small', '', '🔥 NOVIDADES'), el('h2', '', 'o ViraRua ficou ENORME'), el('p', 'nota', 'tudo isso chegou hoje. Toca pra testar:'));
  cx.append(botao('fechar nv-fechar', '✕', fechar, 'fechar'), topo);
  NOVIDADES.forEach((n, i) => {
    const it = el('div', 'nv-item'); it.style.animationDelay = i * 70 + 'ms';
    const tx = el('div'); tx.append(el('b', '', n.tit), el('span', '', n.txt));
    it.append(el('span', 'ic', n.ic), tx, botao('btn mini prim', n.bt, () => { fechar(); ctx.paineis.abrir(n.painel); }));
    cx.append(it);
  });
  cx.append(botao('btn bloco', 'bora jogar!', fechar));
  fundo.append(cx);
  fundo.onclick = (e) => { if (e.target === fundo) fechar(); };
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', esc); } });
  document.body.append(fundo);
}

/** faixa no topo do mapa por alguns segundos */
export function aviso(texto: string, acao?: [string, () => void], ms = 7000) {
  document.querySelector('.av-vivo')?.remove();
  const a = el('div', 'av-vivo'); a.setAttribute('role', 'status'); a.append(el('span', '', texto));
  if (acao) a.append(botao('btn mini prim', acao[0], () => { a.remove(); acao[1](); }));
  $('app').append(a);
  setTimeout(() => { a.classList.add('sai'); setTimeout(() => a.remove(), 450); }, ms);
}

async function avisosGuerra(ctx: Ctx, primeira: boolean) {
  const eu = await api.eu(); const ibge = eu.ok && eu.casa ? eu.casa.cidade.ibge : undefined;
  const r = await crescimentoApi.guerra(ibge); if (!r.ok) return;
  const novo = r.eventos[0], chave = novo ? `${novo.a}>${novo.b}>${novo.quando}` : '';
  if (novo && chave !== ler(LS_EVENTO)) {
    gravar(LS_EVENTO, chave);
    aviso(`🔥 ${novo.a} passou ${novo.b}! agora é #${novo.pos}`, ['ver guerra', () => ctx.paineis.abrir('guerra')]);
    return;
  }
  // na entrada, lembra a pessoa de quanto falta para a cidade dela subir
  if (primeira && r.minha?.acima) aviso(`⚔️ ${r.minha.falta === 1 ? 'falta 1 ponto' : `faltam ${r.minha.falta} pontos`} pra ${r.minha.nome} passar ${r.minha.acima.nome}!`, ['ajudar', () => ctx.paineis.abrir('guerra')]);
}

function atalhos(ctx: Ctx) {
  const box = el('div', 'cr-fabs');
  const fab = (cls: string, ic: string, txt: string, painel: string, bolinha: boolean) => {
    const b = el('button', 'cr-fab ' + cls) as HTMLButtonElement; b.type = 'button'; b.setAttribute('aria-label', txt);
    b.append(el('span', '', ic), el('b', '', txt)); if (bolinha) b.append(el('i'));
    b.onclick = () => { b.querySelector('i')?.remove(); gravar('smn_fab_' + painel, new Date().toISOString().slice(0, 10)); ctx.paineis.abrir(painel); };
    return b;
  };
  const hoje = new Date().toISOString().slice(0, 10);
  box.append(fab('te', '🗝️', 'tesouro', 'tesouro', ler('smn_fab_tesouro') !== hoje), fab('gu', '⚔️', 'guerra', 'guerra', ler('smn_fab_guerra') !== hoje));
  $('atalhos').append(box);
}

/** ?convite=CODIGO: guarda, mostra quem chamou e aceita quando a pessoa já tem casa */
async function convite(ctx: Ctx) {
  const sp = new URLSearchParams(location.search), cod = sp.get('convite');
  if (cod && /^[\w-]{8,64}$/.test(cod)) gravar(LS_CONVITE, cod);
  const guardado = ler(LS_CONVITE); if (!guardado) return;
  const pv = await social.verConvite(guardado);
  if (!pv.ok || pv.convite.situacao !== 'valido' || pv.convite.tipo !== 'rua') { if (cod) toast(pv.ok ? pv.convite.aviso || 'convite inválido' : pv.erro, 4000); gravar(LS_CONVITE, null); return; }
  const cv = pv.convite, quem = cv.de?.handle ? '@' + cv.de.handle : cv.de?.nome || 'um amigo', rua = `${cv.rua?.nome} · ${cv.rua?.cidade}-${cv.rua?.uf}`;
  const eu = await api.eu();
  if (eu.ok && eu.casa) {
    if (eu.rua?.id === cv.rua?.id) { gravar(LS_CONVITE, null); return; }
    aviso(`📨 ${quem} te chamou pra morar na ${rua}`, ['entrar na rua', async () => {
      const r = await social.aceitarConvite(guardado); gravar(LS_CONVITE, null);
      if (!r.ok) { toast(r.erro, 4000); return; }
      toast(r.tipo === 'rua' && r.troca.tipo === 'lista_espera' ? 'a rua está cheia: você entrou na lista de espera' : `bem-vindo à ${cv.rua?.nome}! agora vocês são vizinhos 🏠`, 4500);
      (window as any).__carregarEu?.();
    }], 15000);
  } else if (cod) {
    aviso(`📨 ${quem} te chamou pra ser vizinho! Comente "${cv.rua?.cidade} ${cv.rua?.uf}" num post do @viraruajogo, confirme a casa e volte por este link`, undefined, 15000);
  }
}

export function iniciarNovidades(ctx: Ctx) {
  atalhos(ctx);
  const temUrl = /[?&](convite|u|c|aba)=/.test(location.search) || location.hash.length > 1;
  if (ler(LS_VISTO) !== VERSAO && !temUrl && !/[?&]filme/.test(location.search)) quandoLivre(() => popup(ctx));
  setTimeout(() => void convite(ctx), 1500);
  setTimeout(() => void avisosGuerra(ctx, true), 9000);
  setInterval(() => void avisosGuerra(ctx, false), 120_000);
}
