import { ViewportPortal } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { FLIGHT_MS, MAX_FLIGHTS, easeInOut, planFlights } from '../../lib/token-flight';
import { onSimEvents } from '../../store/sim-log';
import type { ArcFlowEdge } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Flight {
  dot: SVGCircleElement;
  path: SVGPathElement;
  length: number;
  start: number;
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Draws a token that moves along an arc whenever a firing starts or ends. The movement lasts
 * `FLIGHT_MS` whatever the speed of the simulation; with `prefers-reduced-motion` tokens just
 * appear. It is drawn without React state: one frame callback moves the dots directly.
 */
export function TokenFlights({ edges }: { edges: readonly ArcFlowEdge[] }) {
  const group = useRef<SVGGElement>(null);
  const paths = useRef(new Map<string, string>());
  const flights = useRef<Flight[]>([]);
  const frame = useRef(0);

  // The newest paths are kept in a ref, so that the subscription below does not restart.
  useEffect(() => {
    paths.current = new Map(edges.map((e) => [`${e.source}>${e.target}`, e.data?.path ?? '']));
  }, [edges]);

  useEffect(() => {
    const host = group.current;
    if (!host) return;

    const tick = (): void => {
      frame.current = 0;
      const now = performance.now();
      const alive: Flight[] = [];
      for (const flight of flights.current) {
        const k = Math.min(1, (now - flight.start) / FLIGHT_MS);
        const point = flight.path.getPointAtLength(easeInOut(k) * flight.length);
        flight.dot.setAttribute('cx', String(point.x));
        flight.dot.setAttribute('cy', String(point.y));
        if (k >= 1) {
          flight.dot.remove();
          flight.path.remove();
        } else {
          alive.push(flight);
        }
      }
      flights.current = alive;
      if (alive.length > 0) frame.current = requestAnimationFrame(tick);
    };

    const unsubscribe = onSimEvents((events) => {
      if (reducedMotion() || document.hidden) return;
      const room = MAX_FLIGHTS - flights.current.length;
      if (room <= 0) return;
      const wanted = planFlights(
        events,
        (s, t) => paths.current.get(`${s}>${t}`) || undefined,
        room,
      );
      const start = performance.now();
      for (const d of wanted) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'none');
        host.append(path);
        const length = path.getTotalLength();
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('r', '5');
        dot.setAttribute('class', 'pn-flight');
        dot.setAttribute('data-testid', 'token-flight');
        const first = path.getPointAtLength(0);
        dot.setAttribute('cx', String(first.x));
        dot.setAttribute('cy', String(first.y));
        host.append(dot);
        flights.current.push({ dot, path, length, start });
      }
      if (frame.current === 0 && flights.current.length > 0) {
        frame.current = requestAnimationFrame(tick);
      }
    });

    return () => {
      unsubscribe();
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
      frame.current = 0;
      for (const flight of flights.current) {
        flight.dot.remove();
        flight.path.remove();
      }
      flights.current = [];
    };
  }, []);

  return (
    <ViewportPortal>
      <svg
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width="1"
        height="1"
        aria-hidden="true"
      >
        <g ref={group} />
      </svg>
    </ViewportPortal>
  );
}
