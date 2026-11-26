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
