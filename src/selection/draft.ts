/**
 * Standard FRC alliance selection (10.6.1), as a pure state machine.
 *  - Captains are the highest-ranked teams not yet on an alliance. If a lower
 *    alliance's (projected) captain is picked, everyone below moves up and the
 *    next team becomes the last captain ("captain promotion").
 *  - Round 1: alliances 1 → N pick; Round 2 (serpentine): N → 1.
 *  - A team that DECLINES can't be picked later, but can still be a captain if
 *    the captain order reaches it.
 *  - Unpicked teams are backup robots in rank order.
 * The board state is a replay of append-only actions (undo = drop the last one),
 * optionally starting from the official /api/alliances data.
 */
import type { DraftAction, OfficialAlliance } from '@/data/types';

export interface DraftAlliance {
  number: number;
  captain: string | null;
  /** true while the captain is only projected (that alliance hasn't picked yet). */
  projected: boolean;
  picks: [string | null, string | null];
}

export interface DraftTurn {
  round: 1 | 2;
  alliance: number;
}

export interface DraftState {
  allianceCount: number;
  ranked: string[];
  alliances: DraftAlliance[];
  /** team → alliance number it declined */
  declined: Map<string, number>;
  /** team → alliance number it is on (captains + picks, fixed only) */
  onAlliance: Map<string, number>;
  turn: DraftTurn | null;
  done: boolean;
  /** Teams that can still be picked, in rank order (excludes the turn alliance's own captain). */
  available: string[];
  backups: string[];
  warnings: string[];
}

export type DraftStep = Pick<DraftAction, 'action' | 'alliance' | 'team_id'> & { payload?: Record<string, unknown> | null };

interface Mutable {
  n: number;
  ranked: string[];
  fixedCaptain: (string | null)[];
  picks: [string | null, string | null][];
  declined: Map<string, number>;
  warnings: string[];
}

function onAllianceMap(m: Mutable): Map<string, number> {
  const out = new Map<string, number>();
  for (let a = 0; a < m.n; a++) {
    if (m.fixedCaptain[a]) out.set(m.fixedCaptain[a]!, a + 1);
    for (const p of m.picks[a]) if (p) out.set(p, a + 1);
  }
  return out;
}

/** Captains for every alliance: fixed ones, then the best remaining teams in order. */
function captains(m: Mutable): { team: string | null; projected: boolean }[] {
  const taken = onAllianceMap(m);
  const out: { team: string | null; projected: boolean }[] = [];
  const used = new Set<string>();
  for (let a = 0; a < m.n; a++) {
    const fixed = m.fixedCaptain[a];
    if (fixed) {
      out.push({ team: fixed, projected: false });
      continue;
    }
    const next = m.ranked.find((t) => !taken.has(t) && !used.has(t));
    if (next) used.add(next);
    out.push({ team: next ?? null, projected: true });
  }
  return out;
}

function currentTurn(m: Mutable): DraftTurn | null {
  const caps = captains(m);
  for (let a = 0; a < m.n; a++) if (caps[a].team && !m.picks[a][0]) return { round: 1, alliance: a + 1 };
  for (let a = m.n - 1; a >= 0; a--) if (caps[a].team && m.picks[a][0] && !m.picks[a][1]) return { round: 2, alliance: a + 1 };
  return null;
}

function snapshot(m: Mutable): DraftState {
  const caps = captains(m);
  const onAlliance = onAllianceMap(m);
  const turn = currentTurn(m);
  const turnCaptain = turn ? caps[turn.alliance - 1].team : null;
  const available = m.ranked.filter((t) => !onAlliance.has(t) && !m.declined.has(t) && t !== turnCaptain);
  const done = !turn;
  return {
    allianceCount: m.n,
    ranked: m.ranked,
    alliances: Array.from({ length: m.n }, (_, a) => ({ number: a + 1, captain: caps[a].team, projected: caps[a].projected, picks: m.picks[a] })),
    declined: new Map(m.declined),
    onAlliance,
    turn,
    done,
    available,
    backups: done ? m.ranked.filter((t) => !onAlliance.has(t) && !caps.some((c) => c.team === t)) : [],
    warnings: [...m.warnings],
  };
}

function resize(m: Mutable, n: number) {
  const k = Math.max(1, Math.min(8, Math.round(n)));
  while (m.fixedCaptain.length < k) {
    m.fixedCaptain.push(null);
    m.picks.push([null, null]);
  }
  m.fixedCaptain.length = k;
  m.picks.length = k;
  m.n = k;
}

