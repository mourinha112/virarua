-- desce antes de 020: limpa dados que referenciam o catálogo e as regras (020.down remove as tabelas em seguida)
truncate office_action_catalog, seasons cascade;
delete from rule_versions where dominio = 'eleicoes';
