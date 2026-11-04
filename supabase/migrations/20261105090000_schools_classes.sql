-- OpenCAD Studio: school directory, classes, assignments, submissions and share links.
-- Run after 20261103090000_designs.sql and 20261104090000_designs_org.sql. Safe to run more than once.

-- ============ schools (directory) ============
create table if not exists public.orgs (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (char_length(name) between 3 and 120),
  short text not null check (char_length(short) between 1 and 12),
  city text check (city is null or char_length(city) <= 80),
  color text not null default '#3b8cff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  verified boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.orgs enable row level security;

insert into public.orgs (slug, name, short, city, color, verified, created_by)
values ('sisb', 'Singapore International School of Bangkok', 'SISB', 'Bangkok, Thailand', '#c8102e', true, null)
on conflict (slug) do nothing;

drop policy if exists "Anyone can see the school directory" on public.orgs;
create policy "Anyone can see the school directory" on public.orgs for select to anon, authenticated using (true);
drop policy if exists "Signed-in users can add a school" on public.orgs;
create policy "Signed-in users can add a school" on public.orgs for insert to authenticated
  with check ((select auth.uid()) = created_by and verified = false);
drop policy if exists "Creators can edit their school" on public.orgs;
create policy "Creators can edit their school" on public.orgs for update to authenticated
  using ((select auth.uid()) = created_by) with check ((select auth.uid()) = created_by);
drop policy if exists "Creators can remove their school" on public.orgs;
create policy "Creators can remove their school" on public.orgs for delete to authenticated
  using ((select auth.uid()) = created_by and verified = false);

-- only the project owner (service role / SQL editor) can verify a school or change its address
create or replace function public.orgs_protect() returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then
    new.verified := old.verified;
    new.slug := old.slug;
    new.created_by := old.created_by;
  end if;
  return new;
end; $$;
drop trigger if exists orgs_protect on public.orgs;
create trigger orgs_protect before update on public.orgs for each row execute function public.orgs_protect();

-- ============ classes ============
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  org text check (org is null or org ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  teacher_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  teacher_name text check (teacher_name is null or char_length(teacher_name) <= 80),
  join_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  created_at timestamptz not null default now()
);
create table if not exists public.class_members (
  class_id uuid not null references public.classes (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  joined_at timestamptz not null default now(),
  primary key (class_id, user_id)
);
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  instructions text check (instructions is null or char_length(instructions) <= 4000),
  due_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  student_name text check (student_name is null or char_length(student_name) <= 80),
  name text not null default 'Design' check (char_length(name) between 1 and 200),
  doc jsonb not null,
  thumb text check (thumb is null or char_length(thumb) < 400000),
  submitted_at timestamptz not null default now(),
  feedback text check (feedback is null or char_length(feedback) <= 4000),
  grade text check (grade is null or char_length(grade) <= 20),
  reviewed_at timestamptz,
  unique (assignment_id, student_id)
);
create index if not exists class_members_user_idx on public.class_members (user_id);
create index if not exists assignments_class_idx on public.assignments (class_id, due_at);
create index if not exists submissions_assignment_idx on public.submissions (assignment_id);
create index if not exists submissions_student_idx on public.submissions (student_id);

-- helpers (security definer avoids recursive policies)
create or replace function public.is_class_teacher(cid uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classes c where c.id = cid and c.teacher_id = (select auth.uid()));
$$;
create or replace function public.is_class_member(cid uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.class_members m where m.class_id = cid and m.user_id = (select auth.uid()));
$$;
create or replace function public.assignment_class(aid uuid) returns uuid
  language sql stable security definer set search_path = '' as $$
  select a.class_id from public.assignments a where a.id = aid;
$$;

alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;

-- classes
drop policy if exists "Teachers and members see a class" on public.classes;
create policy "Teachers and members see a class" on public.classes for select to authenticated
  using (teacher_id = (select auth.uid()) or public.is_class_member(id));
drop policy if exists "Anyone signed in can start a class" on public.classes;
create policy "Anyone signed in can start a class" on public.classes for insert to authenticated
  with check (teacher_id = (select auth.uid()));
drop policy if exists "Teachers edit their class" on public.classes;
create policy "Teachers edit their class" on public.classes for update to authenticated
  using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
drop policy if exists "Teachers delete their class" on public.classes;
create policy "Teachers delete their class" on public.classes for delete to authenticated
  using (teacher_id = (select auth.uid()));

-- members (joining happens through join_class())
drop policy if exists "Members and teachers see the class list" on public.class_members;
create policy "Members and teachers see the class list" on public.class_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_class_teacher(class_id));
drop policy if exists "Students leave, teachers remove" on public.class_members;
create policy "Students leave, teachers remove" on public.class_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_class_teacher(class_id));

