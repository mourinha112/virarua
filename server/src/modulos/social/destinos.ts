/* Destinos tipados (house, street, city_square, venue, event), instâncias e slots. Sem joystick/pathfinding:
   o jogador escolhe o destino (e opcionalmente o slot) e é teletransportado para um slot livre.
   - Escolha de slot atômica: select ... for update skip locked; índice único garante 1 slot por usuário no mundo.
   - Sala cheia: abre outra instância até max_instancias; depois devolve alternativas (nunca sobrepõe personagens).
   - Visitar outra cidade NÃO altera casa, lote, rua nem residência (só presença/slot). */
import { db, q, q1, tx, emitir, type Exec, type Tx } from '../../db/db';
import { config } from '../../config';
import { ErroHttp } from '../../http/app';
import { SQL_HANDLE, casaPrincipal } from './comum';
import { bloqueado, saoAmigos } from './amizades';
import { expirarPresencas } from './presenca';
import { destinosExtrasDaCidade } from './provedores';
import { ruaAtualDaCasa } from './ruas';

export type TipoDestino = 'house' | 'street' | 'city_square' | 'venue' | 'event';
export const CAPACIDADE: Record<TipoDestino, number> = { house: 8, street: 24, city_square: 30, venue: 20, event: 40 };
export const MAX_INSTANCIAS: Record<TipoDestino, number> = { house: 1, street: 2, city_square: 6, venue: 4, event: 8 };

export type Location = { id: string; tipo: TipoDestino; ibge: number; ref_id: string; nome: string; capacidade: number; max_instancias: number; ativo: boolean };

export async function garantirLocation(ex: Exec, tipo: TipoDestino, refId: string, ibge: number, nome: string, capacidade = CAPACIDADE[tipo], maxInst = MAX_INSTANCIAS[tipo]) {
  return (await q1<Location>(
    `insert into locations (tipo, ref_id, ibge, nome, capacidade, max_instancias) values ($1, $2, $3, $4, $5, $6)
     on conflict (tipo, ref_id) do update set nome = excluded.nome returning *`, [tipo, refId, ibge, nome, capacidade, maxInst], ex))!;
}

export async function garantirDestinoCasa(houseId: string, ex: Exec) {
  const h = await q1<{ id: string; ibge: number; handle: string | null; status: string }>(
    `select h.id, p.ibge, h.status, ${SQL_HANDLE} handle from houses h join plots p on p.id = h.plot_id
       left join external_identities ei on ei.id = h.dono_identity_id left join privacy_preferences pp on pp.user_id = h.dono_user_id where h.id = $1`, [houseId], ex);
  if (!h || (h.status !== 'reivindicada' && h.status !== 'reservada')) throw new ErroHttp(404, 'casa não encontrada');
  return garantirLocation(ex, 'house', h.id, h.ibge, h.handle ? `casa de @${h.handle}` : 'casa de um morador');
}

/** acesso ao destino: casa respeita privacy_preferences.visita (publica/amigos/privada) e bloqueio; rua privada só membros ou convidados */
export async function podeAcessar(userId: string, loc: Location, ex: Exec): Promise<{ ok: true } | { ok: false; motivo: string }> {
  if (!loc.ativo) return { ok: false, motivo: 'esse lugar está fechado' };
  const convidado = async (dono: string | null) => !!(await q1(
    `select 1 from invitation_uses u join invitations i on i.id = u.invitation_id
      where u.user_id = $1 and i.location_id = $2 and i.revogado_em is null and i.expira_em > now() ${dono ? 'and i.criado_por = $3' : ''}`, dono ? [userId, loc.id, dono] : [userId, loc.id], ex));
  if (loc.tipo === 'house') {
    const h = await q1<{ dono: string | null; visita: string | null }>(`select h.dono_user_id dono, pp.visita from houses h left join privacy_preferences pp on pp.user_id = h.dono_user_id where h.id = $1`, [loc.ref_id], ex);
    if (!h) return { ok: false, motivo: 'casa não encontrada' };
    if (h.dono === userId) return { ok: true };
    if (h.dono && await bloqueado(userId, h.dono, ex)) return { ok: false, motivo: 'você não pode visitar essa casa' };
    const regra = h.visita || 'publica';
    if (regra === 'publica') return { ok: true };
    if (regra === 'amigos' && h.dono && await saoAmigos(userId, h.dono, ex)) return { ok: true };
    if (await convidado(h.dono)) return { ok: true };
    return { ok: false, motivo: regra === 'amigos' ? 'essa casa recebe só amigos' : 'essa casa é privada: só com convite do dono' };
  }
  if (loc.tipo === 'street') {
    const s = await q1<{ publica: boolean; status: string }>(`select publica, status from virtual_streets where id = $1`, [loc.ref_id], ex);
    if (!s || s.status === 'arquivada') return { ok: false, motivo: 'rua não encontrada' };
    if (s.publica) return { ok: true };
    const casa = await casaPrincipal(userId, ex);
    if (casa && (await ruaAtualDaCasa(casa.id, ex))?.street_id === loc.ref_id) return { ok: true };
    if (await convidado(null)) return { ok: true };
    return { ok: false, motivo: 'rua privada: só moradores e convidados' };
  }
  return { ok: true };
}

