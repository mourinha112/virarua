/* Autorização do painel administrativo.
   - Papéis SEPARADOS (admin_roles): operador_integracao, moderador, editor_conteudo, admin_tecnico. Cada área lista os
     papéis que a acessam; nenhum papel é "superusuário" de tudo.
   - Exige: sessão válida de usuário ativo + papel da área + sessão RECENTE (criada há no máximo ADMIN_SESSAO_MIN
     minutos, padrão 120). Sessão velha precisa entrar de novo.
   - PRODUÇÃO: colocar autenticação forte NA FRENTE do painel (passkey/WebAuthn ou 2FA TOTP no proxy/IdP, ex.: Cloudflare
     Access, Tailscale, oauth2-proxy com 2FA obrigatório) e restringir /admin.html e /api/admin/* a essa camada.
     Este servidor ainda não tem passkey própria; a checagem aqui é a segunda barreira, não a única.
   - Conceder papel é operação fora do painel (CLI auditada: server/src/modulos/admin/cli.ts). */
import type { Context } from 'hono';
import { q, q1 } from '../../db/db';
import { ErroHttp, type Vars, type Usuario } from '../../http/app';

export const PAPEIS = ['operador_integracao', 'moderador', 'editor_conteudo', 'admin_tecnico'] as const;
export type Papel = (typeof PAPEIS)[number];

export const AREAS = {
  metricas: ['operador_integracao', 'moderador', 'editor_conteudo', 'admin_tecnico'],
  divulgar: ['operador_integracao', 'moderador', 'editor_conteudo', 'admin_tecnico'],
  saude: ['operador_integracao', 'admin_tecnico'],
  midias: ['operador_integracao', 'editor_conteudo'],
  comentarios: ['operador_integracao', 'moderador'],
  reservas: ['operador_integracao', 'moderador'],
  denuncias: ['moderador'],
  cidades: ['moderador', 'editor_conteudo'],
  patrocinadores: ['editor_conteudo'],
  flags: ['admin_tecnico'],
  fila: ['operador_integracao', 'admin_tecnico'],
  auditoria: ['admin_tecnico'],
} as const satisfies Record<string, readonly Papel[]>;
export type Area = keyof typeof AREAS;

export const sessaoMaxMin = () => { const n = Number(process.env.ADMIN_SESSAO_MIN); return Number.isFinite(n) && n > 0 ? n : 120; };

export type Admin = { usuario: Usuario; papeis: Papel[] };

/** usuário com algum papel administrativo e sessão recente (sem checar área) */
export async function exigirAdmin(c: Context<{ Variables: Vars }>): Promise<Admin> {
  const u = c.get('usuario'); const sid = c.get('sessaoId');
  if (!u || !sid) throw new ErroHttp(401, 'entre na sua conta para usar o painel');
  const papeis = (await q<{ papel: Papel }>(`select papel from admin_roles where user_id = $1`, [u.id])).map((r) => r.papel);
  if (!papeis.length) throw new ErroHttp(403, 'sem permissão para o painel');
  const s = await q1<{ recente: boolean }>(`select criado_em > now() - make_interval(mins => $2) recente from sessions where id = $1`, [sid, sessaoMaxMin()]);
  if (!s?.recente) throw new ErroHttp(403, 'sessão antiga: entre de novo para usar o painel');
  return { usuario: u, papeis };
}

export async function exigirArea(c: Context<{ Variables: Vars }>, area: Area): Promise<Admin> {
  const a = await exigirAdmin(c);
  if (!a.papeis.some((p) => (AREAS[area] as readonly string[]).includes(p))) throw new ErroHttp(403, `seu papel não acessa a área ${area}`);
  return a;
}

export function areasDe(papeis: Papel[]): Area[] { return (Object.keys(AREAS) as Area[]).filter((a) => papeis.some((p) => (AREAS[a] as readonly string[]).includes(p))); }

/** motivo obrigatório para ações sensíveis */
export function exigirMotivo(v: unknown): string {
  const m = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500);
  if (m.length < 5) throw new ErroHttp(400, 'informe o motivo (mínimo 5 caracteres): fica na auditoria');
  return m;
}
