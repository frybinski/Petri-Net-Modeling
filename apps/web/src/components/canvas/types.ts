import type { Id } from '@pnm/core';
import type { Edge, Node } from '@xyflow/react';

export interface PlaceNodeData extends Record<string, unknown> {
  name: string;
  tokens: number;
  /** JSON net: tokens are shown as a number and short labels instead of dots. */
  json: boolean;
  /** Short labels of the first tokens (JSON nets), shown as chips next to a selected place. */
  chips: string[];
  /** Number of tokens beyond the chips. */
  chipsMore: number;
  /** Type name, shown as a badge when inscriptions are visible. */
  typeName?: string;
  capacity?: number;
  hasError: boolean;
  /** First error message of the element. */
  errorText?: string;
  isArcSource: boolean;
  renaming: boolean;
}

export interface TransitionNodeData extends Record<string, unknown> {
  name: string;
  /** Guard text, shown in a pill above the transition when inscriptions are visible. */
  guard?: string;
  /** Number of bindings while simulating. */
  bindings: number;
  /** The binding list is open (simulation). */
  picking: boolean;
  /** Only set while simulating. */
  enabled: boolean;
  simulating: boolean;
  hasError: boolean;
  /** First error message of the element. */
  errorText?: string;
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
  /** Inscription text shown instead of the weight (JSON nets). */
  inscription?: string;
  hasError: boolean;
  arcId: Id;
}

export type ArcFlowEdge = Edge<ArcEdgeData, 'arc'>;
