import { describe, expect, it } from 'vitest';
import { clampZoom, fitAround, fitViewport, MAX_FIT_ZOOM, toSheet, zoomAround } from './viewport';

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

describe('fitAround', () => {
  const sheet = { width: 1200, height: 640 };

  it('is the plain fit without controls over the sheet', () => {
    const view = { width: 1000, height: 700 };
    expect(fitAround(sheet, view, [])).toEqual(fitViewport(sheet, view));
  });

  it('pushes the sheet down below a bar that lies over it', () => {
    const view = { width: 1000, height: 700 };
    const bar = { left: 200, top: 12, right: 800, bottom: 56 };
    const fitted = fitAround(sheet, view, [bar]);
    expect(fitted.y).toBeGreaterThanOrEqual(56 + 10 - 1e-6);
    expect(fitted.zoom).toBeLessThanOrEqual(fitViewport(sheet, view).zoom);
  });

  it('leaves the sheet alone when the control sits beside it', () => {
    // A short, wide view: the sheet is as high as the view and narrow, controls at the corners.
    const view = { width: 1400, height: 300 };
    const plain = fitViewport(sheet, view);
    const corner = { left: 1140, top: 240, right: 1390, bottom: 290 };
    expect(plain.x + sheet.width * plain.zoom).toBeLessThan(corner.left - 10);
    expect(fitAround(sheet, view, [corner])).toEqual(plain);
  });

  it('keeps clear of controls at the top and the bottom together', () => {
    const view = { width: 1000, height: 700 };
    const top = { left: 100, top: 12, right: 900, bottom: 56 };
    const bottom = { left: 100, top: 640, right: 900, bottom: 690 };
    const fitted = fitAround(sheet, view, [top, bottom]);
    expect(fitted.y).toBeGreaterThanOrEqual(66 - 1e-6);
    expect(fitted.y + sheet.height * fitted.zoom).toBeLessThanOrEqual(640 - 10 + 1e-6);
  });
});

describe('fitAround dodging', () => {
  it('moves the sheet to the side to avoid a control at a corner', () => {
    const sheet = { width: 1200, height: 640 };
    const view = { width: 1024, height: 362 };
    // At the plain fit the sheet is 461 px wide, centered; the control reaches into its corner.
    const plain = fitViewport(sheet, view);
    const corner = { left: 700, top: 300, right: 1010, bottom: 350 };
    const fitted = fitAround(sheet, view, [corner]);
    expect(fitted.zoom).toBeCloseTo(plain.zoom, 2);
    const right = fitted.x + sheet.width * fitted.zoom;
    const bottom = fitted.y + sheet.height * fitted.zoom;
    expect(right <= corner.left - 10 + 1e-6 || bottom <= corner.top - 10 + 1e-6).toBe(true);
  });
});
