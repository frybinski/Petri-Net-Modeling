import { choiceProblems, type ChoiceProblem } from '@pnm/domain';
import { useMemo } from 'react';
import { useEditorStore } from '../store/editor-store';
import { useGenerationStore } from '../store/generation-store';

/** The problems of the form of the guided way (rules V10 to V12), for the fields and the buttons. */
export function useChoiceProblems(): ChoiceProblem[] {
  const net = useEditorStore((s) => s.net);
  const choices = useGenerationStore((s) => s.choices);
  return useMemo(() => (choices ? choiceProblems(net, choices) : []), [net, choices]);
}
