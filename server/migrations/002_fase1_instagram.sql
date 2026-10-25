-- 002 · Fase 1: registro de comentários do Instagram (estado/motivo por comentário) e índices de reivindicação.
-- Aditiva. Reversão em 002_fase1_instagram.down.sql.

-- Um registro por comentário recebido (dedupe por comment_id). Guarda o estado do processamento com motivo,
-- inclusive quando NÃO há identidade (ex.: sem id estável do autor → needs_review) ou a cidade ficou pendente.
create table instagram_comments (
  comment_id text primary key,
  conta_id text not null,                     -- conta profissional que recebeu (escopo do id do autor)
  media_id text,
  campo text not null default 'comments',
  autor_external_id text,                     -- from.id (id escopado pela conta conectada); null → needs_review
  username text,                              -- from.username no momento do comentário (só exibição)
  texto text,                                 -- até 300 caracteres
  identity_id uuid references external_identities(id),
  ibge integer references municipios(ibge),
  estado text not null default 'received' check (estado in ('received','ignored','needs_review','pending_city_resolution','provisioned','duplicate','challenge','revoked','invalid')),
  motivo text,
  candidatos jsonb,                           -- cidades candidatas quando ambígua
  evento_em timestamptz,                      -- entry.time do webhook
  recebido_em timestamptz not null default now(),
  processado_em timestamptz
);
create index instagram_comments_identidade on instagram_comments(identity_id);
create index instagram_comments_estado on instagram_comments(estado, recebido_em);

-- desafio por código: o status é consultado pelo hash do cookie do navegador
create index claim_challenges_sessao on claim_challenges(sessao_pendente_hash);
create index identity_claims_identidade on identity_claims(identity_id) where consumido_em is null;
-- expiração de reservas
create index houses_reserva_expira on houses(expira_em) where status = 'reservada';
create index outbound_messages_identidade on outbound_messages(identity_id, estado);
