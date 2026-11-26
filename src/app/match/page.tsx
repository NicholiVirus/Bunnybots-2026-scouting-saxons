'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { Eye } from 'lucide-react';
import { db } from '@/data/db';
import { allianceScore, type AllianceBreakdown } from '@/game/scoring';
import { HARVEST_HAVOC as G, SHELVES, FLAG_LABEL } from '@/game/harvestHavoc.config';
import type { Alliance, MatchRow } from '@/data/types';
import { Badge, Button, Card, Empty, PageTitle, cx } from '@/components/ui';
import { TeamChip, usePhotoMap } from '@/components/TeamChip';
import { RpBadges } from '@/components/RpBadges';
import { PantryGraphic } from '@/components/PantryGraphic';
import { FreshnessBanner } from '@/components/FreshnessBanner';
import { useFlagIndex } from '@/data/scoutHooks';
import { SOURCE_LABEL } from '@/sources/DataSource';
import { MatchScouting } from '@/components/MatchScouting';
import { VideoScouting } from '@/components/VideoScouting';

export default function MatchPage() {
  return (
    <Suspense fallback={null}>
      <MatchInner />
    </Suspense>
  );
}

function MatchInner() {
  const key = useSearchParams().get('key') ?? '';
  const m = useLiveQuery(() => (key ? db.matches.get(key) : undefined), [key]);
  if (m === undefined) return <Empty title={key ? `Match ${key} not found` : 'No match selected'} />;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageTitle
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <FreshnessBanner /> <Badge>{SOURCE_LABEL[m.source]}</Badge>
          </span>
        }
        actions={
          <Link href={`/preview/?key=${encodeURIComponent(m.key)}`}>
            <Button size="sm">
              <Eye size={16} /> Preview
            </Button>
          </Link>
        }
      >
        {m.label} {m.played ? '' : <span className="text-base font-normal text-muted">(not played yet)</span>}
      </PageTitle>
      <Scoreboard m={m} />
      {(m.warnings?.length ?? 0) > 0 && (
        <Card title="Data warnings" className="border-warn/50">
          <ul className="list-disc pl-5 text-sm text-warn">
            {m.warnings!.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      )}
      {m.breakdown && (
        <>
          <Card title="Breakdown">
            <BreakdownTable m={m} red={m.breakdown.red} blue={m.breakdown.blue} />
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <PantryGraphic b={m.breakdown.red} teams={m.red} side="red" />
            </Card>
            <Card>
              <PantryGraphic b={m.breakdown.blue} teams={m.blue} side="blue" />
            </Card>
          </div>
        </>
      )}
      <MatchScouting m={m} />
      <VideoScouting m={m} />
    </div>
  );
}

function Scoreboard({ m }: { m: MatchRow }) {
  const photos = usePhotoMap();
  const flags = useFlagIndex();
  const col = (a: Alliance) => (
    <div className={cx('flex-1 rounded-2xl p-3', a === 'red' ? 'bg-redA/15' : 'bg-blueA/15', m.winner === a && 'ring-2', m.winner === a && (a === 'red' ? 'ring-redA' : 'ring-blueA'))}>
      <div className="mb-2 flex items-center justify-between">
        <span className={cx('text-sm font-bold uppercase', a === 'red' ? 'text-redA' : 'text-blueA')}>{a}</span>
        <RpBadges m={m} side={a} />
      </div>
      <div className="tnum mb-2 text-4xl font-black">{(a === 'red' ? m.red_score : m.blue_score) ?? '–'}</div>
      <div className="space-y-1">
        {m[a].map((t, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1">
            <TeamChip team={t} photo={photos.get(t)} showName />
            {(flags.get(`${m.key}:${t}`)?.flags ?? []).map((f) => (
              <Badge key={f} tone="bad">
                {FLAG_LABEL[f]}
              </Badge>
            ))}
            {(m.dq ?? []).includes(t) && <Badge tone="bad">DQ</Badge>}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {col('red')}
      {col('blue')}
    </div>
  );
}

function BreakdownTable({ m, red, blue }: { m: MatchRow; red: AllianceBreakdown; blue: AllianceBreakdown }) {
  const rs = allianceScore(red, blue.fouls);
  const bs = allianceScore(blue, red.fouls);
  const tick = (b: boolean) => (b ? '✓' : '✗');
  const row = (label: string, r: React.ReactNode, b: React.ReactNode, strong = false) => (
    <tr className={cx('border-b border-line', strong && 'font-bold')}>
      <td className="py-1.5 text-right text-redA tnum">{r}</td>
      <td className="px-2 text-center text-xs text-muted">{label}</td>
      <td className="py-1.5 text-left text-blueA tnum">{b}</td>
    </tr>
  );
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[320px] text-sm">
        <tbody>
          {row('Taxi', `${red.taxi.map(tick).join(' ')} (+${rs.taxi})`, `${blue.taxi.map(tick).join(' ')} (+${bs.taxi})`)}
          {[...SHELVES].reverse().map((s) =>
            row(
              `Pantry ${s} (carrot / cake)`,
              `${red.pantry.carrot[s]} / ${red.pantry.cake[s]}`,
              `${blue.pantry.carrot[s]} / ${blue.pantry.cake[s]}`,
            ),
          )}
          {row('Pantry points', `+${rs.pantry}`, `+${bs.pantry}`)}
          {row('Oven (carrot / cake)', `${red.oven.carrot} / ${red.oven.cake} (+${rs.oven})`, `${blue.oven.carrot} / ${blue.oven.cake} (+${bs.oven})`)}
          {row(
            `Cakes earned via trade (${G.cakeEconomy.ovenCarrotsPerCake} oven carrots each)`,
            Math.floor(red.oven.carrot / G.cakeEconomy.ovenCarrotsPerCake),
            Math.floor(blue.oven.carrot / G.cakeEconomy.ovenCarrotsPerCake),
          )}
          {row('Park', `${red.park.map(tick).join(' ')} (+${rs.park})`, `${blue.park.map(tick).join(' ')} (+${bs.park})`)}
          {row(
            'Haul (carrots+cakes per robot)',
            `${red.haul.carrot.map((c, i) => `${c}+${red.haul.cake[i]}`).join(' · ')} (+${rs.haul})`,
            `${blue.haul.carrot.map((c, i) => `${c}+${blue.haul.cake[i]}`).join(' · ')} (+${bs.haul})`,
          )}
          {row('Endgame points', rs.endgame, bs.endgame)}
          {row('Fouls committed (minor / major)', `${red.fouls.minor} / ${red.fouls.major}`, `${blue.fouls.minor} / ${blue.fouls.major}`)}
          {row('Foul points received', `+${rs.fouls}`, `+${bs.fouls}`)}
          {row('Total (by the rules)', rs.total, bs.total, true)}
          {row('Official score', m.red_score ?? '–', m.blue_score ?? '–', true)}
        </tbody>
      </table>
    </div>
  );
}
