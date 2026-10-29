import type { Id } from '@pnm/core';
import type { Edge, Node } from '@xyflow/react';
import type { ChipSide } from '../../lib/flow-model';

export interface PlaceNodeData extends Record<string, unknown> {
  name: string;
  tokens: number;
  /** JSON net: tokens are shown as a number and short labels instead of dots. */
  json: boolean;
  /** Short labels of the first tokens (JSON nets), shown as chips next to a selected place. */
  chips: string[];
  /** Number of tokens beyond the chips. */
  chipsMore: number;
  /** Side of the node on which the chip card appears. */
  chipSide: ChipSide;
  /** Type name, shown as a badge when inscriptions are visible. */
  typeName?: string;
  capacity?: number;
  hasError: boolean;
  /** First error message of the element. */
  errorText?: string;
  isArcSource: boolean;
  renaming: boolean;
  /** The place is a queue that is filling up (timed simulation). */
  bottleneck?: 'warn' | 'crit';
  /** Pause when the place holds this many tokens. */
  breakpoint?: number;
  /** A replay just created a token on the place (a red ring for a moment). */
  deviation?: boolean;
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
  /** Description of the duration; set when the transition takes time. */
  timing?: string;
  /** Firings that have started and not finished. */
  running: number;
  /** Progress of the firing that finishes first, 0 to 1. */
  progress: number;
  breakpoint: boolean;
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
