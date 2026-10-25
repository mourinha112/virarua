/* Fixtures de teste compartilhadas (dados SINTÉTICOS, nunca pessoas reais). Insere direto via SQL no esquema 001,
   para os módulos testarem sem depender do fluxo do Instagram. */
import { q1, q } from '../src/db/db';
import { AVATAR_PADRAO } from '../src/db/semear';

let seq = 0;
export type Morador = { userId: string; identityId: string; houseId: string; streetId: string; plotId: string; ibge: number; handle: string };

/** cria rua pública na cidade (ou devolve a primeira com vaga) */
export async function ruaTeste(ibge: number, nome?: string, capacidade = 24) {
  return (await q1<{ id: string }>(`insert into virtual_streets (ibge, nome, capacidade, status) values ($1, $2, $3, 'ativa') returning id`, [ibge, nome || `Rua Teste ${++seq}`, capacidade]))!.id;
}

/** morador reivindicado e verificado há `diasVerificado` dias, com casa num lote novo da cidade e membro da rua */
export async function moradorTeste(ibge: number, opts: { rua?: string; diasVerificado?: number; handle?: string; adulto?: boolean } = {}): Promise<Morador> {
  const n = ++seq, handle = opts.handle || `teste_sintetico_${n}`;
  const dias = opts.diasVerificado ?? 3;
  const user = (await q1<{ id: string }>(`insert into users (nome_publico, verificado_em, faixa_etaria) values ($1, now() - make_interval(days => $2), $3) returning id`, [`Teste ${n}`, dias, opts.adulto ? 'adulto' : 'desconhecida']))!.id;
  const ident = (await q1<{ id: string }>(`insert into external_identities (provedor, escopo, external_id, username, user_id) values ('instagram', 'teste', $1, $2, $3) returning id`, ['sint-' + n + '-' + Date.now(), handle, user]))!.id;
  await q(`insert into city_lot_counters (ibge, proximo) values ($1, 0) on conflict (ibge) do nothing`, [ibge]);
  const lote = (await q1<{ k: number }>(`update city_lot_counters set proximo = proximo + 1 where ibge = $1 returning proximo - 1 as k`, [ibge]))!.k;
  const rua = opts.rua || (await ruaTeste(ibge));
  const plot = (await q1<{ id: string }>(`insert into plots (ibge, lote_index, street_id) values ($1, $2, $3) returning id`, [ibge, lote, rua]))!.id;
  const house = (await q1<{ id: string }>(`insert into houses (plot_id, dono_identity_id, dono_user_id, status, reivindicada_em) values ($1, $2, $3, 'reivindicada', now()) returning id`, [plot, ident, user]))!.id;
  await q(`insert into street_memberships (street_id, house_id) values ($1, $2)`, [rua, house]);
  await q(`update virtual_streets set ocupadas = ocupadas + 1 where id = $1`, [rua]);
  await q(`insert into avatars (house_id, config) values ($1, $2)`, [house, JSON.stringify(AVATAR_PADRAO)]);
  await q(`insert into onboarding (identity_id, estado) values ($1, 'onboarding_complete')`, [ident]);
  return { userId: user, identityId: ident, houseId: house, streetId: rua, plotId: plot, ibge, handle };
}

/** sessão autenticada para um usuário (cookie smn_sess) — para testes de rota */
export async function sessaoTeste(userId: string) {
  const { tokenForte, sha256 } = await import('../src/seguranca/cripto');
  const t = tokenForte(32);
  await q(`insert into sessions (user_id, token_hash, expira_em) values ($1, $2, now() + interval '1 day')`, [userId, sha256(t)]);
  return t;
}
