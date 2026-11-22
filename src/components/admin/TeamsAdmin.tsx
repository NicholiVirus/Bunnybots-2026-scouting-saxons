'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { db } from '@/data/db';
import { useTeams } from '@/data/hooks';
import { deleteRows, putRow } from '@/data/repo';
import type { Team } from '@/data/types';
import { cleanTeamToken, teamNumber, displayTeam } from '@/lib/teamIds';
import { isOurTeam } from '@/config/event';
import { Badge, Button, Card, inputCls } from '@/components/ui';

export function TeamsAdmin() {
  const teams = useTeams() ?? [];
  const aliases = useLiveQuery(() => db.team_aliases.toArray(), [], []);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [alias, setAlias] = useState('');
  const [aliasTeam, setAliasTeam] = useState('');

  const addTeam = async () => {
    const id = cleanTeamToken(newId);
    if (!id) return;
    await putRow('teams', { id, number: teamNumber(id), name: newName.trim(), status: 'expected', notes: null } satisfies Omit<Team, 'updated_at'>);
    // B robots get their field-system alias automatically (449b → 9449)
    const m = /^(\d+)b$/.exec(id);
    if (m) await putRow('team_aliases', { alias: `9${m[1]}`, team_id: id });
    setNewId('');
    setNewName('');
  };

  return (
    <div className="space-y-4">
      <Card title={`Teams (${teams.length})`}>
        <div className="mb-3 flex flex-wrap gap-2">
          <input className={`${inputCls} w-28`} placeholder="e.g. 1234b" value={newId} onChange={(e) => setNewId(e.target.value)} />
          <input className={`${inputCls} min-w-40 flex-1`} placeholder="Team name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button variant="primary" onClick={() => void addTeam()}>
            Add team
          </Button>
        </div>
        <ul className="divide-y divide-line">
          {teams.map((t) => (
            <li key={t.id} className={`flex flex-wrap items-center gap-2 py-2 ${isOurTeam(t.id) ? 'ours rounded-lg px-2' : ''}`}>
              <span className="w-16 font-bold tnum">{displayTeam(t.id)}</span>
              <input
                className="h-10 min-w-40 flex-1 rounded-lg border border-line bg-surface-2 px-2"
                defaultValue={t.name}
                onBlur={(e) => e.target.value !== t.name && void putRow('teams', { ...t, name: e.target.value })}
              />
              <select
                className="h-10 rounded-lg border border-line bg-surface-2 px-2"
                value={t.status}
                onChange={(e) => void putRow('teams', { ...t, status: e.target.value as Team['status'] })}
              >
                <option value="confirmed">confirmed</option>
                <option value="expected">expected</option>
                <option value="withdrawn">withdrawn</option>
              </select>
              {t.notes && <Badge>{t.notes}</Badge>}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${t.id}`}
                onClick={() => confirm(`Remove team ${t.id}? (Scouting data is kept.)`) && void deleteRows('teams', [t])}
              >
                <Trash2 size={16} />
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Team alias map">
        <p className="mb-3 text-sm text-muted">
          Every importer runs team numbers through this map. The field system sends B robots as <b>9</b> + number (9449 → 449b).
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          <input className={`${inputCls} w-32`} placeholder="Alias (9449)" value={alias} onChange={(e) => setAlias(e.target.value)} />
          <select className={`${inputCls} w-40`} value={aliasTeam} onChange={(e) => setAliasTeam(e.target.value)}>
            <option value="">→ team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {displayTeam(t.id)}
              </option>
            ))}
          </select>
          <Button
            onClick={() => {
              const a = cleanTeamToken(alias);
              if (a && aliasTeam) void putRow('team_aliases', { alias: a, team_id: aliasTeam });
              setAlias('');
            }}
          >
            Add alias
          </Button>
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {aliases.map((a) => (
            <li key={a.alias} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
              <span className="tnum">
                {a.alias} → <b>{displayTeam(a.team_id)}</b>
              </span>
              <button className="text-muted hover:text-bad" onClick={() => void deleteRows('team_aliases', [a])} aria-label="Remove alias">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
