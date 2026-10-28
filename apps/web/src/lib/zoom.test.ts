import { describe, expect, it } from 'vitest';
import { ZOOM_FAR, ZOOM_MID, zoomLevel } from './zoom';

describe('zoomLevel', () => {
  it('shows all details from 70 % upwards', () => {
    expect(zoomLevel(3)).toBe('detail');
    expect(zoomLevel(1)).toBe('detail');
    expect(zoomLevel(ZOOM_MID)).toBe('detail');
  });

  it('hides the details between 40 % and 70 %', () => {
    expect(zoomLevel(0.69)).toBe('mid');
    expect(zoomLevel(0.5)).toBe('mid');
    expect(zoomLevel(ZOOM_FAR)).toBe('mid');
  });

  it('shows only the shapes below 40 %', () => {
    expect(zoomLevel(0.39)).toBe('far');
    expect(zoomLevel(0.15)).toBe('far');
  });
});
