import { useStore, type ReactFlowState } from '@xyflow/react';

/**
 * While an arc is dragged: whether the node under the pointer would accept it. Other nodes,
 * and the node the arc comes from, report nothing.
 */
export function useDropState(id: string): 'valid' | 'invalid' | undefined {
  return useStore((s: ReactFlowState) => {
    const connection = s.connection;
    if (!connection.inProgress) return undefined;
    if (connection.toNode?.id !== id || connection.fromNode.id === id) return undefined;
    return connection.isValid === false ? 'invalid' : 'valid';
  });
}
