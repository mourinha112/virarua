/* Layout do mapa: relógio da eleição (topo), faixa do presidente, coluna de botões do mapa (bússola, zoom,
   inclinar, Brasil, dia/noite, minha casa), hora + online, busca e "divulgue seu negócio" embaixo e a
   folha "comente sua cidade" que abre e fecha. */
import type { Ctx } from './app';
import { $, el, toast } from './dom';
import { fmtN, MUNICIPIOS } from '../dados/dados';
import { proximoFechamento } from '../jogo/regras';
import { NOITE_FORCADA, fatorNoite } from '../mundo/cores';
import { visitaApi } from '../api/crescimento';
import { abrirStory } from './story';
import './layout.css';

export const IG_JOGO = 'https://www.instagram.com/viraruajogo/';
const ler = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } };
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const dois = (n: number) => String(n).padStart(2, '0');

function relogio(ctx: Ctx) {
  const t = $('relogioT'), s = $('relogioS');
  const pinta = () => {
    const ms = Math.max(0, proximoFechamento() - Date.now()), h = Math.floor(ms / 3600_000), m = Math.floor((ms % 3600_000) / 60_000), sg = Math.floor((ms % 60_000) / 1000);
    t.textContent = h >= 24 ? `${Math.floor(h / 24)}d ${dois(h % 24)}h` : `${dois(h)}:${dois(m)}:${dois(sg)}`;
    s.textContent = h >= 24 ? 'pra eleição de domingo 21h' : 'pra eleição das 21h';
  };
  pinta(); setInterval(pinta, 1000);
  $('relogio').onclick = () => ctx.paineis.abrir('eleicoes');
}

/** faixa do presidente(a) da semana: frase, curtidas e pontos; recolhe e lembra */
function presidente(ctx: Ctx) {
  const box = $('pres'), { dados } = ctx, gi = dados.presidente;
  if (gi < 0) return;
  const h = dados.USR[gi], c = dados.CID[dados.CID_DE[gi]];
  const fr = dados.p.frases[h];
  const cab = el('button', 'pr-cab'); (cab as HTMLButtonElement).type = 'button';
  cab.append(el('span', 'pr-cargo', `☆ @${h} · presidente(a) do Brasil`), el('i', 'pr-seta', '▴'));
  const corpo = el('div', 'pr-corpo');
  const frase = el('button', 'pr-frase', fr ? `“${fr}”` : `${c ? c.nome + ' · ' + c.uf : 'Brasil'} · toca pra visitar a casa`); (frase as HTMLButtonElement).type = 'button';
  frase.onclick = () => ctx.mostrarCasa(gi);
  const cor = el('button', 'pr-cor'); (cor as HTMLButtonElement).type = 'button'; cor.setAttribute('aria-label', 'curtir a casa do presidente');
  const n = el('b', '', '·'); cor.append(el('span', '', '♥'), n);
  const lin = el('div', 'pr-lin'); lin.append(frase, cor);
  corpo.append(lin, el('span', 'pr-chip', `lidera a semana com ${fmtN(dados.p.pts[gi])} pts`));
  box.append(cab, corpo); box.hidden = false;
  const recolher = (v: boolean) => { box.classList.toggle('mini', v); gravar('smn_pres_mini', v ? '1' : ''); };
  if (ler('smn_pres_mini') === '1') box.classList.add('mini');
  cab.onclick = () => recolher(!box.classList.contains('mini'));
  void visitaApi.estado(h).then((r) => { if (r.ok) { n.textContent = fmtN(r.curtidas); cor.classList.toggle('on', r.eu.curtiu); } });
  cor.onclick = async () => {
    const r = await visitaApi.curtir(h);
    if (!r.ok) { toast(/login|entr/i.test(r.erro) || /401/.test(r.erro) ? 'entre na sua casa pra curtir' : r.erro, 3500); return; }
    n.textContent = fmtN(r.curtidas); cor.classList.add('on'); toast(`curtiu @${h} · +1 pra casa dele(a)`);
  };
}

function controles(ctx: Ctx) {
  const cam = ctx.mundo.camera;
  $('zbus').onclick = () => cam.voar({ psi: 0 });
  $('zinc').onclick = () => { const deitado = cam.st.phi < 40; cam.voar({ phi: deitado ? 62 : 28 }); $('zinc').classList.toggle('on', !deitado); };
  const bn = $('znoite');
  const pintaNoite = () => bn.classList.toggle('on', fatorNoite() > 0.5);
  bn.onclick = () => { NOITE_FORCADA.v = fatorNoite() > 0.5 ? 0 : 1; pintaNoite(); toast(NOITE_FORCADA.v ? '🌙 modo noite' : '☀️ modo dia', 1500); };
  pintaNoite();
  $('zeu').onclick = () => {
    const ir = (window as any).__irMinhaCasa;
    if (ir) { ctx.fecharCartao(); ir(); return; }
    const gi = ctx.eu(); if (gi >= 0) { ctx.mostrarCasa(gi); return; }
    toast('digite seu @ na busca pra achar sua casa'); ($('q') as HTMLInputElement).focus();
  };
}

function horaOnline() {
  const t = $('horaT'), on = $('online');
  const pinta = () => { t.textContent = fmtHora.format(new Date()); };
  pinta(); setInterval(pinta, 15_000);
  const vid = ler('smn_vid') || '';
  const ping = async () => { const r = await visitaApi.online(vid); if (r.ok) on.textContent = `${fmtN(r.online)} online`; };
  setTimeout(() => void ping(), 1200); setInterval(() => { if (!document.hidden) void ping(); }, 60_000);
}

function folha(ctx: Ctx) {
  const f = $('folha'), bt = $('folhaBt'), D = ctx.dados.p;
  const abrir = (v: boolean) => { f.classList.toggle('fechada', !v); bt.setAttribute('aria-expanded', String(v)); gravar('smn_folha', v ? '' : 'fechada'); };
  bt.onclick = () => abrir(true);
  // fecha arrastando/tocando no mapa e começa fechada pra quem já conhece
  f.classList.toggle('fechada', ler('smn_folha') === 'fechada' || ctx.eu() >= 0);
  const fx = el('button', 'fl-x', '▾'); fx.setAttribute('aria-label', 'recolher'); (fx as HTMLButtonElement).type = 'button'; fx.onclick = () => abrir(false);
  $('folhaC').prepend(fx);
  const tot = $('totais'); tot.innerHTML = '';
  const q = (v: string, r: string) => { const d = el('div'); d.append(el('b', '', v), el('small', '', r)); tot.append(d); };
  q(fmtN(D.n), D.n === 1 ? 'casa' : 'casas'); q(fmtN(ctx.dados.CID.length), `de ${fmtN(MUNICIPIOS.length)} cidades`); q(fmtN(D.lojas.length), D.lojas.length === 1 ? 'loja' : 'lojas');
  tot.setAttribute('aria-label', `${fmtN(D.n)} casas em ${fmtN(ctx.dados.CID.length)} cidades`);
  for (const id of ['segRodape', 'comentarBt']) ($(id) as HTMLAnchorElement).href = IG_JOGO;
  $('ajuda').onclick = () => abrirStory(ctx);
  ctx.mundo.aoClicar(() => { if (!f.classList.contains('fechada') && innerWidth < 760) abrir(false); });
}

export function iniciarLayout(ctx: Ctx) {
  relogio(ctx); presidente(ctx); controles(ctx); horaOnline(); folha(ctx);
}
