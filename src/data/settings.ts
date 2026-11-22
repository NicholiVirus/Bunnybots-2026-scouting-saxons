/** Synced (admin-controlled) settings, merged over defaults. */
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { EVENT } from '@/config/event';
import type { SettingRow } from './types';

export interface EventSettings {
  tbaUrl: string;
  dataMode: 'live' | 'manual';
  pollIntervalSec: number;
  allianceCount: number;
  cycleOutlierCapSec: number;
  cycleBurstWindowSec: number;
  picklistAutoLock: string | null;
  publicBoard: { enabled: boolean; token: string };
  branding: { path: string; type: string; updated_at: string } | null;
  splashEnabled: boolean;
  draftSource: 'auto' | 'official' | 'local';
}

export const SETTING_KEYS = {
  tbaUrl: 'tba_url',
  dataMode: 'data_mode',
  pollIntervalSec: 'poll_interval_sec',
  allianceCount: 'alliance_count',
  cycleOutlierCapSec: 'cycle_outlier_cap_sec',
  cycleBurstWindowSec: 'cycle_burst_window_sec',
  picklistAutoLock: 'picklist_auto_lock',
  publicBoard: 'public_board',
  branding: 'branding',
  splashEnabled: 'splash_enabled',
  draftSource: 'draft_source',
} as const satisfies Record<keyof EventSettings, string>;

export function readSettings(rows: SettingRow[] | undefined): EventSettings {
  const m = new Map((rows ?? []).map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => {
    const v = Number(m.get(k));
    return Number.isFinite(v) && m.has(k) && m.get(k) !== null ? v : d;
  };
  const pb = (m.get('public_board') as { enabled?: boolean; token?: string } | null) ?? null;
  return {
    tbaUrl: String((m.get('tba_url') as string) || EVENT.defaultTbaUrl || ''),
    dataMode: (m.get('data_mode') as 'live' | 'manual') === 'manual' ? 'manual' : 'live',
    pollIntervalSec: Math.max(10, num('poll_interval_sec', DEFAULT_SETTINGS.pollIntervalSec)),
    allianceCount: Math.min(8, Math.max(2, num('alliance_count', DEFAULT_SETTINGS.allianceCount))),
    cycleOutlierCapSec: num('cycle_outlier_cap_sec', DEFAULT_SETTINGS.cycleOutlierCapSec),
    cycleBurstWindowSec: num('cycle_burst_window_sec', DEFAULT_SETTINGS.cycleBurstWindowSec),
    picklistAutoLock: m.has('picklist_auto_lock') ? ((m.get('picklist_auto_lock') as string | null) ?? null) : DEFAULT_SETTINGS.picklistAutoLock,
    publicBoard: { enabled: !!pb?.enabled, token: pb?.token ?? '' },
    branding: (m.get('branding') as EventSettings['branding']) ?? null,
    splashEnabled: m.has('splash_enabled') ? m.get('splash_enabled') !== false : true,
    draftSource: ((m.get('draft_source') as EventSettings['draftSource']) || 'auto') as EventSettings['draftSource'],
  };
}
