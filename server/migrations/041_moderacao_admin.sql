-- 041 · painel administrativo: denúncias, ações de moderação, resolução manual de cidade e kill switches como flags.
-- Não existe tabela/rota para "editar voto" ou "dar cargo": correções eleitorais seguem as regras públicas da Fase 4.

create table reports (
  id uuid primary key default gen_random_uuid(),
  autor_user_id uuid references users(id),
  alvo_tipo text not null check (alvo_tipo in ('user','house','street','venue','comentario','conteudo')),
  alvo_id text not null check (char_length(alvo_id) between 1 and 80),
  categoria text not null check (categoria in ('abuso','spam','golpe','conteudo_improprio','menor_em_risco','falsidade','outro')),
  texto text check (char_length(texto) <= 500),
  estado text not null default 'aberta' check (estado in ('aberta','em_analise','resolvida','descartada')),
  resolvido_por uuid references users(id), resolvido_em timestamptz,
  criado_em timestamptz not null default now()
);
create index reports_estado on reports(estado, criado_em);
-- a mesma pessoa não abre duas denúncias abertas para o mesmo alvo
create unique index reports_uma_aberta on reports(autor_user_id, alvo_tipo, alvo_id) where estado in ('aberta','em_analise') and autor_user_id is not null;

create table moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references reports(id),
  ator_user_id uuid not null references users(id),
  alvo_tipo text not null,
  alvo_id text not null,
  acao text not null check (acao in ('advertir','ocultar_conteudo','suspender_usuario','reativar_usuario','suspender_estabelecimento','pausar_rua','reativar_rua','descartar')),
  motivo text not null check (char_length(motivo) >= 5),
  dados jsonb not null default '{}'::jsonb,
  expira_em timestamptz,
  criado_em timestamptz not null default now()
);
create index moderation_actions_alvo on moderation_actions(alvo_tipo, alvo_id);

-- escolha manual de cidade para onboarding pendente/ambíguo (o processamento do job é da Fase 1)
create table admin_city_resolutions (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references external_identities(id),
  ibge integer not null references municipios(ibge),
  ator_user_id uuid not null references users(id),
  motivo text not null check (char_length(motivo) >= 5),
  job_id bigint,
  criado_em timestamptz not null default now()
);

insert into feature_flags (chave, ligada, nota) values
  ('kill_eventos', false, 'kill switch: ligado = pausa eventos do jogo'),
  ('kill_render', false, 'kill switch: ligado = pausa render de vídeos'),
  ('kill_publicacao', true, 'kill switch: ligado = nenhuma publicação externa (padrão)'),
  ('estabelecimentos', true, 'estabelecimentos patrocinados (café/pet etc.)')
on conflict (chave) do nothing;
