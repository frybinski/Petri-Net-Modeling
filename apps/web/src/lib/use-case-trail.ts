import { caseTrail, type TrailEntry } from '@pnm/domain';
import { useEffect, useReducer } from 'react';
import { eventLog, onSimEvents, onSimJump } from '../store/sim-log';

/**
 * The steps of one case so far, kept up to date from the stream of events. `null` follows no case.
 * The trail is built from the event log once and then extended with every new bundle.
 */
export function useCaseTrail(caseId: string | null): readonly TrailEntry[] {
  const [state, dispatch] = useReducer(
    (
      current: { caseId: string | null; trail: readonly TrailEntry[] },
      action:
        | { type: 'reset'; caseId: string | null }
        | { type: 'append'; entries: readonly TrailEntry[] },
    ) => {
      if (action.type === 'reset') {
        return {
          caseId: action.caseId,
          trail: action.caseId === null ? [] : caseTrail(eventLog.all(), action.caseId),
        };
      }
      return { ...current, trail: [...current.trail, ...action.entries] };
    },
    { caseId: null, trail: [] },
  );

  useEffect(() => {
    dispatch({ type: 'reset', caseId });
    if (caseId === null) return undefined;
    const offEvents = onSimEvents((events) => {
      const entries = caseTrail(events, caseId);
      if (entries.length > 0) dispatch({ type: 'append', entries });
    });
    const offJump = onSimJump(() => {
      dispatch({ type: 'reset', caseId });
    });
    return () => {
      offEvents();
      offJump();
    };
  }, [caseId]);

  // Until the effect has caught up with a new case the trail of the old one is not shown.
  return state.caseId === caseId ? state.trail : [];
}