const ocupacaoSql = `(select count(*)::int from location_slots s join location_instances i on i.id = s.instance_id join presence_sessions ps on ps.user_id = s.user_id and ps.expira_em > now() where i.location_id = l.id)`;

export async function destinosDaCidade(ibge: number, viewer: string | null, ex: Exec = db()) {
  const cid = await q1<{ nome: string; uf: string }>(`select nome, uf from municipios where ibge = $1`, [ibge], ex);
  if (!cid) throw new ErroHttp(404, 'cidade não encontrada');
  await garantirLocation(ex, 'city_square', 'praca:' + ibge, ibge, `praça de ${cid.nome}`);
  for (const s of await q<{ id: string; nome: string }>(`select id, nome from virtual_streets where ibge = $1 and status in ('fundacao','ativa','pausada')`, [ibge], ex)) await garantirLocation(ex, 'street', s.id, ibge, s.nome);
  for (const e of await destinosExtrasDaCidade(ibge, ex)) await garantirLocation(ex, e.tipo, e.refId, ibge, e.nome, Math.max(1, Math.min(200, e.capacidade)));
  if (viewer) {
    const casa = await casaPrincipal(viewer, ex); if (casa && casa.ibge === ibge) await garantirDestinoCasa(casa.id, ex);
    // casas de amigos nesta cidade aparecem como "visitar amigo"
    for (const h of await q<{ id: string }>(`select h.id from friendships f join houses h on h.dono_user_id = case when f.solicitante_id = $1 then f.destinatario_id else f.solicitante_id end and h.principal and h.status = 'reivindicada'
                                              join plots p on p.id = h.plot_id where f.estado = 'aceita' and $1 in (f.solicitante_id, f.destinatario_id) and p.ibge = $2`, [viewer, ibge], ex)) await garantirDestinoCasa(h.id, ex);
  }
  const lista = await q<Location & { ocupacao: number; instancias: number }>(
    `select l.*, ${ocupacaoSql} ocupacao, (select count(*)::int from location_instances i where i.location_id = l.id) instancias
       from locations l where l.ibge = $1 and l.ativo and (l.tipo <> 'house' or l.ref_id in (
         select h.id::text from houses h where h.dono_user_id = $2::uuid
         union select h.id::text from friendships f join houses h on h.dono_user_id = case when f.solicitante_id = $2::uuid then f.destinatario_id else f.solicitante_id end where f.estado = 'aceita' and $2::uuid in (f.solicitante_id, f.destinatario_id)))
      order by array_position(array['city_square','street','venue','event','house'], l.tipo), l.nome`, [ibge, viewer], ex);
  const out = [];
  for (const l of lista) {
    const acesso = viewer ? await podeAcessar(viewer, l, ex) : { ok: l.tipo !== 'house' } as { ok: boolean };
    out.push({ id: l.id, tipo: l.tipo, nome: l.nome, capacidade: l.capacidade * l.max_instancias, porSala: l.capacidade, ocupacao: l.ocupacao, salas: l.instancias, acessivel: acesso.ok, motivo: (acesso as any).motivo ?? null });
  }
  return { cidade: { ibge, nome: cid.nome, uf: cid.uf }, destinos: out };
}

export async function presentes(instanceId: string, viewer: string | null, ex: Exec = db()) {
  const l = await q<{ slot: number; userId: string; nome: string; handle: string | null; avatar: any; estado: string; invisivel: boolean }>(
    `select s.slot, s.user_id "userId", u.nome_publico nome, ${SQL_HANDLE} handle, a.config avatar, ps.estado, coalesce(pp.presenca, 'visivel') = 'invisivel' invisivel
       from location_slots s join presence_sessions ps on ps.user_id = s.user_id and ps.expira_em > now()
       join users u on u.id = s.user_id
       left join privacy_preferences pp on pp.user_id = s.user_id
       left join houses h on h.dono_user_id = s.user_id and h.principal and h.status = 'reivindicada'
       left join external_identities ei on ei.id = h.dono_identity_id
       left join avatars a on a.house_id = h.id and a.ativo
      where s.instance_id = $1 and s.user_id is not null
        and ($2::uuid is null or not exists (select 1 from user_blocks b where (b.user_id = $2::uuid and b.bloqueado_id = s.user_id) or (b.user_id = s.user_id and b.bloqueado_id = $2::uuid)))
      order by s.slot`, [instanceId, viewer], ex);
  const visiveis = l.filter((p) => !p.invisivel || p.userId === viewer).map(({ invisivel, ...p }) => ({ ...p, eu: p.userId === viewer }));
  return { ocupados: l.length, presentes: visiveis };
}

