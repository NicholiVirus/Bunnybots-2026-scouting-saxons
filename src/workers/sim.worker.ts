/// <reference lib="webworker" />
/** Heavy Monte Carlo off the UI thread (rank/captain predictor, bracket, accept/decline). */
import { acceptOrDecline, predictBracket, predictEvent } from '@/selection/eventSim';

type Msg =
  | { id: number; type: 'predictEvent'; payload: Parameters<typeof predictEvent> }
  | { id: number; type: 'predictBracket'; payload: Parameters<typeof predictBracket> }
  | { id: number; type: 'acceptOrDecline'; payload: Parameters<typeof acceptOrDecline> };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    let result: unknown;
    if (m.type === 'predictEvent') result = predictEvent(...m.payload);
    else if (m.type === 'predictBracket') result = predictBracket(...m.payload);
    else result = acceptOrDecline(...m.payload);
    (self as unknown as Worker).postMessage({ id: m.id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, error: String((err as Error)?.message ?? err) });
  }
};
