-- Pet da casa: um por pessoa (gato ou cachorro), fica na frente da casa. Liberado por meta de pontos (servidor confere).
create table pets (
  user_id uuid primary key references users(id) on delete cascade,
  especie text not null check (especie in ('gato','cachorro')),
  cor text not null check (cor ~ '^[a-z]{3,12}$'),
  nome text not null check (char_length(nome) between 1 and 20),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
