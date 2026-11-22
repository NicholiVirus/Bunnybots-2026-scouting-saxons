'use client';
import Link from 'next/link';
import { ClipboardPen, ListOrdered, Swords, Users } from 'lucide-react';
import { Card, PageTitle, Badge } from '@/components/ui';
import { EVENT, OUR_TEAMS, OUR_TEAM_NAMES } from '@/config/event';
import { useTeams } from '@/data/hooks';
import { useAuth } from '@/sync/auth';

export default function HomePage() {
  const teams = useTeams();
  const auth = useAuth();
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageTitle sub={`${EVENT.name} · ${EVENT.venue}`}>
        Saxon Robotics <span className="text-saxon">{OUR_TEAMS.join(' · ')}</span>
      </PageTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: '/scout/', label: 'Scout a match', icon: ClipboardPen },
          { href: '/matches/', label: 'Matches', icon: Swords },
          { href: '/teams/', label: 'Team catalog', icon: Users },
          { href: '/selection/', label: 'Alliance selection', icon: ListOrdered },
        ].map((q) => (
          <Link key={q.href} href={q.href} className="flex h-24 flex-col justify-between rounded-2xl border border-line bg-surface p-4 hover:border-saxon">
            <q.icon className="text-saxon" />
            <span className="font-semibold">{q.label}</span>
          </Link>
        ))}
      </div>
      <Card title="Event day">
        <ul className="grid gap-2 sm:grid-cols-5">
          {EVENT.schedule.map((s) => (
            <li key={s.label} className="rounded-xl bg-surface-2 p-3">
              <div className="text-xs text-muted">
                {s.start}–{s.end}
              </div>
              <div className="font-medium">{s.label}</div>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Status">
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="saxon">{teams?.length ?? 0} teams</Badge>
          {OUR_TEAMS.map((t) => (
            <Badge key={t} tone="saxon">
              {t} {OUR_TEAM_NAMES[t]}
            </Badge>
          ))}
          <Badge>{auth.status === 'local' ? 'local-only mode' : auth.status}</Badge>
          {auth.role && <Badge>role: {auth.role}</Badge>}
        </div>
      </Card>
    </div>
  );
}
