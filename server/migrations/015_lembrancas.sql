-- 015 · Fase 2: álbum de lembranças (passaporte). Deduplicado por chave (ex.: uma lembrança por lugar por dia).
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  tipo text not null check (tipo in ('visita','praca','rua','evento','temporada','foto')),
  titulo text not null check (char_length(titulo) between 1 and 80),
  location_id uuid references locations(id),
  ibge integer references municipios(ibge),
  dados jsonb not null default '{}'::jsonb,
  chave text not null unique,
  criado_em timestamptz not null default now()
);
create index memories_user on memories (user_id, criado_em desc);
