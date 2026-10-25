-- 030 · Fase 3: ledger de recompensas e desafios validados no servidor.
-- Quatro sistemas separados (cap. 8): XP individual e contribuição da rua vivem AQUI; voto e apoio de candidatura
-- pertencem à Fase 4 e são proibidos neste ledger pelo check de "sistema". Nada vem do frontend: só o servidor grava.
create table reward_ledger (
  id bigserial primary key,
  user_id uuid not null references users(id),
  sistema text not null check (sistema in ('xp','contribuicao','colecao')),   -- 'colecao' = emblema/lembrança/cosmético (sem pontos)
  regra_id text not null,                     -- regra versionada, ex.: 'xp10@1' (recompensas/regras.ts + rule_versions)
  evento_ref text not null,                   -- o que gerou: 'missao:desafio.curto:2026-10-24', 'evento:<instância>', 'E01'
  chave text not null unique,                 -- idempotência: regra + evento + usuário
  quantidade integer not null check (quantidade >= 0),
  pedida integer not null check (pedida >= 0),-- quanto a regra daria sem teto (auditoria do corte)
  limitado boolean not null default false,    -- true quando o teto diário cortou
  dia date not null,                          -- dia do jogo (America/Sao_Paulo)
  origem text not null check (origem in ('missao','evento','obra','competicao')),
  street_id uuid references virtual_streets(id),   -- só contribuição: rua do elenco snapshot que recebeu o ponto
  season_id uuid,                             -- só contribuição: temporada (FK criada em 032)
  item text,                                  -- só coleção: 'emblema:E20', 'lembranca:E47'...
  dados jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  check (sistema <> 'contribuicao' or (street_id is not null and season_id is not null)),
  check (sistema <> 'colecao' or item is not null)
);
create index reward_ledger_user_dia on reward_ledger(user_id, dia, sistema);
create index reward_ledger_temporada on reward_ledger(season_id, street_id) where sistema = 'contribuicao';

-- desafios curtos emitidos pelo servidor (semente + gabarito guardados só aqui; o cliente nunca recebe a resposta)
create table server_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  contexto text not null,                     -- 'missao:desafio.curto', 'evento:<instância>'
  tipo text not null check (tipo in ('conta','sequencia','peca','quiz','simbolos')),
  semente text not null,
  gabarito jsonb not null,
  progresso jsonb not null default '{}'::jsonb,
  tentativas integer not null default 0,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  consumido_em timestamptz,
  resultado text check (resultado in ('certo','errado'))
);
create index server_challenges_user on server_challenges(user_id, contexto, criado_em desc);

insert into rule_versions (id, dominio, regras) values
  ('recompensas@1', 'recompensas', '{"teto_xp_dia":100,"teto_contribuicao_dia":30,"pontos_por_missao":10,"xp_por_missao":5,"missoes_por_dia":3,"uma_conclusao_paga_por_missao_dia":true,"pontos_do_frontend":false}'::jsonb)
on conflict (id) do nothing;
