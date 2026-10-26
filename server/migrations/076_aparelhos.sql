-- "lembrar este aparelho": se o cookie de sessão sumir (navegador do Instagram apaga), o token guardado no aparelho
-- abre uma sessão nova sem pedir código de novo. Só o hash vai ao banco; sair da conta revoga.
create table device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  token_hash bytea not null unique,
  criado_em timestamptz not null default now(),
  usado_em timestamptz,
  expira_em timestamptz not null,
  revogado_em timestamptz
);
create index device_tokens_user on device_tokens(user_id) where revogado_em is null;
