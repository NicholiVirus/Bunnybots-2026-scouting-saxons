'use client';
/**
 * PUBLIC read-only alliance-selection board (share link). No login: data comes
 * from the token-gated get_public_board() RPC (admin toggle, default OFF,
 * revocable). Never shows notes or Do-Not-Pick reasons.
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import brand from '@/generated/brand.json';
import { getSupabase } from '@/sync/supabase';
import { deriveDraft, type DraftStep } from '@/selection/draft';
import type { OfficialAlliance, RankingRow } from '@/data/types';
import { OUR_TEAMS, isOurTeam } from '@/config/event';
import { displayTeam } from '@/lib/teamIds';
import { formatAgo } from '@/lib/util';
import { cx } from '@/components/ui';

interface PublicBoard {
  generated_at: string;
  teams: { id: string; name: string; status: string }[];
  rankings: RankingRow[];
  official_alliances: OfficialAlliance[];
  draft_actions: DraftStep[];
  picklists: { picking_team: string; team_id: string; tier: 'first' | 'second'; position: number }[];
  alliance_count: number | null;
}

export default function PublicBoardPage() {
  return (
    <Suspense fallback={null}>
      <PublicBoardInner />
    </Suspense>
  );
}

function PublicBoardInner() {
  const token = useSearchParams().get('t') ?? '';
  const [data, setData] = useState<PublicBoard | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'off' | 'noserver'>('loading');
  const [at, setAt] = useState(0);
  const [team, setTeam] = useState<string>(OUR_TEAMS[0]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setState('noserver');
      return;
    }
    let stop = false;
    const load = async () => {
      const { data: d, error } = await sb.rpc('get_public_board', { p_token: token });
      if (stop) return;
      if (error || !d) setState((cur) => (error ? cur : 'off'));
      else {
        setData(d as PublicBoard);
        setState('ok');
        setAt(Date.now());
      }
    };
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [token]);

  const draft = useMemo(() => {
    if (!data) return null;
    const ranked = [...data.rankings].sort((a, b) => a.rank - b.rank).map((r) => r.team_id);
    const official = data.official_alliances.some((a) => a.first_pick || a.second_pick) ? data.official_alliances : null;
    return deriveDraft(ranked, Number(data.alliance_count) || 8, data.draft_actions, official);
  }, [data]);

  if (state === 'noserver') return <Message text="The public board needs the team's Supabase server (this build runs in local-only mode)." />;
  if (state === 'off') return <Message text="This link is turned off or was replaced. Ask the team for a new one." />;
  if (!data || !draft) return <Message text="Loading…" />;

  const list = data.picklists.filter((p) => p.picking_team === team);
  return (
    <div className="min-h-dvh bg-bg p-4 text-fg sm:p-8">
      <header className="mb-6 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.still ?? '/icons/icon-192.png'} alt="" className="h-12 w-12" />
        <div>
          <h1 className="text-2xl font-black">Alliance selection — live</h1>
          <p className="text-sm text-muted">Saxon Robotics 611 · 526 · read-only · updated {formatAgo(at)}</p>
        </div>
      </header>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 text-lg font-bold">
            {draft.turn ? `Round ${draft.turn.round} · Alliance ${draft.turn.alliance} picking` : 'Selection complete'}
          </div>
          <table className="w-full text-lg">
            <tbody>
              {draft.alliances
                .filter((a) => a.captain)
                .map((a) => (
                  <tr key={a.number} className={cx('border-t border-line', [a.captain, ...a.picks].some((t) => t && isOurTeam(t)) && 'ours')}>
                    <td className="py-2 pr-3 font-black">{a.number}</td>
                    {[a.captain, ...a.picks].map((t, i) => (
                      <td key={i} className={cx('py-2 pr-3 font-bold tnum', i === 0 && a.projected && 'italic opacity-60')}>
                        {t ? displayTeam(t) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
          {!draft.done && (
            <div className="mt-4">
              <div className="mb-1 text-sm text-muted">Available</div>
              <div className="flex flex-wrap gap-2">
                {draft.available.map((t) => (
                  <span key={t} className="rounded-lg bg-surface-2 px-2 py-1 font-bold tnum">
                    {displayTeam(t)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className="rounded-2xl border border-line bg-surface p-4">
          <div className="mb-2 flex gap-2">
            {OUR_TEAMS.map((t) => (
              <button key={t} onClick={() => setTeam(t)} className={cx('h-10 rounded-lg px-3 font-bold', team === t ? 'bg-saxon text-saxon-ink' : 'bg-surface-2')}>
                {t} list
              </button>
            ))}
          </div>
          {(['first', 'second'] as const).map((tier) => (
            <div key={tier} className="mb-3">
              <div className="text-sm text-muted">{tier === 'first' ? '1st pick' : '2nd pick'}</div>
              <ol className="mt-1 space-y-1">
                {list
                  .filter((p) => p.tier === tier)
                  .sort((a, b) => a.position - b.position)
                  .map((p, i) => (
                    <li key={p.team_id} className={cx('font-bold tnum', draft.onAlliance.has(p.team_id) && 'line-through opacity-40')}>
                      {i + 1}. {displayTeam(p.team_id)}
                    </li>
                  ))}
              </ol>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function Message({ text }: { text: string }) {
  return <div className="flex min-h-dvh items-center justify-center p-6 text-center text-muted">{text}</div>;
}
