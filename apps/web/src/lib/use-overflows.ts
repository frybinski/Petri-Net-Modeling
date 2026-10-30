import { counterOverflows, type CounterOverflow } from '@pnm/domain';
import { useMemo } from 'react';
import { en } from '../i18n/en';
import { useEditorStore } from '../store/editor-store';
import { validDomainView } from './domain-view';

/**
 * The fill levels of the domain view that hold more than their limit: in the simulation those of
 * the simulated marking, otherwise those of the initial marking. Empty without a valid view.
 */
export function useFillOverflows(): CounterOverflow[] {
  const net = useEditorStore((s) => s.net);
  const marking = useEditorStore((s) => (s.mode === 'simulate' ? s.simMarking : null));
  const view = useMemo(() => validDomainView(net), [net]);
  return useMemo(
    () => (view ? counterOverflows(net, view, marking ?? net.marking) : []),
    [net, view, marking],
  );
}

/** The sentences of the status of the view for a list of overflows. */
export function overflowMessages(overflows: readonly CounterOverflow[]): string[] {
  return overflows.map((o) => en.domain.overflow(o.name, o.count, o.max));
}
