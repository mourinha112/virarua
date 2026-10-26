drop table if exists ig_indicacoes;
delete from reward_ledger where origem = 'instagram';
alter table reward_ledger drop constraint if exists reward_ledger_origem_check;
alter table reward_ledger add constraint reward_ledger_origem_check check (origem in ('missao','evento','obra','competicao'));