async function alternativas(loc: Location, ex: Exec) {
  return q(`select l.id, l.tipo, l.nome from locations l where l.ibge = $1 and l.ativo and l.id <> $2 and l.tipo in ('city_square','street','venue','event')
              and ${ocupacaoSql} < l.capacidade * l.max_instancias order by array_position(array['city_square','venue','event','street'], l.tipo), l.nome limit 5`, [loc.ibge, loc.id], ex);
}

export type ResultadoEntrada =
  | { ok: true; destino: { id: string; tipo: string; nome: string; ibge: number }; instancia: { id: string; numero: number; capacidade: number }; slot: number; jaEstava: boolean; ocupados: number; presentes: unknown[] }
  | { ok: false; motivo: 'cheio' | 'slot_ocupado'; erro: string; alternativas?: unknown[]; slotsLivres?: number[] };

async function pegarSlotLivre(c: Tx, instanceId: string) {
  return q1<{ slot: number }>(`select slot from location_slots where instance_id = $1 and user_id is null order by slot limit 1 for update skip locked`, [instanceId], c);
}

export async function entrar(userId: string, locationId: string, pedido: { instanciaId?: string; slot?: number } = {}): Promise<ResultadoEntrada> {
  await expirarPresencas();
  return tx(async (c) => {
    const loc = await q1<Location>(`select * from locations where id = $1`, [locationId], c);
    if (!loc) throw new ErroHttp(404, 'lugar não encontrado');
    const acesso = await podeAcessar(userId, loc, c); if (!acesso.ok) throw new ErroHttp(403, acesso.motivo);
    // trava a presença do usuário: várias abas entrando ao mesmo tempo serializam aqui (uma localização autoritativa)
    await c.query(`insert into presence_sessions (user_id, expira_em) values ($1, now() + make_interval(secs => $2))
                   on conflict (user_id) do update set ultimo_heartbeat = now(), expira_em = excluded.expira_em`, [userId, config.presenca.expiraSeg]);
    const anterior = await q1<{ instance_id: string; slot: number; location_id: string; numero: number; capacidade: number }>(
      `select s.instance_id, s.slot, i.location_id, i.numero, i.capacidade from location_slots s join location_instances i on i.id = s.instance_id where s.user_id = $1`, [userId], c);
    const querSlot = pedido.slot !== undefined && pedido.instanciaId !== undefined;

    let alvo: { instance_id: string; slot: number; numero: number; capacidade: number } | null = null;
    if (anterior && anterior.location_id === loc.id && (!querSlot || (anterior.instance_id === pedido.instanciaId && anterior.slot === pedido.slot))) {
      alvo = anterior;   // já está aqui (outra aba, reconexão): idempotente
    } else if (querSlot) {
      const s = await q1<{ user_id: string | null; numero: number; capacidade: number }>(
        `select s.user_id, i.numero, i.capacidade from location_slots s join location_instances i on i.id = s.instance_id where s.instance_id = $1 and s.slot = $2 and i.location_id = $3 for update of s`, [pedido.instanciaId, pedido.slot, loc.id], c);
      if (!s) throw new ErroHttp(404, 'lugar não encontrado nessa sala');
      if (s.user_id && s.user_id !== userId) {
        const livres = await q<{ slot: number }>(`select slot from location_slots where instance_id = $1 and user_id is null order by slot limit 8`, [pedido.instanciaId], c);
        return { ok: false, motivo: 'slot_ocupado', erro: 'esse lugar acabou de ser ocupado', slotsLivres: livres.map((x) => x.slot) } as ResultadoEntrada;
      }
      alvo = { instance_id: pedido.instanciaId!, slot: pedido.slot!, numero: s.numero, capacidade: s.capacidade };
    } else {
      // varre as salas abertas atrás de slot livre; se não houver, abre a próxima sala. Repete porque outra transação
      // pode ter aberto a sala ao mesmo tempo (conflito em (location_id, numero)) com vagas sobrando.
      for (let tent = 0; !alvo && tent < 8; tent++) {
        const insts = await q<{ id: string; numero: number; capacidade: number; aberta: boolean }>(`select id, numero, capacidade, aberta from location_instances where location_id = $1 order by numero`, [loc.id], c);
        for (const i of insts) { if (!i.aberta) continue; const s = await pegarSlotLivre(c, i.id); if (s) { alvo = { instance_id: i.id, slot: s.slot, numero: i.numero, capacidade: i.capacidade }; break; } }
        if (alvo || insts.length >= loc.max_instancias) break;
        const nova = await q1<{ id: string; numero: number; capacidade: number }>(
          `insert into location_instances (location_id, numero, capacidade) values ($1, $2, $3)
           on conflict (location_id, numero) do nothing returning id, numero, capacidade`, [loc.id, (insts[insts.length - 1]?.numero ?? 0) + 1, loc.capacidade], c);
        if (!nova) continue;   // outra transação abriu a mesma sala: varre de novo
        await c.query(`insert into location_slots (instance_id, slot) select $1, g from generate_series(0, $2 - 1) g`, [nova.id, nova.capacidade]);
        const s = await pegarSlotLivre(c, nova.id); if (s) alvo = { instance_id: nova.id, slot: s.slot, numero: nova.numero, capacidade: nova.capacidade };
        await emitir(c, 'destino.sala_aberta', { locationId: loc.id, instanceId: nova.id, numero: nova.numero });
      }
      if (!alvo) return { ok: false, motivo: 'cheio', erro: 'esse lugar está lotado agora', alternativas: await alternativas(loc, c) } as ResultadoEntrada;
    }

    const jaEstava = !!anterior && anterior.instance_id === alvo.instance_id && anterior.slot === alvo.slot;
    if (!jaEstava) {
      if (anterior) await c.query(`update location_slots set user_id = null, ocupado_em = null where instance_id = $1 and slot = $2 and user_id = $3`, [anterior.instance_id, anterior.slot, userId]);
      const ok = await q1(`update location_slots set user_id = $3, ocupado_em = now() where instance_id = $1 and slot = $2 and (user_id is null or user_id = $3) returning slot`, [alvo.instance_id, alvo.slot, userId], c);
      if (!ok) throw Object.assign(new Error('slot disputado'), { code: '40001' });   // repete a transação
    }
    await c.query(`update presence_sessions set location_id = $2, instance_id = $3, slot = $4 where user_id = $1`, [userId, loc.id, alvo.instance_id, alvo.slot]);
    if (!jaEstava) await registrarLembrancaDeVisita(c, userId, loc);
    const p = await presentes(alvo.instance_id, userId, c);
    return { ok: true, destino: { id: loc.id, tipo: loc.tipo, nome: loc.nome, ibge: loc.ibge }, instancia: { id: alvo.instance_id, numero: alvo.numero, capacidade: alvo.capacidade }, slot: alvo.slot, jaEstava, ...p } as ResultadoEntrada;
  });
}

