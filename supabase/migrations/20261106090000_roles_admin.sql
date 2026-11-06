-- OpenCAD Studio: organisation roles (owner / teacher / student), the site admin,
-- organisation passwords, the school creation code and sharing designs with a class.
-- Run after the earlier migrations. Safe to run more than once.

create extension if not exists pgcrypto with schema extensions;

-- ============ the site admin ============
-- The admin is recognised by a CONFIRMED sign-in email. Keep "Confirm email" switched on in
-- Supabase (Authentication > Providers > Email), otherwise anyone could claim this address.
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid())
      and lower(u.email) = 'tonklapc.toogle@gmail.com'
      and u.email_confirmed_at is not null
  );
$$;

-- ============ secrets nobody can read directly ============
-- Hashed organisation passwords and the school creation code. No policies = no direct access;
-- only the security-definer functions below read or write them.
create table if not exists public.org_secrets (
  org text primary key references public.orgs (slug) on delete cascade on update cascade,
  password_hash text not null
);
alter table public.org_secrets enable row level security;

create table if not exists public.app_secrets (
  key text primary key,
  value_hash text not null
);
alter table public.app_secrets enable row level security;

-- ============ organisation members ============
create table if not exists public.org_members (
  org text not null references public.orgs (slug) on delete cascade on update cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'teacher', 'student')),
  username text check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{1,30}$'),
  display_name text check (display_name is null or char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  primary key (org, user_id),
  unique (org, username)
);
create index if not exists org_members_user_idx on public.org_members (user_id);
alter table public.org_members enable row level security;

create or replace function public.org_role(o text) returns text
  language sql stable security definer set search_path = '' as $$
  select m.role from public.org_members m where m.org = o and m.user_id = (select auth.uid());
$$;
create or replace function public.is_org_owner(o text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select public.is_admin() or coalesce(public.org_role(o) = 'owner', false);
$$;
create or replace function public.is_org_staff(o text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select public.is_admin() or coalesce(public.org_role(o) in ('owner', 'teacher'), false);
$$;
create or replace function public.is_org_member(o text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select public.is_admin() or public.org_role(o) is not null;
$$;
create or replace function public.class_org(cid uuid) returns text
  language sql stable security definer set search_path = '' as $$
  select c.org from public.classes c where c.id = cid;
$$;

drop policy if exists "Members see their school's people" on public.org_members;
create policy "Members see their school's people" on public.org_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_staff(org));
-- accounts are created and changed through the org-admin Edge Function (service role);
-- owners may also change roles and names directly
drop policy if exists "Owners manage their school's people" on public.org_members;
create policy "Owners manage their school's people" on public.org_members for update to authenticated
  using (public.is_org_owner(org)) with check (public.is_org_owner(org));
drop policy if exists "Owners remove people" on public.org_members;
create policy "Owners remove people" on public.org_members for delete to authenticated
  using (public.is_org_owner(org) and (role <> 'owner' or public.is_admin()));

-- ============ schools: created only with the creation code ============
drop policy if exists "Signed-in users can add a school" on public.orgs;
drop policy if exists "Creators can edit their school" on public.orgs;
drop policy if exists "Creators can remove their school" on public.orgs;
drop policy if exists "Owners and the admin edit a school" on public.orgs;
create policy "Owners and the admin edit a school" on public.orgs for update to authenticated
  using (public.is_org_owner(slug)) with check (public.is_org_owner(slug));
drop policy if exists "The admin removes schools" on public.orgs;
create policy "The admin removes schools" on public.orgs for delete to authenticated
  using (public.is_admin());

create or replace function public.orgs_protect() returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' and not public.is_admin() then
    new.verified := old.verified;
    new.slug := old.slug;
    new.created_by := old.created_by;
  end if;
  return new;
end; $$;

-- create a school: needs the creation code; the creator becomes its owner
create or replace function public.create_org(
  p_slug text, p_name text, p_short text, p_city text, p_color text, p_password text, p_code text
) returns public.orgs language plpgsql security definer set search_path = '' as $$
declare o public.orgs; h text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  select value_hash into h from public.app_secrets where key = 'org_creation_code';
  if not public.is_admin() then
    if h is null then raise exception 'Adding schools isn''t open yet. Ask the site admin for a school creation code.'; end if;
    if p_code is null or extensions.crypt(p_code, h) <> h then raise exception 'That school creation code is not right. Ask the site admin for it.'; end if;
  end if;
  if char_length(coalesce(p_password, '')) < 6 then raise exception 'Choose an organisation password with at least 6 characters.'; end if;
  if exists (select 1 from public.orgs where slug = p_slug) then raise exception 'That web address is already taken. Try another one.'; end if;
  insert into public.orgs (slug, name, short, city, color, verified, created_by)
    values (p_slug, p_name, p_short, nullif(p_city, ''), coalesce(p_color, '#3b8cff'), false, (select auth.uid()))
    returning * into o;
  insert into public.org_secrets (org, password_hash) values (o.slug, extensions.crypt(p_password, extensions.gen_salt('bf')));
  insert into public.org_members (org, user_id, role, display_name)
    values (o.slug, (select auth.uid()), 'owner', (select coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)) from auth.users u where u.id = (select auth.uid())));
  return o;