function apply(m: Mutable, s: DraftStep) {
  const a = (s.alliance ?? 0) - 1;
  const team = s.team_id ?? '';
  if (s.action === 'config') {
    const n = Number(s.payload?.allianceCount);
    if (Number.isFinite(n)) resize(m, n);
    return;
  }
  if (a < 0 || a >= m.n) {
    m.warnings.push(`Alliance ${s.alliance} does not exist`);
    return;
  }
  const taken = onAllianceMap(m);
  if (s.action === 'captain') {
    if (taken.has(team) && taken.get(team) !== a + 1) {
      m.warnings.push(`${team} is already on alliance ${taken.get(team)}`);
      return;
    }
    m.fixedCaptain[a] = team;
    return;
  }
  const caps = captains(m);
  const captain = caps[a].team;
  if (s.action === 'decline') {
    if (taken.has(team)) {
      m.warnings.push(`${team} is already on alliance ${taken.get(team)} — can't decline`);
      return;
    }
    m.declined.set(team, a + 1);
    return;
  }
  // pick
  if (!captain) {
    m.warnings.push(`Alliance ${a + 1} has no captain`);
    return;
  }
  if (team === captain) {
    m.warnings.push(`${team} is alliance ${a + 1}'s own captain`);
    return;
  }
  if (taken.has(team)) {
    m.warnings.push(`${team} is already on alliance ${taken.get(team)}`);
    return;
  }
  if (m.declined.has(team)) {
    m.warnings.push(`${team} declined earlier and can't be picked`);
    return;
  }
  if (m.picks[a][0] && m.picks[a][1]) {
    m.warnings.push(`Alliance ${a + 1} is already full`);
    return;
  }
  const slot: 0 | 1 = m.picks[a][0] ? 1 : 0;
  const turn = currentTurn(m);
  if (!turn || turn.alliance !== a + 1) m.warnings.push(`Out of turn: alliance ${a + 1} picked ${team}`);
  // lock in this alliance's captain (and every earlier one) at the moment it picks
  for (let i = 0; i <= a; i++) if (!m.fixedCaptain[i] && caps[i].team) m.fixedCaptain[i] = caps[i].team;
  m.picks[a][slot] = team;
}

export function deriveDraft(ranked: string[], allianceCount: number, steps: readonly DraftStep[] = [], official: readonly OfficialAlliance[] | null = null): DraftState {
  const m: Mutable = { n: 0, ranked: [...ranked], fixedCaptain: [], picks: [], declined: new Map(), warnings: [] };
  resize(m, allianceCount);
  if (official?.length) {
    for (const o of official) {
      const a = o.number - 1;
      if (a < 0) continue;
      if (a >= m.n) resize(m, a + 1);
      m.fixedCaptain[a] = o.captain;
      m.picks[a] = [o.first_pick, o.second_pick];
    }
    // only declines (the field system doesn't publish them) and config apply on top
    for (const s of steps) if (s.action === 'decline' || s.action === 'config') apply(m, s);
    return snapshot(m);
  }
  for (const s of steps) apply(m, s);
  return snapshot(m);
}

/** Apply one more step to an existing state (used by simulations). */
export function stepDraft(state: DraftState, s: DraftStep): DraftState {
  const m: Mutable = {
    n: state.allianceCount,
    ranked: state.ranked,
    fixedCaptain: state.alliances.map((a) => (a.projected ? null : a.captain)),
    picks: state.alliances.map((a) => [...a.picks] as [string | null, string | null]),
    declined: new Map(state.declined),
    warnings: [],
  };
  apply(m, s);
  return snapshot(m);
}

/** Alliance (number) containing a team, fixed or projected captain included. */
export function allianceOfTeam(state: DraftState, team: string): { number: number; role: 'captain' | 'first' | 'second'; projected: boolean } | null {
  for (const a of state.alliances) {
    if (a.captain === team) return { number: a.number, role: 'captain', projected: a.projected };
    if (a.picks[0] === team) return { number: a.number, role: 'first', projected: false };
    if (a.picks[1] === team) return { number: a.number, role: 'second', projected: false };
  }
  return null;
}

export function draftToCsv(state: DraftState): string {
  const rows = ['alliance,captain,first_pick,second_pick'];
  for (const a of state.alliances) rows.push([a.number, a.captain ?? '', a.picks[0] ?? '', a.picks[1] ?? ''].join(','));
  if (state.backups.length) rows.push(`backups,${state.backups.join(' ')}`);
  return rows.join('\n');
}
