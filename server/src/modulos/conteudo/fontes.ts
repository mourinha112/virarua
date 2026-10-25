/* Fontes de fatos: consultas nomeadas e determinísticas sobre as tabelas do núcleo (001). Cada métrica do vídeo
   aponta para (fonte, parâmetros) e é re-executada antes de publicar. Separa casa reservada de reivindicada.
   Identidades de demonstração (escopo 'demo' ou @ "demo.*") nunca entram em contadores de produção. */
import { q1, type Exec, db } from '../../db/db';

const SEM_DEMO = `ei.escopo <> 'demo' and coalesce(ei.username, '') not like 'demo.%'`;

type Fonte = (p: Record<string, any>, ex: Exec) => Promise<number>;
const n = async (sql: string, params: unknown[], ex: Exec) => Number((await q1<{ n: number }>(sql, params, ex))?.n ?? 0);

export const FONTES: Record<string, Fonte> = {
  'cidade.moradores_reivindicados': (p, ex) => n(
    `select count(*)::int n from houses h join plots pl on pl.id = h.plot_id join external_identities ei on ei.id = h.dono_identity_id
     where pl.ibge = $1 and h.status = 'reivindicada' and ${SEM_DEMO}`, [p.ibge], ex),
  'cidade.casas_reservadas': (p, ex) => n(
    `select count(*)::int n from houses h join plots pl on pl.id = h.plot_id join external_identities ei on ei.id = h.dono_identity_id
     where pl.ibge = $1 and h.status = 'reservada' and ${SEM_DEMO}`, [p.ibge], ex),
  'cidade.ruas_ativas': (p, ex) => n(`select count(*)::int n from virtual_streets where ibge = $1 and status in ('fundacao','ativa')`, [p.ibge], ex),
  'rua.moradores': (p, ex) => n(
    `select count(*)::int n from street_memberships sm join houses h on h.id = sm.house_id join external_identities ei on ei.id = h.dono_identity_id
     where sm.street_id = $1 and sm.saiu_em is null and h.status = 'reivindicada' and ${SEM_DEMO}`, [p.street_id], ex),
  /** vagas REALMENTE disponíveis: rua pública, aberta, capacidade − ocupadas */
  'rua.vagas': (p, ex) => n(
    `select case when publica and status in ('fundacao','ativa') then greatest(capacidade - ocupadas, 0) else 0 end::int n from virtual_streets where id = $1`, [p.street_id], ex),
  'pais.moradores_reivindicados': (_p, ex) => n(
    `select count(*)::int n from houses h join external_identities ei on ei.id = h.dono_identity_id where h.status = 'reivindicada' and ${SEM_DEMO}`, [], ex),
  'pais.cidades_com_casas': (_p, ex) => n(
    `select count(distinct pl.ibge)::int n from houses h join plots pl on pl.id = h.plot_id join external_identities ei on ei.id = h.dono_identity_id
     where h.status = 'reivindicada' and ${SEM_DEMO}`, [], ex),
  /** avatar salvo = versão > 1 (o avatar nasce com a reserva na versão 1) */
  'pais.avatares_salvos': (_p, ex) => n(
    `select count(*)::int n from avatars a join houses h on h.id = a.house_id join external_identities ei on ei.id = h.dono_identity_id
     where a.ativo and a.versao > 1 and h.status = 'reivindicada' and ${SEM_DEMO}`, [], ex),
  'pais.ruas_ativas': (_p, ex) => n(`select count(*)::int n from virtual_streets where status in ('fundacao','ativa')`, [], ex),
};

export async function consultarFonte(fonte: string, parametros: Record<string, any>, ex: Exec = db()) {
  const f = FONTES[fonte]; if (!f) throw new Error('fonte de fato desconhecida: ' + fonte);
  return f(parametros, ex);
}

/** perfis que podem aparecer: consentimento promocional explícito (privacy_preferences.aparecer_em_video) */
export async function perfisPermitidos(userIds: string[], ex: Exec = db()) {
  if (!userIds.length) return [] as { user_id: string; nome_publico: string; handle: string | null; avatar: Record<string, string> | null }[];
  const r = await ex.query(
    `select u.id user_id, u.nome_publico, case when pp.mostrar_handle then ei.username else null end handle, av.config avatar
       from users u join privacy_preferences pp on pp.user_id = u.id and pp.aparecer_em_video
       left join external_identities ei on ei.user_id = u.id and ei.revogado_em is null and ei.provedor = 'instagram'
       left join houses h on h.dono_user_id = u.id and h.principal and h.status = 'reivindicada'
       left join avatars av on av.house_id = h.id and av.ativo
      where u.id = any($1::uuid[]) and u.status = 'ativo' and u.faixa_etaria <> 'menor'`, [userIds]);
  return r.rows as { user_id: string; nome_publico: string; handle: string | null; avatar: Record<string, string> | null }[];
}
