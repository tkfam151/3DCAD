-- OpenCAD Studio: designs saved to the cloud by signed-in users.
-- Each row belongs to one user; row level security keeps it private to them.

create table if not exists public.designs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'Untitled' check (char_length(name) between 1 and 200),
  doc jsonb not null,
  thumb text check (thumb is null or char_length(thumb) < 400000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists designs_user_updated_idx on public.designs (user_id, updated_at desc);

alter table public.designs enable row level security;

drop policy if exists "Users can read their own designs" on public.designs;
create policy "Users can read their own designs" on public.designs
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own designs" on public.designs;
create policy "Users can add their own designs" on public.designs
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own designs" on public.designs;
create policy "Users can update their own designs" on public.designs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own designs" on public.designs;
create policy "Users can delete their own designs" on public.designs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- keep updated_at current
create or replace function public.designs_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists designs_touch_updated_at on public.designs;
create trigger designs_touch_updated_at before update on public.designs
  for each row execute function public.designs_touch_updated_at();
