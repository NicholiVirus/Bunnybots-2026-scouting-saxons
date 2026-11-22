-- ═══════════════════════════════════════════════════════════════════════════
--  Harvest Havoc Scouting — schema, Row-Level Security, triggers, RPCs
--  Saxon Robotics (FRC 611 + FRC 526) @ Blair BunnyBots 2026
--
--  Run once in Supabase → SQL Editor (or `supabase db push`). Safe to re-run
--  on an empty project. Every table has RLS ON; the policies below are the
--  ONLY way data can be read or written with the public (anon) key.
--
--  Roles (public.profiles.role):
--    admin       everything incl. users/roles, results, settings, audit log
--    strategist  + picklists, draft board, strategy notes, catalog, rotations
--    scout       + own scouting / pit submissions, photos, pick votes
--    viewer      read-only (default for new sign-ups)
--    public      (not signed in) → only get_public_board(token) when enabled
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Roles & helpers ────────────────────────────────────────────────────────
do $$ begin
  create type public.app_role as enum ('admin', 'strategist', 'scout', 'viewer');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  email text,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and deleted_at is null
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

create or replace function public.is_strategist() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('admin', 'strategist'), false)
$$;

create or replace function public.is_scout() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('admin', 'strategist', 'scout'), false)
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_app_role() is not null
$$;

-- updated_at is always SERVER time (clients pull with updated_at >= cursor)
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

-- ── New user → profile (first account ever becomes admin) ──────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_account boolean;
begin
  select not exists (select 1 from public.profiles) into first_account;
  insert into public.profiles (id, display_name, email, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''),
             nullif(new.raw_user_meta_data ->> 'name', ''),
             split_part(coalesce(new.email, ''), '@', 1)),
    new.email,
    case when first_account then 'admin'::public.app_role else 'viewer'::public.app_role end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change roles; the last admin cannot be demoted.
create or replace function public.profiles_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- SQL Editor / migrations / service role are trusted; API users are checked.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.role is distinct from old.role then
    if not public.is_admin() then
      raise exception 'only an admin can change roles' using errcode = '42501';
    end if;
    if old.role = 'admin' and new.role <> 'admin'
       and (select count(*) from public.profiles where role = 'admin' and deleted_at is null) <= 1 then
      raise exception 'cannot remove the last admin' using errcode = '42501';
    end if;
  end if;
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'id/email are read-only' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ── Audit log (admin read-only; written only by triggers) ──────────────────
create table if not exists public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  table_name text not null,
  row_key text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_row jsonb,
  new_row jsonb
);

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  key_col text := coalesce(tg_argv[0], 'id');
  actor uuid := auth.uid();
  aname text;
  o jsonb;
  n jsonb;
begin
  select display_name into aname from public.profiles where id = actor;
  if tg_op = 'DELETE' then
    o := to_jsonb(old);
    insert into public.audit_log (actor_id, actor_name, table_name, row_key, action, old_row)
    values (actor, aname, tg_table_name, o ->> key_col, 'delete', o);
    return old;
  end if;
  n := to_jsonb(new);
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    -- skip no-op re-upserts (e.g. the results poller re-sending identical rows)
    if (o - 'updated_at') = (n - 'updated_at') then
      return new;
    end if;
    insert into public.audit_log (actor_id, actor_name, table_name, row_key, action, old_row, new_row)
    values (actor, aname, tg_table_name, n ->> key_col, 'update', o, n);
  else
    insert into public.audit_log (actor_id, actor_name, table_name, row_key, action, new_row)
    values (actor, aname, tg_table_name, n ->> key_col, 'insert', n);
  end if;
  return new;
end $$;

