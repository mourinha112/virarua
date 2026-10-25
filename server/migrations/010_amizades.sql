-- 010 · Fase 2: amizades (pedido aceito pelos dois lados) e bloqueio.
-- Par ativo único independente da direção: least/greatest. Bloqueio é unilateral e impede pedido, visita e emote.
create table friendships (
  id uuid primary key default gen_random_uuid(),
  solicitante_id uuid not null references users(id),
  destinatario_id uuid not null references users(id),
  estado text not null default 'pendente' check (estado in ('pendente','aceita','recusada','cancelada','removida')),
  criado_em timestamptz not null default now(),
  respondido_em timestamptz,
  check (solicitante_id <> destinatario_id)
);
create unique index friendships_par_ativo on friendships (least(solicitante_id, destinatario_id), greatest(solicitante_id, destinatario_id)) where estado in ('pendente','aceita');
create index friendships_destinatario on friendships (destinatario_id, estado);
create index friendships_solicitante on friendships (solicitante_id, estado);

create table user_blocks (
  user_id uuid not null references users(id),
  bloqueado_id uuid not null references users(id),
  criado_em timestamptz not null default now(),
  primary key (user_id, bloqueado_id),
  check (user_id <> bloqueado_id)
);
create index user_blocks_bloqueado on user_blocks (bloqueado_id);
