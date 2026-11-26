-- Live-stream links for the automatic video scout (BunnyBotsAutomaticScouting).
-- A Strategist / Admin pastes a YouTube / Twitch link in the app (Admin -> Data sources -> Live streams);
-- the video PC (`bunnyscout saxon-worker`, signed in as a Strategist / Admin) records it, splits it into
-- matches, analyses them, writes its progress back here and uploads the results to video_reports.
-- Needs 0004_video_reports.sql. Safe to run again.

create table if not exists public.video_streams (
  id text primary key,
  url text not null,
  first_label text not null default '',     -- first match in the stream ('' = the next one not done yet)
  example_start real,                        -- seconds: one match start in the stream (teaches the start sound)
  keep_waiting boolean not null default false, -- a channel's live link: wait for the next stream when one ends
  requested text not null default 'run' check (requested in ('run', 'stop')),       -- set by the app
  state text not null default 'queued'
    check (state in ('queued', 'waiting', 'recording', 'ended', 'stopped', 'error')), -- set by the video PC
  status text not null default '',
  title text not null default '',
  matches jsonb not null default '[]',       -- [{label, at_s, note?}] matches found in the stream
  worker text not null default '',
  heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists video_streams_updated_idx on public.video_streams (updated_at);

drop trigger if exists touch_video_streams on public.video_streams;
create trigger touch_video_streams before insert or update on public.video_streams
  for each row execute function public.touch_updated_at();

alter table public.video_streams enable row level security;
revoke all on public.video_streams from anon;

drop policy if exists video_streams_select on public.video_streams;
drop policy if exists video_streams_insert on public.video_streams;
drop policy if exists video_streams_update on public.video_streams;
drop policy if exists video_streams_delete on public.video_streams;
create policy video_streams_select on public.video_streams for select to authenticated using (public.is_member());
create policy video_streams_insert on public.video_streams for insert to authenticated with check (public.is_strategist());
create policy video_streams_update on public.video_streams for update to authenticated
  using (public.is_strategist()) with check (public.is_strategist());
create policy video_streams_delete on public.video_streams for delete to authenticated using (public.is_strategist());

do $$
begin
  alter publication supabase_realtime add table public.video_streams;
exception when duplicate_object then null;
end $$;
