'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { officialStore } from '@/sources/apply';
import { SOURCE_LABEL } from '@/sources/DataSource';
import { useSettings } from '@/data/hooks';
import { usePrefs } from '@/lib/prefs';
import { formatAgo } from '@/lib/util';
import { cx } from './ui';

/** "Results updated 40 s ago · source: Bunnybots Alliance" */
export function FreshnessBanner({ className }: { className?: string }) {
  const s = officialStore.use();
  const settings = useSettings();
  const prefs = usePrefs();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stale = s.lastSuccessAt !== null && now - s.lastSuccessAt > Math.max(90_000, settings.pollIntervalSec * 3000);
  let text: string;
  let tone = 'text-muted';
  let Icon = Clock;
  if (prefs.demo) {
    text = `Demo data · source: ${SOURCE_LABEL.demo}`;
  } else if (s.lastSuccessAt) {
    text = `Results updated ${formatAgo(s.lastSuccessAt, now)} · source: ${SOURCE_LABEL[s.source ?? 'api']}`;
    tone = stale || s.lastError ? 'text-warn' : 'text-good';
    Icon = stale || s.lastError ? AlertTriangle : CheckCircle2;
  } else if (settings.dataMode === 'manual') {
    text = 'Results: manual entry by admins';
  } else if (!settings.tbaUrl) {
    text = 'Results feed not set — an admin adds the Bunnybots Alliance URL in Admin → Data sources';
  } else {
    text = 'Waiting for the first results…';
  }
  return (
    <div className={cx('flex items-center gap-2 text-xs', tone, className)} data-testid="freshness">
      <Icon size={14} className={s.polling ? 'animate-pulse' : ''} />
      <span>{text}</span>
      {s.lastError && !prefs.demo && <span className="text-warn">· last try failed: {s.lastError.slice(0, 80)}</span>}
    </div>
  );
}
