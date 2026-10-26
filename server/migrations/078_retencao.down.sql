delete from reward_ledger where origem in ('bau','pet','chuva');
alter table reward_ledger drop constraint if exists reward_ledger_origem_check;
alter table reward_ledger add constraint reward_ledger_origem_check check (origem in ('missao','evento','obra','competicao','instagram','convite','tesouro','ofensiva','visita'));
drop table if exists rain_picks;
alter table pets drop column if exists alimentado_em;
drop table if exists daily_chests;
