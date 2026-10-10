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
