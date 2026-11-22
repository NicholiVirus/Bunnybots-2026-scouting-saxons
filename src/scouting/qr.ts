/**
 * QR transfer format (works with zero connectivity — hotspots are banned, E6).
 *  bundle → compact JSON (events packed ~10 chars each) → DEFLATE → base45 →
 *  split into parts "HH1/<SID8>/<i>/<n>/<data>" (all QR-alphanumeric).
 * The full event log survives, so cycle timing works for QR-moved data too.
 * Re-scanning is idempotent: same submission id, deterministic event ids.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { Phase, Piece, ProblemFlag } from '@/game/harvestHavoc.config';
import type { EventAction, EventTarget, RobotReport, ScoutEvent, ScoutSubmission, Station } from '@/data/types';
import { hashString } from '@/lib/util';
import { base45Decode, base45Encode } from './base45';
import type { ScoutingBundle } from '@/data/repo';

export const QR_PREFIX = 'HH1';
export const QR_CHUNK = 900;

const ACTION: Record<EventAction, string> = { score: 's', intake: 'i', drop: 'd', handoff: 'h', park: 'p', haul: 'u', flag: 'f', revive: 'r', taxi: 'x' };
const PIECE: Record<Piece, string> = { carrot: 'c', cake: 'k' };
const TARGET: Record<EventTarget, string> = { L1: '1', L2: '2', L3: '3', oven: 'o', haul: 'u' };
const PHASE: Record<Phase, string> = { auto: 'a', teleop: 't', endgame: 'e' };
const DETAIL: Record<string, string> = {
  kitchen: 'K',
  neutral: 'N',
  source: 'S',
  ground: 'G',
  died: 'D',
  no_show: 'O',
  browned_out: 'B',
  a_stop: 'A',
  e_stop: 'E',
  parts_fell_off: 'P',
  severely_damaged: 'X',
  tipped: 'T',
};
const inv = <K extends string>(m: Record<K, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<string, K>;
const ACTION_I = inv(ACTION);
const PIECE_I = inv(PIECE);
const TARGET_I = inv(TARGET);
const PHASE_I = inv(PHASE);
const DETAIL_I = inv(DETAIL);
const MECH_STATUS = ['worked', 'partial', 'failed', 'not_used'] as const;

/** Deterministic UUID-shaped id from a seed (stable across re-imports). */
export function stableUuid(seed: string): string {
  const h = [0, 1, 2, 3].map((i) => hashString(`${i}:${seed}`)).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function packEvents(events: ScoutEvent[], teams: string[]): string {
  return [...events]
    .sort((a, b) => a.t_ms - b.t_ms)
    .map((e) => {
      const ti = Math.max(0, teams.indexOf(e.team_id));
      return `${ti}${ACTION[e.action]}${e.piece ? PIECE[e.piece] : '-'}${e.target ? TARGET[e.target] : '-'}${e.detail ? DETAIL[e.detail] ?? '-' : '-'}${PHASE[e.phase]}${Math.round(e.t_ms / 100).toString(36)}`;
    })
    .join('.');
}

function unpackEvents(s: string, teams: string[], submissionId: string): ScoutEvent[] {
  if (!s) return [];
  return s.split('.').map((tok, i) => {
    const action = ACTION_I[tok[1]];
    return {
      id: stableUuid(`${submissionId}:${i}:${tok}`),
      submission_id: submissionId,
      team_id: teams[Number(tok[0])] ?? teams[0],
      action,
      piece: tok[2] === '-' ? null : PIECE_I[tok[2]],
      target: tok[3] === '-' ? null : TARGET_I[tok[3]],
      detail: tok[4] === '-' ? null : DETAIL_I[tok[4]],
      phase: PHASE_I[tok[5]],
      t_ms: parseInt(tok.slice(6), 36) * 100,
    };
  });
}

interface Packed {
  v: 1;
  s: {
    id: string;
    m: string;
    a: 'r' | 'b';
    t: string[];
    st: Station[];
    sid: string | null;
    sn: string;
    d: string;
    sa: number | null;
    su: string | null;
    ca: string;
  };
  r: {
    t: string;
    st: Station;
    n?: string;
    dr?: number | null;
    dp?: 1;
    dt?: string | null;
    dx?: number | null;
    f?: string;
    m?: Record<string, [number, string?]>;
    rq?: number | null;
    ra?: number | null;
    rd?: number | null;
  }[];
  e: string;
}

export function packBundle(b: ScoutingBundle): string {
  const s = b.submission;
  const p: Packed = {
    v: 1,
    s: { id: s.id, m: s.match_key, a: s.alliance === 'red' ? 'r' : 'b', t: s.teams, st: s.stations, sid: s.scout_id, sn: s.scout_name, d: s.device_id, sa: s.started_at, su: s.submitted_at, ca: s.created_at },
    r: b.reports.map((r) => ({
      t: r.team_id,
      st: r.station,
      ...(r.note ? { n: r.note } : {}),
      ...(r.driver_rating ? { dr: r.driver_rating } : {}),
      ...(r.defense_played ? { dp: 1 as const, dt: r.defense_type, dx: r.defense_rating } : {}),
      ...(r.flags.length ? { f: r.flags.map((f) => DETAIL[f]).join('') } : {}),
      ...(Object.values(r.mechanisms).some(Boolean)
        ? {
            m: Object.fromEntries(
              Object.entries(r.mechanisms)
                .filter(([, v]) => !!v)
                .map(([k, v]) => [k, v!.note ? [MECH_STATUS.indexOf(v!.status), v!.note] : [MECH_STATUS.indexOf(v!.status)]]),
            ) as Packed['r'][number]['m'],
          }
        : {}),
      ...(r.rank_quickness ? { rq: r.rank_quickness, ra: r.rank_awareness, rd: r.rank_defense_resistance } : {}),
    })),
    e: packEvents(b.events, s.teams),
  };
  return JSON.stringify(p);
}

export function unpackBundle(json: string, appVersion = 'qr'): ScoutingBundle {
  const p = JSON.parse(json) as Packed;
  if (p.v !== 1) throw new Error('Unsupported QR version');
  const now = new Date().toISOString();
  const submission: ScoutSubmission = {
    id: p.s.id,
    match_key: p.s.m,
    alliance: p.s.a === 'r' ? 'red' : 'blue',
    teams: p.s.t,
    stations: p.s.st,
    robot_count: p.s.t.length,
    scout_id: p.s.sid,
    scout_name: p.s.sn,
    device_id: p.s.d,
    status: 'submitted',
    started_at: p.s.sa,
    submitted_at: p.s.su ?? now,
    source: 'qr',
    discarded: false,
    discard_reason: null,
    app_version: appVersion,
    created_at: p.s.ca ?? now,
    updated_at: now,
  };
  const reports: RobotReport[] = p.r.map((r) => ({
    id: `${submission.id}:${r.t}`,
    submission_id: submission.id,
    team_id: r.t,
    station: r.st,
    note: r.n ?? '',
    driver_rating: r.dr ?? null,
    defense_played: r.dp === 1,
    defense_type: (r.dt as RobotReport['defense_type']) ?? null,
    defense_rating: r.dx ?? null,
    flags: (r.f ?? '').split('').filter(Boolean).map((c) => DETAIL_I[c] as ProblemFlag),
    mechanisms: Object.fromEntries(Object.entries(r.m ?? {}).map(([k, v]) => [k, { status: MECH_STATUS[v[0]], ...(v[1] ? { note: v[1] } : {}) }])),
    rank_quickness: r.rq ?? null,
    rank_awareness: r.ra ?? null,
    rank_defense_resistance: r.rd ?? null,
    viewed: true,
    totals_override: null,
    updated_at: now,
  }));
  return { submission, reports, events: unpackEvents(p.e, submission.teams, submission.id) };
}

/** Bundle → QR strings (1+ parts). */
export function encodeBundleToQr(b: ScoutingBundle, chunk = QR_CHUNK): string[] {
  const data = base45Encode(deflateSync(strToU8(packBundle(b)), { level: 9 }));
  const sid = b.submission.id.replace(/-/g, '').slice(0, 8).toUpperCase();
  const n = Math.max(1, Math.ceil(data.length / chunk));
  return Array.from({ length: n }, (_, i) => `${QR_PREFIX}/${sid}/${i + 1}/${n}/${data.slice(i * chunk, (i + 1) * chunk)}`);
}

export interface QrPart {
  sid: string;
  index: number;
  total: number;
  data: string;
}

export function parseQrPart(text: string): QrPart | null {
  const m = /^HH1\/([0-9A-Z]{8})\/(\d+)\/(\d+)\/(.*)$/s.exec(text.trim());
  if (!m) return null;
  return { sid: m[1], index: Number(m[2]), total: Number(m[3]), data: m[4] };
}

/** Accumulates multi-part scans; returns the bundle once every part arrived. */
export class QrAssembler {
  private parts = new Map<string, Map<number, string>>();
  private totals = new Map<string, number>();

  add(text: string): { status: 'progress'; sid: string; have: number; total: number } | { status: 'done'; bundle: ScoutingBundle } | null {
    const p = parseQrPart(text);
    if (!p) return null;
    const m = this.parts.get(p.sid) ?? new Map<number, string>();
    m.set(p.index, p.data);
    this.parts.set(p.sid, m);
    this.totals.set(p.sid, p.total);
    if (m.size < p.total) return { status: 'progress', sid: p.sid, have: m.size, total: p.total };
    const data = Array.from({ length: p.total }, (_, i) => m.get(i + 1) ?? '').join('');
    this.parts.delete(p.sid);
    return { status: 'done', bundle: decodeQrData(data) };
  }

  progress(): { sid: string; have: number; total: number }[] {
    return [...this.parts.entries()].map(([sid, m]) => ({ sid, have: m.size, total: this.totals.get(sid) ?? 0 }));
  }
}

export function decodeQrData(data: string): ScoutingBundle {
  return unpackBundle(strFromU8(inflateSync(base45Decode(data))));
}
