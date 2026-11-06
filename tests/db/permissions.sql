\set ON_ERROR_STOP 1
\set QUIET 1
-- people
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a', 'tonklapc.toogle@gmail.com', now(), '{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-00000000000b', 'owner@school.test', now(), '{"full_name":"Owner"}'),
 ('00000000-0000-0000-0000-00000000000c', 'teacher@bta.opencad.invalid', now(), '{}'),
 ('00000000-0000-0000-0000-00000000000d', 's1@bta.opencad.invalid', now(), '{}'),
 ('00000000-0000-0000-0000-00000000000e', 's2@bta.opencad.invalid', now(), '{}'),
 ('00000000-0000-0000-0000-00000000000f', 'outsider@x.test', now(), '{}'),
 ('00000000-0000-0000-0000-000000000010', 'other@sisb.opencad.invalid', now(), '{}');

create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAILED: %', msg; end if; raise notice 'ok  %', msg; end $$;
create function pg_temp.fails(q text, msg text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'ok  % (blocked: %)', msg, left(sqlerrm, 70); return; end;
  raise exception 'FAILED (was allowed): %', msg;
end $$;
create function pg_temp.affected(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;

\set ADMIN '''00000000-0000-0000-0000-00000000000a'''
\set OWNER '''00000000-0000-0000-0000-00000000000b'''
\set TEACH '''00000000-0000-0000-0000-00000000000c'''
\set S1 '''00000000-0000-0000-0000-00000000000d'''
\set S2 '''00000000-0000-0000-0000-00000000000e'''
\set OUT '''00000000-0000-0000-0000-00000000000f'''
\set OTHER '''00000000-0000-0000-0000-000000000010'''

-- ===== school creation code =====
set role authenticated; select set_config('request.jwt.claim.sub', :OWNER, false), set_config('request.jwt.claim.role', 'authenticated', false) \g /dev/null
select pg_temp.fails($$select public.create_org('bta','Bangkok Test Academy','BTA','Bangkok','#2f6fd0','schoolpw1','anything')$$, 'no school can be added before the admin sets a creation code');
select pg_temp.fails($$select public.set_creation_code('letmein123')$$, 'a normal user cannot set the creation code');
select pg_temp.fails($$insert into public.orgs (slug,name,short) values ('sneaky','Sneaky School','SS')$$, 'schools cannot be inserted directly');
select pg_temp.ok((select count(*) from public.app_secrets) = 0 and (select count(*) from public.org_secrets) = 0, 'secrets tables are unreadable');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :ADMIN, false) \g /dev/null
select public.set_creation_code('MAKE-SCHOOL-2026') \g /dev/null
select pg_temp.ok(public.is_admin(), 'the confirmed admin email is recognised as admin');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :OWNER, false) \g /dev/null
select pg_temp.fails($$select public.create_org('bta','Bangkok Test Academy','BTA','Bangkok','#2f6fd0','schoolpw1','wrong-code')$$, 'a wrong creation code is refused');
select public.create_org('bta','Bangkok Test Academy','BTA','Bangkok','#2f6fd0','schoolpw1','MAKE-SCHOOL-2026') \g /dev/null
select pg_temp.ok(public.org_role('bta') = 'owner', 'the creator becomes the owner');
select pg_temp.ok((select slug from public.create_org('bta2','Second Academy','B2','','#2f6fd0','schoolpw2','MAKE-SCHOOL-2026')) = 'bta2', 'the creation code keeps working (reusable)');
select pg_temp.ok(not public.is_admin(), 'the owner is not the site admin');
select pg_temp.ok(public.check_org_password('bta','schoolpw1') and not public.check_org_password('bta','nope'), 'the organisation password is checked correctly');
select pg_temp.affected($$update public.orgs set verified = true, name = 'Bangkok Test Academy!' where slug = 'bta'$$) \g /dev/null
select pg_temp.ok((select not verified and name = 'Bangkok Test Academy!' from public.orgs where slug = 'bta'), 'the owner can rename the school but cannot verify it');
reset role;
-- members (normally created by the org-admin function with the service role)
insert into public.org_members (org, user_id, role, username, display_name) values
 ('bta', :TEACH, 'teacher', 'msl', 'Ms Lee'), ('bta', :S1, 'student', 'tonkla', 'Tonkla'), ('bta', :S2, 'student', 'pim', 'Pim'),
 ('sisb', :OTHER, 'student', 'kai', 'Kai');
select pg_temp.ok(not public.check_org_password('sisb', 'x'), 'a school without a password set opens for nobody');

-- ===== outsiders and other schools =====
set role authenticated; select set_config('request.jwt.claim.sub', :OUT, false) \g /dev/null
select pg_temp.affected($$update public.orgs set name = 'Hacked' where slug = 'bta'$$) \g /dev/null
select pg_temp.ok((select name from public.orgs where slug = 'bta') <> 'Hacked', 'an outsider cannot edit a school');
select pg_temp.ok((select count(*) from public.org_members where org = 'bta') = 0, 'an outsider cannot list a school''s people');
select pg_temp.fails($$select public.set_org_password('bta','hacked123')$$, 'an outsider cannot change the school password');
reset role;

-- ===== classes =====
set role authenticated; select set_config('request.jwt.claim.sub', :S1, false) \g /dev/null
select pg_temp.fails($$insert into public.classes (org, name) values ('bta', 'Student class')$$, 'a student cannot create a class');
select pg_temp.fails($$insert into public.classes (org, name) values (null, 'No school class')$$, 'classes outside a school cannot be created');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :TEACH, false) \g /dev/null
insert into public.classes (id, org, name, join_code) values ('11111111-1111-1111-1111-111111111111', 'bta', 'Year 9 Design', 'Y9CODE') \g /dev/null
select pg_temp.ok(true, 'a teacher can create a class');
insert into public.class_members (class_id, user_id, display_name) values ('11111111-1111-1111-1111-111111111111', :S1, 'Tonkla') \g /dev/null
select pg_temp.ok(true, 'a teacher can assign a student from the school');
select pg_temp.fails($$insert into public.class_members (class_id, user_id) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000010')$$, 'a teacher cannot assign someone from another school');
insert into public.assignments (id, class_id, title) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Keychain') \g /dev/null
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :S2, false) \g /dev/null
select pg_temp.ok((select count(*) from public.classes) = 0, 'a student not in the class cannot see it');
select pg_temp.ok((select name from public.join_class('y9code', 'Pim')) = 'Year 9 Design', 'a student of the school can join with the code');
select pg_temp.fails($$insert into public.classes (org, name) values ('bta', 'x')$$, 'a student still cannot create classes after joining');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :OTHER, false) \g /dev/null
select pg_temp.fails($$select public.join_class('Y9CODE', 'Kai')$$, 'a student from another school cannot join with the code');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :OUT, false) \g /dev/null
select pg_temp.fails($$select public.join_class('Y9CODE', 'X')$$, 'someone outside every school cannot join');
reset role;

