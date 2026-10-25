-- 021 · regras versionadas das eleições virtuais (eleicoes@1) e catálogo aprovado de poderes dos cargos.
-- Números são parâmetros iniciais de produto, não dados comprovados. Uma nova versão vale a partir da próxima temporada.
insert into rule_versions (id, dominio, regras, vigente_desde) values ('eleicoes@1', 'eleicoes', '{
  "versao": 1,
  "verificadoHoras": 24,
  "limiares": { "lider": 3, "prefeito": 5, "presidente": 50 },
  "apoiosPresidente": 5,
  "quorumPct": 30,
  "unicaExigeMaisConfirmacoes": true,
  "segundoTurnoHoras": 24,
  "placarMinEleitorado": 10,
  "votoEmCandidatoInativo": "invalido_com_aviso",
  "quotaAcoesPorTipo": 1,
  "calendario": {
    "fuso": "America/Sao_Paulo",
    "inscricoesAbrem": { "dia": 1, "hora": 0 },
    "inscricoesFecham": { "dia": 4, "hora": 20 },
    "votacaoAbre": { "dia": 5, "hora": 0 },
    "votacaoFecha": { "dia": 7, "hora": 20 },
    "publica": { "dia": 7, "hora": 21 }
  }
}'::jsonb, '2026-01-01T00:00:00Z') on conflict (id) do nothing;

insert into office_action_catalog (id, cargo, tipo, nome, descricao, duracao_horas, neutra) values
  -- líder da rua: próxima obra, evento e decoração coletiva
  ('lider.obra.horta', 'lider', 'obra', 'horta comunitária', 'a rua vota sua próxima obra: uma horta coletiva', 168, true),
  ('lider.obra.mural', 'lider', 'obra', 'mural de grafite', 'próxima obra da rua: um mural colorido', 168, false),
  ('lider.obra.banco', 'lider', 'obra', 'bancos na calçada', 'próxima obra da rua: bancos para conversar', 168, false),
  ('lider.obra.luz', 'lider', 'obra', 'iluminação nova', 'próxima obra da rua: postes de luz quente', 168, false),
  ('lider.evento.churrasco', 'lider', 'evento', 'churrasco da rua', 'evento coletivo no fim de semana', 48, true),
  ('lider.evento.cinema', 'lider', 'evento', 'cinema na calçada', 'telão na rua por uma noite', 24, false),
  ('lider.evento.troca', 'lider', 'evento', 'feira de trocas', 'moradores trocam itens decorativos', 48, false),
  ('lider.decoracao.bandeirinhas', 'lider', 'decoracao', 'bandeirinhas', 'decoração coletiva da rua', 168, true),
  ('lider.decoracao.luzes', 'lider', 'decoracao', 'varal de luzes', 'decoração coletiva da rua', 168, false),
  ('lider.decoracao.flores', 'lider', 'decoracao', 'canteiros floridos', 'decoração coletiva da rua', 168, false),
  -- prefeito: festival municipal, melhoria da praça, missão comunitária
  ('prefeito.festival.junino', 'prefeito', 'festival', 'festival junino', 'festival municipal com quadrilha virtual', 72, true),
  ('prefeito.festival.musica', 'prefeito', 'festival', 'festival de música', 'palco na praça da cidade', 72, false),
  ('prefeito.festival.comida', 'prefeito', 'festival', 'festival de comida de rua', 'barracas na praça', 72, false),
  ('prefeito.praca.fonte', 'prefeito', 'melhoria_praca', 'fonte na praça', 'melhoria visual da praça', 168, true),
  ('prefeito.praca.coreto', 'prefeito', 'melhoria_praca', 'coreto', 'melhoria visual da praça', 168, false),
  ('prefeito.praca.jardim', 'prefeito', 'melhoria_praca', 'jardim', 'melhoria visual da praça', 168, false),
  ('prefeito.missao.limpeza', 'prefeito', 'missao', 'mutirão de limpeza', 'missão comunitária da cidade', 72, true),
  ('prefeito.missao.plantio', 'prefeito', 'missao', 'plantio de árvores', 'missão comunitária da cidade', 72, false),
  ('prefeito.missao.boasvindas', 'prefeito', 'missao', 'boas-vindas aos novos', 'missão comunitária da cidade', 72, false),
  -- presidente: tema nacional, missão nacional, monumento temporário
  ('presidente.tema.cultura', 'presidente', 'tema_nacional', 'semana da cultura', 'tema do evento nacional', 168, true),
  ('presidente.tema.futebol', 'presidente', 'tema_nacional', 'semana do futebol', 'tema do evento nacional', 168, false),
  ('presidente.tema.carnaval', 'presidente', 'tema_nacional', 'carnaval fora de época', 'tema do evento nacional', 168, false),
  ('presidente.missao.visitas', 'presidente', 'missao_nacional', 'visite outra região', 'missão nacional de visitas', 120, true),
  ('presidente.missao.obras', 'presidente', 'missao_nacional', 'mutirão de obras', 'missão nacional de obras comunitárias', 120, false),
  ('presidente.monumento.farol', 'presidente', 'monumento', 'farol', 'monumento temporário no mapa', 168, true),
  ('presidente.monumento.arco', 'presidente', 'monumento', 'arco', 'monumento temporário no mapa', 168, false),
  ('presidente.monumento.estatua', 'presidente', 'monumento', 'estátua de capivara', 'monumento temporário no mapa', 168, false)
on conflict (id) do nothing;
