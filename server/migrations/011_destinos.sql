-- 011 · Fase 2: destinos tipados, instâncias (salas) e slots. Sem caminhada: o jogador escolhe destino e slot.
-- Um destino tem N instâncias; quando todas lotam, abre-se outra até max_instancias (depois: alternativas).
create table locations (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('house','street','city_square','venue','event')),
  ibge integer not null references municipios(ibge),
  ref_id text not null,                       -- house.id / street.id / ibge (praça) / id do estabelecimento ou evento
  nome text not null,
  capacidade integer not null check (capacidade between 1 and 200),   -- slots por instância
  max_instancias integer not null default 4 check (max_instancias between 1 and 50),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (tipo, ref_id)
);
create index locations_cidade on locations (ibge, tipo) where ativo;

create table location_instances (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id),
  numero integer not null check (numero >= 1),
  capacidade integer not null check (capacidade between 1 and 200),
  aberta boolean not null default true,
  criada_em timestamptz not null default now(),
  unique (location_id, numero)
);

create table location_slots (
  instance_id uuid not null references location_instances(id) on delete cascade,
  slot integer not null check (slot >= 0),
  user_id uuid references users(id),
  ocupado_em timestamptz,
  primary key (instance_id, slot)
);
-- UMA localização autoritativa por usuário: no máximo um slot ocupado em todo o mundo
create unique index location_slots_um_por_user on location_slots (user_id) where user_id is not null;
