/** First-launch local seed: the 28-team roster + B-robot alias map (works with no server). */
import { DEFAULT_ALIASES, ROSTER } from '@/config/event';
import { nowIso } from '@/lib/util';
import { teamNumber } from '@/lib/teamIds';
import { db } from './db';
import type { Team, TeamAlias } from './types';

export function rosterTeams(): Team[] {
  const ts = nowIso();
  return ROSTER.map((t) => ({ id: t.id, number: teamNumber(t.id), name: t.name, status: t.status, notes: t.notes ?? null, updated_at: ts }));
}

export function rosterAliases(): TeamAlias[] {
  const ts = nowIso();
  return Object.entries(DEFAULT_ALIASES).map(([alias, team_id]) => ({ alias, team_id, updated_at: ts }));
}

export async function ensureLocalSeed() {
  const done = await db.kv.get('seeded:v1');
  if (done) return;
  await db.transaction('rw', db.teams, db.team_aliases, db.kv, async () => {
    if ((await db.teams.count()) === 0) await db.teams.bulkPut(rosterTeams());
    if ((await db.team_aliases.count()) === 0) await db.team_aliases.bulkPut(rosterAliases());
    await db.kv.put({ key: 'seeded:v1', value: nowIso() });
  });
}
