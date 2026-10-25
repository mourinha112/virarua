/* Filtro simples de texto para nome/descrição de rua (moderação automática de primeira linha).
   Recusa: palavrões e ofensas comuns (com leetspeak), links, @, telefone, apostas/pirataria, texto só de símbolos.
   Revisão humana continua no painel admin (Fase 7). */

/** radicais: bloqueiam palavra que COMEÇA com eles; exatas: só a palavra inteira; frases: trecho */
const RADICAIS = ['porra', 'caralh', 'bucet', 'puta', 'puto', 'merda', 'cacete', 'fode', 'foder', 'fodid', 'arrombad', 'viado', 'viadinho',
  'crioul', 'retardad', 'otari', 'babaca', 'cuzao', 'piroc', 'xoxot', 'boquet', 'punhet', 'safad', 'nazis', 'hitler', 'estupr', 'pedofil',
  'suicid', 'traficant', 'cocain', 'maconh', 'aposta', 'cassino', 'tigrinho', 'onlyfans', 'whatsapp', 'telegram', 'bolsonar', 'petist'];
const EXATAS = ['foda', 'fdp', 'vsf', 'pqp', 'bicha', 'matar', 'bet', 'bets', 'iptv', 'pix', 'privacy', 'zap', 'lula', 'pt', 'pl', 'partido', 'nazi'];
const FRASES = ['morte aos', 'morte a', 'fora negro', 'vai se'];
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i' };

export function normalizar(s: string) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[01345678@$!]/g, (ch) => LEET[ch] || ch);
}
/** limpa espaços e caracteres de controle; não altera o conteúdo visível */
export function limpar(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export type Veredito = { ok: true; texto: string } | { ok: false; erro: string };

export function moderarTexto(bruto: unknown, campo: string, min: number, max: number): Veredito {
  const t = limpar(bruto, max + 1);
  if (t.length < min) return { ok: false, erro: `${campo}: mínimo de ${min} letras` };
  if (t.length > max) return { ok: false, erro: `${campo}: máximo de ${max} letras` };
  if (/(https?:|www\.|\.com|\.br\b|\.net|\.io\b)/i.test(t)) return { ok: false, erro: `${campo}: links não são permitidos` };
  if (/@\w/.test(t)) return { ok: false, erro: `${campo}: não use @ de perfil` };
  if (/\d[\d\s().-]{7,}\d/.test(t)) return { ok: false, erro: `${campo}: não coloque telefone` };
  if (!/[a-zA-ZÀ-ÿ]/.test(t)) return { ok: false, erro: `${campo}: use letras` };
  // junta letras soltas ("p u t a" → "puta") antes de separar as palavras
  const n = normalizar(t).replace(/[^a-z ]/g, ' ').replace(/\b([a-z]) (?=[a-z]\b)/g, '$1').replace(/\s+/g, ' ').trim();
  const palavras = n.split(' ');
  const ruim = palavras.some((w) => EXATAS.includes(w) || RADICAIS.some((r) => w.startsWith(r))) || FRASES.some((f) => (' ' + n + ' ').includes(' ' + f + ' '));
  if (ruim) return { ok: false, erro: `${campo}: escolha outro texto (palavra não permitida)` };
  return { ok: true, texto: t };
}

export const EMBLEMAS = ['estrela', 'coracao', 'sol', 'lua', 'folha', 'flor', 'raio', 'bola', 'nota', 'casa', 'peixe', 'passaro', 'arvore', 'onda', 'coroa', 'fogo'] as const;
export function moderarEmblema(v: unknown): string | null {
  return typeof v === 'string' && (EMBLEMAS as readonly string[]).includes(v) ? v : null;
}
