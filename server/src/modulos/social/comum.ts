/* Utilitários compartilhados da Fase 2 (social + avatares). */
import type { Context } from 'hono';
import { q1, type Exec } from '../../db/db';
import { ErroHttp } from '../../http/app';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function idValido(v: unknown, oque = 'item'): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new ErroHttp(404, `${oque} não encontrado`);
  return v.toLowerCase();
}
export async function corpo(c: Context): Promise<Record<string, unknown>> {
  try { const j = await c.req.json(); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
export const inteiro = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

export type CasaPrincipal = { id: string; plot_id: string; status: string; nivel: number; ibge: number; lote_index: number; dono_identity_id: string };

/** casa principal reivindicada do usuário (ou null). `travar` = select ... for update (use dentro de tx). */
export async function casaPrincipal(userId: string, ex: Exec, travar = false): Promise<CasaPrincipal | null> {
  return q1<CasaPrincipal>(
    `select h.id, h.plot_id, h.status, h.nivel, h.dono_identity_id, p.ibge, p.lote_index
       from houses h join plots p on p.id = h.plot_id
      where h.dono_user_id = $1 and h.principal and h.status = 'reivindicada'
      ${travar ? 'for update of h' : ''}`, [userId], ex);
}
export async function exigirCasa(userId: string, ex: Exec, travar = false) {
  const h = await casaPrincipal(userId, ex, travar);
  if (!h) throw new ErroHttp(403, 'reivindique a sua casa primeiro');
  return h;
}

/** próximo fechamento semanal: domingo 21h em America/Sao_Paulo (UTC−3 fixo, sem horário de verão desde 2019) */
export function proximoFechamento(agora = new Date()): Date {
  const BRT = 3 * 3600_000;
  const local = new Date(agora.getTime() - BRT);
  const alvo = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 21, 0, 0));
  let dias = (7 - local.getUTCDay()) % 7;
  if (dias === 0 && local.getTime() >= alvo.getTime()) dias = 7;
  return new Date(alvo.getTime() + dias * 86400_000 + BRT);
}

/** handle exibível respeitando privacy_preferences.mostrar_handle */
export const SQL_HANDLE = `case when coalesce(pp.mostrar_handle, true) then ei.username else null end`;
