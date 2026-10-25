-- 031 · Fase 3: missões diárias (validação no servidor) e obra comunitária da rua (etapas persistentes com limite).
create table missions (
  id text primary key,                        -- 'obra.etapa', 'desafio.curto', 'atividade.praca'
  versao integer not null default 1,
  titulo text not null,
  descricao text not null,
  tipo_desafio text not null check (tipo_desafio in ('conta','sequencia','peca','quiz','simbolos')),
  min_ms integer not null default 1500,       -- tempo mínimo entre emitir e responder (não basta "aba aberta")
  regra_xp text not null,
  regra_contribuicao text not null,
  ativa boolean not null default true,
  ordem integer not null default 0
);
insert into missions (id, titulo, descricao, tipo_desafio, min_ms, regra_xp, regra_contribuicao, ordem) values
  ('obra.etapa', 'Ajude a obra da rua', 'Encaixe a peça certa e avance uma etapa da obra comunitária.', 'peca', 1500, 'xp5_missao@1', 'contrib10_missao@1', 1),
  ('desafio.curto', 'Desafio rápido', 'Resolva um desafio curto sorteado pelo servidor.', 'conta', 1500, 'xp5_missao@1', 'contrib10_missao@1', 2),
  ('atividade.praca', 'Roda na praça', 'Vá até a praça e repita a sequência de gestos da roda.', 'sequencia', 4000, 'xp5_missao@1', 'contrib10_missao@1', 3);

create table mission_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  mission_id text not null references missions(id),
  dia date not null,
  desafio_id uuid not null references server_challenges(id),
  street_id uuid references virtual_streets(id),   -- rua do morador no momento (informativo)
  contribuiu boolean not null default false,       -- se pontuou no competitivo
  motivo_sem_ponto text,                           -- 'fora_do_elenco', 'mudou_de_rua', 'teto_diario'
  criado_em timestamptz not null default now(),
  unique (user_id, mission_id, dia)                -- no máximo uma conclusão (paga) por missão/usuário/dia
);

create table community_projects (
  id uuid primary key default gen_random_uuid(),
  street_id uuid not null references virtual_streets(id),
  modelo text not null,                       -- 'jardim','banco','praca_luz','skate','biblioteca'
  titulo text not null,
  etapas jsonb not null,                      -- [{nome, ate}] limite acumulado de cada etapa
  meta_total integer not null check (meta_total > 0),
  progresso integer not null default 0 check (progresso >= 0),
  limite_parcela numeric not null default 0.5 check (limite_parcela > 0 and limite_parcela < 1), -- ninguém sozinho completa tudo
  limite_dia_usuario integer not null default 2,
  status text not null default 'em_obra' check (status in ('em_obra','concluida')),
  criada_em timestamptz not null default now(),
  concluida_em timestamptz,
  check (progresso <= meta_total)
);
create unique index community_projects_uma_ativa on community_projects(street_id) where status = 'em_obra';
create table community_contributions (
  id bigserial primary key,
  project_id uuid not null references community_projects(id),
  user_id uuid not null references users(id),
  quantidade integer not null check (quantidade > 0),
  dia date not null,
  origem text not null,                       -- 'missao:obra.etapa', 'evento:<instância>'
  chave text not null unique,
  criado_em timestamptz not null default now()
);
create index community_contributions_proj on community_contributions(project_id, user_id);
