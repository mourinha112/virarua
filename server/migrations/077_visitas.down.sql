delete from reward_ledger where origem = 'visita';
alter table reward_ledger drop constraint if exists reward_ledger_origem_check;
alter table reward_ledger add constraint reward_ledger_origem_check check (origem in ('missao','evento','obra','competicao','instagram','convite','tesouro','ofensiva'));
drop table if exists house_kudos;
