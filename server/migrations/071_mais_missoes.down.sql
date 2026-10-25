delete from mission_completions where mission_id in ('obra.material','obra.ferramentas','quiz.brasil','quiz.jogo');
delete from missions where id in ('obra.material','obra.ferramentas','quiz.brasil','quiz.jogo');
alter table missions drop column if exists params;
alter table community_projects alter column limite_dia_usuario set default 2;
