-- 013 · Fase 2: presença por heartbeat. Chave primária = usuário: várias abas atualizam a MESMA linha
-- (nunca dois avatares online). Expira em config.presenca.expiraSeg; sair limpa sem depender da expiração.
create table presence_sessions (
  user_id uuid primary key references users(id),
  estado text not null default 'online' check (estado in ('online','away')),
  aba_id text,                                -- última aba que mandou heartbeat (aba "principal")
  location_id uuid references locations(id),
  instance_id uuid references location_instances(id),
  slot integer,
  iniciada_em timestamptz not null default now(),
  ultimo_heartbeat timestamptz not null default now(),
  expira_em timestamptz not null
);
create index presence_sessions_expira on presence_sessions (expira_em);
create index presence_sessions_instancia on presence_sessions (instance_id) where instance_id is not null;
