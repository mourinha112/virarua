/* "Como funciona" em formato de story: barrinhas de progresso no topo, passa sozinho, toque na direita
   avança e na esquerda volta, segurar pausa. Cada tela numa cor do jogo. */
import type { Ctx } from './app';
import { el, botao } from './dom';
import { IG_JOGO } from './layout';

type Tela = { cor: string; tag: string; ic: string; tit: string; passos: string[]; fim?: boolean };
const TELAS: Tela[] = [
  { cor: '#ffd23f', tag: 'como entrar no jogo', ic: '💬', tit: 'comente o nome da sua cidade', passos: ['Abra o <b>último post do @viraruajogo</b> e comente sua cidade, tipo <b>“Recife PE”</b>.', 'Em até 1 minuto sua casa acende no mapa.', 'Volte aqui, digite seu @ lá embaixo e veja sua casa.'] },
  { cor: '#4fb7f0', tag: 'sua casa', ic: '🏠', tit: 'sua casa cresce com pontos', passos: ['Faça as <b>missões do dia</b> e trabalhe: cada uma dá XP.', 'Sua casa sobe de nível e <b>nunca encolhe</b>.', 'Reivindique pelo Instagram pra ter avatar, pet e enfeites.'] },
  { cor: '#78ad54', tag: 'visitas', ic: '🔔', tit: 'visite e toque a campainha', passos: ['Toque numa casa do mapa e <b>deixe um adesivo</b> na porta.', 'Curta as casas que você gostar: cada curtida dá <b>+1</b> pro dono.', 'Quem visita a sua casa também te dá pontos.'] },
  { cor: '#ff8a1f', tag: 'amigos', ic: '📣', tit: 'marque amigos e ganhe', passos: ['Marque <b>@amigos</b> nos posts do jogo: +5 XP cada.', 'Quando o amigo ganha a casa: <b>+50 XP</b> pra você.', 'Mande o seu link de vizinho: quem entra cai na <b>sua rua</b>.'] },
  { cor: '#8338ec', tag: 'palácio', ic: '🏛️', tit: 'vire prefeito, governador ou presidente', passos: ['Quem mais pontua na semana lidera a cidade, o estado e o Brasil.', 'Tem eleição virtual: candidate-se e peça votos.', 'Domingo às 21h fecha e começa tudo de novo.'] },
  { cor: '#ffd23f', tag: 'bora!', ic: '🚀', tit: 'sua cidade precisa de você', passos: ['Chame os amigos e faça sua cidade subir na <b>guerra de cidades</b>.'], fim: true },
];
const DUR = 6500;

export function abrirStory(ctx: Ctx, inicio = 0) {
  document.querySelector('.st-fundo')?.remove();
  const fundo = el('div', 'st-fundo'); fundo.setAttribute('role', 'dialog'); fundo.setAttribute('aria-modal', 'true'); fundo.setAttribute('aria-label', 'como funciona');
  const cx = el('div', 'st-caixa'), barras = el('div', 'st-barras'), palco = el('div', 'st-palco');
  const bs = TELAS.map(() => { const b = el('span'); b.append(el('i')); barras.append(b); return b; });
  let i = inicio, t0 = performance.now(), pausa = 0, raf = 0, vivo = true;
  const fechar = () => { vivo = false; cancelAnimationFrame(raf); fundo.remove(); document.removeEventListener('keydown', tecla); };
  const x = botao('st-x', '✕', fechar, 'fechar');
  function desenhar() {
    const T = TELAS[i]; cx.style.setProperty('--st', T.cor); palco.innerHTML = '';
    palco.append(el('span', 'st-bola a'), el('span', 'st-bola b'), el('span', 'st-tag', T.tag), el('div', 'st-ic', T.ic), el('h2', 'st-tit', T.tit));
    T.passos.forEach((p, k) => { const d = el('div', 'st-passo'); d.style.animationDelay = 120 + k * 140 + 'ms'; const s = el('span'); s.innerHTML = p; d.append(el('b', '', T.passos.length > 1 ? String(k + 1) : '★'), s); palco.append(d); });
    if (T.fim) {
      const a = el('a', 'btn prim bloco st-cta', 'comentar minha cidade no post') as HTMLAnchorElement; a.href = IG_JOGO; a.target = '_blank'; a.rel = 'noopener';
      palco.append(a, botao('btn bloco st-cta', 'ver as regras completas', () => { fechar(); ctx.paineis.abrir('como'); }));
    }
    bs.forEach((b, k) => { b.className = k < i ? 'ok' : ''; (b.firstChild as HTMLElement).style.width = k < i ? '100%' : '0'; });
    t0 = performance.now();
  }
  const ir = (d: number) => { const n = i + d; if (n < 0) { t0 = performance.now(); return; } if (n >= TELAS.length) { fechar(); return; } i = n; desenhar(); };
  function quadro(agora: number) {
    if (!vivo) return;
    if (!pausa) { const f = Math.min(1, (agora - t0) / DUR); (bs[i].firstChild as HTMLElement).style.width = f * 100 + '%'; if (f >= 1 && !TELAS[i].fim) ir(1); }
    raf = requestAnimationFrame(quadro);
  }
  // toque: esquerda volta, direita avança; segurar pausa
  let baixo = 0;
  palco.onpointerdown = () => { baixo = performance.now(); pausa = baixo; };
  palco.onpointerup = (e) => {
    const segurou = performance.now() - baixo > 350; t0 += performance.now() - pausa; pausa = 0;
    if (segurou || (e.target as HTMLElement).closest('a,button')) return;
    const r = palco.getBoundingClientRect(); ir(e.clientX - r.left < r.width * 0.33 ? -1 : 1);
  };
  function tecla(e: KeyboardEvent) { if (e.key === 'Escape') fechar(); else if (e.key === 'ArrowRight') ir(1); else if (e.key === 'ArrowLeft') ir(-1); }
  document.addEventListener('keydown', tecla);
  fundo.onclick = (e) => { if (e.target === fundo) fechar(); };
  cx.append(barras, x, palco); fundo.append(cx); document.body.append(fundo);
  desenhar(); raf = requestAnimationFrame(quadro);
}
