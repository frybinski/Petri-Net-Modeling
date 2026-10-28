import type { Id } from '@pnm/core';
import type { Edge, Node } from '@xyflow/react';

export interface PlaceNodeData extends Record<string, unknown> {
  name: string;
  tokens: number;
  capacity?: number;
  hasError: boolean;
  isArcSource: boolean;
  renaming: boolean;
}

export interface TransitionNodeData extends Record<string, unknown> {
  name: string;
  /** Only set while simulating. */
  enabled: boolean;
  simulating: boolean;
  hasError: boolean;
  isArcSource: boolean;
  renaming: boolean;
}

export interface AnnotationNodeData extends Record<string, unknown> {
  text: string;
  renaming: boolean;
}

export type PlaceFlowNode = Node<PlaceNodeData, 'place'>;
export type TransitionFlowNode = Node<TransitionNodeData, 'transition'>;
export type AnnotationFlowNode = Node<AnnotationNodeData, 'annotation'>;
export type FlowNode = PlaceFlowNode | TransitionFlowNode | AnnotationFlowNode;

export interface ArcEdgeData extends Record<string, unknown> {
  path: string;
  arrow: string;
  label: { x: number; y: number };
  weight: number;
  hasError: boolean;
  arcId: Id;
}

export type ArcFlowEdge = Edge<ArcEdgeData, 'arc'>;
