-- Visita na casa: tocar a campainha (1 adesivo por visitante por casa por dia) e curtir (1 vez por visitante por casa).
-- Quem recebe ganha +1 XP por toque/curtida (casa reivindicada), até 20 XP por dia vindos de visitas.
create table house_kudos (
  id bigserial primary key,
  house_id uuid not null references houses(id) on delete cascade,
  visitante_user_id uuid not null references users(id) on delete cascade,
  tipo text not null check (tipo in ('campainha','curtida')),
  adesivo text,
  dia date not null,
  criado_em timestamptz not null default now(),
  unique (house_id, visitante_user_id, tipo, dia)
);
create index house_kudos_casa on house_kudos(house_id, tipo, dia);

alter table reward_ledger drop constraint if exists reward_ledger_origem_check;
alter table reward_ledger add constraint reward_ledger_origem_check check (origem in ('missao','evento','obra','competicao','instagram','convite','tesouro','ofensiva','visita'));
