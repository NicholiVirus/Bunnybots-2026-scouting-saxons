'use client';
import { useState } from 'react';
import { Download, Maximize2, Minimize2, Undo2 } from 'lucide-react';
import { isOurTeam } from '@/config/event';
import { DNP_REASON_LABEL } from '@/data/types';
import { draftToCsv } from '@/selection/draft';
import { displayTeam } from '@/lib/teamIds';
import { downloadText } from '@/lib/util';
import { saveSetting } from '@/components/admin/SettingsAdmin';
import { useAuth, can } from '@/sync/auth';
import { Badge, Button, Card, Segmented, cx, fmt } from '@/components/ui';
import { TeamChip, usePhotoMap } from '@/components/TeamChip';
import type { Selection } from './useSelection';

export function Board({ s, projector, setProjector }: { s: Selection; projector: boolean; setProjector: (v: boolean) => void }) {
  const auth = useAuth();
  const photos = usePhotoMap();
  const d = s.draft;
  const [acting, setActing] = useState<number | null>(null);
  const actingAlliance = acting ?? d.turn?.alliance ?? null;
  const tier = new Map(s.entries.map((e) => [e.team_id, e]));
  const scoreOf = new Map((d.turn?.round === 2 ? s.second : s.first).map((r) => [r.team, r.score]));
  const editable = s.canEditBoard && !projector;

  return (
    <div className={cx('space-y-4', projector && 'projector')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-lg font-bold" data-testid="turn">
          {d.turn ? (
            <>
              Round {d.turn.round} · Alliance {d.turn.alliance}
              {d.alliances[d.turn.alliance - 1]?.captain && ` (${displayTeam(d.alliances[d.turn.alliance - 1].captain)})`} is picking
            </>
          ) : (
            'Selection complete'
          )}
          {s.useOfficial && <Badge className="ml-2">synced from /api/alliances</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button size="sm" onClick={() => void s.undo()} data-testid="undo">
              <Undo2 size={16} /> Undo
            </Button>
          )}
          <Button size="sm" onClick={() => downloadText('alliance-selection.csv', draftToCsv(d), 'text/csv')}>
            <Download size={16} /> CSV
          </Button>
          <Button size="sm" onClick={() => setProjector(!projector)}>
            {projector ? <Minimize2 size={16} /> : <Maximize2 size={16} />} {projector ? 'Exit projector' : 'Projector'}
          </Button>
        </div>
      </div>

      <Card>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'auto 1fr 1fr 1fr' }}>
          <div className="text-xs text-muted">#</div>
          <div className="text-xs text-muted">Captain</div>
          <div className="text-xs text-muted">1st pick</div>
          <div className="text-xs text-muted">2nd pick</div>
          {d.alliances
            .filter((a) => a.captain)
            .map((a) => {
              const isTurn = d.turn?.alliance === a.number;
              const ours = [a.captain, ...a.picks].some((t) => t && isOurTeam(t));
              return [
                <button
                  key={`n${a.number}`}
                  onClick={() => setActing(a.number === acting ? null : a.number)}
                  className={cx('flex h-11 w-11 items-center justify-center rounded-lg font-black', isTurn ? 'bg-saxon text-saxon-ink' : actingAlliance === a.number ? 'bg-surface-2 ring-2 ring-saxon' : 'bg-surface-2')}
                  title="Tap to enter picks for this alliance"
                >
                  {a.number}
                </button>,
                ...[a.captain, a.picks[0], a.picks[1]].map((t, i) => (
                  <div key={`${a.number}-${i}`} className={cx('flex min-h-11 items-center rounded-lg px-2', ours ? 'ours' : 'bg-surface-2/60', i === 0 && a.projected && 'italic opacity-70')} data-testid={`slot-${a.number}-${i}`}>
                    {t ? <TeamChip team={t} photo={photos.get(t)} size={projector ? 34 : 24} /> : <span className="text-muted">—</span>}
                  </div>
                )),
              ];
            })}
        </div>
        <p className="mt-2 text-xs text-muted">Projected captains are in italics (they become fixed when that alliance picks).</p>
      </Card>

      {d.warnings.length > 0 && can.editBoard(auth.role) && (
        <ul className="rounded-xl bg-warn/10 p-2 text-xs text-warn">
          {d.warnings.slice(-3).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {!d.done && (
        <Card title={`Available (${d.available.length}) — rank order`}>
          <ul className="divide-y divide-line">
            {d.available.map((t) => {
              const e = tier.get(t);
              const st = s.model?.teams.get(t);
              return (
                <li key={t} className={cx('flex flex-wrap items-center gap-2 py-1.5', isOurTeam(t) && 'ours rounded-lg px-1')} data-testid={`avail-${t}`}>
                  <span className="w-8 text-xs text-muted tnum">#{d.ranked.indexOf(t) + 1}</span>
                  <TeamChip team={t} photo={photos.get(t)} size={projector ? 34 : 26} showName={!projector} />
                  {e && (
                    <Badge tone={e.tier === 'dnp' ? 'bad' : e.tier === 'first' ? 'saxon' : 'neutral'} title={e.tier === 'dnp' ? `${e.dnp_reason ? DNP_REASON_LABEL[e.dnp_reason] : ''} ${e.dnp_note ?? ''}` : e.note ?? ''}>
                      {e.tier === 'dnp' ? `DNP${e.dnp_reason ? ': ' + DNP_REASON_LABEL[e.dnp_reason] : ''}` : e.tier === 'first' ? '1st list' : '2nd list'}
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted tnum">
                    {st?.n ? `${fmt(st.points.mean)} pts` : ''} {scoreOf.has(t) ? `· score ${fmt(scoreOf.get(t), 0)}` : ''}
                  </span>
                  {editable && actingAlliance && (
                    <span className="flex gap-1">
                      <Button size="sm" variant="primary" onClick={() => void s.addAction({ action: 'pick', alliance: actingAlliance, team_id: t })} data-testid={`pick-${t}`}>
                        Pick → A{actingAlliance}
                      </Button>
                      <Button size="sm" onClick={() => void s.addAction({ action: 'decline', alliance: actingAlliance, team_id: t })}>
                        Declined
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {d.declined.size > 0 && (
        <Card title="Declined (can't be picked; can still captain)">
          <div className="flex flex-wrap gap-2">
            {[...d.declined.entries()].map(([t, a]) => (
              <Badge key={t} tone="warn">
                {displayTeam(t)} declined A{a}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {d.done && (
        <Card title="Backup robots (rank order)">
          <div className="flex flex-wrap gap-2">
            {d.backups.map((t, i) => (
              <Badge key={t}>
                {i + 1}. {displayTeam(t)}
              </Badge>
            ))}
            {!d.backups.length && <span className="text-sm text-muted">None.</span>}
          </div>
        </Card>
      )}

      {can.admin(auth.role) && !projector && (
        <Card title="Board settings (admin)">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              Alliances
              <select className="h-10 rounded-xl border border-line bg-surface-2 px-2" value={s.settings.allianceCount} onChange={(e) => void saveSetting('allianceCount', Number(e.target.value))}>
                {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <Segmented
              size="sm"
              value={s.settings.draftSource}
              onChange={(v) => void saveSetting('draftSource', v)}
              options={[
                { value: 'auto', label: 'Auto (official when available)' },
                { value: 'official', label: 'Official only' },
                { value: 'local', label: 'Local taps only' },
              ]}
            />
            <Button size="sm" variant="danger" onClick={() => confirm('Clear every pick on the board?') && void s.resetBoard()}>
              Reset board
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
