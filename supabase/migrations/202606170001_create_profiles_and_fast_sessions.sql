create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  provider text check (provider is null or provider in ('google', 'apple')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fast_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  target_hours numeric(4, 1) not null default 13,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint fast_sessions_target_hours_check check (target_hours >= 1 and target_hours <= 48),
  constraint fast_sessions_end_after_start_check check (ended_at is null or ended_at > started_at),
  constraint fast_sessions_deleted_after_start_check check (deleted_at is null or deleted_at >= started_at)
);

create index if not exists fast_sessions_user_ended_at_idx
  on public.fast_sessions (user_id, ended_at desc);

create index if not exists fast_sessions_user_updated_at_idx
  on public.fast_sessions (user_id, updated_at desc);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.fast_sessions enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can read their own fast sessions" on public.fast_sessions;
create policy "Users can read their own fast sessions"
on public.fast_sessions for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own fast sessions" on public.fast_sessions;
create policy "Users can insert their own fast sessions"
on public.fast_sessions for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own fast sessions" on public.fast_sessions;
create policy "Users can update their own fast sessions"
on public.fast_sessions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own fast sessions" on public.fast_sessions;
create policy "Users can delete their own fast sessions"
on public.fast_sessions for delete
using (auth.uid() = user_id);
