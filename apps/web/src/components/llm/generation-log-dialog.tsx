import { parseGeneration } from '@pnm/llm/record';
import { useMemo } from 'react';
import { en } from '../../i18n/en';
import { useEditorStore } from '../../store/editor-store';
import { useGenerationStore } from '../../store/generation-store';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Details, PromptBlock, RecordSummary, RoundLogList } from './generation-parts';

/** The log of the generation that is stored with the net: model, rounds, findings and prompt. */
export function GenerationLogDialog() {
  const open = useGenerationStore((s) => s.logOpen);
  const setOpen = useGenerationStore((s) => s.setLogOpen);
  const stored = useEditorStore((s) => s.net.domainViewGeneration);
  const record = useMemo(() => parseGeneration(stored), [stored]);
  const close = (): void => {
    setOpen(false);
  };
  return (
    <Dialog
      open={open && record !== null}
      title={en.llm.logTitle}
      onClose={close}
      width="max-w-3xl"
      footer={<Button onClick={close}>{en.llm.close}</Button>}
    >
      {record ? (
        <div className="flex flex-col gap-4" data-testid="llm-log">
          <RecordSummary record={record} />
          <Details title={`${en.llm.rounds} (${record.rounds.length})`}>
            <RoundLogList rounds={record.rounds} />
          </Details>
          {record.filled.length + record.dropped.length > 0 ? (
            <Details title={en.llm.logPaths}>
              <pre className="m-0 max-h-48 overflow-auto font-mono text-[11px] leading-4 whitespace-pre-wrap">
                {[
                  ...record.filled.map((p) => `filled   ${p}`),
                  ...record.dropped.map((p) => `dropped  ${p}`),
                ].join('\n')}
              </pre>
            </Details>
          ) : null}
          <Details title={en.llm.promptTitle}>
            <PromptBlock prompt={record.prompt} />
          </Details>
        </div>
      ) : null}
    </Dialog>
  );
}
