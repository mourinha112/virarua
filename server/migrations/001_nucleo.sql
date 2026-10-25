-- 001 · núcleo: identidade, sessão, reivindicação, mundo (cidades/ruas/lotes/casas), avatar, Instagram, filas, outbox, auditoria.
-- Aditiva. Reversão em 001_nucleo.down.sql.
create extension if not exists pgcrypto;

-- ---------- geografia (IBGE) ----------
create table municipios (
  ibge integer primary key,
  nome text not null,
  uf char(2) not null,
  pop integer not null default 0,
  x real not null, y real not null,          -- km na projeção do mapa
  nome_norm text not null                     -- minúsculas, sem acento
);
create index municipios_nome_norm on municipios (nome_norm);
create table municipio_aliases (              -- variantes revisadas ("caxias rj" → 3301702)
  alias_norm text not null, uf char(2), ibge integer not null references municipios(ibge),
  revisado_por uuid, criado_em timestamptz not null default now(),
  primary key (alias_norm, ibge)
);

-- ---------- usuários e identidades ----------
create table users (
  id uuid primary key default gen_random_uuid(),
  nome_publico text not null check (char_length(nome_publico) between 2 and 30),
  criado_em timestamptz not null default now(),
  verificado_em timestamptz,                  -- quando provou controle de uma identidade externa
  faixa_etaria text not null default 'desconhecida' check (faixa_etaria in ('desconhecida','menor','adulto')),
  status text not null default 'ativo' check (status in ('ativo','suspenso','removido')),
  suspenso_ate timestamptz
);
create table external_identities (
  id uuid primary key default gen_random_uuid(),
  provedor text not null,                     -- 'instagram'
  escopo text not null,                       -- id da conta profissional conectada (namespace do id do autor)
  external_id text not null,                  -- id estável do autor no provedor (NUNCA o username)
  username text,                              -- atributo mutável, só exibição
  username_atualizado_em timestamptz,
  user_id uuid references users(id),
  criado_em timestamptz not null default now(),
  revogado_em timestamptz,
  unique (provedor, escopo, external_id)      -- soft delete não burla: revogado continua ocupando a chave
);
create index external_identities_user on external_identities(user_id);
create unique index external_identities_um_por_user on external_identities(user_id, provedor) where user_id is not null and revogado_em is null;

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  token_hash bytea not null unique,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogada_em timestamptz,
  ua text
);
create table privacy_preferences (
  user_id uuid primary key references users(id),
  mostrar_handle boolean not null default true,
  visita text not null default 'publica' check (visita in ('publica','amigos','privada')),
  presenca text not null default 'visivel' check (presenca in ('visivel','invisivel')),
  aparecer_em_video boolean not null default false,   -- consentimento promocional separado
  atualizado_em timestamptz not null default now()
);

-- links de uso único (private reply) e desafios por código (alternativa)
create table identity_claims (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references external_identities(id),
  token_hash bytea not null unique,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  consumido_em timestamptz,
  consumido_por_sessao uuid
);
create table claim_challenges (
  id uuid primary key default gen_random_uuid(),
  codigo_hash bytea not null unique,          -- sha256 do código mostrado no navegador
  sessao_pendente_hash bytea not null,        -- sha256 do cookie do navegador que pediu: só ele pode concluir
  handle_informado text,                      -- só dica de UI; não decide nada
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  verificado_identity_id uuid references external_identities(id),
  verificado_em timestamptz,
  consumido_em timestamptz
);

