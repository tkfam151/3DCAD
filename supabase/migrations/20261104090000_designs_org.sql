-- OpenCAD Studio: designs can belong to a school space (e.g. 'sisb' for /3DCAD/org/sisb/).
-- Safe to run more than once. Run after 20261103090000_designs.sql.

alter table public.designs add column if not exists org text
  check (org is null or org ~ '^[a-z0-9-]{1,40}$');

create index if not exists designs_user_org_updated_idx on public.designs (user_id, org, updated_at desc);
