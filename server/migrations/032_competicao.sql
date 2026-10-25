-- 032 · Fase 3: competição semanal de ruas (independente de cargos). Elenco congelado no início da temporada.
create table competition_seasons (
  id uuid primary key default gen_random_uuid(),
  semana date not null unique,                -- segunda-feira (America/Sao_Paulo)
  inicio timestamptz not null,
  fim timestamptz not null,
  regra_id text not null default 'competicao@1',
  estado text not null default 'aberta' check (estado in ('aberta','apurada')),
  snapshot_em timestamptz not null default now(),
  apurada_em timestamptz
);
alter table reward_ledger add constraint reward_ledger_season_fk foreign key (season_id) references competition_seasons(id);

create table competition_entries (
  season_id uuid not null references competition_seasons(id),
  street_id uuid not null references virtual_streets(id),
  ibge integer not null references municipios(ibge),
  uf char(2) not null,
  elenco_n integer not null,
  elegivel boolean not null,                  -- >= 3 membros ativos no snapshot
  divisao text,                               -- '3-8','9-16','17-24' (null se inelegível)
  modo text not null check (modo in ('competitivo','cooperativo')),
  meta_cooperativa integer,                   -- só no cooperativo
  pontos_final integer,
  colocacao integer,                          -- compartilhada em empate
  primary key (season_id, street_id)
);
create index competition_entries_grupo on competition_entries(season_id, ibge, divisao);

create table competition_roster (
  season_id uuid not null references competition_seasons(id),
  user_id uuid not null references users(id),
  street_id uuid not null references virtual_streets(id),
  house_id uuid not null references houses(id),
  primary key (season_id, user_id)            -- uma rua por pessoa por temporada
);
create index competition_roster_rua on competition_roster(season_id, street_id);

create table competition_groups (
  season_id uuid not null references competition_seasons(id),
  ibge integer not null, divisao text not null,
  lideres uuid[] not null default '{}',
  viradas integer not null default 0,
  primary key (season_id, ibge, divisao)
);

create table competition_awards (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references competition_seasons(id),
  street_id uuid not null references virtual_streets(id),
  tipo text not null check (tipo in ('trofeu','faixa','decoracao','meta_cooperativa')),
  colocacao integer,
  valido_ate timestamptz,                     -- null = permanente (troféu)
  criado_em timestamptz not null default now(),
  unique (season_id, street_id, tipo)
);

insert into rule_versions (id, dominio, regras) values
  ('competicao@1', 'competicao', '{"min_membros_ativos":3,"divisoes":[[3,8],[9,16],[17,24]],"teto_contribuicao_dia":30,"pontos_por_missao":10,"meta_cooperativa_por_membro":60,"empate":"colocacao_compartilhada","premios":["trofeu","faixa","decoracao"],"dinheiro":false,"elege_cargo":false}'::jsonb)
on conflict (id) do nothing;