end; $$;
revoke all on function public.create_org(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_org(text, text, text, text, text, text, text) to authenticated;

-- check an organisation password (the front door of /org/<school>/)
create or replace function public.check_org_password(p_slug text, p_password text) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
declare h text;
begin
  select password_hash into h from public.org_secrets where org = p_slug;
  if h is null then return false; end if;
  return extensions.crypt(coalesce(p_password, ''), h) = h;
end; $$;
revoke all on function public.check_org_password(text, text) from public;
grant execute on function public.check_org_password(text, text) to anon, authenticated;

create or replace function public.set_org_password(p_slug text, p_password text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_org_owner(p_slug) then raise exception 'Only the school owner can change the password.'; end if;
  if char_length(coalesce(p_password, '')) < 6 then raise exception 'Use at least 6 characters.'; end if;
  insert into public.org_secrets (org, password_hash) values (p_slug, extensions.crypt(p_password, extensions.gen_salt('bf')))
    on conflict (org) do update set password_hash = excluded.password_hash;
end; $$;
revoke all on function public.set_org_password(text, text) from public, anon;
grant execute on function public.set_org_password(text, text) to authenticated;

-- the admin sets the school creation code (it keeps working until changed)
create or replace function public.set_creation_code(p_code text) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only the site admin can do this.'; end if;
  if char_length(coalesce(p_code, '')) < 6 then raise exception 'Use at least 6 characters.'; end if;
  insert into public.app_secrets (key, value_hash) values ('org_creation_code', extensions.crypt(p_code, extensions.gen_salt('bf')))
    on conflict (key) do update set value_hash = excluded.value_hash;
end; $$;
revoke all on function public.set_creation_code(text) from public, anon;
grant execute on function public.set_creation_code(text) to authenticated;

create or replace function public.whoami() returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'admin', public.is_admin(),
    'orgs', coalesce((select jsonb_agg(jsonb_build_object('org', m.org, 'role', m.role, 'username', m.username, 'display_name', m.display_name))
                      from public.org_members m where m.user_id = (select auth.uid())), '[]'::jsonb)
  );
$$;
grant execute on function public.whoami() to authenticated;

-- ============ classes: only staff create them; owners and the admin see all ============
drop policy if exists "Teachers and members see a class" on public.classes;
create policy "Teachers and members see a class" on public.classes for select to authenticated
  using (teacher_id = (select auth.uid()) or public.is_class_member(id) or (org is not null and public.is_org_owner(org)) or public.is_admin());
drop policy if exists "Anyone signed in can start a class" on public.classes;
drop policy if exists "Staff create classes" on public.classes;
create policy "Staff create classes" on public.classes for insert to authenticated
  with check (teacher_id = (select auth.uid()) and org is not null and public.is_org_staff(org));
drop policy if exists "Teachers edit their class" on public.classes;
create policy "Teachers edit their class" on public.classes for update to authenticated
  using (teacher_id = (select auth.uid()) or (org is not null and public.is_org_owner(org)))
  with check (teacher_id = (select auth.uid()) or (org is not null and public.is_org_owner(org)));
drop policy if exists "Teachers delete their class" on public.classes;
create policy "Teachers delete their class" on public.classes for delete to authenticated
  using (teacher_id = (select auth.uid()) or (org is not null and public.is_org_owner(org)));

create or replace function public.is_class_teacher(cid uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classes c where c.id = cid and
    (c.teacher_id = (select auth.uid()) or (c.org is not null and public.is_org_owner(c.org))));
$$;

-- assigning students: the class teacher, the school owner or the admin adds a member of the school
drop policy if exists "Teachers assign students" on public.class_members;
create policy "Teachers assign students" on public.class_members for insert to authenticated
  with check (public.is_class_teacher(class_id)
    and exists (select 1 from public.org_members m where m.org = public.class_org(class_id) and m.user_id = class_members.user_id));

-- joining with a code: only people in that school
create or replace function public.join_class(code text, display_name text default null)
  returns public.classes language plpgsql security definer set search_path = '' as $$
declare c public.classes;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  select * into c from public.classes where join_code = upper(trim(code));
  if not found then raise exception 'No class has that code. Check it with your teacher.'; end if;
  if c.org is not null and not public.is_org_member(c.org) then
    raise exception 'This class belongs to a school you are not part of. Ask your teacher to add you.';
  end if;
  insert into public.class_members (class_id, user_id, display_name)
    values (c.id, (select auth.uid()), left(display_name, 80))
    on conflict (class_id, user_id) do update set display_name = excluded.display_name;
  return c;
end; $$;

-- ============ sharing a design with a class ============
alter table public.designs add column if not exists shared_class uuid references public.classes (id) on delete set null;
drop policy if exists "Class members see designs shared with the class" on public.designs;
create policy "Class members see designs shared with the class" on public.designs for select to authenticated
  using (shared_class is not null and (public.is_class_member(shared_class) or public.is_class_teacher(shared_class)));

-- ============ the admin sees and fixes everything ============
drop policy if exists "Admin full access" on public.designs;
create policy "Admin full access" on public.designs for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admin full access" on public.classes;
create policy "Admin full access" on public.classes for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admin full access" on public.class_members;
create policy "Admin full access" on public.class_members for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admin full access" on public.assignments;
create policy "Admin full access" on public.assignments for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admin full access" on public.submissions;
create policy "Admin full access" on public.submissions for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admin full access" on public.org_members;
create policy "Admin full access" on public.org_members for all to authenticated using (public.is_admin()) with check (public.is_admin());
