/* Exportação de auditoria com dados pessoais protegidos.
   - ids (uuid) viram pseudônimos estáveis HMAC (mesmo id → mesmo pseudônimo dentro do export; sem reversão sem o segredo);
   - chaves de dado pessoal (handle, username, telefone, e-mail, ip, texto livre...) viram "[protegido]";
   - no texto livre (motivo) são mascarados @handles, e-mails e sequências longas de dígitos (telefone/documento). */
import { createHmac } from 'node:crypto';
import { config } from '../../config';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const CHAVE_PESSOAL = /^(handle|username|user_?name|ig|instagram|zap|whatsapp|telefone|phone|email|e_?mail|ip|ip_hash|texto|comentario|nome_publico|nome|endereco|token|codigo)$/i;

export function pseudonimo(id: string) { return 'p_' + createHmac('sha256', config.segredo + '|auditoria').update(id.toLowerCase()).digest('hex').slice(0, 16); }

export function protegerTexto(s: string | null | undefined) {
  if (s == null) return s ?? null;
  return String(s).replace(UUID, (m) => pseudonimo(m)).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/@[\w.]{2,30}/g, '@[protegido]').replace(/\d[\d\s().-]{7,}\d/g, '[número]');
}

export function protegerDados(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(protegerDados);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = CHAVE_PESSOAL.test(k) ? '[protegido]' : protegerDados(x);
    return o;
  }
  if (typeof v === 'string') return protegerTexto(v);
  return v;
}

export type LinhaAuditoria = { id: number; ator_user_id: string | null; acao: string; alvo: string; motivo: string | null; dados: unknown; criado_em: string | Date };
export function protegerLinha(l: LinhaAuditoria) {
  return { id: l.id, ator: l.ator_user_id ? pseudonimo(l.ator_user_id) : 'sistema', acao: l.acao, alvo: protegerTexto(l.alvo), motivo: protegerTexto(l.motivo), dados: protegerDados(l.dados), criado_em: new Date(l.criado_em).toISOString() };
}

const csvCel = (v: unknown) => { const s = typeof v === 'string' ? v : JSON.stringify(v ?? ''); const t = /^[=+\-@\t\r]/.test(s) ? "'" + s : s; return '"' + t.replace(/"/g, '""') + '"'; };
export function paraCsv(linhas: ReturnType<typeof protegerLinha>[]) {
  const cab = ['id', 'ator', 'acao', 'alvo', 'motivo', 'dados', 'criado_em'];
  return [cab.join(','), ...linhas.map((l) => [l.id, l.ator, l.acao, l.alvo, l.motivo ?? '', l.dados, l.criado_em].map(csvCel).join(','))].join('\n') + '\n';
}