-- ===== designs: private unless shared =====
set role authenticated; select set_config('request.jwt.claim.sub', :S1, false) \g /dev/null
insert into public.designs (id, name, doc) values ('33333333-3333-3333-3333-333333333333', 'Tonkla private', '{}') \g /dev/null
insert into public.designs (id, name, doc) values ('44444444-4444-4444-4444-444444444444', 'Tonkla for class', '{}') \g /dev/null
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :S2, false) \g /dev/null
select pg_temp.ok((select count(*) from public.designs) = 0, 'a classmate cannot see designs that are not shared');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :S1, false) \g /dev/null
update public.designs set shared_class = '11111111-1111-1111-1111-111111111111' where id = '44444444-4444-4444-4444-444444444444';
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :S2, false) \g /dev/null
select pg_temp.ok((select array_agg(name) from public.designs) = array['Tonkla for class'], 'a classmate sees only the design shared with the class');
select pg_temp.ok(pg_temp.affected($$update public.designs set name = 'vandalised'$$) = 0, 'a classmate cannot change a shared design');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :TEACH, false) \g /dev/null
select pg_temp.ok((select count(*) from public.designs where name = 'Tonkla for class') = 1 and (select count(*) from public.designs where name = 'Tonkla private') = 0, 'the teacher sees the class-shared design, not the private one');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :OUT, false) \g /dev/null
select pg_temp.ok((select count(*) from public.designs) = 0, 'an outsider sees no designs');
reset role;

-- ===== submissions and grading =====
set role authenticated; select set_config('request.jwt.claim.sub', :S1, false) \g /dev/null
insert into public.submissions (id, assignment_id, name, doc) values ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'My keychain', '{}') \g /dev/null
update public.submissions set grade = 'A+' where id = '55555555-5555-5555-5555-555555555555';
select pg_temp.ok((select grade is null from public.submissions), 'a student cannot grade their own work');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :S2, false) \g /dev/null
select pg_temp.ok((select count(*) from public.submissions) = 0, 'a classmate cannot see another student''s submission');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :TEACH, false) \g /dev/null
update public.submissions set grade = '7/8', feedback = 'Nice', doc = '{"hacked":true}' where id = '55555555-5555-5555-5555-555555555555';
select pg_temp.ok((select grade = '7/8' and doc = '{}'::jsonb from public.submissions), 'the teacher can grade but cannot change the student''s work');
reset role;

-- ===== the owner and the admin =====
set role authenticated; select set_config('request.jwt.claim.sub', :OWNER, false) \g /dev/null
select pg_temp.ok((select count(*) from public.classes where org = 'bta') = 1, 'the owner sees every class in the school');
select pg_temp.ok((select count(*) from public.org_members where org = 'bta') = 4, 'the owner sees everyone in the school');
select pg_temp.ok((select count(*) from public.submissions) = 1, 'the owner can see submissions in the school');
select public.set_org_password('bta', 'newpassword') \g /dev/null
select pg_temp.ok(public.check_org_password('bta', 'newpassword'), 'the owner can change the school password');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :ADMIN, false) \g /dev/null
select pg_temp.ok((select count(*) from public.designs) = 2 and (select count(*) from public.org_members) >= 6, 'the admin sees everything');
update public.orgs set verified = true where slug = 'bta';
select pg_temp.ok((select verified from public.orgs where slug = 'bta'), 'the admin can verify a school');
reset role;
-- an unconfirmed copy of the admin email is NOT admin
update auth.users set email_confirmed_at = null where id = :ADMIN;
set role authenticated; select set_config('request.jwt.claim.sub', :ADMIN, false) \g /dev/null
select pg_temp.ok(not public.is_admin(), 'the admin email without a confirmed address is not admin');
reset role;
select 'ALL PERMISSION TESTS PASSED' as result;