-- ── Teams & aliases ────────────────────────────────────────────────────────
create table if not exists public.teams (
  id text primary key,
  number int not null,
  name text not null default '',
  status text not null default 'confirmed' check (status in ('confirmed', 'expected', 'withdrawn')),
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.team_aliases (
  alias text primary key,
  team_id text not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ── Official results ───────────────────────────────────────────────────────
create table if not exists public.matches (
  key text primary key,
  comp_level text not null check (comp_level in ('qm', 'po')),
  match_number int not null,
  label text not null,
  red text[] not null default '{}',
  blue text[] not null default '{}',
  scheduled_time text,
  played boolean not null default false,
  red_score int,
  blue_score int,
  breakdown jsonb,
  winner text check (winner in ('red', 'blue', 'tie')),
  dq text[] default '{}',
  source text not null default 'manual' check (source in ('api', 'manual', 'csv', 'demo')),
  locked boolean not null default false,
  warnings text[] default '{}',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.rankings (
  team_id text primary key,
  rank int not null,
  ranking_score numeric not null default 0,
  ranking_total numeric not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  ties int not null default 0,
  dq int not null default 0,
  matches_played int not null default 0,
  avg_match numeric not null default 0,
  source text not null default 'api',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.official_alliances (
  number int primary key,
  captain text,
  first_pick text,
  second_pick text,
  source text not null default 'api',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Raw API responses kept for replay / debugging
create table if not exists public.api_snapshots (
  id bigserial primary key,
  endpoint text not null,
  fetched_at timestamptz not null default now(),
  hash text not null,
  payload jsonb not null
);

-- ── Scouting ───────────────────────────────────────────────────────────────
create table if not exists public.scout_submissions (
  id uuid primary key,
  match_key text not null,
  alliance text not null check (alliance in ('red', 'blue')),
  teams text[] not null,
  stations text[] not null,
  robot_count int not null check (robot_count between 1 and 3),
  scout_id uuid references public.profiles (id) on delete set null,
  scout_name text not null default '',
  device_id text not null default '',
  status text not null default 'draft' check (status in ('draft', 'live', 'submitted')),
  started_at bigint,
  submitted_at timestamptz,
  source text not null default 'app' check (source in ('app', 'qr', 'qrscout')),
  discarded boolean not null default false,
  discard_reason text,
  app_version text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists scout_submissions_match_idx on public.scout_submissions (match_key);
create index if not exists scout_submissions_updated_idx on public.scout_submissions (updated_at);

create table if not exists public.robot_reports (
  id text primary key,
  submission_id uuid not null references public.scout_submissions (id) on delete cascade,
  team_id text not null,
  station text not null,
  note text not null default '',
  driver_rating int check (driver_rating between 1 and 5),
  defense_played boolean not null default false,
  defense_type text check (defense_type in ('thief', 'defense_oz', 'defense_nz')),
  defense_rating int check (defense_rating between 1 and 5),
  flags text[] not null default '{}',
  mechanisms jsonb not null default '{}',
  rank_quickness int,
  rank_awareness int,
  rank_defense_resistance int,
  viewed boolean not null default false,
  totals_override jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists robot_reports_submission_idx on public.robot_reports (submission_id);

create table if not exists public.scout_events (
  id uuid primary key,
  submission_id uuid not null references public.scout_submissions (id) on delete cascade,
  team_id text not null,
  t_ms int not null check (t_ms >= 0),
  phase text not null check (phase in ('auto', 'teleop', 'endgame')),
  action text not null check (action in ('score', 'intake', 'drop', 'handoff', 'park', 'haul', 'flag', 'revive', 'taxi')),
  piece text check (piece in ('carrot', 'cake')),
  target text check (target in ('L1', 'L2', 'L3', 'oven', 'haul')),
  detail text
);
create index if not exists scout_events_submission_idx on public.scout_events (submission_id);

-- Only admins can discard / restore a submission.
create or replace function public.submissions_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (new.discarded is distinct from old.discarded or new.discard_reason is distinct from old.discard_reason)
     and not public.is_admin() then
    raise exception 'only an admin can discard submissions' using errcode = '42501';
  end if;
  return new;
end $$;

-- ── Pit scouting / catalog ─────────────────────────────────────────────────
create table if not exists public.pit_reports (
  id uuid primary key,
  team_id text not null,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null default '',
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists pit_reports_team_idx on public.pit_reports (team_id);

create table if not exists public.photos (
  id uuid primary key,
  team_id text not null,
  storage_path text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_by_name text not null default '',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ── Strategy / alliance selection ──────────────────────────────────────────
create table if not exists public.picklist_meta (
  picking_team text primary key,
  locked boolean not null default false,
  locked_by uuid,
  locked_at timestamptz,
  weights_first jsonb,
  weights_second jsonb,
  captain_guesses jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create or replace function public.picklist_locked(pt text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select locked from public.picklist_meta where picking_team = pt), false)
$$;

-- Strategists may lock; only admins may unlock.
create or replace function public.picklist_meta_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.locked and not new.locked and not public.is_admin() then
    raise exception 'only an admin can unlock a pick list' using errcode = '42501';
  end if;
  return new;
end $$;

create table if not exists public.picklist_entries (
  id text primary key,
  picking_team text not null,
  team_id text not null,
  tier text not null check (tier in ('first', 'second', 'dnp')),
  position double precision not null default 0,
  note text,
  dnp_reason text check (dnp_reason in ('unreliable', 'fouls', 'tippy', 'damaged_others', 'cant_score', 'other')),
  dnp_note text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- every Do-Not-Pick needs a reason tag
  constraint dnp_needs_reason check (tier <> 'dnp' or deleted_at is not null or dnp_reason is not null)
);
create index if not exists picklist_entries_team_idx on public.picklist_entries (picking_team);

create table if not exists public.picklist_votes (
  id text primary key,
  picking_team text not null,
  team_id text not null,
  user_id uuid not null,
  user_name text not null default '',
  value int not null check (value in (-1, 1)),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.picklist_snapshots (
  id uuid primary key,
  picking_team text not null,
  name text not null,
  entries jsonb not null,
  created_by uuid,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.draft_actions (
  id uuid primary key,
  seq double precision not null,
  action text not null check (action in ('pick', 'decline', 'captain', 'config')),
  alliance int,
  team_id text,
  payload jsonb,
  created_by uuid,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.strategy_notes (
  match_key text primary key,
  note text not null default '',
  plan jsonb not null default '{}',
  updated_by uuid,
  updated_by_name text not null default '',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.pit_checks (
  team_id text primary key,
  status text check (status in ('healthy', 'concern')),
  note text not null default '',
  checked_by uuid,
  checked_by_name text not null default '',
  checked_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.scout_assignments (
  id text primary key,
  match_key text not null,
  scout_id uuid,
  scout_name text not null default '',
  alliance text not null check (alliance in ('red', 'blue')),
  teams text[] not null default '{}',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.settings (
  key text primary key,
  value jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ── updated_at triggers ────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'teams', 'team_aliases', 'matches', 'rankings', 'official_alliances',
    'scout_submissions', 'robot_reports', 'pit_reports', 'photos', 'picklist_meta',
    'picklist_entries', 'picklist_votes', 'picklist_snapshots', 'draft_actions',
    'strategy_notes', 'pit_checks', 'scout_assignments', 'settings'
  ] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before insert or update on public.%1$I
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

drop trigger if exists submissions_guard on public.scout_submissions;
create trigger submissions_guard before update on public.scout_submissions
  for each row execute function public.submissions_guard();

drop trigger if exists picklist_meta_guard on public.picklist_meta;
create trigger picklist_meta_guard before update on public.picklist_meta
  for each row execute function public.picklist_meta_guard();

-- ── Audit triggers: results, picklist, teams, catalog, roles, settings ─────
do $$
declare
  spec text[];
begin
  foreach spec slice 1 in array array[
    array['matches', 'key'], array['official_alliances', 'number'], array['teams', 'id'],
    array['team_aliases', 'alias'], array['picklist_entries', 'id'], array['picklist_meta', 'picking_team'],
    array['pit_reports', 'id'], array['photos', 'id'], array['settings', 'key'], array['profiles', 'id']
  ] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', spec[1]);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_trigger(%2$L)', spec[1], spec[2]);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  ROW-LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'audit_log', 'teams', 'team_aliases', 'matches', 'rankings', 'official_alliances',
    'api_snapshots', 'scout_submissions', 'robot_reports', 'scout_events', 'pit_reports', 'photos',
    'picklist_meta', 'picklist_entries', 'picklist_votes', 'picklist_snapshots', 'draft_actions',
    'strategy_notes', 'pit_checks', 'scout_assignments', 'settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- (not FORCE: SECURITY DEFINER helpers owned by postgres must bypass RLS
    --  to read roles without recursing into the profiles policies)
    -- defense in depth: the anon (not signed in) role gets no direct table access
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Drop-and-create helper so re-running this file stays clean
create or replace function pg_temp.reset_policies(tbl text) returns void language plpgsql as $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = tbl loop
    execute format('drop policy %I on public.%I', p.policyname, tbl);
  end loop;
end $$;

-- profiles: members read names/roles; you edit your own display name; admins edit roles
select pg_temp.reset_policies('profiles');
revoke all on public.profiles from authenticated;
grant select (id, display_name, role, created_at, updated_at, deleted_at) on public.profiles to authenticated;
grant update (display_name, role) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated using (public.is_member());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- audit_log: admins read; nobody writes directly
select pg_temp.reset_policies('audit_log');
create policy audit_select on public.audit_log for select to authenticated using (public.is_admin());

-- Admin-written, member-readable tables
do $$
declare t text;
begin
  foreach t in array array['teams', 'team_aliases', 'matches', 'rankings', 'official_alliances', 'settings'] loop
    perform pg_temp.reset_policies(t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_member())', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.is_admin())', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- api_snapshots: admin writes, strategists+ read
select pg_temp.reset_policies('api_snapshots');
create policy api_snapshots_select on public.api_snapshots for select to authenticated using (public.is_strategist());
create policy api_snapshots_insert on public.api_snapshots for insert to authenticated with check (public.is_admin());

-- scout_submissions: scouts write THEIR OWN; strategists+ may file on behalf of
-- others (QR import from offline scouts); only admins delete / discard.
select pg_temp.reset_policies('scout_submissions');
create policy subs_select on public.scout_submissions for select to authenticated using (public.is_member());
create policy subs_insert on public.scout_submissions for insert to authenticated
  with check (public.is_scout() and (scout_id = auth.uid() or public.is_strategist()));
create policy subs_update on public.scout_submissions for update to authenticated
  using (public.is_scout() and (scout_id = auth.uid() or public.is_strategist()))
  with check (public.is_scout() and (scout_id = auth.uid() or public.is_strategist()));
create policy subs_delete on public.scout_submissions for delete to authenticated using (public.is_admin());

create or replace function public.can_write_submission(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.scout_submissions s
    where s.id = sid and public.is_scout() and (s.scout_id = auth.uid() or public.is_strategist())
  )
$$;

do $$
declare t text;
begin
  foreach t in array array['robot_reports', 'scout_events'] loop
    perform pg_temp.reset_policies(t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_member())', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.can_write_submission(submission_id))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.can_write_submission(submission_id)) with check (public.can_write_submission(submission_id))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.can_write_submission(submission_id))', t);
  end loop;
end $$;

-- pit_reports: scouts add/edit their own; strategists+ edit any (team catalog)
select pg_temp.reset_policies('pit_reports');
create policy pit_select on public.pit_reports for select to authenticated using (public.is_member());
create policy pit_insert on public.pit_reports for insert to authenticated
  with check (public.is_scout() and (author_id = auth.uid() or public.is_strategist()));
create policy pit_update on public.pit_reports for update to authenticated
  using (public.is_strategist() or (public.is_scout() and author_id = auth.uid()))
  with check (public.is_strategist() or (public.is_scout() and author_id = auth.uid()));
create policy pit_delete on public.pit_reports for delete to authenticated using (public.is_strategist());

-- photos: scouts upload; uploader or strategists+ edit/delete
select pg_temp.reset_policies('photos');
create policy photos_select on public.photos for select to authenticated using (public.is_member());
create policy photos_insert on public.photos for insert to authenticated
  with check (public.is_scout() and (uploaded_by = auth.uid() or public.is_strategist()));
create policy photos_update on public.photos for update to authenticated
  using (public.is_strategist() or (public.is_scout() and uploaded_by = auth.uid()))
  with check (public.is_strategist() or (public.is_scout() and uploaded_by = auth.uid()));
create policy photos_delete on public.photos for delete to authenticated using (public.is_strategist());

-- picklist_meta: strategists+ (unlock guarded by trigger)
select pg_temp.reset_policies('picklist_meta');
create policy plmeta_select on public.picklist_meta for select to authenticated using (public.is_member());
create policy plmeta_insert on public.picklist_meta for insert to authenticated with check (public.is_strategist());
create policy plmeta_update on public.picklist_meta for update to authenticated
  using (public.is_strategist()) with check (public.is_strategist());

-- picklist_entries: strategists+ while unlocked; admins always
select pg_temp.reset_policies('picklist_entries');
create policy pl_select on public.picklist_entries for select to authenticated using (public.is_member());
create policy pl_insert on public.picklist_entries for insert to authenticated
  with check (public.is_admin() or (public.is_strategist() and not public.picklist_locked(picking_team)));
create policy pl_update on public.picklist_entries for update to authenticated
  using (public.is_admin() or (public.is_strategist() and not public.picklist_locked(picking_team)))
  with check (public.is_admin() or (public.is_strategist() and not public.picklist_locked(picking_team)));
create policy pl_delete on public.picklist_entries for delete to authenticated
  using (public.is_admin() or (public.is_strategist() and not public.picklist_locked(picking_team)));

-- picklist_votes: scouts+ vote with their own rows ("karma" — never reorders)
select pg_temp.reset_policies('picklist_votes');
create policy votes_select on public.picklist_votes for select to authenticated using (public.is_member());
create policy votes_insert on public.picklist_votes for insert to authenticated
  with check (public.is_scout() and user_id = auth.uid());
create policy votes_update on public.picklist_votes for update to authenticated
  using (public.is_scout() and user_id = auth.uid()) with check (public.is_scout() and user_id = auth.uid());
create policy votes_delete on public.picklist_votes for delete to authenticated
  using (public.is_scout() and user_id = auth.uid());

-- Strategist-written, member-readable tables
do $$
declare t text;
begin
  foreach t in array array['picklist_snapshots', 'draft_actions', 'strategy_notes', 'pit_checks', 'scout_assignments'] loop
    perform pg_temp.reset_policies(t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_member())', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.is_strategist())', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.is_strategist()) with check (public.is_strategist())', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.is_strategist())', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- Atomic scouting upload: submission + per-robot reports + full event log.
-- SECURITY INVOKER → every statement inside is still checked by RLS.
create or replace function public.submit_scouting(p jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  s jsonb := p -> 'submission';
  sid uuid := (s ->> 'id')::uuid;
begin
  insert into public.scout_submissions (
    id, match_key, alliance, teams, stations, robot_count, scout_id, scout_name, device_id,
    status, started_at, submitted_at, source, discarded, discard_reason, app_version, created_at, deleted_at
  )
  select r.id, r.match_key, r.alliance, r.teams, r.stations, r.robot_count, r.scout_id, r.scout_name, r.device_id,
         r.status, r.started_at, r.submitted_at, r.source, r.discarded, r.discard_reason, r.app_version,
         coalesce(r.created_at, now()), r.deleted_at
  from jsonb_populate_record(null::public.scout_submissions, s) r
  on conflict (id) do update set
    match_key = excluded.match_key, alliance = excluded.alliance, teams = excluded.teams,
    stations = excluded.stations, robot_count = excluded.robot_count, scout_name = excluded.scout_name,
    device_id = excluded.device_id, status = excluded.status, started_at = excluded.started_at,
    submitted_at = excluded.submitted_at, source = excluded.source, app_version = excluded.app_version,
    deleted_at = excluded.deleted_at;

  delete from public.scout_events where submission_id = sid;
  delete from public.robot_reports where submission_id = sid;

  insert into public.robot_reports (
    id, submission_id, team_id, station, note, driver_rating, defense_played, defense_type, defense_rating,
    flags, mechanisms, rank_quickness, rank_awareness, rank_defense_resistance, viewed, totals_override
  )
  select r.id, sid, r.team_id, r.station, coalesce(r.note, ''), r.driver_rating, coalesce(r.defense_played, false),
         r.defense_type, r.defense_rating, coalesce(r.flags, '{}'), coalesce(r.mechanisms, '{}'),
         r.rank_quickness, r.rank_awareness, r.rank_defense_resistance, coalesce(r.viewed, false), r.totals_override
  from jsonb_populate_recordset(null::public.robot_reports, coalesce(p -> 'reports', '[]')) r;

  insert into public.scout_events (id, submission_id, team_id, t_ms, phase, action, piece, target, detail)
  select r.id, sid, r.team_id, r.t_ms, r.phase, r.action, r.piece, r.target, r.detail
  from jsonb_populate_recordset(null::public.scout_events, coalesce(p -> 'events', '[]')) r;
end $$;

-- Admin-only: list accounts with e-mails (emails are hidden from other members)
create or replace function public.admin_list_profiles()
returns table (id uuid, display_name text, email text, role public.app_role, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query select p.id, p.display_name, p.email, p.role, p.created_at
               from public.profiles p where p.deleted_at is null order by p.created_at;
end $$;

-- Public, read-only alliance-selection board (share link). Returns NULL unless
-- an admin enabled it AND the token matches. Never returns notes or DNP reasons.
create or replace function public.get_public_board(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb;
begin
  select value into cfg from public.settings where key = 'public_board' and deleted_at is null;
  if cfg is null
     or coalesce((cfg ->> 'enabled')::boolean, false) = false
     or coalesce(cfg ->> 'token', '') = ''
     or p_token is null
     or cfg ->> 'token' <> p_token then
    return null;
  end if;
  return jsonb_build_object(
    'generated_at', now(),
    'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'number', t.number, 'name', t.name, 'status', t.status)), '[]'::jsonb)
              from public.teams t where t.deleted_at is null),
    'rankings', (select coalesce(jsonb_agg(to_jsonb(r) - 'deleted_at'), '[]'::jsonb) from public.rankings r where r.deleted_at is null),
    'official_alliances', (select coalesce(jsonb_agg(to_jsonb(a) - 'deleted_at'), '[]'::jsonb) from public.official_alliances a where a.deleted_at is null),
    'draft_actions', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'seq', d.seq, 'action', d.action, 'alliance', d.alliance,
                        'team_id', d.team_id, 'payload', d.payload) order by d.seq), '[]'::jsonb)
                      from public.draft_actions d where d.deleted_at is null),
    'picklists', (select coalesce(jsonb_agg(jsonb_build_object('picking_team', e.picking_team, 'team_id', e.team_id, 'tier', e.tier,
                    'position', e.position) order by e.picking_team, e.position), '[]'::jsonb)
                  from public.picklist_entries e where e.deleted_at is null and e.tier <> 'dnp'),
    'alliance_count', (select value from public.settings where key = 'alliance_count' and deleted_at is null)
  );
end $$;

-- Tiny no-data heartbeat for the GitHub Actions keepalive (keeps Free projects awake)
create or replace function public.keepalive() returns timestamptz
language sql stable security definer set search_path = public as $$ select now() $$;

revoke execute on function public.get_public_board(text) from public;
revoke execute on function public.keepalive() from public;
revoke execute on function public.admin_list_profiles() from public;
revoke execute on function public.submit_scouting(jsonb) from public;
grant execute on function public.get_public_board(text) to anon, authenticated;
grant execute on function public.keepalive() to anon, authenticated;
grant execute on function public.admin_list_profiles() to authenticated;
grant execute on function public.submit_scouting(jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
--  STORAGE (robot photos + branding). Buckets are public-READ (photos of robots
--  are not secret and must load offline from cache); writes are role-checked.
-- ═══════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('robot-photos', 'robot-photos', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 8388608,
        array['image/svg+xml', 'image/png', 'image/gif', 'video/mp4', 'video/webm', 'application/json'])
on conflict (id) do nothing;

drop policy if exists "robot photos: scouts upload" on storage.objects;
drop policy if exists "robot photos: owner or strategist delete" on storage.objects;
drop policy if exists "robot photos: owner or strategist update" on storage.objects;
drop policy if exists "branding: admin insert" on storage.objects;
drop policy if exists "branding: admin update" on storage.objects;
drop policy if exists "branding: admin delete" on storage.objects;

create policy "robot photos: scouts upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'robot-photos' and public.is_scout());
create policy "robot photos: owner or strategist update" on storage.objects for update to authenticated
  using (bucket_id = 'robot-photos' and (owner_id = auth.uid()::text or public.is_strategist()));
create policy "robot photos: owner or strategist delete" on storage.objects for delete to authenticated
  using (bucket_id = 'robot-photos' and (owner_id = auth.uid()::text or public.is_strategist()));
create policy "branding: admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and public.is_admin());
create policy "branding: admin update" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and public.is_admin());
create policy "branding: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
--  REALTIME: live board / results / coverage across devices (<2 s)
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'teams', 'team_aliases', 'matches', 'rankings', 'official_alliances', 'scout_submissions',
    'pit_reports', 'photos', 'picklist_meta', 'picklist_entries', 'picklist_votes', 'picklist_snapshots',
    'draft_actions', 'strategy_notes', 'pit_checks', 'scout_assignments', 'settings'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
