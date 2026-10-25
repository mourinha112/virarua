-- Login próprio do painel admin (usuário + senha), separado do login do jogo. Só o hash scrypt é guardado.
create table admin_logins (
  login text primary key check (login ~ '^[a-z0-9._-]{3,40}$'),
  user_id uuid not null unique references users(id) on delete cascade,
  senha_hash text not null,
  falhas int not null default 0,
  bloqueado_ate timestamptz,
  ultimo_login_em timestamptz,
  criado_em timestamptz not null default now()
);
