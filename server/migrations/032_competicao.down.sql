alter table if exists reward_ledger drop constraint if exists reward_ledger_season_fk;
drop table if exists competition_awards, competition_groups, competition_roster, competition_entries, competition_seasons cascade;
delete from rule_versions where dominio = 'competicao';
