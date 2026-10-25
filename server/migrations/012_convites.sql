-- 012 · Fase 2: convites com código opaco (só o sha256 fica no banco), validade, limite de usos e revogação.
-- tipo 'rua' leva para uma rua (mover a casa exige o aceite do dono); 'visita' dá acesso a um destino.
create table invitations (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('rua','visita')),
  codigo_hash bytea not null unique,
  criado_por uuid not null references users(id),
  street_id uuid references virtual_streets(id),
  location_id uuid references locations(id),
  para_user_id uuid references users(id),     -- convite nominal (opcional): só essa pessoa pode aceitar
  max_usos integer not null default 1 check (max_usos between 1 and 100),
  usos integer not null default 0 check (usos >= 0),
  expira_em timestamptz not null,
  revogado_em timestamptz,
  criado_em timestamptz not null default now(),
  check (usos <= max_usos),
  check ((tipo = 'rua' and street_id is not null) or (tipo = 'visita' and location_id is not null))
);
create index invitations_criador on invitations (criado_por, criado_em desc);
create table invitation_uses (
  invitation_id uuid not null references invitations(id),
  user_id uuid not null references users(id),
  usado_em timestamptz not null default now(),
  primary key (invitation_id, user_id)
);
