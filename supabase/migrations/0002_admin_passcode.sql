-- ═══════════════════════════════════════════════════════════════════════════
--  Admin by passcode: any signed-in member who enters the team admin passcode
--  becomes an Admin. The passcode is checked HERE, on the server, so editing
--  the app in a browser cannot grant the role. Safe to re-run.
--
--  Rotate the passcode (SQL Editor):
--    update private.admin_passcode
--       set sha256 = encode(sha256(convert_to(upper('NEWCODE'), 'UTF8')), 'hex');
--  (and change PASSCODE_SHA256 in src/components/admin/PasscodeGate.tsx, which
--   only controls the lock screen).
-- ═══════════════════════════════════════════════════════════════════════════

-- Not exposed through the API: only security-definer functions can read it.
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table if not exists private.admin_passcode (
  id boolean primary key default true check (id),
  sha256 text not null
);
-- default passcode SSTI (stored uppercase, hashed); keeps a rotated code on re-run
insert into private.admin_passcode (id, sha256)
values (true, 'c750ae35005d3181ddf3f2a6763c1189a934b5884539f46c630e1ca02019c903')
on conflict (id) do nothing;

-- Wrong guesses are rate-limited per account (5 per 15 minutes).
create table if not exists private.admin_claim_attempts (
  id bigserial primary key,
  user_id uuid not null,
  at timestamptz not null default now(),
  ok boolean not null
);
create index if not exists admin_claim_attempts_user_at on private.admin_claim_attempts (user_id, at);

create or replace function public.claim_admin(p_passcode text) returns public.app_role
language plpgsql volatile security definer set search_path = public, private as $$
declare
  uid uuid := auth.uid();
  want text;
  fails int;
  cur public.app_role;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select role into cur from public.profiles where id = uid and deleted_at is null;
  if cur is null then
    raise exception 'no profile for this account' using errcode = '42501';
  end if;
  if cur = 'admin' then
    return cur;
  end if;
  select count(*) into fails from private.admin_claim_attempts
   where user_id = uid and not ok and at > now() - interval '15 minutes';
  if fails >= 5 then
    raise exception 'too many wrong passcodes, try again in 15 minutes' using errcode = '42501';
  end if;
  select sha256 into want from private.admin_passcode where id;
  if want is null
     or encode(sha256(convert_to(upper(btrim(coalesce(p_passcode, ''))), 'UTF8')), 'hex') <> want then
    insert into private.admin_claim_attempts (user_id, ok) values (uid, false);
    return null; -- wrong passcode (the attempt is recorded)
  end if;
  insert into private.admin_claim_attempts (user_id, ok) values (uid, true);
  -- runs as the function owner, so profiles_guard treats it as trusted;
  -- the audit trigger still records who became admin
  update public.profiles set role = 'admin' where id = uid;
  return 'admin';
end $$;

revoke execute on function public.claim_admin(text) from public;
revoke execute on function public.claim_admin(text) from anon;
grant execute on function public.claim_admin(text) to authenticated;
