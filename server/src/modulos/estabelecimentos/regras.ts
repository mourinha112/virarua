/* Regras puras da Fase 5 (sem banco): validação de URL externa, política etária, categorias, códigos e textos. */
import { randomBytes } from 'node:crypto';

export const CATEGORIAS = ['cafeteria', 'restaurante', 'loja', 'pet', 'eventos', 'bar'] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/** tipo usado pelo mapa (src/dados/formato.ts → Loja.tipo; o mascote 3D sai daqui em src/mundo/lojas3d.ts) */
export const TIPO_MAPA: Record<Categoria, string> = { cafeteria: 'cafe', restaurante: 'restaurante', loja: 'loja', pet: 'pet', eventos: 'eventos', bar: 'bar' };
/** o formulário do mapa manda o tipo no vocabulário do front; bar não é aceito por pedido público */
export const TIPO_PEDIDO: Record<string, Exclude<Categoria, 'bar'>> = { cafe: 'cafeteria', cafeteria: 'cafeteria', restaurante: 'restaurante', loja: 'loja', pet: 'pet', eventos: 'eventos' };

export type Faixa = 'desconhecida' | 'menor' | 'adulto';

/** bar ou qualquer item marcado como álcool é conteúdo restrito */
export function restrito(x: { categoria?: string | null; alcool?: boolean | null }) { return x.categoria === 'bar' || !!x.alcool; }

/**
 * Política etária (aplicada no SERVIDOR): conteúdo com álcool só aparece se a flag 'bares' estiver ligada E a conta
 * tiver faixa etária 'adulto' confirmada. Menor, faixa desconhecida e visitante sem sessão nunca veem.
 * Ter Instagram não significa ser adulto.
 */
export function podeVerRestrito(faixa: string | null | undefined, flagBares: boolean) { return flagBares === true && faixa === 'adulto'; }

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const HOST_OK = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export type UrlValidada = { ok: true; url: string; dominio: string } | { ok: false; erro: string };

/**
 * URL externa permitida: https, sem usuário/senha, sem porta, host com nome (nunca IP/localhost), host igual a um
 * domínio da allowlist ou subdomínio dele, até 300 caracteres, sem espaços/controle.
 */
export function validarUrlExterna(bruta: unknown, allowlist: readonly string[]): UrlValidada {
  if (typeof bruta !== 'string') return { ok: false, erro: 'link inválido' };
  const s = bruta.trim();
  if (!s || s.length > 300) return { ok: false, erro: 'link vazio ou longo demais' };
  if (/[\s\u0000-\u001f\u007f\\]/.test(s)) return { ok: false, erro: 'link com caracteres inválidos' };
  let u: URL; try { u = new URL(s); } catch { return { ok: false, erro: 'link inválido' }; }
  if (u.protocol !== 'https:') return { ok: false, erro: 'só links https são aceitos' };
  if (u.username || u.password) return { ok: false, erro: 'link com usuário/senha não é aceito' };
  if (u.port) return { ok: false, erro: 'link com porta não é aceito' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || IPV4.test(host) || host.includes(':') || host.includes('[') || !HOST_OK.test(host)) return { ok: false, erro: 'endereço do link não é aceito' };
  const dom = allowlist.find((d) => host === d || host.endsWith('.' + d));
  if (!dom) return { ok: false, erro: `domínio ${host} não está na lista de domínios permitidos` };
  return { ok: true, url: u.href, dominio: dom };
}

/** @ do Instagram: aceita "@x", "x" ou URL do perfil; devolve o handle em minúsculas ou null se inválido */
export function normalizarInstagram(v: unknown): string | null | undefined {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  let s = String(v).trim().toLowerCase();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/); if (m) s = m[1];
  s = s.replace(/^@/, '');
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : null;
}
/** telefone/WhatsApp brasileiro: só dígitos, 10 a 13 (com DDI opcional) */
export function normalizarTelefone(v: unknown): string | null | undefined {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const d = String(v).replace(/\D/g, '');
  return d.length >= 10 && d.length <= 13 ? d : null;
}
/** texto curto exibido: sem caracteres de controle, espaços colapsados */
export function textoLimpo(v: unknown, max: number) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function codigoAleatorio(prefixo: string, n: number) {
  const b = randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALFA[b[i] % ALFA.length];
  return `${prefixo}-${s}`;
}

export const SELO_PATROCINIO = 'patrocinado';
export const AVISO_VIRTUAL = 'Cenário virtual: estar aqui no jogo não significa presença física no local real.';
export const AVISO_METRICAS = 'Métricas de visitas virtuais e cliques de contas autenticadas, deduplicadas. Não indicam vendas.';
/** o que um patrocínio pode comprar (espelha o check do banco) — nunca voto, cargo, remoção de concorrente ou vantagem eleitoral */
export const BENEFICIOS = ['presenca_mapa', 'personalizacao_fachada', 'evento_patrocinado', 'cupom'] as const;
