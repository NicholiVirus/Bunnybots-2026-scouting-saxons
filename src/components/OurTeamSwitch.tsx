'use client';
import { setPrefs, usePrefs } from '@/lib/prefs';
import { cx } from './ui';

/** Header filter for every "our team" view: 611 / 526 / Both. */
export function OurTeamSwitch() {
  const prefs = usePrefs();
  const opts: { v: '611' | '526' | 'both'; label: string }[] = [
    { v: '611', label: '611' },
    { v: '526', label: '526' },
    { v: 'both', label: 'Both' },
  ];
  return (
    <div className="flex rounded-xl border border-line bg-surface-2 p-0.5" title="Our team filter">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => setPrefs({ ourTeam: o.v })}
          className={cx(
            'h-9 rounded-lg px-2.5 text-sm font-semibold tnum',
            prefs.ourTeam === o.v ? 'bg-saxon text-saxon-ink' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ourTeamsFor(filter: '611' | '526' | 'both'): string[] {
  return filter === 'both' ? ['611', '526'] : [filter];
}
