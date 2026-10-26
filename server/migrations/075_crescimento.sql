-- crescimento: guerra de cidades, caça ao tesouro, enfeites da casa e missão de Natal

-- missões com janela de datas (Natal); null = sempre
alter table missions add column if not exists inicio date, add column if not exists fim date;
insert into missions (id, titulo, descricao, tipo_desafio, min_ms, regra_xp, regra_contribuicao, ordem, params, inicio, fim) values
  ('natal.presente', 'Embrulhe os presentes', 'Natal na cidade: monte a ceia na ordem que o Papai Noel pediu.', 'sequencia', 3000, 'xp5_missao@1', 'contrib10_missao@1', 8,
   '{"itens":["arvore","presente","estrela","sino","vela","biscoito"],"tamanho":4}', '2026-12-01', '2027-01-06')
on conflict (id) do nothing;

-- guerra de cidades: última posição conhecida (para saber quem passou quem) e as ultrapassagens
create table city_war_positions (semana date not null, tipo text not null check (tipo in ('cidade','estado')), chave text not null, pos integer not null, pts integer not null, primary key (semana, tipo, chave));
create table city_war_events (
  id bigserial primary key, semana date not null, tipo text not null check (tipo in ('cidade','estado')),
  chave text not null, passou text not null, pos integer not null, criado_em timestamptz not null default now(),
  unique (semana, tipo, chave, passou)
);
create index city_war_events_recentes on city_war_events(criado_em desc);

-- caça ao tesouro: 1 baú por semana numa cidade com casas
create table treasure_hunts (semana date primary key, ibge integer not null references municipios(ibge), criado_em timestamptz not null default now());
create table treasure_digs (
  id bigserial primary key, semana date not null references treasure_hunts(semana), user_id uuid not null references users(id),
  dia date not null, ibge integer not null references municipios(ibge), km integer not null, criado_em timestamptz not null default now()
);
create index treasure_digs_user on treasure_digs(user_id, dia);
create table treasure_finds (semana date not null references treasure_hunts(semana), user_id uuid not null references users(id), ordem integer not null, achado_em timestamptz not null default now(), primary key (semana, user_id));

-- enfeites da casa (liberados por XP) e cor do time na bandeira
create table house_decor (
  user_id uuid primary key references users(id),
  itens text[] not null default '{}',
  bandeira text check (bandeira is null or bandeira ~ '^#[0-9a-f]{6}-#[0-9a-f]{6}$'),
  atualizado_em timestamptz not null default now()
);

-- novas origens de XP no ledger
alter table reward_ledger drop constraint if exists reward_ledger_origem_check;
alter table reward_ledger add constraint reward_ledger_origem_check check (origem in ('missao','evento','obra','competicao','instagram','convite','tesouro','ofensiva'));
