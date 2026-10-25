/* Presença por heartbeat. Uma linha por usuário (PK user_id): várias abas atualizam a mesma linha e nunca criam
   dois avatares. Expira em config.presenca.expiraSeg; a expiração libera o slot do destino. Estados públicos:
   online | away | offline | invisible (invisible só para o próprio usuário; os outros veem offline). */
import { db, q, q1, type Exec } from '../../db/db';
import { config } from '../../config';
import { enfileirar } from '../../jobs/fila';

/** expressão SQL do estado visto por `viewerParam` (ex.: '$2'); exige aliases pp (privacy_preferences) e ps (presence_sessions vivas) */
export function estadoPresencaSql(viewerParam: string, alvoCol = 'h.dono_user_id') {
  return `case when coalesce(pp.presenca, 'visivel') = 'invisivel' then (case when ${alvoCol} = ${viewerParam}::uuid then 'invisible' else 'offline' end)
               when ps.user_id is null then 'offline' else ps.estado end`;
}

/** remove presenças expiradas e libera os slots delas (idempotente; seguro em concorrência) */
export async function expirarPresencas(ex: Exec = db()) {
  const r = await q<{ n: number }>(
    `with exp as (delete from presence_sessions where expira_em < now() returning user_id),
          liberados as (update location_slots s set user_id = null, ocupado_em = null from exp where s.user_id = exp.user_id returning s.user_id)
     select (select count(*) from exp)::int n`, [], ex);
  // slots presos sem presença viva (ex.: presença apagada por sair da conta)
  await q(`update location_slots s set user_id = null, ocupado_em = null where s.user_id is not null and s.ocupado_em < now() - interval '2 minutes' and not exists (select 1 from presence_sessions p where p.user_id = s.user_id)`, [], ex);
  return r[0]?.n ?? 0;
}

export type Heartbeat = { aba?: unknown; estado?: unknown };

export async function heartbeat(userId: string, d: Heartbeat) {
  await expirarPresencas();
  const aba = typeof d.aba === 'string' ? d.aba.slice(0, 64) : null;
  const estado = d.estado === 'away' ? 'away' : 'online';
  const r = (await q1<{ estado: string; aba_id: string | null; location_id: string | null; instance_id: string | null; slot: number | null; iniciada_em: string; nova: boolean }>(
    `insert into presence_sessions (user_id, estado, aba_id, expira_em) values ($1, $2, $3, now() + make_interval(secs => $4))
     on conflict (user_id) do update set estado = excluded.estado, aba_id = coalesce(excluded.aba_id, presence_sessions.aba_id),
       ultimo_heartbeat = now(), expira_em = excluded.expira_em
     returning estado, aba_id, location_id, instance_id, slot, iniciada_em, (xmax = 0) as nova`, [userId, estado, aba, config.presenca.expiraSeg]))!;
  // varredura periódica idempotente (uma por minuto) para expirar quem fechou a aba sem sair
  const bucket = Math.floor(Date.now() / 60_000);
  await enfileirar(db(), 'social.expirar_presencas', {}, 'presenca-varredura:' + bucket, 60).catch(() => {});
  const pref = await q1<{ presenca: string }>(`select presenca from privacy_preferences where user_id = $1`, [userId]);
  return {
    estado: pref?.presenca === 'invisivel' ? 'invisible' : r.estado,
    abaPrincipal: r.aba_id, estaAbaPrincipal: !aba || r.aba_id === aba,
    local: r.instance_id ? { destinoId: r.location_id, instanciaId: r.instance_id, slot: r.slot } : null,
    expiraSeg: config.presenca.expiraSeg, novaSessao: r.nova,
  };
}

/** sair do jogo (logout/fechar): limpa presença e slot na hora, sem esperar expirar */
export async function encerrarPresenca(userId: string, ex: Exec = db()) {
  await q(`update location_slots set user_id = null, ocupado_em = null where user_id = $1`, [userId], ex);
  await q(`delete from presence_sessions where user_id = $1`, [userId], ex);
}

export async function estadoDe(alvo: string, viewer: string | null) {
  const r = await q1<{ estado: string; location_id: string | null; nome: string | null; tipo: string | null }>(
    `select ${estadoPresencaSql('$2', 'u.id')} estado, ps.location_id, l.nome, l.tipo
       from users u left join privacy_preferences pp on pp.user_id = u.id
       left join presence_sessions ps on ps.user_id = u.id and ps.expira_em > now()
       left join locations l on l.id = ps.location_id
      where u.id = $1`, [alvo, viewer]);
  if (!r) return null;
  const visivel = r.estado === 'online' || r.estado === 'away' || (r.estado === 'invisible' && alvo === viewer);
  return { estado: r.estado, local: visivel && r.location_id ? { destinoId: r.location_id, nome: r.nome, tipo: r.tipo } : null };
}

export async function definirInvisivel(userId: string, invisivel: boolean) {
  await q(`insert into privacy_preferences (user_id, presenca) values ($1, $2) on conflict (user_id) do update set presenca = excluded.presenca, atualizado_em = now()`, [userId, invisivel ? 'invisivel' : 'visivel']);
}
