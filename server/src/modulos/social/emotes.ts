/* Emotes e frases predefinidas numa sala, reações persistentes moderadas e álbum de lembranças.
   Chat livre fica atrás da flag chat_livre (desligada): a rota só responde que está desligado. */
import { q, q1, type Exec } from '../../db/db';
import { ErroHttp } from '../../http/app';
import { limpar } from './moderacao';
import { bloqueado } from './amizades';

export const LIMITE_EMOTES = { janelaSeg: 20, max: 5 };
export const LIMITE_REACOES = { janelaSeg: 60, max: 30 };

export async function catalogoEmotes(ex: Exec) {
  return q(`select id, tipo, rotulo, animacao from emote_catalog where ativo order by ordem, id`, [], ex);
}

export async function enviarEmote(userId: string, d: { emote?: unknown; alvoUserId?: unknown }, ex: Exec) {
  const e = typeof d.emote === 'string' ? await q1<{ id: string; animacao: string | null }>(`select id, animacao from emote_catalog where id = $1 and ativo`, [d.emote], ex) : null;
  if (!e) throw new ErroHttp(400, 'escolha um emote da lista');
  const pres = await q1<{ instance_id: string | null }>(`select instance_id from presence_sessions where user_id = $1 and expira_em > now()`, [userId], ex);
  if (!pres?.instance_id) throw new ErroHttp(409, 'entre num lugar para mandar emotes');
  const n = (await q1<{ n: number }>(`select count(*)::int n from emote_events where user_id = $1 and criado_em > now() - make_interval(secs => $2)`, [userId, LIMITE_EMOTES.janelaSeg], ex))!.n;
  if (n >= LIMITE_EMOTES.max) throw new ErroHttp(429, 'calma! espere uns segundos para o próximo emote');
  let alvo: string | null = typeof d.alvoUserId === 'string' && /^[0-9a-f-]{36}$/i.test(d.alvoUserId) ? d.alvoUserId : null;
  if (alvo) {
    const naSala = await q1(`select 1 from location_slots where user_id = $1 and instance_id = $2`, [alvo, pres.instance_id], ex);
    if (!naSala || await bloqueado(userId, alvo, ex)) alvo = null;
  }
  const r = (await q1<{ id: number; criado_em: string }>(`insert into emote_events (user_id, instance_id, emote_id, alvo_user_id) values ($1, $2, $3, $4) returning id, criado_em`, [userId, pres.instance_id, e.id, alvo], ex))!;
  return { id: r.id, instanciaId: pres.instance_id, emote: e.id, animacao: e.animacao };
}

/** emotes recentes da sala (polling): só os últimos 60 s e depois de `desde` */
export async function emotesDaSala(instanceId: string, desde: number, viewer: string | null, ex: Exec) {
  return q(`select e.id, e.user_id "userId", e.emote_id emote, c.animacao, c.rotulo, e.alvo_user_id "alvoUserId", e.criado_em "criadoEm"
              from emote_events e join emote_catalog c on c.id = e.emote_id
             where e.instance_id = $1 and e.id > $2 and e.criado_em > now() - interval '60 seconds'
               and ($3::uuid is null or not exists (select 1 from user_blocks b where (b.user_id = $3::uuid and b.bloqueado_id = e.user_id) or (b.user_id = e.user_id and b.bloqueado_id = $3::uuid)))
             order by e.id limit 100`, [instanceId, desde, viewer], ex);
}

