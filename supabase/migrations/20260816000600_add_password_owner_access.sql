create table if not exists public.event_owner_credentials (
  event_id uuid primary key references public.events(id) on delete cascade,
  password_salt text not null,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.event_owner_sessions (
  token_hash text primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists event_owner_sessions_event_idx on public.event_owner_sessions(event_id);

create table if not exists public.event_owner_login_attempts (
  event_id uuid not null references public.events(id) on delete cascade,
  client_hash text not null,
  failures integer not null default 0,
  window_started timestamptz not null default now(),
  locked_until timestamptz,
  primary key (event_id, client_hash)
);

alter table public.event_owner_credentials enable row level security;
alter table public.event_owner_sessions enable row level security;
alter table public.event_owner_login_attempts enable row level security;

-- Password: delivered separately to the event owner. Only its salted hash is stored.
insert into public.event_owner_credentials (event_id, password_salt, password_hash)
select id,
  '6d2c3d596555a8922f67917893cdd686',
  'b7bb4ee10118db05988d9faeaedbc65745cb7a72b603dbc328426e429e1c4e68'
from public.events where event_code = 'C&C2026'
on conflict (event_id) do update set
  password_salt = excluded.password_salt,
  password_hash = excluded.password_hash,
  updated_at = now();
