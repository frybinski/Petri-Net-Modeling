import { afterEach, describe, expect, it, vi } from 'vitest';
import { installLiveApi, removeLiveApi, toLiveEvents } from './live-api';
import { parseLiveLines } from './replay-log';

describe('parseLiveLines', () => {
  it('reads case and activity, with lifecycle and time in any order', () => {
    const { events, skipped } = parseLiveLines(
      [
        'C-1,Scannen',
        'C-1,Sortieren,start',
        'C-2,Scannen,complete,12.5',
        'C-3,Scannen,7,start',
        '  C-4 ; Verladen ; 3 ',
        '',
        '# a remark',
      ].join('\n'),
    );
    expect(skipped).toBe(0);
    expect(events).toEqual([
      { caseId: 'C-1', activity: 'Scannen', lifecycle: 'complete' },
      { caseId: 'C-1', activity: 'Sortieren', lifecycle: 'start' },
      { caseId: 'C-2', activity: 'Scannen', lifecycle: 'complete', time: 12.5 },
      { caseId: 'C-3', activity: 'Scannen', lifecycle: 'start', time: 7 },
      { caseId: 'C-4', activity: 'Verladen', lifecycle: 'complete', time: 3 },
    ]);
  });

  it('skips a header, counts lines it cannot use and honours quotes and tabs', () => {
    const { events, skipped } = parseLiveLines(
      'case_id,activity,timestamp,lifecycle\n"C,1","Check, then pay",2026-01-05T08:00:00Z,start\nlonely\nC-2\tPay\r\n,Pay',
    );
    expect(skipped).toBe(2);
    expect(events).toEqual([
      { caseId: 'C,1', activity: 'Check, then pay', lifecycle: 'start' },
      { caseId: 'C-2', activity: 'Pay', lifecycle: 'complete' },
    ]);
  });
});

describe('the console API', () => {
  afterEach(() => {
    removeLiveApi();
  });

  it('takes case or caseId and defaults the lifecycle', () => {
    expect(
      toLiveEvents([
        { case: 'a', activity: 'X' },
        { caseId: 'b', activity: 'Y', lifecycle: 'start', time: 4 },
      ]),
    ).toEqual([
      { caseId: 'a', activity: 'X', lifecycle: 'complete' },
      { caseId: 'b', activity: 'Y', lifecycle: 'start', time: 4 },
    ]);
    expect(() => toLiveEvents([{ activity: 'X' }])).toThrow(/Event 1/);
    expect(() => toLiveEvents([{ case: 'a' } as never])).toThrow(/activity/);
  });

  it('is installed on window.pnm.live and removed without disturbing the rest of window.pnm', async () => {
    const host = window as unknown as { pnm?: Record<string, unknown> };
    host.pnm = { other: 1 };
    const push = vi.fn(() => Promise.resolve());
    installLiveApi({ push, close: () => Promise.resolve() });
    const live = host.pnm?.['live'] as { push(events: unknown[]): Promise<void>; help: string };
    expect(host.pnm?.['other']).toBe(1);
    await live.push([{ case: 'a', activity: 'X' }]);
    expect(push).toHaveBeenCalledWith([{ caseId: 'a', activity: 'X', lifecycle: 'complete' }]);
    await expect(live.push([{ activity: 'X' }])).rejects.toThrow(/needs a "case"/);
    expect(live.help).toContain('push');
    removeLiveApi();
    expect(host.pnm).toEqual({ other: 1 });
    delete host.pnm;
    installLiveApi({ push, close: () => Promise.resolve() });
    removeLiveApi();
    expect(host.pnm).toBeUndefined();
  });
});
