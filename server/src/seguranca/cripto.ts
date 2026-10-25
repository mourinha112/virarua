/* Primitivas de segurança: hash de tokens, tokens fortes, comparação em tempo constante, AES-256-GCM em repouso. */
import { createHash, createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { config } from '../config';

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest();
export const tokenForte = (bytes = 32) => randomBytes(bytes).toString('base64url');
/** código legível de alta entropia (sem caracteres ambíguos): 10 chars ≈ 50 bits */
export function codigoLegivel(n = 10) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b = randomBytes(n); let s = '';
  for (let i = 0; i < n; i++) s += A[b[i] % A.length];
  return 'SMN-' + s;
}
export function iguais(a: Buffer, b: Buffer) { return a.length === b.length && timingSafeEqual(a, b); }

/** Assinatura do webhook da Meta: header X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, corpo bruto). */
export function assinaturaValida(corpoBruto: Buffer, header: string | undefined | null, segredo: string) {
  if (!header || !segredo || !header.startsWith('sha256=')) return false;
  const esperado = createHmac('sha256', segredo).update(corpoBruto).digest();
  let recebido: Buffer; try { recebido = Buffer.from(header.slice(7), 'hex'); } catch { return false; }
  return iguais(esperado, recebido);
}

function chave() { const k = Buffer.from(config.chaveCripto, 'hex'); if (k.length !== 32) throw new Error('SMN_CHAVE_CRIPTO precisa de 32 bytes em hex'); return k; }
export function cifrar(texto: string) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', chave(), iv);
  const enc = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}
export function decifrar(buf: Buffer) {
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', chave(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

/** Redige segredos de qualquer texto de log. */
export function redigir(s: string) {
  return s.replace(/([?&](t|token|access_token|code)=)[^&\s"]+/gi, '$1[redigido]').replace(/(EAA|IGQ)[A-Za-z0-9_-]{10,}/g, '[token-redigido]');
}
