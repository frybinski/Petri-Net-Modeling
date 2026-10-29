import type { Id, PetriNet } from '@pnm/core';
import type { ActivityMapping } from './types';

/** The text in lower case without spaces, `_` and `-`, so that `Check Credit` and `check_credit` compare equal. */
function squash(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/** The only element of `ids`, or `undefined` if there are none or several. */
function only(ids: readonly Id[]): Id | undefined {
  return ids.length === 1 ? ids[0] : undefined;
}

/** A prefix shorter than this is no evidence. */
const MIN_PREFIX = 3;

/**
 * Proposes which transition each activity of a log belongs to. An activity is matched, in this
 * order, by the same name, the same name when case, spaces, `_` and `-` are ignored, the id of
 * the transition, and last by a name that is the beginning of the other (`Verladen` for `Verladen
 * Tor 1`). A rule counts only if it finds exactly one transition; an ambiguous activity stays
 * unmatched. Unmatched activities are listed and left out of the mapping.
 */
export function autoMapActivities(
  net: PetriNet,
  activities: readonly string[],
): { mapping: ActivityMapping; unmatched: string[] } {
  const mapping: ActivityMapping = {};
  const unmatched: string[] = [];
  const transitions = net.transitions.map((t) => ({
    id: t.id,
    name: t.name,
    flat: squash(t.name),
    flatId: squash(t.id),
  }));
  for (const activity of activities) {
    const flat = squash(activity);
    const found =
      only(transitions.filter((t) => t.name === activity).map((t) => t.id)) ??
      (flat === ''
        ? undefined
        : only(transitions.filter((t) => t.flat === flat).map((t) => t.id))) ??
      only(
        transitions
          .filter((t) => t.id === activity || (flat !== '' && t.flatId === flat))
          .map((t) => t.id),
      ) ??
      (flat.length < MIN_PREFIX
        ? undefined
        : only(
            transitions
              .filter(
                (t) =>
                  (t.flat.length >= MIN_PREFIX && t.flat.startsWith(flat)) ||
                  (t.flat.length >= MIN_PREFIX && flat.startsWith(t.flat)),
              )
              .map((t) => t.id),
          ));
    if (found === undefined) unmatched.push(activity);
    else mapping[activity] = found;
  }
  return { mapping, unmatched };
}
