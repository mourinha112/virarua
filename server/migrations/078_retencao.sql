-- Retenção: baú diário com sequência de 7 dias, pet que sente falta (comida 1x por dia) e chuva de baús das 20h.
create table daily_chests (
  user_id uuid not null references users(id) on delete cascade,
  dia date not null,
  seq integer not null check (seq between 1 and 7),
  xp integer not null default 0,
  criado_em timestamptz not null default now(),
  primary key (user_id, dia)
);
alter table pets add column if not exists alimentado_em timestamptz not null default now();
create table rain_picks (
  user_id uuid not null references users(id) on delete cascade,
  dia date not null,
  ibge integer not null,
  idx integer not null check (idx between 0 and 9),
  criado_em timestamptz not null default now(),
  primary key (user_id, dia, ibge, idx)
);

alter table reward_ledger drop constraint if exists reward_ledger_origem_check;
alter table reward_ledger add constraint reward_ledger_origem_check check (origem in ('missao','evento','obra','competicao','instagram','convite','tesouro','ofensiva','visita','bau','pet','chuva'));
