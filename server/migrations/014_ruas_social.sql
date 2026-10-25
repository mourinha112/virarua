-- 014 · Fase 2: lista de espera, pedidos de entrada em rua privada, histórico de membership e a regra do
-- vínculo competitivo para a Fase 3.
alter table virtual_streets add column arquivada_em timestamptz;

-- origem da membership e a partir de quando ela vale para a competição de ruas.
-- REGRA (Fase 3 usa): o vínculo competitivo NÃO migra na troca de rua. A membership criada por troca só passa a
-- pontuar no próximo fechamento semanal (domingo 21h, America/Sao_Paulo). Entre a troca e o fechamento a casa não
-- pontua para nenhuma rua (nem a antiga, que ela deixou, nem a nova). Use rua_competitiva(house_id, instante).
alter table street_memberships add column origem text not null default 'alocacao'
  check (origem in ('alocacao','criacao','troca','convite','aprovacao','migracao'));
alter table street_memberships add column competicao_a_partir_de timestamptz;   -- null = desde entrou_em

create or replace function rua_competitiva(p_house uuid, p_instante timestamptz) returns uuid language sql stable as $$
  select street_id from street_memberships
   where house_id = p_house and entrou_em <= p_instante and (saiu_em is null or saiu_em > p_instante)
     and coalesce(competicao_a_partir_de, entrou_em) <= p_instante
   order by entrou_em desc limit 1
$$;

create table street_waitlist (
  id uuid primary key default gen_random_uuid(),
  street_id uuid not null references virtual_streets(id),
  house_id uuid not null references houses(id),
  user_id uuid not null references users(id),
  estado text not null default 'aguardando' check (estado in ('aguardando','notificada','atendida','cancelada')),
  criado_em timestamptz not null default now(),
  notificada_em timestamptz,
  encerrada_em timestamptz
);
create unique index street_waitlist_ativa on street_waitlist (street_id, house_id) where estado in ('aguardando','notificada');
create index street_waitlist_fila on street_waitlist (street_id, criado_em) where estado in ('aguardando','notificada');

create table street_join_requests (
  id uuid primary key default gen_random_uuid(),
  street_id uuid not null references virtual_streets(id),
  house_id uuid not null references houses(id),
  user_id uuid not null references users(id),
  mensagem text,                               -- frase predefinida (sem texto livre)
  estado text not null default 'pendente' check (estado in ('pendente','aprovado','recusado','cancelado')),
  criado_em timestamptz not null default now(),
  decidido_por uuid references users(id),
  decidido_em timestamptz
);
create unique index street_join_requests_pendente on street_join_requests (street_id, house_id) where estado = 'pendente';