export async function reagir(userId: string, d: { alvoTipo?: unknown; alvoId?: unknown; emote?: unknown }, ex: Exec) {
  const tipo = d.alvoTipo === 'casa' || d.alvoTipo === 'lembranca' ? d.alvoTipo : null;
  const id = typeof d.alvoId === 'string' && /^[0-9a-f-]{36}$/i.test(d.alvoId) ? d.alvoId : null;
  if (!tipo || !id) throw new ErroHttp(400, 'reação inválida');
  const e = typeof d.emote === 'string' ? await q1(`select 1 from emote_catalog where id = $1 and ativo and tipo = 'emote'`, [d.emote], ex) : null;
  if (!e) throw new ErroHttp(400, 'escolha um emote da lista');
  const dono = tipo === 'casa' ? await q1<{ u: string | null }>(`select dono_user_id u from houses where id = $1 and status = 'reivindicada'`, [id], ex)
    : await q1<{ u: string | null }>(`select user_id u from memories where id = $1`, [id], ex);
  if (!dono) throw new ErroHttp(404, 'não encontrado');
  if (dono.u && await bloqueado(userId, dono.u, ex)) throw new ErroHttp(403, 'não é possível reagir');
  const n = (await q1<{ n: number }>(`select count(*)::int n from reactions where user_id = $1 and criado_em > now() - make_interval(secs => $2)`, [userId, LIMITE_REACOES.janelaSeg], ex))!.n;
  if (n >= LIMITE_REACOES.max) throw new ErroHttp(429, 'muitas reações seguidas: espere um minuto');
  await q(`insert into reactions (user_id, alvo_tipo, alvo_id, emote_id) values ($1, $2, $3, $4) on conflict do nothing`, [userId, tipo, id, d.emote], ex);
  return contarReacoes(tipo, id, userId, ex);
}
export async function contarReacoes(tipo: string, id: string, viewer: string | null, ex: Exec) {
  const l = await q<{ emote: string; n: number; minha: boolean }>(`select emote_id emote, count(*)::int n, bool_or(user_id = $3::uuid) minha from reactions where alvo_tipo = $1 and alvo_id = $2 group by emote_id order by n desc`, [tipo, id, viewer], ex);
  return { reacoes: l };
}

/* ---------- álbum de lembranças ---------- */
export async function minhasLembrancas(userId: string, ex: Exec) {
  return q(`select m.id, m.tipo, m.titulo, m.ibge, mu.nome cidade, mu.uf, m.dados, m.criado_em "criadoEm" from memories m left join municipios mu on mu.ibge = m.ibge where m.user_id = $1 order by m.criado_em desc limit 200`, [userId], ex);
}
/** "guardar este momento": foto do lugar atual com quem está visível agora (uma por lugar por dia) */
export async function guardarLembranca(userId: string, d: { titulo?: unknown }, ex: Exec) {
  const pres = await q1<{ location_id: string | null; instance_id: string | null; nome: string; ibge: number }>(
    `select ps.location_id, ps.instance_id, l.nome, l.ibge from presence_sessions ps join locations l on l.id = ps.location_id where ps.user_id = $1 and ps.expira_em > now()`, [userId], ex);
  if (!pres?.instance_id) throw new ErroHttp(409, 'entre num lugar para guardar uma lembrança');
  const comQuem = await q<{ nome: string }>(`select u.nome_publico nome from location_slots s join users u on u.id = s.user_id left join privacy_preferences pp on pp.user_id = s.user_id
                                           join presence_sessions ps on ps.user_id = s.user_id and ps.expira_em > now()
                                          where s.instance_id = $1 and s.user_id <> $2 and coalesce(pp.presenca, 'visivel') <> 'invisivel' limit 12`, [pres.instance_id, userId], ex);
  const titulo = limpar(d.titulo, 80) || ('em ' + pres.nome).slice(0, 80);
  const dia = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const r = await q1<{ id: string }>(`insert into memories (user_id, tipo, titulo, location_id, ibge, dados, chave) values ($1, 'foto', $2, $3, $4, $5, $6) on conflict (chave) do nothing returning id`,
    [userId, titulo, pres.location_id, pres.ibge, JSON.stringify({ destino: pres.nome, comQuem: comQuem.map((x) => x.nome) }), `foto:${userId}:${pres.location_id}:${dia}`], ex);
  if (!r) throw new ErroHttp(409, 'você já guardou uma lembrança deste lugar hoje');
  return { id: r.id };
}
