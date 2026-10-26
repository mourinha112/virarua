-- Apelidos populares de cidades (o nome oficial do IBGE é diferente do que o povo escreve).
-- Busca o código pelo nome oficial: se não existir, simplesmente não insere (não quebra a migração).
insert into municipio_aliases (alias_norm, uf, ibge)
select a.alias, a.uf, m.ibge from (values
  ('buzios', 'RJ', 'armacao dos buzios'), ('arraial', 'RJ', 'arraial do cabo'), ('parati', 'RJ', 'paraty'),
  ('meriti', 'RJ', 'sao joao de meriti'),
  ('floripa', 'SC', 'florianopolis'), ('jampa', 'PB', 'joao pessoa'),
  ('sjc', 'SP', 'sao jose dos campos'), ('sbc', 'SP', 'sao bernardo do campo'), ('sampa', 'SP', 'sao paulo'),
  ('embu', 'SP', 'embu das artes'), ('moji mirim', 'SP', 'mogi mirim'), ('moji guacu', 'SP', 'mogi guacu'),
  ('bh', 'MG', 'belo horizonte'), ('poa', 'RS', 'porto alegre'), ('jeri', 'CE', 'jijoca de jericoacoara'),
  ('jericoacoara', 'CE', 'jijoca de jericoacoara'), ('canoa quebrada', 'CE', 'aracati'), ('pipa', 'RN', 'tibau do sul'),
  ('porto de galinhas', 'PE', 'ipojuca'), ('trancoso', 'BA', 'porto seguro'), ('arraial d ajuda', 'BA', 'porto seguro'),
  ('morro de sao paulo', 'BA', 'cairu'), ('alter do chao', 'PA', 'santarem'), ('noronha', 'PE', 'fernando de noronha'),
  ('itaipava', 'RJ', 'petropolis'), ('ilha grande', 'RJ', 'angra dos reis')
) as a(alias, uf, oficial)
join municipios m on m.nome_norm = a.oficial and m.uf = a.uf
on conflict do nothing;
