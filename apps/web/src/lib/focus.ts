/** Gives the keyboard focus back to a node, so that Tab and F2 keep working after renaming. */
export function refocusNode(id: string): void {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: true });
  });
}

/** Gives the keyboard focus back to an arc after its label was edited. */
export function refocusEdge(id: string): void {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(`.react-flow__edge[data-id="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: true });
  });
}
