'use client';
import { useState } from 'react';
import type { StatMode } from '@/analytics/pickScore';
import { Empty, PageTitle, Segmented, cx } from '@/components/ui';
import { useSelection } from '@/components/selection/useSelection';
import { usePrediction } from '@/components/selection/usePrediction';
import { PickingAs } from '@/components/selection/PickingAs';
import { Board } from '@/components/selection/Board';
import { Picklist } from '@/components/selection/Picklist';
import { Suggestions } from '@/components/selection/Suggestions';
import { Simulator } from '@/components/selection/Simulator';
import { AcceptDecline, Predictor } from '@/components/selection/Predictor';
import { Meeting } from '@/components/selection/Meeting';
import { QuickCard } from '@/components/selection/QuickCard';

type Tab = 'board' | 'list' | 'suggest' | 'sim' | 'predict' | 'meeting' | 'quick';

export default function SelectionPage() {
  const [mode, setMode] = useState<StatMode>('avg');
  const s = useSelection(mode);
  const { pred, busy, inputs } = usePrediction(s);
  const [tab, setTab] = useState<Tab>('board');
  const [projector, setProjector] = useState(false);

  if (!s.model) return null;
  if (!s.ranked.length)
    return <Empty title="No rankings yet">Alliance selection needs qualification results (or a schedule + manual results).</Empty>;

  if (projector)
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-bg p-6">
        <Board s={s} projector setProjector={setProjector} />
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitle sub="Live draft board, pick lists, simulations">Alliance selection</PageTitle>
      <PickingAs s={s} />
      <div className="scroll-x mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'board', label: 'Board' },
            { value: 'list', label: 'Pick list' },
            { value: 'suggest', label: 'Suggestions' },
            { value: 'sim', label: 'Simulator' },
            { value: 'predict', label: 'Predictor' },
            { value: 'meeting', label: 'Meeting' },
            { value: 'quick', label: 'Quick card' },
          ]}
        />
      </div>
      <div className={cx(tab !== 'board' && 'hidden')}>
        <Board s={s} projector={false} setProjector={setProjector} />
      </div>
      {tab === 'list' && <Picklist s={s} />}
      {tab === 'suggest' && <Suggestions s={s} pred={pred} busy={busy} mode={mode} setMode={setMode} />}
      {tab === 'sim' && <Simulator s={s} inputs={inputs} />}
      {tab === 'predict' && (
        <div className="space-y-4">
          <Predictor s={s} pred={pred} busy={busy} />
          <AcceptDecline s={s} inputs={inputs} />
        </div>
      )}
      {tab === 'meeting' && <Meeting s={s} />}
      {tab === 'quick' && <QuickCard s={s} pred={pred} />}
    </div>
  );
}
