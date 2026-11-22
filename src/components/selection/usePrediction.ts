'use client';
import { useMemo, useState } from 'react';
import { OUR_TEAMS } from '@/config/event';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { buildSimInputs } from '@/selection/inputs';
import type { EventPrediction, SimInputs } from '@/selection/eventSim';
import { runSim, useSimOnChange } from '@/selection/useSim';
import { hashString } from '@/lib/util';
import type { Selection } from './useSelection';

/** Rank/captain/availability prediction for the current state (worker, debounced). */
export function usePrediction(s: Selection) {
  const [pred, setPred] = useState<EventPrediction | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs: SimInputs | null = useMemo(() => {
    if (!s.model || !s.ranked.length) return null;
    return buildSimInputs(s.model, {
      matches: s.matches,
      ranked: s.ranked,
      allianceCount: s.settings.allianceCount,
      actions: s.actions,
      official: s.official,
      useOfficial: s.useOfficial,
      first: s.first,
      second: s.second,
      guesses: s.meta?.captain_guesses ?? {},
      rpRuns: 200,
    });
  }, [s.model, s.ranked, s.matches, s.settings.allianceCount, s.actions, s.official, s.useOfficial, s.first, s.second, s.meta?.captain_guesses]);
  const focus = [...new Set([...OUR_TEAMS, s.pickingAs])];
  const key = inputs ? hashString(JSON.stringify([inputs.records, inputs.remaining.length, inputs.draftSteps, inputs.official, inputs.allianceCount, focus, Object.keys(inputs.pickValue1).length, s.first.slice(0, 5).map((r) => r.score), inputs.guesses])) : '';
  useSimOnChange(
    key,
    !!inputs,
    async () => {
      setBusy(true);
      try {
        return await runSim('predictEvent', inputs!, { runs: DEFAULT_SETTINGS.simRuns, seed: 1234, focus });
      } finally {
        setBusy(false);
      }
    },
    setPred,
  );
  return { pred, busy, inputs, focus };
}
