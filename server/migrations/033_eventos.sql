-- 033 · Fase 3: catálogo versionado de eventos (E01–E60), instâncias com snapshot de regras e orquestrador.
create table event_definitions (
  id text not null,
  version integer not null check (version >= 1),
  categoria text not null,
  motor text not null,
  definicao jsonb not null,                   -- EventDefinition completa (seção 21)
  habilitado boolean not null,
  motivo_desabilitado text,
  sincronizado_em timestamptz not null default now(),
  primary key (id, version),
  check (habilitado or motivo_desabilitado is not null)
);

create table event_instances (
  id uuid primary key default gen_random_uuid(),
  definicao_id text not null,
  definicao_versao integer not null,
  regras jsonb not null,                      -- snapshot da definição no momento do planejamento
  categoria text not null,
  escopo text not null check (escopo in ('usuario','rua','cidade','regional','nacional')),
  ibge integer references municipios(ibge),
  uf char(2),
  chave text not null unique,                 -- idempotência do planejador: definição + alvo + janela
  estado text not null check (estado in ('proposed','validated','scheduled','announced','enrolling','active','resolving','completed','cancelled','archived')),
  modo text not null check (modo in ('manual','assistido','automatico')),
  permanente boolean not null default false,
  anuncio_em timestamptz, inicio timestamptz, fim timestamptz,
  progresso jsonb not null default '{}'::jsonb,
  resultado jsonb,
  textos jsonb not null default '{}'::jsonb,  -- {titulo, chamada, fonte: 'template'|'ia', template_id}
  criado_por text not null default 'planejador',
  motivo text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  foreign key (definicao_id, definicao_versao) references event_definitions(id, version)
);
create index event_instances_estado on event_instances(estado, inicio);
create index event_instances_cidade on event_instances(ibge, categoria, inicio);

create table event_participants (
  instance_id uuid not null references event_instances(id),
  user_id uuid not null references users(id),
  estado text not null default 'inscrito' check (estado in ('inscrito','concluido')),
  progresso jsonb not null default '{}'::jsonb,
  inscrito_em timestamptz not null default now(),
  concluido_em timestamptz,
  primary key (instance_id, user_id)
);
create index event_participants_user on event_participants(user_id, estado);

create table event_transitions (
  id bigserial primary key,
  instance_id uuid not null references event_instances(id),
  de text, para text not null, motivo text, ator text not null default 'sistema',
  em timestamptz not null default now()
);

create table event_planner_runs (
  chave text primary key,                     -- 'madrugada:2026-10-25', 'fatos:2026-10-25T14'
  tipo text not null check (tipo in ('madrugada','fatos')),
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz,
  execucoes integer not null default 1,
  resumo jsonb not null default '{}'::jsonb
);

create table event_orchestrator_settings (
  id integer primary key default 1 check (id = 1),
  modo text not null default 'automatico' check (modo in ('manual','assistido','automatico')),
  max_simultaneos_cidade integer not null default 2,
  max_novos_dia_cidade integer not null default 1,
  janela_categoria_horas integer not null default 48,
  max_inscricoes_usuario integer not null default 4,
  max_fatos_hora integer not null default 50,
  cursor_fatos bigint not null default 0,
  atualizado_em timestamptz not null default now()
);
insert into event_orchestrator_settings (id) values (1);

create table ai_calls (
  id bigserial primary key,
  provedor text not null, finalidade text not null,
  ok boolean not null, latencia_ms integer, tokens_entrada integer, tokens_saida integer, custo_estimado numeric,
  erro text, criado_em timestamptz not null default now()
);
