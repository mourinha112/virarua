-- 050 · Fase 6: pipeline de conteúdo (candidatas → snapshot → render → publicação) e calendário editorial.
-- Aditiva. Reversão em 050_conteudo.down.sql. Nada aqui altera tabelas do jogo; render nunca escreve em votos/pontos.

-- pauta candidata gerada a partir de domain_events (não publica nada sozinha)
create table content_candidates (
  id uuid primary key default gen_random_uuid(),
  template_id text not null,
  chave text not null unique,                       -- dedupe: mesmo fato não vira duas pautas
  event_ids bigint[] not null default '{}',
  escopo jsonb not null,                            -- {tipo, nome, uf, ibge, street_id, eleicao_id}
  fatos jsonb not null default '{}'::jsonb,         -- payload do evento (sem dados pessoais além de user_ids p/ consentimento)
  perfis_user_ids uuid[] not null default '{}',     -- quem pode aparecer (revalidado contra privacy_preferences)
  election_status text not null default 'nao_aplica' check (election_status in ('nao_aplica','em_andamento','provisorio','oficial','sem_resultado')),
  categoria text not null,                          -- rodízio: mesma categoria/cidade no máx. 1x em 48 h
  prioridade integer not null default 50,
  campanha text,
  demo boolean not null default false,
  estado text not null default 'nova' check (estado in ('nova','selecionada','descartada','expirada')),
  motivo text,
  valido_ate timestamptz,
  criado_em timestamptz not null default now()
);
create index content_candidates_fila on content_candidates(estado, prioridade desc, criado_em);
create index content_candidates_eleicao on content_candidates((escopo->>'eleicao_id'));

-- fatos reconciliados: o input validado do render + origem de cada número
create table content_snapshots (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references content_candidates(id),
  template_id text not null,
  template_version text not null,
  contrato_versao text not null,
  hash text not null unique,                        -- sha256 do input canônico (cache de render)
  dados jsonb not null,                             -- RenderInput (validado; sem tokens/email/voto)
  fontes jsonb not null default '[]'::jsonb,        -- [{chave, fonte, parametros, valor, apurado_em}] para revalidar
  perfis_user_ids uuid[] not null default '{}',     -- fica fora do input do template
  demo boolean not null default false,
  valido_ate timestamptz,
  criado_em timestamptz not null default now()
);
create index content_snapshots_perfis on content_snapshots using gin (perfis_user_ids);

-- fila de render consumida pelo worker do video-studio (API interna). Limites em conteudo/config.ts.
create table render_jobs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references content_snapshots(id),
  template_id text not null,
  template_version text not null,
  cache_key text not null unique,                   -- snapshot.hash + template_version + runtime
  estado text not null default 'pendente' check (estado in ('pendente','rodando','feito','erro','morto','cancelado')),
  prioridade integer not null default 50,
  tentativas integer not null default 0,
  max_tentativas integer not null default 3,
  disponivel_em timestamptz not null default now(),
  travado_ate timestamptz,                          -- lease do worker; vencido = pode ser retomado
  worker text,
  saida_mp4 text, saida_thumb text,
  inspecao jsonb,
  erro text,
  criado_em timestamptz not null default now(),
  terminado_em timestamptz
);
create index render_jobs_fila on render_jobs(estado, prioridade, criado_em) where estado in ('pendente','erro','rodando');

-- publicação: máquina de estados editorial. 'exported_manual' = pacote dry-run (MP4+thumb+legenda) para o operador.
create table publication_jobs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references content_snapshots(id),
  render_job_id uuid references render_jobs(id),
  template_id text not null,
  campanha text,
  estado text not null default 'draft' check (estado in ('draft','rendering','rendered','review','approved','scheduled','publishing','published','exported_manual','failed','cancelled','needs_correction')),
  modo text not null default 'dry_run' check (modo in ('dry_run','oficial')),
  tipo text not null default 'organico' check (tipo in ('organico','patrocinado')),
  legenda text,
  chave_idempotencia text not null unique,          -- snapshot+template+campanha: retry nunca cria segundo post
  agendado_para timestamptz,
  container_id text,                                -- id do container de mídia na Graph API
  publicar_enviado_em timestamptz,                  -- media_publish foi chamado (resultado pode ser desconhecido) → reconciliar antes de repetir
  media_id_externo text,
  permalink text,
  tentativas integer not null default 0,
  ultimo_erro text,
  motivo text,
  aprovado_por uuid references users(id),
  aprovado_em timestamptz,
  publicado_em timestamptz,
  pacote_manual text,                               -- pasta do pacote dry-run
  demo boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (not demo or campanha is null or campanha like 'demo%')   -- dado demo nunca em campanha real
);
create index publication_jobs_estado on publication_jobs(estado, agendado_para);
create table publication_attempts (
  id bigserial primary key,
  publication_job_id uuid not null references publication_jobs(id),
  fase text not null,                               -- revalidar | dry_run | container | status | publicar | reconciliar
  resultado text not null,
  detalhe jsonb not null default '{}'::jsonb,       -- resposta redigida (sem token)
  criado_em timestamptz not null default now()
);
create index publication_attempts_job on publication_attempts(publication_job_id, id);

-- calendário editorial: 1 linha por vaga do dia (America/Sao_Paulo). Teto diário garantido pela unicidade do slot.
create table editorial_calendar (
  id uuid primary key default gen_random_uuid(),
  data date not null,                               -- dia em America/Sao_Paulo
  tipo text not null check (tipo in ('organico','patrocinado')),
  slot integer not null check (slot >= 1),
  publication_job_id uuid not null references publication_jobs(id),
  horario timestamptz not null,                     -- UTC
  estado text not null default 'reservado' check (estado in ('reservado','usado','liberado')),
  criado_em timestamptz not null default now()
);
create unique index editorial_calendar_vaga on editorial_calendar(data, tipo, slot) where estado in ('reservado','usado');
create unique index editorial_calendar_pub on editorial_calendar(publication_job_id) where estado in ('reservado','usado');

-- storyboard aprovado por template (pré-requisito do autopublish daquele template)
create table content_template_approvals (
  template_version text primary key,
  storyboard_aprovado_por uuid references users(id),
  storyboard_aprovado_em timestamptz,
  autopublish boolean not null default false,
  atualizado_em timestamptz not null default now()
);

-- erros de consumo de eventos (o consumidor nunca derruba a outbox do jogo)
create table content_event_errors (
  id bigserial primary key,
  evento_id bigint,
  tipo text not null,
  erro text not null,
  criado_em timestamptz not null default now()
);
