/**
 * Automatic video scouting import: the JSON file `bunnyscout saxon-export` writes
 * ({"format": "bunnyscout-video/1", "rows": [...]}) → video_reports rows.
 * Everything is checked against the app's vocabulary; anything else is dropped with a warning.
 */
import type { EventAction, EventTarget, VideoEvent, VideoReport } from '@/data/types';
import type { Phase, Piece } from '@/game/harvestHavoc.config';

export const VIDEO_FORMAT = 'bunnyscout-video/1';

const PHASES: readonly Phase[] = ['auto', 'teleop', 'endgame'];
const ACTIONS: readonly EventAction[] = ['score', 'intake', 'drop', 'handoff', 'park', 'haul', 'flag', 'revive', 'taxi'];
const PIECES: readonly Piece[] = ['carrot', 'cake'];
const TARGETS: readonly EventTarget[] = ['L1', 'L2', 'L3', 'oven', 'haul'];

export interface VideoImport {
  rows: Omit<VideoReport, 'updated_at'>[];
  warnings: string[];
  event: string;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

function cleanEvent(e: unknown): VideoEvent | null {
  const o = obj(e);
  const t = Number(o.t_ms);
  const phase = str(o.phase) as Phase;
  const action = str(o.action) as EventAction;
  if (!Number.isFinite(t) || t < 0 || !PHASES.includes(phase) || !ACTIONS.includes(action)) return null;
  const piece = str(o.piece) as Piece;
  const target = str(o.target) as EventTarget;
  if (action === 'score' && (!PIECES.includes(piece) || !TARGETS.includes(target))) return null;
  return {
    t_ms: Math.round(t),
    phase,
    action,
    piece: PIECES.includes(piece) ? piece : null,
    target: TARGETS.includes(target) ? target : null,
    detail: str(o.detail).slice(0, 120) || null,
  };
}

/** Parse the video scout's file. Throws on a file that is not one. */
export function parseVideoFile(text: string): VideoImport {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('Not a JSON file');
  }
  const d = obj(doc);
  if (d.format !== VIDEO_FORMAT || !Array.isArray(d.rows)) throw new Error(`Not a video scouting file (expected format "${VIDEO_FORMAT}")`);
  const warnings: string[] = [];
  const rows: VideoImport['rows'] = [];
  let dropped = 0;
  for (const raw of d.rows as unknown[]) {
    const r = obj(raw);
    const match_key = str(r.match_key).toUpperCase();
    const team_id = str(r.team_id);
    const alliance = str(r.alliance);
    if (!match_key || !/^\d+[A-Za-z]?$/.test(team_id) || (alliance !== 'red' && alliance !== 'blue')) {
      warnings.push(`skipped a row without a valid match / team / alliance (${match_key || '?'} ${team_id || '?'})`);
      continue;
    }
    const events: VideoEvent[] = [];
    for (const e of Array.isArray(r.events) ? r.events : []) {
      const c = cleanEvent(e);
      if (c) events.push(c);
      else dropped++;
    }
    rows.push({
      id: `${match_key}:${team_id}`,
      match_key,
      team_id,
      alliance,
      station: str(r.station).slice(0, 4),
      events: events.sort((a, b) => a.t_ms - b.t_ms),
      points: obj(r.points) as VideoReport['points'],
      confidence: obj(r.confidence) as VideoReport['confidence'],
      metrics: obj(r.metrics),
      source_version: str(r.source_version).slice(0, 80),
      deleted_at: null,
    });
  }
  if (dropped) warnings.push(`${dropped} event(s) outside the app's vocabulary were dropped`);
  return { rows, warnings, event: str(d.event) };
}

/** Rows whose team is not in the match's official lineup (a misread bumper number). */
export function lineupMismatches(rows: VideoImport['rows'], lineups: Map<string, { red: string[]; blue: string[] }>): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const m = lineups.get(r.match_key);
    if (m && !m[r.alliance as 'red' | 'blue'].includes(r.team_id)) out.push(`${r.match_key}: ${r.team_id} is not on ${r.alliance}`);
  }
  return out;
}

// ── Live-stream links (video_streams) ──────────────────────────────────────

export type StreamLink = { ok: true; url: string; site: 'youtube' | 'twitch'; channel: boolean } | { ok: false; error: string };

/**
 * A YouTube / Twitch link the video PC can record. `channel` = a channel's live page (youtube.com/@x/live,
 * twitch.tv/x), which shows whatever that channel streams next.
 */
export function parseStreamLink(text: string): StreamLink {
  let u: URL;
  try {
    u = new URL(text.trim().startsWith('http') ? text.trim() : `https://${text.trim()}`);
  } catch {
    return { ok: false, error: 'Not a link' };
  }
  const host = u.hostname.replace(/^(www|m)\./, '');
  const path = u.pathname.replace(/\/+$/, '');
  if (host === 'youtu.be' && /^\/[\w-]{11}$/.test(path)) return { ok: true, url: `https://www.youtube.com/watch?v=${path.slice(1)}`, site: 'youtube', channel: false };
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const v = u.searchParams.get('v');
    if (path === '/watch' && v && /^[\w-]{11}$/.test(v)) return { ok: true, url: `https://www.youtube.com/watch?v=${v}`, site: 'youtube', channel: false };
    const live = path.match(/^\/live\/([\w-]{11})$/);
    if (live) return { ok: true, url: `https://www.youtube.com/watch?v=${live[1]}`, site: 'youtube', channel: false };
    if (/^\/(@[\w.-]+|channel\/UC[\w-]{22}|c\/[\w.-]+|user\/[\w.-]+)\/live$/.test(path)) return { ok: true, url: `https://www.youtube.com${path}`, site: 'youtube', channel: true };
    if (/^\/(@[\w.-]+|channel\/UC[\w-]{22}|c\/[\w.-]+|user\/[\w.-]+)$/.test(path)) return { ok: true, url: `https://www.youtube.com${path}/live`, site: 'youtube', channel: true };
    return { ok: false, error: 'Use a video link (youtube.com/watch?v=…, youtu.be/…) or a channel’s live link (youtube.com/@channel/live)' };
  }
  if (host === 'twitch.tv') {
    const vod = path.match(/^\/videos\/(\d+)$/);
    if (vod) return { ok: true, url: `https://www.twitch.tv/videos/${vod[1]}`, site: 'twitch', channel: false };
    if (/^\/[A-Za-z0-9_]{3,25}$/.test(path)) return { ok: true, url: `https://www.twitch.tv${path.toLowerCase()}`, site: 'twitch', channel: true };
    return { ok: false, error: 'Use a Twitch channel (twitch.tv/name) or a past broadcast (twitch.tv/videos/…)' };
  }
  return { ok: false, error: 'Only YouTube and Twitch links are supported' };
}

/** "1:02:05", "62:05" or "3725" (seconds) → seconds; '' → null; anything else → NaN. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return NaN;
  return t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

/** The video PC counts as online if it reported in the last 2 minutes (it checks in every ~15 s). */
export function workerOnline(heartbeat: string | null | undefined, nowMs = Date.now()): boolean {
  if (!heartbeat) return false;
  const t = Date.parse(heartbeat);
  return Number.isFinite(t) && nowMs - t < 120_000;
}