async function registrarLembrancaDeVisita(c: Tx, userId: string, loc: Location) {
  const dia = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  if (loc.tipo === 'house') {
    const dono = await q1<{ dono: string | null }>(`select dono_user_id dono from houses where id = $1`, [loc.ref_id], c);
    if (dono?.dono && dono.dono !== userId) await c.query(`insert into memories (user_id, tipo, titulo, location_id, ibge, chave) values ($1, 'visita', $2, $3, $4, $5) on conflict (chave) do nothing`, [userId, ('visitou a ' + loc.nome).slice(0, 80), loc.id, loc.ibge, `visita:${userId}:${loc.id}:${dia}`]);
  } else if (loc.tipo === 'city_square') {
    await c.query(`insert into memories (user_id, tipo, titulo, location_id, ibge, chave) values ($1, 'praca', $2, $3, $4, $5) on conflict (chave) do nothing`, [userId, ('carimbo: ' + loc.nome).slice(0, 80), loc.id, loc.ibge, `praca:${userId}:${loc.ibge}`]);
  }
}

export async function sair(userId: string) {
  await tx(async (c) => {
    await c.query(`update location_slots set user_id = null, ocupado_em = null where user_id = $1`, [userId]);
    await c.query(`update presence_sessions set location_id = null, instance_id = null, slot = null where user_id = $1`, [userId]);
  });
}

export async function detalheDestino(id: string, viewer: string | null) {
  await expirarPresencas();
  const loc = await q1<Location>(`select * from locations where id = $1`, [id]);
  if (!loc) throw new ErroHttp(404, 'lugar não encontrado');
  const salas = await q<{ id: string; numero: number; capacidade: number; ocupados: number }>(
    `select i.id, i.numero, i.capacidade, (select count(*)::int from location_slots s join presence_sessions ps on ps.user_id = s.user_id and ps.expira_em > now() where s.instance_id = i.id) ocupados
       from location_instances i where i.location_id = $1 order by i.numero`, [id]);
  const acesso = viewer ? await podeAcessar(viewer, loc, db()) : { ok: loc.tipo !== 'house' };
  return { destino: { id: loc.id, tipo: loc.tipo, nome: loc.nome, ibge: loc.ibge, porSala: loc.capacidade, maxSalas: loc.max_instancias }, salas, acessivel: acesso.ok, motivo: (acesso as any).motivo ?? null };
}
