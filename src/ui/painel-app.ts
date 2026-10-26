/* Aba "app": instala o jogo na tela inicial (botão nativo quando o navegador oferece; senão, o passo a passo). */
import { el, botao, toast } from './dom';

let pedido: any = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pedido = e; });
const instalado = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export function montarPainelApp(c: HTMLElement) {
  const topo = el('div', 'cartao-b am');
  topo.append(el('h2', '', instalado() ? 'o app já está instalado ✅' : 'jogue como app'), el('p', '', 'ícone na tela inicial, tela cheia e entra direto na sua casa. Não ocupa espaço: é o próprio site.'));
  if (!instalado() && pedido) topo.append(botao('btn prim bloco', 'instalar agora', async () => { pedido.prompt(); const r = await pedido.userChoice.catch(() => null); pedido = null; if (r?.outcome === 'accepted') toast('instalado! procure o ícone na tela inicial'); }));
  c.append(topo);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const passos: [string, string, string][] = ios
    ? [['1', '⬆️', 'toque em <b>compartilhar</b> (quadrado com seta) no Safari'], ['2', '➕', 'escolha <b>adicionar à tela de início</b>'], ['3', '🏠', 'abra pelo ícone novo: entra direto na sua casa']]
    : [['1', '⋮', 'toque nos <b>3 pontinhos</b> do Chrome'], ['2', '📲', 'escolha <b>instalar app</b> ou <b>adicionar à tela inicial</b>'], ['3', '🏠', 'abra pelo ícone novo: entra direto na sua casa']];
  const b = el('div', 'cartao-b'); b.append(el('h2', '', ios ? 'no iPhone' : 'no Android'));
  for (const [n, ic, t] of passos) { const l = el('div', 'app-p'); const s = el('span'); s.innerHTML = t; l.append(el('b', 'app-n', n), el('span', 'app-ic', ic), s); b.append(l); }
  c.append(b);
}