create or replace function public.join_class(code text, display_name text default null)
  returns public.classes language plpgsql security definer set search_path = '' as $$
declare c public.classes;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  select * into c from public.classes where join_code = upper(trim(code));
  if not found then raise exception 'No class has that code. Check it with your teacher.'; end if;
  insert into public.class_members (class_id, user_id, display_name)
    values (c.id, (select auth.uid()), left(display_name, 80))
    on conflict (class_id, user_id) do update set display_name = excluded.display_name;
  return c;
end; $$;
revoke all on function public.join_class(text, text) from public, anon;
grant execute on function public.join_class(text, text) to authenticated;

-- assignments
drop policy if exists "Class sees its assignments" on public.assignments;
create policy "Class sees its assignments" on public.assignments for select to authenticated
  using (public.is_class_teacher(class_id) or public.is_class_member(class_id));
drop policy if exists "Teachers manage assignments" on public.assignments;
create policy "Teachers manage assignments" on public.assignments for all to authenticated
  using (public.is_class_teacher(class_id)) with check (public.is_class_teacher(class_id));

-- submissions
drop policy if exists "Students and their teacher see submissions" on public.submissions;
create policy "Students and their teacher see submissions" on public.submissions for select to authenticated
  using (student_id = (select auth.uid()) or public.is_class_teacher(public.assignment_class(assignment_id)));
drop policy if exists "Students submit to their class" on public.submissions;
create policy "Students submit to their class" on public.submissions for insert to authenticated
  with check (student_id = (select auth.uid()) and public.is_class_member(public.assignment_class(assignment_id)));
drop policy if exists "Students resubmit, teachers review" on public.submissions;
create policy "Students resubmit, teachers review" on public.submissions for update to authenticated
  using (student_id = (select auth.uid()) or public.is_class_teacher(public.assignment_class(assignment_id)))
  with check (student_id = (select auth.uid()) or public.is_class_teacher(public.assignment_class(assignment_id)));
drop policy if exists "Students withdraw their submission" on public.submissions;
create policy "Students withdraw their submission" on public.submissions for delete to authenticated
  using (student_id = (select auth.uid()));

-- students can't grade themselves; teachers can't change a student's work
create or replace function public.submissions_protect() returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then return new; end if;
  if (select auth.uid()) = old.student_id and not public.is_class_teacher(public.assignment_class(old.assignment_id)) then
    new.feedback := old.feedback; new.grade := old.grade; new.reviewed_at := old.reviewed_at;
    new.submitted_at := now();
  else
    new.doc := old.doc; new.thumb := old.thumb; new.name := old.name; new.student_name := old.student_name;
    new.submitted_at := old.submitted_at; new.reviewed_at := now();
  end if;
  new.student_id := old.student_id; new.assignment_id := old.assignment_id;
  return new;
end; $$;
drop trigger if exists submissions_protect on public.submissions;
create trigger submissions_protect before update on public.submissions for each row execute function public.submissions_protect();

-- ============ share links for designs ============
alter table public.designs add column if not exists shared boolean not null default false;
drop policy if exists "Anyone with the link can view a shared design" on public.designs;
create policy "Anyone with the link can view a shared design" on public.designs for select to anon, authenticated
  using (shared = true);
