#!/usr/bin/env node
// Writes the events of a few cases walking through a net (default: the smart office), with random
// durations, in a form that the live source of the app takes:
//
//   node scripts/live-demo.mjs > events.txt        paste the lines into "Paste events" (Source: Live)
//   node scripts/live-demo.mjs --format console    prints a window.pnm.live.push([...]) call for the
//                                                  browser console
//   node scripts/live-demo.mjs --format json        prints the events as a JSON array
//
// Options: --cases <n> (default 6), --gap <s> mean seconds between arrivals (default 120), --seed <n>
// (default 1), --scale <k> divides all times by k so that the demo is over in a couple of minutes
// (default 10), --net <file> another net (the walk follows its arcs; resources are respected).
//
// The script needs nothing but Node: it reads the net as JSON and does not run the engine.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** A small seeded generator (mulberry32), so that a demo can be repeated. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function duration(timing, random) {
  if (!timing) return 0;
  if (timing.kind === 'fixed') return timing.value;
  if (timing.kind === 'uniform') return timing.min + random() * (timing.max - timing.min);
  return -Math.log(1 - random()) * timing.mean;
}

/**
 * The events of `cases` cases that walk through `net`: events with `case`, `activity`, `lifecycle`
 * and `time` in seconds, sorted by time. Transitions that need a resource wait until one is free.
 */
export function walk(net, { cases = 6, gap = 120, seed = 1, scale = 10 } = {}) {
  const random = rng(seed);
  const placeIds = new Set(net.places.map((p) => p.id));
  const into = (id) => net.arcs.filter((a) => a.target === id && placeIds.has(a.source));
  const out = (id) => net.arcs.filter((a) => a.source === id && placeIds.has(a.target));
  const loops = (placeId) =>
    net.transitions.some(
      (t) =>
        net.arcs.some((a) => a.source === placeId && a.target === t.id) &&
        net.arcs.some((a) => a.source === t.id && a.target === placeId),
    );
  const marked = (placeId) => (net.marking[placeId]?.length ?? 0) > 0;
  const isResource = (placeId) => marked(placeId) && loops(placeId);
  /** When each unit of each resource is free again. */
  const free = new Map(
    net.places
      .filter((p) => isResource(p.id))
      .map((p) => [p.id, Array.from({ length: net.marking[p.id].length }, () => 0)]),
  );
  const sources = net.transitions.filter((t) => into(t.id).length === 0);
  if (sources.length === 0) throw new Error('The net has no transition that lets cases in.');

  const events = [];
  let arrival = 0;
  for (let n = 1; n <= cases; n += 1) {
    arrival += -Math.log(1 - random()) * gap;
    const id = `D-${String(n).padStart(3, '0')}`;
    let transition = sources[0];
    let ready = arrival;
    for (let guard = 0; transition && guard < 100; guard += 1) {
      // Wait for a free unit of every resource the transition takes.
      let start = ready;
      const taken = [];
      for (const arc of into(transition.id)) {
        const units = free.get(arc.source);
        if (!units) continue;
        const order = units.map((at, index) => ({ at, index })).sort((a, b) => a.at - b.at);
        for (const unit of order.slice(0, arc.weight)) {
          start = Math.max(start, unit.at);
          taken.push([arc.source, unit.index]);
        }
      }
      const end = start + duration(transition.timing, random);
      for (const [place, index] of taken) free.get(place)[index] = end;
      const time = (seconds) => Math.round((seconds / scale) * 10) / 10;
      events.push({ case: id, activity: transition.name, lifecycle: 'start', time: time(start) });
      events.push({ case: id, activity: transition.name, lifecycle: 'complete', time: time(end) });
      ready = end;
      // On to the next place of the case, and a transition that takes from it.
      const next = out(transition.id).find((arc) => !isResource(arc.target));
      const choices = next
        ? net.transitions.filter((t) => into(t.id).some((a) => a.source === next.target))
        : [];
      transition = choices.length > 0 ? choices[Math.floor(random() * choices.length)] : undefined;
    }
  }
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.time - b.event.time || a.index - b.index)
    .map(({ event }) => event);
}

/** The events as the lines that the live source takes: case, activity, lifecycle, time. */
export function toLines(events) {
  return events.map((e) => `${e.case},${e.activity},${e.lifecycle},${e.time}`).join('\n');
}

export function toConsole(events) {
  return `window.pnm.live.push(${JSON.stringify(events, null, 1)});`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({
    options: {
      net: { type: 'string' },
      cases: { type: 'string' },
      gap: { type: 'string' },
      seed: { type: 'string' },
      scale: { type: 'string' },
      format: { type: 'string' },
    },
  });
  const net = JSON.parse(
    readFileSync(values.net ?? join(here, '..', 'examples', 'smart-office.pn.json'), 'utf8'),
  );
  const number = (value, fallback) => (value === undefined ? fallback : Number(value));
  const events = walk(net, {
    cases: number(values.cases, 6),
    gap: number(values.gap, 120),
    seed: number(values.seed, 1),
    scale: number(values.scale, 10),
  });
  const format = values.format ?? 'paste';
  if (format === 'json') process.stdout.write(`${JSON.stringify(events)}\n`);
  else if (format === 'console') process.stdout.write(`${toConsole(events)}\n`);
  else if (format === 'paste') process.stdout.write(`${toLines(events)}\n`);
  else {
    process.stderr.write(`Unknown format "${format}": use paste, console or json.\n`);
    process.exitCode = 2;
  }
}
