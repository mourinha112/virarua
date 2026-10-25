-- Mais missões por dia (7): três delas ajudam a obra da rua. Parâmetros do desafio por missão (tema, itens, banco do quiz).
alter table missions add column params jsonb not null default '{}'::jsonb;
update missions set titulo = 'Encaixe a peça da obra', descricao = 'Complete o padrão e a peça vai pra obra da rua.' where id = 'obra.etapa';
update missions set titulo = 'Conta rápida', descricao = 'Resolva a continha sorteada.' where id = 'desafio.curto';
update missions set titulo = 'Roda na praça', descricao = 'Repita os gestos da roda na ordem certa.' where id = 'atividade.praca';
insert into missions (id, titulo, descricao, tipo_desafio, min_ms, regra_xp, regra_contribuicao, ordem, params) values
  ('obra.material', 'Conte o material da obra', 'Chegou caminhão com material: conte quanto chegou.', 'conta', 1500, 'xp5_missao@1', 'contrib10_missao@1', 2, '{"tema":"material"}'),
  ('obra.ferramentas', 'Passe as ferramentas', 'Entregue as ferramentas na ordem que o mestre de obras pediu.', 'sequencia', 3000, 'xp5_missao@1', 'contrib10_missao@1', 3, '{"itens":["martelo","tijolo","tinta","serra","muda","lampada"],"tamanho":4}'),
  ('quiz.brasil', 'Quiz do Brasil', 'Duas perguntas sobre o Brasil. Acerte as duas.', 'quiz', 3000, 'xp5_missao@1', 'contrib10_missao@1', 6, '{"banco":"biblioteca","perguntas":2}'),
  ('quiz.jogo', 'Quiz do jogo', 'Duas perguntas sobre como o jogo funciona.', 'quiz', 3000, 'xp5_missao@1', 'contrib10_missao@1', 7, '{"banco":"jogo","perguntas":2}')
on conflict (id) do nothing;
update missions set ordem = 4 where id = 'desafio.curto';
update missions set ordem = 5 where id = 'atividade.praca';
-- três ajudas por dia na obra (uma por missão de obra); a metade da obra por pessoa continua valendo
alter table community_projects alter column limite_dia_usuario set default 3;
update community_projects set limite_dia_usuario = 3 where status = 'em_obra' and limite_dia_usuario < 3;
