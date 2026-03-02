-- Run in Supabase SQL editor
create extension if not exists pgcrypto;

create table if not exists public.owners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  owner text not null,
  status text not null check (status in ('todo','doing','blocked','done')),
  due date,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.minutes (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  owner text not null,
  this_week text,
  next_week text,
  created_at timestamptz not null default now()
);

alter table public.owners enable row level security;
alter table public.tasks enable row level security;
alter table public.minutes enable row level security;

-- Demo policy: anyone with anon key can read/write
-- (Some Postgres environments do not support "create policy if not exists")
drop policy if exists owners_all on public.owners;
create policy owners_all on public.owners for all to anon using (true) with check (true);

drop policy if exists tasks_all on public.tasks;
create policy tasks_all on public.tasks for all to anon using (true) with check (true);

drop policy if exists minutes_all on public.minutes;
create policy minutes_all on public.minutes for all to anon using (true) with check (true);

alter publication supabase_realtime add table public.owners;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.minutes;
