'use client';
/** Live IndexedDB queries for React (re-render automatically on any change, across tabs). */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from './db';
import { readSettings } from './settings';
import type { MatchRow, Team } from './types';
import { compareTeamIds, defaultTeamIdContext, type TeamIdContext } from '@/lib/teamIds';

export function useTeams(): Team[] | undefined {
  return useLiveQuery(async () => (await db.teams.toArray()).sort((a, b) => compareTeamIds(a.id, b.id)), []);
}

export function useTeamMap(): Map<string, Team> {
  const teams = useTeams();
  return useMemo(() => new Map((teams ?? []).map((t) => [t.id, t])), [teams]);
}

export function useMatches(): MatchRow[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.matches.toArray()).sort((a, b) =>
        a.comp_level === b.comp_level ? a.match_number - b.match_number : a.comp_level === 'qm' ? -1 : 1,
      ),
    [],
  );
}

export function useSettings() {
  const rows = useLiveQuery(() => db.settings.toArray(), []);
  return useMemo(() => readSettings(rows), [rows]);
}

/** Team-id context (roster + editable alias map) for importers. */
export function useTeamIdContext(): TeamIdContext {
  const teams = useTeams();
  const aliases = useLiveQuery(() => db.team_aliases.toArray(), []);
  return useMemo(() => {
    const base = defaultTeamIdContext();
    const known = new Set<string>([...base.known, ...(teams ?? []).map((t) => t.id)]);
    const map: Record<string, string> = { ...base.aliases };
    for (const a of aliases ?? []) map[a.alias] = a.team_id;
    return { known, aliases: map };
  }, [teams, aliases]);
}

export async function loadTeamIdContext(): Promise<TeamIdContext> {
  const base = defaultTeamIdContext();
  const [teams, aliases] = await Promise.all([db.teams.toArray(), db.team_aliases.toArray()]);
  const map: Record<string, string> = { ...base.aliases };
  for (const a of aliases) map[a.alias] = a.team_id;
  return { known: new Set([...base.known, ...teams.map((t) => t.id)]), aliases: map };
}

export function useOutboxCounts() {
  return useLiveQuery(
    async () => ({
      pending: await db.outbox.where('status').equals('pending').count(),
      failed: await db.outbox.where('status').equals('failed').count(),
    }),
    [],
    { pending: 0, failed: 0 },
  );
}
