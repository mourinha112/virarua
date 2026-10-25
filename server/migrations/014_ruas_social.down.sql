drop table if exists street_join_requests;
drop table if exists street_waitlist;
drop function if exists rua_competitiva(uuid, timestamptz);
alter table street_memberships drop column if exists competicao_a_partir_de;
alter table street_memberships drop column if exists origem;
alter table virtual_streets drop column if exists arquivada_em;
