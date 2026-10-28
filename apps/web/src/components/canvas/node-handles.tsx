import { Handle, Position } from '@xyflow/react';

const SIDES = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
] as const;

/**
 * Connection handles on all four sides. Arcs are drawn between node centers, so the
 * handles only serve as drag sources; with the loose connection mode every handle also
 * accepts a drop.
 */
export function NodeHandles() {
  return (
    <>
      {SIDES.map((side) => (
        <Handle key={side.id} id={side.id} type="source" position={side.position} />
      ))}
    </>
  );
}
