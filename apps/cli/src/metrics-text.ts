import type { PetriNet } from '@pnm/core';
import { formatIndicatorValue, type MetricsSnapshot } from '@pnm/sim';
import { formatDuration, formatNumber, table } from './format';

/** The tables of places and resources of a run, as lines (each table preceded by an empty line). */
export function metricTables(net: PetriNet, metrics: MetricsSnapshot): string[] {
  const lines: string[] = [];
  const names = new Map(net.places.map((p) => [p.id, p.name]));
  if (metrics.indicators !== undefined && metrics.indicators.length > 0) {
    lines.push('');
    lines.push(
      table(
        [{ header: 'INDICATOR' }, { header: 'VALUE', align: 'right' }, { header: 'UNIT' }],
        metrics.indicators.map((i) => [
          i.label === '' ? i.id : i.label,
          formatIndicatorValue(i),
          i.unit,
        ]),
      ).trimEnd(),
    );
  }
  if (metrics.places.length > 0) {
    lines.push('');
    lines.push(
      table(
        [
          { header: 'PLACE' },
          { header: 'ROLE' },
          { header: 'NOW', align: 'right' },
          { header: 'MEAN', align: 'right' },
          { header: 'MAX', align: 'right' },
          { header: 'MEAN WAIT', align: 'right' },
        ],
        metrics.places.map((p) => [
          names.get(p.placeId) ?? p.placeId,
          p.role,
          String(p.current),
          formatNumber(p.mean),
          String(p.max),
          formatDuration(p.meanWait),
        ]),
      ).trimEnd(),
    );
  }
  if (metrics.resources.length > 0) {
    lines.push('');
    lines.push(
      table(
        [
          { header: 'RESOURCE' },
          { header: 'FREE', align: 'right' },
          { header: 'IN USE', align: 'right' },
          { header: 'CAPACITY', align: 'right' },
          { header: 'UTILIZATION', align: 'right' },
        ],
        metrics.resources.map((r) => [
          names.get(r.placeId) ?? r.placeId,
          String(r.free),
          String(r.inUse),
          String(r.capacity),
          `${formatNumber(r.utilization * 100, 1)} %`,
        ]),
      ).trimEnd(),
    );
  }
  return lines;
}
