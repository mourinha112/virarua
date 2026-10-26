delete from reward_ledger where origem in ('convite','tesouro','ofensiva');
alter table reward_ledger drop constraint if exists reward_ledger_origem_check;
alter table reward_ledger add constraint reward_ledger_origem_check check (origem in ('missao','evento','obra','competicao','instagram'));
drop table if exists house_decor, treasure_finds, treasure_digs, treasure_hunts, city_war_events, city_war_positions;
delete from mission_completions where mission_id = 'natal.presente';
delete from missions where id = 'natal.presente';
alter table missions drop column if exists inicio, drop column if exists fim;
