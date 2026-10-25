/* Avatar: nasce com a reserva (AVATAR_PADRAO), editável só depois de reivindicar a casa. O servidor valida cada
   peça contra avatar_catalog (slot certo, ativo) e user_inventory (itens pagos). O cliente nunca concede cosmético
   e nunca escolhe a casa: a casa vem da sessão (sem mass assignment). Nada de inferir aparência do nome/foto. */
import { q, q1, emitir, type Exec, type Tx } from '../../db/db';
import { AVATAR_PADRAO } from '../../db/semear';
import { ErroHttp } from '../../http/app';
import { casaPrincipal, exigirCasa } from '../social/comum';

export const SLOTS = ['pele', 'cabelo', 'cor_cabelo', 'roupa', 'cor_roupa', 'acessorio', 'calcado'] as const;
export type Slot = (typeof SLOTS)[number];
export type ConfigAvatar = Record<Slot, string>;

export async function catalogo(userId: string | null, ex: Exec) {
  return q<{ id: string; slot: Slot; nome: string; gratuito: boolean; possui: boolean }>(
    `select c.item_id id, c.slot, c.nome, c.gratuito, (c.gratuito or ui.item_id is not null) possui
       from avatar_catalog c left join user_inventory ui on ui.item_id = c.item_id and ui.user_id = $1::uuid
      where c.ativo order by c.slot, c.item_id`, [userId], ex);
}

/** mescla o pedido sobre a config atual e valida peça por peça. Chaves desconhecidas são ignoradas. */
export async function validarConfig(userId: string, atual: Partial<ConfigAvatar>, pedido: unknown, ex: Exec): Promise<ConfigAvatar> {
  if (!pedido || typeof pedido !== 'object' || Array.isArray(pedido)) throw new ErroHttp(400, 'configuração de avatar inválida');
  const p = pedido as Record<string, unknown>;
  const cfg = { ...AVATAR_PADRAO, ...atual } as ConfigAvatar;
  for (const s of SLOTS) if (p[s] !== undefined) {
    if (typeof p[s] !== 'string' || (p[s] as string).length > 60) throw new ErroHttp(400, `peça inválida em ${s}`);
    cfg[s] = p[s] as string;
  }
  const itens = await q<{ item_id: string; slot: string; gratuito: boolean; ativo: boolean; possui: boolean }>(
    `select c.item_id, c.slot, c.gratuito, c.ativo, exists (select 1 from user_inventory ui where ui.user_id = $2 and ui.item_id = c.item_id) possui
       from avatar_catalog c where c.item_id = any($1::text[])`, [SLOTS.map((s) => cfg[s]), userId], ex);
  const por = new Map(itens.map((i) => [i.item_id, i]));
  for (const s of SLOTS) {
    const it = por.get(cfg[s]);
    if (!it || !it.ativo) throw new ErroHttp(400, `item inexistente: ${cfg[s]}`);
    if (it.slot !== s) throw new ErroHttp(400, `o item ${cfg[s]} não serve em ${s}`);
    if (!it.gratuito && !it.possui) throw new ErroHttp(403, `o item ${cfg[s]} não está no seu inventário`);
  }
  return cfg;
}

export async function meuAvatar(userId: string, ex: Exec) {
  const casa = await casaPrincipal(userId, ex);
  if (!casa) {
    // reserva ainda não reivindicada (ou sem casa): mostra o padrão, sem permitir edição
    const res = await q1<{ config: ConfigAvatar; versao: number; house_id: string }>(
      `select a.config, a.versao, a.house_id from houses h join avatars a on a.house_id = h.id and a.ativo where h.dono_user_id = $1 and h.principal and h.status = 'reservada' limit 1`, [userId], ex);
    return { editavel: false, motivo: 'reivindique a sua casa para editar o avatar', houseId: res?.house_id ?? null, config: res?.config ?? AVATAR_PADRAO, versao: res?.versao ?? 0 };
  }
  const a = await q1<{ config: ConfigAvatar; versao: number; atualizado_em: string }>(`select config, versao, atualizado_em from avatars where house_id = $1 and ativo`, [casa.id], ex);
  return { editavel: true, motivo: null, houseId: casa.id, config: { ...AVATAR_PADRAO, ...(a?.config || {}) }, versao: a?.versao ?? 0, atualizadoEm: a?.atualizado_em ?? null };
}

export async function salvarAvatar(c: Tx, userId: string, pedido: unknown, versaoEsperada?: unknown) {
  const casa = await exigirCasa(userId, c, true);
  const a = await q1<{ id: string; config: ConfigAvatar; versao: number }>(`select id, config, versao from avatars where house_id = $1 and ativo for update`, [casa.id], c);
  if (a && typeof versaoEsperada === 'number' && versaoEsperada !== a.versao) throw new ErroHttp(409, 'o avatar foi alterado em outra aba: recarregue');
  const cfg = await validarConfig(userId, a?.config || {}, pedido, c);
  let r: { versao: number };
  if (a) r = (await q1<{ versao: number }>(`update avatars set config = $2, versao = versao + 1, atualizado_em = now() where id = $1 returning versao`, [a.id, JSON.stringify(cfg)], c))!;
  else r = (await q1<{ versao: number }>(`insert into avatars (house_id, config) values ($1, $2) returning versao`, [casa.id, JSON.stringify(cfg)], c))!;
  await emitir(c, 'avatar.atualizado', { houseId: casa.id, userId, versao: r.versao });
  return { houseId: casa.id, config: cfg, versao: r.versao };
}

export async function avatarDaCasa(houseId: string, ex: Exec) {
  const a = await q1<{ config: ConfigAvatar; versao: number }>(`select a.config, a.versao from avatars a join houses h on h.id = a.house_id where a.house_id = $1 and a.ativo and h.status in ('reservada','reivindicada')`, [houseId], ex);
  if (!a) throw new ErroHttp(404, 'avatar não encontrado');
  return { houseId, config: { ...AVATAR_PADRAO, ...a.config }, versao: a.versao };
}
