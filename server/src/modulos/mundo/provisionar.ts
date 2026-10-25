/* Provisionamento idempotente da casa a partir de uma identidade externa (Fase 1).
   Tudo numa transação do chamador. O "gerador atual" é o par city_lot_counters + gerador procedural do front
   (src/mundo/cidade.ts): o lote k da cidade é sempre a k-ésima posição do gerador. Aqui só alocamos o índice. */
import { q, q1, emitir, type Tx } from '../../db/db';
import { config } from '../../config';
import { AVATAR_PADRAO } from '../../db/semear';

export type ResultadoProvisao =
  | { resultado: 'provisioned'; identityId: string; houseId: string; plotId: string; loteIndex: number; streetId: string; ibge: number }
  | { resultado: 'duplicate'; identityId: string; houseId: string; ibge: number; status: string }
  | { resultado: 'revoked'; identityId: string };

/** upsert da identidade externa (unique provedor+escopo+external_id) e trava da linha (serializa o mesmo autor).
    O username só é atualizado se o evento for mais novo que a última atualização (eventos fora de ordem). */
export async function garantirIdentidade(c: Tx, a: { provedor?: string; escopo: string; externalId: string; username?: string | null; eventoEm?: Date | null }) {
  const provedor = a.provedor || 'instagram';
  const quando = a.eventoEm || new Date();
  await c.query(
    `insert into external_identities (provedor, escopo, external_id, username, username_atualizado_em) values ($1, $2, $3, $4, $5)
     on conflict (provedor, escopo, external_id) do nothing`, [provedor, a.escopo, a.externalId, a.username || null, a.username ? quando : null]);
  const idt = (await q1<{ id: string; username: string | null; username_atualizado_em: Date | null; revogado_em: Date | null; user_id: string | null }>(
    `select id, username, username_atualizado_em, revogado_em, user_id from external_identities where provedor = $1 and escopo = $2 and external_id = $3 for update`,
    [provedor, a.escopo, a.externalId], c))!;
  if (a.username && !idt.revogado_em && idt.username !== a.username && (!idt.username_atualizado_em || idt.username_atualizado_em <= quando)) {
    // username é atributo mutável: o dono atual do @ (mesmo escopo) passa a exibi-lo; quem o tinha antes perde só a exibição
    await c.query(`update external_identities set username = null where provedor = $1 and escopo = $2 and lower(username) = lower($3) and id <> $4`, [provedor, a.escopo, a.username, idt.id]);
    await c.query(`update external_identities set username = $2, username_atualizado_em = $3 where id = $1`, [idt.id, a.username, quando]);
    idt.username = a.username;
  }
  return idt;
}

/** onboarding: grava o estado sem regredir quem já avançou (ex.: um comentário ambíguo não rebaixa uma casa provisionada) */
const ESTADOS_INICIAIS = ['received', 'pending_city_resolution', 'invalid', 'needs_review', 'expired', 'ignored'];
export async function marcarOnboarding(c: Tx, identityId: string, estado: string, detalhe: string | null, opts: { forcar?: boolean; entrega?: string } = {}) {
  await c.query(
    `insert into onboarding (identity_id, estado, detalhe, entrega) values ($1, $2, $3, coalesce($5, 'nenhuma'))
     on conflict (identity_id) do update set estado = excluded.estado, detalhe = excluded.detalhe, atualizado_em = now(),
       entrega = coalesce($5, onboarding.entrega)
     where $4 or onboarding.estado = any($6)`, [identityId, estado, detalhe, !!opts.forcar, opts.entrega ?? null, ESTADOS_INICIAIS]);
}

/** aloca um lote livre na cidade: primeiro reusa lote liberado (reserva expirada), senão o próximo índice do contador */
async function alocarLote(c: Tx, ibge: number) {
  const livre = await q1<{ id: string; lote_index: number }>(
    `select p.id, p.lote_index from plots p
      where p.ibge = $1 and not exists (select 1 from houses h where h.plot_id = p.id and h.status in ('reservada','reivindicada'))
      order by p.lote_index limit 1 for update of p skip locked`, [ibge], c);
  if (livre) return { plotId: livre.id, loteIndex: livre.lote_index };
  await c.query(`insert into city_lot_counters (ibge, proximo) values ($1, 0) on conflict (ibge) do nothing`, [ibge]);
  const k = (await q1<{ k: number }>(`update city_lot_counters set proximo = proximo + 1 where ibge = $1 returning proximo - 1 as k`, [ibge], c))!.k;
  const p = (await q1<{ id: string }>(`insert into plots (ibge, lote_index) values ($1, $2) returning id`, [ibge, k], c))!;
  return { plotId: p.id, loteIndex: k };
}

