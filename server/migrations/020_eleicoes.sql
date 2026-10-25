-- 020 · eleições virtuais (Fase 4): temporadas, eleições, eleitorado congelado, candidaturas, apoios, votos,
-- auditoria de voto, mandatos, ações de cargo (catálogo aprovado) e correções administrativas.
-- Cargos são FICTÍCIOS e internos ao jogo ("eleição virtual"). Peso de voto é sempre 1: não há coluna de peso,
-- e XP/pontos/pagamentos não participam de nenhuma consulta de apuração. Aditiva; reversão em 020_eleicoes.down.sql.

-- temporada semanal: calendário calculado no servidor (America/Sao_Paulo) e persistido em UTC.
create table seasons (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,                 -- 'T2026-10-19' (segunda-feira local que abre a semana)
  regra_id text not null references rule_versions(id),  -- regra congelada na criação: mudanças valem para a próxima
  inscricoes_abrem timestamptz not null,
  inscricoes_fecham timestamptz not null,      -- também congela o eleitorado
  votacao_abre timestamptz not null,
  votacao_fecha timestamptz not null,
  publica_em timestamptz not null,             -- publicação do resultado e posse
  mandato_fim timestamptz not null,            -- término fixo do mandato desta temporada
  criada_em timestamptz not null default now(),
  check (inscricoes_abrem < inscricoes_fecham and inscricoes_fecham <= votacao_abre and votacao_abre < votacao_fecha
         and votacao_fecha <= publica_em and publica_em < mandato_fim)
);

create table elections (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  regra_id text not null references rule_versions(id),
  cargo text not null check (cargo in ('lider','prefeito','presidente')),
  escopo text not null check (escopo in ('rua','cidade','brasil')),
  escopo_id text not null,                     -- id da rua, código IBGE ou 'BR'
  escopo_nome text not null,
  ibge integer references municipios(ibge),
  street_id uuid references virtual_streets(id),
  turno smallint not null default 1 check (turno in (1, 2)),
  origem_id uuid references elections(id),     -- segundo turno aponta para o primeiro
  estado text not null default 'inscricoes' check (estado in
    ('inscricoes','congelada','votacao','apuracao','publicada','segundo_turno','sem_eleito','fundacao','cancelada')),
  modo text check (modo in ('disputa','confirmacao')),
  inscricoes_fecham timestamptz not null,
  votacao_abre timestamptz not null,
  votacao_fecha timestamptz not null,
  publica_em timestamptz not null,
  congelada_em timestamptz,
  eleitorado integer,
  quorum integer,
  resultado_tipo text check (resultado_tipo in
    ('eleito','eleito_sem_concorrencia','rejeitado','sem_candidato','sem_quorum','segundo_turno','empate_vago','fundacao','anulado')),
  resultado jsonb,
  vencedor_user_id uuid references users(id),
  apurada_em timestamptz,
  lider_provisorio uuid,                       -- só para detectar virada (evento provisório)
  placar_atualizado_em timestamptz,
  criada_em timestamptz not null default now(),
  check ((cargo = 'lider' and escopo = 'rua') or (cargo = 'prefeito' and escopo = 'cidade') or (cargo = 'presidente' and escopo = 'brasil')),
  check (votacao_abre < votacao_fecha and votacao_fecha <= publica_em),
  unique (season_id, cargo, escopo_id, turno)
);
create index elections_pendentes on elections(estado, votacao_fecha);
create index elections_escopo on elections(escopo_id, cargo);

-- eleitorado congelado: residência e vínculo de rua no momento do congelamento. Novos moradores votam na próxima.
create table eligibility_snapshots (
  election_id uuid not null references elections(id),
  user_id uuid not null references users(id),
  house_id uuid not null references houses(id),
  street_id uuid references virtual_streets(id),
  ibge integer not null,
  verificado_em timestamptz not null,
  congelado_em timestamptz not null,
  primary key (election_id, user_id)
);