-- ---------- mundo ----------
-- contador de lotes por cidade: lote k da cidade = k-ésima posição do gerador procedural (src/mundo/cidade.ts)
create table city_lot_counters (ibge integer primary key references municipios(ibge), proximo integer not null default 0);
create table virtual_streets (
  id uuid primary key default gen_random_uuid(),
  ibge integer not null references municipios(ibge),
  nome text not null,
  emblema text,
  descricao text,
  publica boolean not null default true,
  capacidade integer not null check (capacidade between 1 and 200),
  ocupadas integer not null default 0 check (ocupadas >= 0),
  status text not null default 'fundacao' check (status in ('fundacao','ativa','pausada','arquivada')),
  fundador_user_id uuid references users(id),
  criada_em timestamptz not null default now(),
  check (ocupadas <= capacidade)
);
create index virtual_streets_cidade on virtual_streets(ibge, status);
create unique index virtual_streets_nome on virtual_streets(ibge, lower(nome));
create unique index virtual_streets_uma_criada_por_user on virtual_streets(fundador_user_id) where fundador_user_id is not null and status in ('fundacao','ativa','pausada');

create table plots (
  id uuid primary key default gen_random_uuid(),
  ibge integer not null references municipios(ibge),
  lote_index integer not null,                -- posição no gerador da cidade
  street_id uuid references virtual_streets(id),
  criado_em timestamptz not null default now(),
  unique (ibge, lote_index)
);
create table houses (
  id uuid primary key default gen_random_uuid(),
  plot_id uuid references plots(id),
  dono_identity_id uuid not null references external_identities(id),
  dono_user_id uuid references users(id),
  status text not null default 'reservada' check (status in ('reservada','reivindicada','expirada','removida')),
  principal boolean not null default true,
  nivel integer not null default 1,
  xp integer not null default 0,
  config jsonb not null default '{}'::jsonb,  -- cor, frase, decoração (camadas aditivas; a geometria base vem do gerador)
  legado_gi integer,                          -- correspondência com o jogo clássico (mapa estático)
  criada_em timestamptz not null default now(),
  reivindicada_em timestamptz,
  expira_em timestamptz
);
create unique index houses_lote_ocupado on houses(plot_id) where status in ('reservada','reivindicada');
create unique index houses_principal_identidade on houses(dono_identity_id) where principal and status in ('reservada','reivindicada');
create unique index houses_principal_user on houses(dono_user_id) where principal and status = 'reivindicada';

create table street_memberships (
  id uuid primary key default gen_random_uuid(),
  street_id uuid not null references virtual_streets(id),
  house_id uuid not null references houses(id),
  entrou_em timestamptz not null default now(),
  saiu_em timestamptz,
  motivo_saida text
);
create unique index street_memberships_atual on street_memberships(house_id) where saiu_em is null;

-- avatar: nasce com a reserva, editável após reivindicar. Catálogo validado no servidor.
create table avatar_catalog (
  item_id text primary key,                   -- ex.: 'cabelo.cacheado'
  slot text not null check (slot in ('pele','cabelo','cor_cabelo','roupa','cor_roupa','acessorio','calcado')),
  nome text not null,
  gratuito boolean not null default true,
  ativo boolean not null default true
);
create table avatars (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references houses(id),
  config jsonb not null,
  versao integer not null default 1,
  atualizado_em timestamptz not null default now(),
  ativo boolean not null default true
);
create unique index avatars_ativo_por_casa on avatars(house_id) where ativo;
create table user_inventory (
  user_id uuid not null references users(id), item_id text not null references avatar_catalog(item_id),
  origem text not null, obtido_em timestamptz not null default now(), primary key (user_id, item_id)
);

-- estado do onboarding por identidade (máquina de estados explícita)
create table onboarding (
  identity_id uuid primary key references external_identities(id),
  estado text not null check (estado in ('received','pending_city_resolution','provisioned_unclaimed','claim_pending','claimed','onboarding_complete','ignored','invalid','duplicate','delivery_pending','delivery_failed','needs_review','revoked','expired')),
  entrega text not null default 'nenhuma' check (entrega in ('nenhuma','delivery_pending','enviada','delivery_failed','dry_run')),
  atualizado_em timestamptz not null default now(),
  detalhe text
);