/** rua pública com vaga (trava a linha; pula as travadas). Cria "Rua N" quando todas estão lotadas. */
export async function alocarRua(c: Tx, ibge: number) {
  for (let tent = 0; tent < 60; tent++) {
    const r = await q1<{ id: string }>(
      `select id from virtual_streets where ibge = $1 and publica and status in ('fundacao','ativa') and ocupadas < capacidade
        order by criada_em, id limit 1 for update skip locked`, [ibge], c);
    if (r) return r.id;
    // todas as ruas com vaga estão travadas por outras transações: espera uma delas (o where é reavaliado após a trava)
    const espera = await q1<{ id: string }>(
      `select id from virtual_streets where ibge = $1 and publica and status in ('fundacao','ativa') and ocupadas < capacidade
        order by criada_em, id limit 1 for update`, [ibge], c);
    if (espera) return espera.id;
    const n = (await q1<{ n: number }>(`select count(*)::int n from virtual_streets where ibge = $1`, [ibge], c))!.n + 1 + tent;
    const nova = await q1<{ id: string }>(
      `insert into virtual_streets (ibge, nome, capacidade, status, publica) values ($1, $2, $3, 'ativa', true) on conflict do nothing returning id`,
      [ibge, `Rua ${n}`, config.ruas.capacidadeInicial], c);
    if (nova) { await c.query(`select id from virtual_streets where id = $1 for update`, [nova.id]); return nova.id; }
  }
  throw new Error('não foi possível alocar rua');
}

/** Provisiona a casa principal da identidade na cidade. Idempotente: quem já tem casa principal ativa recebe 'duplicate'
    (comentar outra cidade depois NÃO muda a residência). Nunca concede sessão. */
export async function provisionar(c: Tx, a: { escopo: string; externalId: string; username?: string | null; ibge: number; origem: string; eventoEm?: Date | null; provedor?: string }): Promise<ResultadoProvisao> {
  const idt = await garantirIdentidade(c, a);
  if (idt.revogado_em) return { resultado: 'revoked', identityId: idt.id };
  const ja = await q1<{ id: string; ibge: number; status: string }>(
    `select h.id, p.ibge, h.status from houses h join plots p on p.id = h.plot_id
      where h.dono_identity_id = $1 and h.principal and h.status in ('reservada','reivindicada')`, [idt.id], c);
  if (ja) return { resultado: 'duplicate', identityId: idt.id, houseId: ja.id, ibge: ja.ibge, status: ja.status };

  const { plotId, loteIndex } = await alocarLote(c, a.ibge);
  const streetId = await alocarRua(c, a.ibge);
  await c.query(`update virtual_streets set ocupadas = ocupadas + 1 where id = $1`, [streetId]);
  await c.query(`update plots set street_id = $2 where id = $1`, [plotId, streetId]);
  const house = (await q1<{ id: string }>(
    `insert into houses (plot_id, dono_identity_id, dono_user_id, status, principal, expira_em)
     values ($1, $2, $3, 'reservada', true, now() + make_interval(days => $4)) returning id`,
    [plotId, idt.id, null, config.reivindicacao.retencaoReservaDias], c))!;
  await c.query(`insert into street_memberships (street_id, house_id) values ($1, $2)`, [streetId, house.id]);
  await c.query(`insert into avatars (house_id, config) values ($1, $2)`, [house.id, JSON.stringify(AVATAR_PADRAO)]);
  await marcarOnboarding(c, idt.id, 'provisioned_unclaimed', null, { forcar: true, entrega: 'nenhuma' });
  await emitir(c, 'casa.provisionada', { house_id: house.id, identity_id: idt.id, ibge: a.ibge, lote_index: loteIndex, street_id: streetId, origem: a.origem }, 'casa.provisionada:' + house.id);
  return { resultado: 'provisioned', identityId: idt.id, houseId: house.id, plotId, loteIndex, streetId, ibge: a.ibge };
}

/** Expira reservas não reivindicadas vencidas: libera lote e vaga na rua em transação; mantém a identidade
    (dedupe mínimo: external_identities + instagram_comments continuam) e invalida links pendentes. */
export async function expirarReservas(c: Tx, max = 200) {
  const hs = await q<{ id: string; dono_identity_id: string; plot_id: string }>(
    `select id, dono_identity_id, plot_id from houses where status = 'reservada' and expira_em < now() order by expira_em limit $1 for update skip locked`, [max], c);
  for (const h of hs) {
    await c.query(`update houses set status = 'expirada' where id = $1`, [h.id]);
    const sm = await q<{ street_id: string }>(`update street_memberships set saiu_em = now(), motivo_saida = 'reserva_expirada' where house_id = $1 and saiu_em is null returning street_id`, [h.id], c);
    for (const s of sm) await c.query(`update virtual_streets set ocupadas = greatest(0, ocupadas - 1) where id = $1`, [s.street_id]);
    await c.query(`update avatars set ativo = false where house_id = $1 and ativo`, [h.id]);
    await c.query(`update identity_claims set expira_em = now() where identity_id = $1 and consumido_em is null and expira_em > now()`, [h.dono_identity_id]);
    await marcarOnboarding(c, h.dono_identity_id, 'expired', 'reserva não reivindicada no prazo; comente de novo para pedir outra casa', { forcar: true });
    await emitir(c, 'casa.reserva_expirada', { house_id: h.id, identity_id: h.dono_identity_id, plot_id: h.plot_id }, 'casa.reserva_expirada:' + h.id);
  }
  return hs.length;
}
