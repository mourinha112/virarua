-- pontos do Instagram: comentário em post do jogo e amigo marcado que ganhou a casa
alter table reward_ledger drop constraint if exists reward_ledger_origem_check;
alter table reward_ledger add constraint reward_ledger_origem_check check (origem in ('missao','evento','obra','competicao','instagram'));

-- @amigo marcado num comentário. Vale para o 1º que marcou, se o amigo ainda não tinha casa; paga quando os dois têm conta
create table ig_indicacoes (
  id bigserial primary key,
  escopo text not null,
  autor_external_id text not null,
  indicado_username text not null check (indicado_username ~ '^[a-z0-9._]{1,30}$'),
  comment_id text not null,
  criado_em timestamptz not null default now(),
  indicado_identity_id uuid references external_identities(id),
  pago_em timestamptz,
  unique (escopo, autor_external_id, indicado_username)
);
create index ig_indicacoes_username on ig_indicacoes(indicado_username) where indicado_identity_id is null;
create unique index ig_indicacoes_um_por_indicado on ig_indicacoes(indicado_identity_id) where indicado_identity_id is not null;
