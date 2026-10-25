-- 060 · rua ao vivo: acenos entre vizinhos (só entre moradores da mesma rua; sem texto livre).
create table street_waves (
  id bigserial primary key,
  street_id uuid not null references virtual_streets(id),
  de_user uuid not null references users(id),
  para_user uuid not null references users(id),
  criado_em timestamptz not null default now(),
  check (de_user <> para_user)
);
create index street_waves_para on street_waves(para_user, criado_em desc);
create index street_waves_de on street_waves(de_user, criado_em desc);
