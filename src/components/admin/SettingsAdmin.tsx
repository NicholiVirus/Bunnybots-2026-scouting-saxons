'use client';
import { useState } from 'react';
import { useSettings } from '@/data/hooks';
import { putRow } from '@/data/repo';
import { SETTING_KEYS, type EventSettings } from '@/data/settings';
import { whoAmI } from '@/sync/auth';
import { Card, Field, Toggle, inputCls } from '@/components/ui';

export async function saveSetting<K extends keyof EventSettings>(key: K, value: EventSettings[K]) {
  await putRow('settings', { key: SETTING_KEYS[key], value, updated_by: whoAmI().id });
}

export function SettingsAdmin() {
  const s = useSettings();
  const [draft, setDraft] = useState({
    allianceCount: String(s.allianceCount),
    cycleOutlierCapSec: String(s.cycleOutlierCapSec),
    cycleBurstWindowSec: String(s.cycleBurstWindowSec),
    picklistAutoLock: s.picklistAutoLock ?? '',
  });

  return (
    <Card title="Event settings (sync to every device)">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Playoff alliances" hint="Up to 8; depends on how many teams are playoff-ready (FRC 10.6.6).">
          <input
            className={inputCls}
            type="number"
            min={2}
            max={8}
            value={draft.allianceCount}
            onChange={(e) => setDraft({ ...draft, allianceCount: e.target.value })}
            onBlur={() => void saveSetting('allianceCount', Math.min(8, Math.max(2, Number(draft.allianceCount) || 8)))}
          />
        </Field>
        <Field label="Pick list auto-lock (HH:MM, blank = manual)" hint="Strategists can lock any time; only admins unlock.">
          <input
            className={inputCls}
            placeholder="14:55"
            value={draft.picklistAutoLock}
            onChange={(e) => setDraft({ ...draft, picklistAutoLock: e.target.value })}
            onBlur={() => void saveSetting('picklistAutoLock', /^\d{1,2}:\d{2}$/.test(draft.picklistAutoLock) ? draft.picklistAutoLock : null)}
          />
        </Field>
        <Field label="Cycle outlier cap (s)" hint="Longer gaps are excluded and shown as “long gaps”.">
          <input
            className={inputCls}
            type="number"
            value={draft.cycleOutlierCapSec}
            onChange={(e) => setDraft({ ...draft, cycleOutlierCapSec: e.target.value })}
            onBlur={() => void saveSetting('cycleOutlierCapSec', Math.max(5, Number(draft.cycleOutlierCapSec) || 60))}
          />
        </Field>
        <Field label="Multi-piece burst window (s)" hint="Placements this close together (no intake between) count as one cycle. 0 = every placement.">
          <input
            className={inputCls}
            type="number"
            step="0.5"
            value={draft.cycleBurstWindowSec}
            onChange={(e) => setDraft({ ...draft, cycleBurstWindowSec: e.target.value })}
            onBlur={() => void saveSetting('cycleBurstWindowSec', Math.max(0, Number(draft.cycleBurstWindowSec) || 0))}
          />
        </Field>
      </div>
      <div className="mt-4">
        <Toggle checked={s.splashEnabled} onChange={(v) => void saveSetting('splashEnabled', v)} label="Launch logo animation for everyone" />
      </div>
      <div className="mt-2 text-xs text-muted">Changes save when you leave a field.</div>
    </Card>
  );
}
