'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { db } from '@/data/db';
import { useAnalytics } from '@/analytics/AnalyticsProvider';
import { scoutedRobots } from '@/scouting/records';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { SHELVES } from '@/game/harvestHavoc.config';
import { mergePit } from '@/catalog/pit';
import { downloadText, toCsv } from '@/lib/util';
import { Button, Card } from '@/components/ui';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export function ExportsAdmin() {
  const model = useAnalytics();
  const [msg, setMsg] = useState<string | null>(null);
  const csv = (name: string, rows: Record<string, unknown>[]) => {
    downloadText(`${name}-${stamp()}.csv`, toCsv(rows), 'text/csv');
    setMsg(`${name}: ${rows.length} rows`);
  };

  const exportMatches = async () => {
    const ms = await db.matches.toArray();
    csv(
      'matches',
      ms.map((m) => ({
        key: m.key,
        label: m.label,
        level: m.comp_level,
        red1: m.red[0],
        red2: m.red[1],
        red3: m.red[2],
        blue1: m.blue[0],
        blue2: m.blue[1],
        blue3: m.blue[2],
        red_score: m.red_score,
        blue_score: m.blue_score,
        winner: m.winner,
        red_stocked: m.rp?.red.stocked,
        red_baked: m.rp?.red.baked,
        red_dinner: m.rp?.red.dinner,
        blue_stocked: m.rp?.blue.stocked,
        blue_baked: m.rp?.blue.baked,
        blue_dinner: m.rp?.blue.dinner,
        source: m.source,
        warnings: (m.warnings ?? []).join(' | '),
      })),
    );
  };

  const exportTeamStats = () => {
    if (!model) return;
    csv(
      'team-stats',
      [...model.teams.values()].map((t) => ({
        team: t.team,
        name: t.name,
        scouted_matches: t.n,
        avg_points: t.n ? t.points.mean.toFixed(2) : '',
        sd: t.n > 1 ? t.points.sd.toFixed(2) : '',
        min: t.n ? t.points.min : '',
        max: t.n ? t.points.max : '',
        recent3: t.recent3?.toFixed(2) ?? '',
        reliability: t.reliability?.toFixed(3) ?? '',
        median_cycle_s: t.cycles?.median.toFixed(2) ?? '',
        cycles_n: t.cycles?.n ?? 0,
        endgame_value: t.endgame.value?.toFixed(2) ?? '',
        cakes_generated: t.cake.cakesGenerated.toFixed(2),
        opr: t.official.opr?.toFixed(2) ?? '',
        no_foul_opr: t.official.components.noFoul?.toFixed(2) ?? '',
        rank: t.official.rank ?? '',
        role: t.role ?? '',
        driver_rel: t.driver.relScore?.toFixed(1) ?? '',
        defense_rate: t.defense.rate.toFixed(2),
        foul_pts_per_match: t.fouls.pointsPerMatch?.toFixed(2) ?? '',
      })),
    );
  };

  const exportScouting = async () => {
    const [submissions, reports, events, matches] = await Promise.all([db.scout_submissions.toArray(), db.robot_reports.toArray(), db.scout_events.toArray(), db.matches.toArray()]);
    const robots = scoutedRobots({
      submissions,
      reports,
      events,
      matches,
      cycleOpts: { burstWindowMs: DEFAULT_SETTINGS.cycleBurstWindowSec * 1000, outlierCapMs: DEFAULT_SETTINGS.cycleOutlierCapSec * 1000 },
      disagreePoints: DEFAULT_SETTINGS.scoutDisagreePoints,
    });
    csv(
      'scouting-by-robot',
      robots.map((r) => {
        const t = r.totals;
        const row: Record<string, unknown> = {
          submission: r.submission.id,
          match: r.submission.match_key,
          alliance: r.submission.alliance,
          team: r.team,
          scout: r.submission.scout_name,
          robots_watched: r.submission.robot_count,
          source: r.submission.source,
          auto_pts: r.points.auto,
          teleop_pts: r.points.teleop,
          endgame_pts: r.points.endgame,
          total_pts: r.points.total,
          taxi: t.auto.taxi,
          parked: t.parked,
          haul_carrots: t.haul.carrot,
          haul_cakes: t.haul.cake,
          oven_carrots: t.auto.oven.carrot + t.teleop.oven.carrot,
          oven_cakes: t.auto.oven.cake + t.teleop.oven.cake,
          cycles: r.cycles?.cycles.length ?? '',
          flags: (r.report?.flags ?? t.flags).join(' '),
          defense: r.report?.defense_played ? r.report.defense_type ?? 'yes' : '',
          driver_rating: r.report?.driver_rating ?? '',
          note: r.report?.note ?? '',
        };
        for (const s of SHELVES) {
          row[`carrot_${s}`] = t.auto.pantry.carrot[s] + t.teleop.pantry.carrot[s];
          row[`cake_${s}`] = t.auto.pantry.cake[s] + t.teleop.pantry.cake[s];
        }
        return row;
      }),
    );
  };

  const exportEvents = async () => csv('scout-events', (await db.scout_events.toArray()) as unknown as Record<string, unknown>[]);
  const exportPit = async () => {
    const reports = await db.pit_reports.toArray();
    const teams = [...new Set(reports.map((r) => r.team_id))];
    csv(
      'pit-catalog',
      teams.map((team) => ({ team, ...Object.fromEntries(Object.entries(mergePit(reports.filter((r) => r.team_id === team))).map(([k, v]) => [k, Array.isArray(v) ? v.join(' ') : v])) })),
    );
  };
  const exportPicklists = async () =>
    csv(
      'picklists',
      (await db.picklist_entries.toArray())
        .sort((a, b) => a.picking_team.localeCompare(b.picking_team) || a.tier.localeCompare(b.tier) || a.position - b.position)
        .map((e) => ({ picking_team: e.picking_team, tier: e.tier, position: e.position, team: e.team_id, note: e.note, dnp_reason: e.dnp_reason, dnp_note: e.dnp_note })),
    );

  const exportAll = async () => {
    const tables = ['teams', 'team_aliases', 'matches', 'rankings', 'official_alliances', 'scout_submissions', 'robot_reports', 'scout_events', 'pit_reports', 'photos', 'picklist_entries', 'picklist_votes', 'picklist_snapshots', 'picklist_meta', 'draft_actions', 'strategy_notes', 'pit_checks', 'scout_assignments', 'settings'] as const;
    const out: Record<string, unknown> = { kind: 'harvest-havoc-full-export', exported_at: new Date().toISOString() };
    for (const t of tables) out[t] = await (db as unknown as Record<string, { toArray: () => Promise<unknown[]> }>)[t].toArray();
    downloadText(`full-export-${stamp()}.json`, JSON.stringify(out), 'application/json');
    setMsg('Full JSON export downloaded.');
  };

  const items: [string, () => void | Promise<void>][] = [
    ['Official matches (CSV)', exportMatches],
    ['Team stats (CSV)', exportTeamStats],
    ['Scouting by robot (CSV)', exportScouting],
    ['Raw tap events (CSV)', exportEvents],
    ['Pit catalog (CSV)', exportPit],
    ['Pick lists (CSV)', exportPicklists],
    ['Everything (JSON)', exportAll],
  ];
  return (
    <Card title="Exports">
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map(([label, fn]) => (
          <Button key={label} onClick={() => void fn()} className="justify-start">
            <Download size={16} /> {label}
          </Button>
        ))}
      </div>
      {msg && <p className="mt-3 text-sm text-good">{msg}</p>}
    </Card>
  );
}