create table candidates (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  election_id uuid not null references elections(id),
  user_id uuid not null references users(id),
  cargo text not null check (cargo in ('lider','prefeito','presidente')),
  turno smallint not null default 1,
  origem_candidate_id uuid references candidates(id),
  estado text not null default 'inscrito' check (estado in ('inscrito','retirado','suspenso','trocou','sem_apoios','inelegivel')),
  intencao text not null,                      -- texto que a pessoa confirmou ("quero concorrer a prefeito de ...")
  motivo text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- candidato único por pessoa/temporada (um cargo só); suspenso continua ocupando a vaga para não se reinscrever
create unique index candidates_um_por_temporada on candidates(season_id, user_id) where turno = 1 and estado in ('inscrito','suspenso');
create unique index candidates_por_eleicao on candidates(election_id, user_id);

-- apoio ≠ voto: assinatura para elegibilidade (presidente exige N apoios). Não altera placar.
create table nomination_supports (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections(id),
  candidate_id uuid not null references candidates(id),
  apoiador_user_id uuid not null references users(id),
  criado_em timestamptz not null default now(),
  invalidado_em timestamptz,
  motivo_invalidacao text
);
create unique index nomination_supports_um_por_eleicao on nomination_supports(election_id, apoiador_user_id) where invalidado_em is null;
create index nomination_supports_candidato on nomination_supports(candidate_id) where invalidado_em is null;

-- um registro ATUAL por eleição+eleitor (troca sobrescreve; nunca soma). Peso implícito = 1.
create table votes (
  election_id uuid not null references elections(id),
  voter_id uuid not null references users(id),
  candidate_id uuid not null references candidates(id),
  escolha text not null default 'voto' check (escolha in ('voto','confirmar','rejeitar')),
  trocas integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (election_id, voter_id)
);
create index votes_candidato on votes(candidate_id);

-- histórico auditável (uso administrativo; a UI nunca lista escolhas individuais)
create table vote_audit (
  id bigserial primary key,
  election_id uuid not null references elections(id),
  voter_id uuid not null references users(id),
  candidate_id uuid references candidates(id),
  escolha text,
  acao text not null check (acao in ('votou','trocou','invalidado','corrigido')),
  motivo text,
  criado_em timestamptz not null default now()
);
create index vote_audit_eleicao on vote_audit(election_id);

create table office_terms (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections(id),
  cargo text not null check (cargo in ('lider','prefeito','presidente')),
  escopo_id text not null,
  escopo_nome text not null,
  user_id uuid not null references users(id),
  inicio timestamptz not null,
  fim timestamptz not null,
  estado text not null default 'ativo' check (estado in ('ativo','encerrado','vago_renuncia','vago_suspensao','vago_saiu_escopo','corrigido')),
  encerrado_em timestamptz,
  motivo text,
  criado_em timestamptz not null default now(),
  check (inicio < fim)
);
-- um mandato ativo por cargo/escopo; um mandato por eleição (retry de apuração não cria outro)
create unique index office_terms_um_ativo on office_terms(cargo, escopo_id) where estado = 'ativo';
create unique index office_terms_por_eleicao on office_terms(election_id) where estado <> 'corrigido';
create index office_terms_usuario on office_terms(user_id) where estado = 'ativo';

-- catálogo aprovado de poderes (allowlist). Nada de moderar, expulsar, mexer em votos/regras ou dar moedas.
create table office_action_catalog (
  id text primary key,
  cargo text not null check (cargo in ('lider','prefeito','presidente')),
  tipo text not null,
  nome text not null,
  descricao text not null,
  duracao_horas integer not null check (duracao_horas between 1 and 336),
  neutra boolean not null default false,      -- opção do calendário neutro quando o cargo está vago
  ativo boolean not null default true
);
create index office_action_catalog_cargo on office_action_catalog(cargo, tipo) where ativo;

create table office_actions (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references office_terms(id),
  user_id uuid not null references users(id),
  cargo text not null,
  escopo_id text not null,
  tipo text not null,
  opcao_id text not null references office_action_catalog(id),
  estado text not null default 'ativa' check (estado in ('ativa','expirada','cancelada')),
  aplica_em timestamptz not null,
  expira_em timestamptz not null,
  criado_em timestamptz not null default now()
);
create index office_actions_escopo on office_actions(cargo, escopo_id, tipo, expira_em);
create index office_actions_term on office_actions(term_id, tipo);

-- correção pós-resultado: só ação administrativa auditada, pública e transparente
create table election_corrections (
  id bigserial primary key,
  election_id uuid not null references elections(id),
  ator_user_id uuid not null references users(id),
  motivo text not null check (char_length(motivo) >= 10),
  antes jsonb not null,
  depois jsonb not null,
  criado_em timestamptz not null default now()
);
