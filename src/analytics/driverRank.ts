/**
 * Relative driver rankings (1678-style). Each multi-robot scout ranks the robots
 * they watched 1st–3rd; every ranking becomes pairwise comparisons, and a
 * Bradley–Terry model (MM algorithm) turns them into one event-wide 0–100 score.
 * A small prior (virtual games vs an average robot) keeps 1–2 data points sane.
 */
export interface RankedGroup {
  /** Teams in finishing order, best first. */
  order: string[];
}

export function bradleyTerry(groups: readonly RankedGroup[], prior = 1, iters = 200): Map<string, number> {
  const teams = [...new Set(groups.flatMap((g) => g.order))];
  if (!teams.length) return new Map();
  const wins = new Map<string, number>(teams.map((t) => [t, prior]));
  const games = new Map<string, Map<string, number>>(teams.map((t) => [t, new Map()]));
  const addGame = (a: string, b: string) => {
    games.get(a)!.set(b, (games.get(a)!.get(b) ?? 0) + 1);
    games.get(b)!.set(a, (games.get(b)!.get(a) ?? 0) + 1);
  };
  for (const g of groups)
    for (let i = 0; i < g.order.length; i++)
      for (let j = i + 1; j < g.order.length; j++) {
        wins.set(g.order[i], (wins.get(g.order[i]) ?? 0) + 1);
        addGame(g.order[i], g.order[j]);
      }
  let p = new Map<string, number>(teams.map((t) => [t, 1]));
  for (let it = 0; it < iters; it++) {
    const next = new Map<string, number>();
    for (const t of teams) {
      let denom = (2 * prior) / (p.get(t)! + 1); // virtual games vs an average (strength 1) robot
      for (const [o, n] of games.get(t)!) denom += n / (p.get(t)! + p.get(o)!);
      next.set(t, (wins.get(t)! + prior) / denom);
    }
    const g = Math.exp(teams.reduce((a, t) => a + Math.log(next.get(t)!), 0) / teams.length);
    for (const t of teams) next.set(t, next.get(t)! / g);
    p = next;
  }
  // map log-strength to 0–100 (50 = event average)
  const out = new Map<string, number>();
  for (const t of teams) out.set(t, Math.max(0, Math.min(100, 50 + 18 * Math.log(p.get(t)!))));
  return out;
}

/** Build ranked groups for one category from (team, among, rank) tuples. */
export function groupsFrom(entries: readonly { team: string; among: string[]; rank: number | null; groupId: string }[]): RankedGroup[] {
  const by = new Map<string, { team: string; rank: number }[]>();
  for (const e of entries) {
    if (!e.rank) continue;
    const arr = by.get(e.groupId) ?? [];
    arr.push({ team: e.team, rank: e.rank });
    by.set(e.groupId, arr);
  }
  return [...by.values()].filter((g) => g.length > 1).map((g) => ({ order: g.sort((a, b) => a.rank - b.rank).map((x) => x.team) }));
}
