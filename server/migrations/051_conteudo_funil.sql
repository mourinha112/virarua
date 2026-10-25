-- 051 · Fase 6: eventos de funil por campanha/template (comentário → cidade → reserva → acesso → reivindicação →
-- avatar → primeira ação → D1/D7 → convite → amigo ativado → participação). Demo nunca entra nos relatórios.
create table content_funnel_events (
  id bigserial primary key,
  etapa text not null check (etapa in ('comentario','cidade_resolvida','reserva','acesso_entregue','reivindicacao','avatar_salvo','primeira_acao','retorno_d1','retorno_d7','convite','amigo_ativado','participacao','clique','compartilhamento')),
  campanha text,
  template_id text,
  publication_job_id uuid references publication_jobs(id),
  user_id uuid references users(id),
  identity_id uuid references external_identities(id),
  chave text not null unique,                       -- idempotência (etapa + referência)
  demo boolean not null default false,
  criado_em timestamptz not null default now()
);
create index content_funnel_events_campanha on content_funnel_events(campanha, template_id, etapa) where not demo;
