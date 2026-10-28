import { describe, expect, it } from 'vitest';
import { clampZoom, fitViewport, MAX_FIT_ZOOM, toSheet, zoomAround } from './viewport';

describe('fitViewport', () => {
  it('centers the sheet and keeps its aspect ratio', () => {
    const fit = fitViewport({ width: 1000, height: 500 }, { width: 1056, height: 800 });
    expect(fit.zoom).toBeCloseTo(1, 5);
    expect(fit.x).toBeCloseTo(28, 5);
    expect(fit.y).toBeCloseTo(150, 5);
  });

  it('shrinks a large sheet and never blows up a small one', () => {
    expect(
      fitViewport({ width: 2000, height: 1000 }, { width: 600, height: 600 }).zoom,
    ).toBeLessThan(0.3);
    expect(fitViewport({ width: 100, height: 100 }, { width: 2000, height: 2000 }).zoom).toBe(
      MAX_FIT_ZOOM,
    );
  });

  it('copes with an empty view', () => {
    expect(fitViewport({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      zoom: 1,
    });
  });
});

describe('zoomAround', () => {
  it('keeps the point under the cursor in place', () => {
    const start = { x: 40, y: 20, zoom: 1 };
    const zoomed = zoomAround(start, 2, 300, 200);
    expect(toSheet(zoomed, 300, 200)[0]).toBeCloseTo(toSheet(start, 300, 200)[0], 5);
    expect(toSheet(zoomed, 300, 200)[1]).toBeCloseTo(toSheet(start, 300, 200)[1], 5);
    expect(zoomed.zoom).toBe(2);
  });

  it('stays within the zoom limits', () => {
    expect(zoomAround({ x: 0, y: 0, zoom: 3.9 }, 10, 0, 0).zoom).toBe(clampZoom(100));
    expect(zoomAround({ x: 0, y: 0, zoom: 0.11 }, 0.01, 0, 0).zoom).toBe(clampZoom(0));
  });
});
