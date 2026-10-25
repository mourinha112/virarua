-- 061 · profissões e empresas VIRTUAIS (jogo). O "registro" da empresa é um código do jogo, nunca um CNPJ real.
create table user_jobs (
  user_id uuid primary key references users(id),
  profissao text not null,
  local_tipo text not null default 'prefeitura' check (local_tipo in ('prefeitura','loja','empresa','casa')),
  local_ref text,                              -- venue id / empresa id quando aplicável
  desde timestamptz not null default now()
);
create table work_shifts (
  id bigserial primary key,
  user_id uuid not null references users(id),
  dia date not null,                           -- dia do jogo (America/Sao_Paulo)
  profissao text not null,
  inicio timestamptz not null default now(),
  fim timestamptz not null,
  recompensado boolean not null default false,
  unique (user_id, dia)
);
create table virtual_companies (
  id uuid primary key default gen_random_uuid(),
  dono_user_id uuid not null references users(id),
  nome text not null check (char_length(nome) between 3 and 40),
  ramo text not null,
  ibge integer not null references municipios(ibge),
  registro text not null unique,               -- ex.: EMP-RJ-7K2Q (fictício, do jogo)
  vagas integer not null default 3 check (vagas between 1 and 20),
  criada_em timestamptz not null default now(),
  encerrada_em timestamptz
);
create unique index virtual_companies_uma_por_dono on virtual_companies(dono_user_id) where encerrada_em is null;
create unique index virtual_companies_nome on virtual_companies(ibge, lower(nome)) where encerrada_em is null;