-- ---------- Instagram ----------
create table instagram_connections (
  id uuid primary key default gen_random_uuid(),
  conta_id text not null unique,              -- conta profissional oficial
  username text,
  token_cifrado bytea,                        -- AES-256-GCM (iv|tag|cipher)
  token_expira_em timestamptz,
  status text not null default 'ativa' check (status in ('ativa','expirada','revogada')),
  atualizado_em timestamptz not null default now()
);
create table enabled_media (
  media_id text primary key,
  conta_id text not null,
  campanha text not null,
  aceita_comentario_cidade boolean not null default true,
  texto_consentimento text not null,          -- o aviso publicado na campanha (cria registro e usa o @)
  status text not null default 'ativa' check (status in ('ativa','pausada','encerrada')),
  criado_em timestamptz not null default now()
);
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provedor text not null,
  chave text not null,                        -- dedupe: comment_id + campo/versão
  recebido_em timestamptz not null default now(),
  payload jsonb not null,
  estado text not null default 'novo' check (estado in ('novo','processando','processado','ignorado','erro','morto')),
  tentativas integer not null default 0,
  erro text,
  unique (provedor, chave)
);

-- ---------- filas, outbox, mensagens ----------
create table processing_jobs (
  id bigserial primary key,
  tipo text not null,
  dados jsonb not null,
  chave text unique,                          -- idempotência do job
  estado text not null default 'pendente' check (estado in ('pendente','rodando','feito','erro','morto','cancelado')),
  tentativas integer not null default 0,
  max_tentativas integer not null default 6,
  disponivel_em timestamptz not null default now(),
  travado_ate timestamptz,
  erro text,
  criado_em timestamptz not null default now(),
  feito_em timestamptz
);
create index processing_jobs_fila on processing_jobs(estado, disponivel_em) where estado in ('pendente','erro');
create table domain_events (
  id bigserial primary key,
  tipo text not null,
  dados jsonb not null,
  chave_idempotencia text unique,
  criado_em timestamptz not null default now(),
  publicado_em timestamptz
);
create table outbound_messages (
  id uuid primary key default gen_random_uuid(),
  canal text not null,                        -- 'ig_private_reply'
  identity_id uuid references external_identities(id),
  referencia text not null,                   -- comment_id
  chave text not null unique,                 -- 1 mensagem por (comentário, tipo)
  modo text not null check (modo in ('dry_run','oficial')),
  estado text not null default 'pendente' check (estado in ('pendente','enviada','falhou','dry_run','cancelada')),
  texto_redigido text not null,               -- sem o token
  resposta_provedor jsonb,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz
);

-- ---------- regras, flags, auditoria, papéis ----------
create table rule_versions (
  id text primary key,                        -- ex.: 'eleicoes@1'
  dominio text not null,
  regras jsonb not null,
  vigente_desde timestamptz not null default now(),
  criada_em timestamptz not null default now()
);
create table feature_flags (chave text primary key, ligada boolean not null default false, atualizado_em timestamptz not null default now(), nota text);
create table admin_roles (user_id uuid not null references users(id), papel text not null check (papel in ('operador_integracao','moderador','editor_conteudo','admin_tecnico')), concedido_em timestamptz not null default now(), primary key (user_id, papel));
create table admin_audit_logs (id bigserial primary key, ator_user_id uuid, acao text not null, alvo text not null, motivo text, dados jsonb not null default '{}'::jsonb, criado_em timestamptz not null default now());
create table legacy_map (tipo text not null, legado text not null, novo uuid not null, criado_em timestamptz not null default now(), primary key (tipo, legado));

insert into feature_flags (chave, ligada, nota) values
  ('avatares', true, 'editor de avatar'), ('ruas', true, 'ruas virtuais'), ('eleicoes', true, 'eleições virtuais'),
  ('competicao_ruas', true, 'competição semanal de ruas'), ('conteudo', true, 'pipeline de conteúdo (dry-run)'),
  ('chat_livre', false, 'desligado: exige moderação completa'), ('bares', false, 'desligado até política etária');
