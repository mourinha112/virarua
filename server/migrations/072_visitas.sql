-- Visitas ao site para as métricas do painel: um id aleatório por aparelho (gerado no navegador), sem IP e sem dado pessoal.
-- novo = primeira vez que esse aparelho aparece; origem = de onde veio (referrer/utm resumido); dispositivo = cel/pc.
create table site_visits (
  dia date not null,
  visitante text not null check (visitante ~ '^[a-z0-9]{16,40}$'),
  logado boolean not null default false,
  novo boolean not null default false,
  dispositivo text not null default 'pc' check (dispositivo in ('cel','pc')),
  origem text not null default 'direto' check (origem in ('instagram','whatsapp','facebook','google','tiktok','direto','outro')),
  paginas integer not null default 1,
  primeira_em timestamptz not null default now(),
  primary key (dia, visitante)
);
create index site_visits_visitante on site_visits(visitante);
