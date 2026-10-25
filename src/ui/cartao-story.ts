/* Cartão de morador para o story (1080×1920): casa, avatar, rua e cidade desenhados em canvas 2D no visual do jogo.
   Compartilha como imagem (Web Share com arquivo) ou baixa o PNG. Sem dados de outras pessoas. */
import { CORES, PADRAO } from '../mundo/avatares3d';

export type DadosCartao = { nome: string; handle?: string | null; cidade: string; uf: string; rua?: string | null; nivel: number; avatar?: Record<string, string> | null; casaCor?: string };

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const tinta = '#1e2430';
function contorno(g: CanvasRenderingContext2D, txt: string, x: number, y: number, size: number, cor = '#fff') {
  g.font = `400 ${size}px "Lilita One", Nunito, sans-serif`; g.textAlign = 'center'; g.lineJoin = 'round';
  g.lineWidth = size * 0.16; g.strokeStyle = tinta; g.strokeText(txt, x, y + size * 0.06); g.strokeText(txt, x, y); g.fillStyle = cor; g.fillText(txt, x, y);
}

export async function desenharCartao(d: DadosCartao): Promise<HTMLCanvasElement> {
  try { await (document as any).fonts?.load?.('400 60px "Lilita One"'); } catch { /* segue com fonte do sistema */ }
  const W = 1080, H = 1920, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d')!;
  // céu e chão
  const ceu = g.createLinearGradient(0, 0, 0, H); ceu.addColorStop(0, '#9fd0f2'); ceu.addColorStop(0.55, '#d9ecf8'); ceu.addColorStop(0.56, '#8fc468'); ceu.addColorStop(1, '#6faa4c');
  g.fillStyle = ceu; g.fillRect(0, 0, W, H);
  for (const [x, y, s] of [[180, 260, 1], [820, 380, 0.8], [520, 170, 0.6]]) { g.fillStyle = 'rgba(255,255,255,.9)'; for (const [dx, dy, r] of [[0, 0, 60], [55, -20, 70], [115, 5, 55], [-50, 10, 45]]) { g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, 7); g.fill(); } }
  // título
  contorno(g, 'MINHA CASA NO', W / 2, 190, 74); contorno(g, 'SEU MUNDO NOVO', W / 2, 290, 96, '#ffd23f');
  // casa
  const cx = W / 2 - 70, base = 1240, parede = d.casaCor || '#fbf8f2';
  g.fillStyle = 'rgba(30,36,48,.18)'; g.beginPath(); g.ellipse(cx, base + 10, 380, 60, 0, 0, 7); g.fill();
  g.lineWidth = 12; g.strokeStyle = tinta; g.lineJoin = 'round';
  rr(g, cx - 280, base - 380, 560, 380, 20); g.fillStyle = parede; g.fill(); g.stroke();
  g.beginPath(); g.moveTo(cx - 340, base - 370); g.lineTo(cx, base - 640); g.lineTo(cx + 340, base - 370); g.closePath(); g.fillStyle = '#f0965a'; g.fill(); g.stroke();
  rr(g, cx - 60, base - 210, 120, 210, 14); g.fillStyle = '#8a6a45'; g.fill(); g.stroke();
  for (const sx of [-1, 1]) { rr(g, cx + sx * 170 - 55, base - 300, 110, 100, 12); g.fillStyle = '#7fa8cc'; g.fill(); g.stroke(); }
  // avatar na porta (estilo bloquinho)
  const a = { ...PADRAO, ...(d.avatar || {}) } as Record<string, string>;
  const pele = CORES[a.pele] || '#d9a273', roupa = CORES[a.cor_roupa] || '#ffd23f', cab = CORES[a.cor_cabelo] || '#5a3a24';
  const ax = cx + 400, ay = base;
  const bloco = (x: number, y: number, w: number, h: number, cor: string) => { rr(g, x, y, w, h, 10); g.fillStyle = cor; g.fill(); g.lineWidth = 9; g.stroke(); };
  bloco(ax - 40, ay - 150, 34, 150, '#2c3a5a'); bloco(ax + 6, ay - 150, 34, 150, '#2c3a5a');
  bloco(ax - 62, ay - 330, 124, 190, roupa); bloco(ax - 92, ay - 320, 34, 140, roupa); bloco(ax + 58, ay - 380, 34, 150, roupa);
  bloco(ax - 70, ay - 480, 140, 140, pele); bloco(ax - 76, ay - 500, 152, 46, cab);
  g.fillStyle = tinta; g.fillRect(ax - 36, ay - 420, 16, 16); g.fillRect(ax + 20, ay - 420, 16, 16);
  // cartão de informações
  rr(g, 90, 1340, W - 180, 430, 44); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 12; g.strokeStyle = tinta; g.stroke();
  g.fillStyle = tinta; g.textAlign = 'center'; g.font = '900 68px Nunito, sans-serif';
  g.fillText(d.handle ? '@' + d.handle : d.nome, W / 2, 1450);
  g.font = '800 46px Nunito, sans-serif'; g.fillStyle = '#4a5260';
  g.fillText(`${d.rua ? d.rua + ' · ' : ''}${d.cidade} - ${d.uf}`, W / 2, 1530);
  rr(g, W / 2 - 190, 1580, 380, 90, 45); g.fillStyle = '#ffd23f'; g.fill(); g.lineWidth = 9; g.stroke();
  g.fillStyle = tinta; g.font = '900 48px Nunito, sans-serif'; g.fillText(`nível ${d.nivel}`, W / 2, 1642);
  g.font = '800 34px Nunito, sans-serif'; g.fillStyle = '#4a5260'; g.fillText('jogo virtual · comenta sua cidade e ganhe a sua casa', W / 2, 1720);
  contorno(g, 'VEM SER MEU VIZINHO!', W / 2, 1860, 70, '#ffd23f');
  return cv;
}

export async function compartilharCartao(d: DadosCartao) {
  const cv = await desenharCartao(d);
  const blob: Blob = await new Promise((ok) => cv.toBlob((b) => ok(b!), 'image/png'));
  const arq = new File([blob], 'minha-casa-seumundonovo.png', { type: 'image/png' });
  try { if ((navigator as any).canShare?.({ files: [arq] })) { await navigator.share({ files: [arq], title: 'Minha casa no Seu Mundo Novo' }); return 'compartilhado'; } } catch { return 'cancelado'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = arq.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'baixado';
}
