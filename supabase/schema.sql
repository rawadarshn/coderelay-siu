-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run

create table if not exists public.rooms (
  id               text primary key,
  code             text        not null default '',
  language         text        not null default 'Plain text',
  owner_token_hash text        not null,
  locked           boolean     not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Lock the table down. The server uses the service_role key (which bypasses RLS);
-- with RLS on and no policies, nobody using the public anon key can read or change rooms.
alter table public.rooms enable row level security;

-- People who use CodeRelay (no login): one row per browser session. Only a hash of the session token is stored.
create table if not exists public.users (
  id         bigint generated always as identity primary key,
  token_hash text not null unique,
  name       text not null,
  created_at timestamptz not null default now()
);
alter table public.users enable row level security;

-- Usernames are unique, ignoring upper/lower case ("Aarav" and "aarav" are the same name).
-- If this fails, you already have two users with the same name: rename or delete one first.
create unique index if not exists users_name_lower_key on public.users (lower(name));

-- Makes the API notice new tables right away.
notify pgrst, 'reload schema';
