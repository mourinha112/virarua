-- 062 · central de notificações (sem spam: agrupadas por chave, só para quem é da rua/cidade do fato)
create table notifications (
  id bigserial primary key,
  user_id uuid not null references users(id),
  tipo text not null,
  titulo text not null,
  texto text not null,
  acao text,                                   -- painel a abrir no app (ex.: 'eleicoes', 'ruas', 'casa')
  chave text not null,                         -- dedupe: mesmo fato não notifica duas vezes a mesma pessoa
  lida_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (user_id, chave)
);
create index notifications_user on notifications(user_id, criado_em desc);
create table notification_prefs (
  user_id uuid primary key references users(id),
  silenciar text[] not null default '{}',      -- tipos silenciados pela pessoa
  atualizado_em timestamptz not null default now()
);
alter table virtual_companies add column cor text not null default '#3a86ff' check (cor ~ '^#[0-9a-f]{6}$');
