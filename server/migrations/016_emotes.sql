-- 016 · Fase 2: emotes e frases PREDEFINIDAS (sem chat livre: a flag chat_livre do 001 continua desligada).
create table emote_catalog (
  id text primary key,
  tipo text not null check (tipo in ('emote','frase')),
  rotulo text not null,
  animacao text,                               -- idle | aceno | comemorar | sentar (cliente 3D)
  ativo boolean not null default true,
  ordem integer not null default 0
);
insert into emote_catalog (id, tipo, rotulo, animacao, ordem) values
  ('acenar', 'emote', 'acenar', 'aceno', 1), ('comemorar', 'emote', 'comemorar', 'comemorar', 2), ('sentar', 'emote', 'sentar', 'sentar', 3),
  ('palmas', 'emote', 'palmas', 'comemorar', 4), ('coracao', 'emote', 'coração', 'aceno', 5), ('rir', 'emote', 'rir', 'comemorar', 6),
  ('oi', 'frase', 'oi!', 'aceno', 10), ('bem_vindo', 'frase', 'bem-vindo à rua!', 'aceno', 11), ('bora_obra', 'frase', 'bora ajudar a obra?', 'comemorar', 12),
  ('bora_votar', 'frase', 'já votou?', null, 13), ('valeu', 'frase', 'valeu!', 'aceno', 14), ('ate_mais', 'frase', 'até mais!', 'aceno', 15);

-- emote disparado numa sala (efêmero; a sala lê os últimos segundos por polling/SSE)
create table emote_events (
  id bigserial primary key,
  user_id uuid not null references users(id),
  instance_id uuid not null references location_instances(id) on delete cascade,
  emote_id text not null references emote_catalog(id),
  alvo_user_id uuid references users(id),
  criado_em timestamptz not null default now()
);
create index emote_events_sala on emote_events (instance_id, id);
create index emote_events_user on emote_events (user_id, criado_em desc);

-- reação persistente e moderada (só itens do catálogo) a uma casa ou lembrança
create table reactions (
  user_id uuid not null references users(id),
  alvo_tipo text not null check (alvo_tipo in ('casa','lembranca')),
  alvo_id uuid not null,
  emote_id text not null references emote_catalog(id),
  criado_em timestamptz not null default now(),
  primary key (user_id, alvo_tipo, alvo_id, emote_id)
);
create index reactions_alvo on reactions (alvo_tipo, alvo_id);
