-- Automatic video scouting (BunnyBotsAutomaticScouting) shown next to the human scouting.
-- One row per robot per match. Written by the video PC (`bunnyscout saxon-push`, signed in as a
-- Strategist / Admin) or imported in the app (Admin -> Data sources -> Video scouting).
-- Safe to run again.

create table if not exists public.video_reports (
  id text primary key,                       -- "<match_key>:<team_id>"
  match_key text not null,
  team_id text not null,
  alliance text not null check (alliance in ('red', 'blue')),
  station text not null default '',
  events jsonb not null default '[]',        -- [{t_ms, phase, action, piece?, target?, detail?}] like scout_events
  points jsonb not null default '{}',        -- the video system's own estimate
  confidence jsonb not null default '{}',
  metrics jsonb not null default '{}',
  source_version text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists video_reports_match_idx on public.video_reports (match_key);
create index if not exists video_reports_team_idx on public.video_reports (team_id);
create index if not exists video_reports_updated_idx on public.video_reports (updated_at);

drop trigger if exists touch_video_reports on public.video_reports;
create trigger touch_video_reports before insert or update on public.video_reports
  for each row execute function public.touch_updated_at();

alter table public.video_reports enable row level security;
revoke all on public.video_reports from anon;

drop policy if exists video_reports_select on public.video_reports;
drop policy if exists video_reports_insert on public.video_reports;
drop policy if exists video_reports_update on public.video_reports;
drop policy if exists video_reports_delete on public.video_reports;
create policy video_reports_select on public.video_reports for select to authenticated using (public.is_member());
create policy video_reports_insert on public.video_reports for insert to authenticated with check (public.is_strategist());
create policy video_reports_update on public.video_reports for update to authenticated
  using (public.is_strategist()) with check (public.is_strategist());
create policy video_reports_delete on public.video_reports for delete to authenticated using (public.is_strategist());

do $$
begin
  alter publication supabase_realtime add table public.video_reports;
exception when duplicate_object then null;
end $$;
