-- 040 · Fase 5: estabelecimentos reais patrocinados (cenários virtuais), patrocínio manual, eventos, cupons, métricas.
-- Sem cobrança: o MVP registra contrato/status MANUAIS. Nenhum valor monetário é cobrado ou simulado aqui.
-- Patrocínio compra só presença/personalização/evento/cupom (check em sponsorships.beneficios): nunca voto, cargo ou vantagem.

-- domínios permitidos para links externos (o servidor só aceita https + host nesta lista ou subdomínio dela)
create table link_domain_allowlist (
  dominio text primary key check (dominio ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  nota text,
  adicionado_por uuid references users(id),
  criado_em timestamptz not null default now()
);
insert into link_domain_allowlist (dominio, nota) values
  ('instagram.com', 'perfil do negócio'), ('wa.me', 'WhatsApp comercial'), ('ifood.com.br', 'cardápio/pedido'), ('maps.google.com', 'mapa do endereço comercial');

create table venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  nome text not null check (char_length(nome) between 2 and 60),
  categoria text not null check (categoria in ('cafeteria','restaurante','loja','pet','eventos','bar')),
  ibge integer not null references municipios(ibge),
  descricao text not null default '' check (char_length(descricao) <= 280),
  cor text not null default '#ffd23f' check (cor ~ '^#[0-9a-f]{6}$'),
  -- logo licenciado: referência ao arquivo + declaração de licença de quem enviou (sem declaração, sem logo)
  logo_ref text, logo_licenca text, logo_declarado_por text, logo_declarado_em timestamptz,
  endereco_comercial text check (char_length(endereco_comercial) <= 200),
  horario text check (char_length(horario) <= 120),
  contato_telefone text check (contato_telefone ~ '^[0-9]{10,13}$'),
  interior jsonb not null default '{"mesas":4,"lugares_por_mesa":4}'::jsonb,
  capacidade integer not null default 16 check (capacidade between 1 and 200),
  alcool boolean not null default false,               -- vende/promove bebida alcoólica (bar sempre conta como álcool)
  verificacao text not null default 'pendente' check (verificacao in ('pendente','verificado','rejeitado','suspenso')),
  verificado_por uuid references users(id), verificado_em timestamptz, nota_verificacao text,
  demo boolean not null default false,                 -- demonstração: nunca entra em contadores/exportação de produção
  pedido_id uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (logo_ref is null or (logo_licenca is not null and char_length(logo_licenca) >= 10 and logo_declarado_por is not null)),
  check (categoria <> 'bar' or alcool)
);
create index venues_cidade on venues(ibge, verificacao);

create table venue_photos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  ref text not null,
  autorizacao text not null check (char_length(autorizacao) >= 10),   -- quem autorizou o uso e em que termos
  autorizado_por text not null,
  status text not null default 'pendente' check (status in ('pendente','aprovada','removida')),
  criado_em timestamptz not null default now()
);

create table venue_links (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  tipo text not null check (tipo in ('site','instagram','whatsapp','cardapio','mapa')),
  url text not null check (url like 'https://%' and char_length(url) <= 300),
  dominio text not null,
  rotulo text not null check (char_length(rotulo) between 2 and 40),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (venue_id, url)
);

create table sponsorships (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  modalidade text not null check (modalidade in ('presenca','personalizacao','evento','demonstracao')),
  beneficios text[] not null default array['presenca_mapa']
    check (beneficios <@ array['presenca_mapa','personalizacao_fachada','evento_patrocinado','cupom']::text[]),
  contrato_ref text not null check (char_length(contrato_ref) between 3 and 120),   -- referência do contrato assinado fora do sistema
  status text not null default 'rascunho' check (status in ('rascunho','ativo','pausado','encerrado','cancelado')),
  inicio date not null, fim date not null,
  aprovado_por uuid references users(id), aprovado_em timestamptz,
  observacao text,
  criado_em timestamptz not null default now(),
  check (fim >= inicio)
);
create index sponsorships_vigencia on sponsorships(venue_id, status, inicio, fim);

create table venue_events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  titulo text not null check (char_length(titulo) between 3 and 80),
  descricao text not null default '' check (char_length(descricao) <= 280),
  inicio timestamptz not null, fim timestamptz not null,
  capacidade integer check (capacidade between 1 and 500),
  alcool boolean not null default false,
  status text not null default 'agendado' check (status in ('agendado','cancelado','encerrado')),
  criado_em timestamptz not null default now(),
  check (fim > inicio)
);

create table coupons (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  titulo text not null check (char_length(titulo) between 3 and 60),
  regras text not null check (char_length(regras) between 5 and 280),   -- condições visíveis ao usuário
  inicio timestamptz not null default now(), fim timestamptz not null,
  limite_total integer check (limite_total > 0),
  resgatados integer not null default 0 check (resgatados >= 0),
  alcool boolean not null default false,
  status text not null default 'ativo' check (status in ('ativo','pausado','encerrado')),
  criado_em timestamptz not null default now(),
  check (fim > inicio), check (limite_total is null or resgatados <= limite_total)
);
create table coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references coupons(id) on delete cascade,
  user_id uuid not null references users(id),
  codigo text not null unique,
  criado_em timestamptz not null default now(),
  unique (coupon_id, user_id)                          -- resgate deduplicado: 1 por pessoa por cupom
);

-- eventos crus deduplicados (1 visita por pessoa/local/dia; 1 clique por pessoa/link/dia). Só usuários autenticados.
create table venue_visits (
  venue_id uuid not null references venues(id) on delete cascade, user_id uuid not null references users(id),
  dia date not null, primeiro_em timestamptz not null default now(),
  primary key (venue_id, user_id, dia)
);
create table venue_clicks (
  venue_id uuid not null references venues(id) on delete cascade, link_id uuid not null references venue_links(id) on delete cascade,
  user_id uuid not null references users(id), dia date not null, primeiro_em timestamptz not null default now(),
  primary key (link_id, user_id, dia)
);
-- agregado diário (recalculado de forma idempotente a partir dos crus). Não mede venda.
create table aggregated_venue_metrics (
  venue_id uuid not null references venues(id) on delete cascade,
  dia date not null,
  visitantes_unicos integer not null default 0,
  cliques integer not null default 0,
  resgates integer not null default 0,
  demo boolean not null default false,
  calculado_em timestamptz not null default now(),
  primary key (venue_id, dia)
);

-- pedidos de cadastro vindos do mapa ("seu negócio no mapa"): nada é publicado sem verificação administrativa
create table venue_requests (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^NEG-[A-Z2-9]{6}$'),
  nome text not null check (char_length(nome) between 2 and 60),
  cidade_texto text not null check (char_length(cidade_texto) <= 80),
  ibge integer references municipios(ibge),
  categoria text not null check (categoria in ('cafeteria','restaurante','loja','pet','eventos')),
  instagram text check (instagram ~ '^[a-z0-9._]{1,30}$'),
  whatsapp text check (whatsapp ~ '^[0-9]{10,13}$'),
  ip_hash bytea,
  status text not null default 'novo' check (status in ('novo','em_analise','aprovado','recusado','spam')),
  nota text,
  venue_id uuid references venues(id),
  criado_em timestamptz not null default now()
);
create index venue_requests_status on venue_requests(status, criado_em);
alter table venues add constraint venues_pedido_fk foreign key (pedido_id) references venue_requests(id);
