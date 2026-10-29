import { addPlace, createEmptyNet, parseNetText, type PetriNet } from '@pnm/core';
import { genericDomainView } from '@pnm/domain';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockCanvas, type CanvasMock } from '../test/canvas-mock';
import { domainToPng } from './export-domain';
import {
  ImageExportError,
  MAX_PNG_SIDE,
  needsLatinExtended,
  netSvg,
  netToPng,
  pngSize,
} from './export-image';

const example = (name: string): PetriNet =>
  parseNetText(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', '..', 'examples', `${name}.pn.json`),
      'utf8',
    ),
  );

let mock: CanvasMock;
beforeEach(() => {
  mock = mockCanvas();
});
afterEach(() => {
  mock.restore();
});

const LIGHT = { dark: false, transparent: false, inscriptions: true } as const;

describe('netToPng', () => {
  it.each([1, 2, 3] as const)('draws the SVG onto a canvas of %s times its size', async (scale) => {
    const net = example('producer-consumer');
    const { width, height } = netSvg(net, LIGHT);
    const result = await netToPng(net, { ...LIGHT, scale });
    expect(result.blob.type).toBe('image/png');
    expect(result.width).toBe(width * scale);
    expect(result.height).toBe(height * scale);
    expect(mock.sizes).toEqual([{ width: width * scale, height: height * scale }]);
    expect(mock.drawImage).toHaveBeenCalledTimes(1);
    expect(mock.drawImage.mock.calls[0]?.slice(1)).toEqual([0, 0, width * scale, height * scale]);
  });

  it('does not depend on the device pixel ratio', async () => {
    const before = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    try {
      const net = example('producer-consumer');
      const { width } = netSvg(net, LIGHT);
      expect((await netToPng(net, { ...LIGHT, scale: 1 })).width).toBe(width);
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: before, configurable: true });
    }
  });

  it('embeds the fonts so that the raster has the right letters', async () => {
    await netToPng(example('producer-consumer'), { ...LIGHT, scale: 1 });
    const svg = await mock.objectUrls[0]!.text();
    expect(mock.objectUrls[0]!.type).toContain('image/svg+xml');
    expect(svg).toContain("font-family:'Inter Variable'");
    expect(svg).toContain("font-family:'JetBrains Mono Variable'");
    expect(svg).toMatch(/url\(data:font\/woff2;base64,/);
  });

  it('knows which texts need the Latin Extended subset of the fonts', () => {
    // Umlauts and accents of Western European languages are in the Latin subset.
    for (const text of ['Müller', 'Café Zoë', 'Straße', 'Ångström', 'ñandú', 'œuvre'])
      expect(needsLatinExtended(text)).toBe(false);
    // Polish, Czech, Hungarian, Turkish, Romanian and the like are not.
    for (const text of ['Łódź', 'Příliš', 'őű', 'İstanbul', 'Brașov', 'ǎ'])
      expect(needsLatinExtended(text)).toBe(true);
  });

  it('embeds the Latin Extended fonts only for a drawing that has such a letter', async () => {
    const plain = addPlace(createEmptyNet('Plain'), {
      id: 'p',
      name: 'Müller',
      position: { x: 0, y: 0 },
    });
    await netToPng(plain, { ...LIGHT, scale: 1 });
    const faces = (svg: string): RegExpMatchArray | never[] => svg.match(/@font-face/g) ?? [];
    const latin = await mock.objectUrls[0]!.text();
    expect(faces(latin)).toHaveLength(2);
    expect(latin).not.toContain('U+0100-02BA');

    const polish = addPlace(createEmptyNet('Polish'), {
      id: 'p',
      name: 'Łódź',
      position: { x: 0, y: 0 },
    });
    await netToPng(polish, { ...LIGHT, scale: 1 });
    const extended = await mock.objectUrls[1]!.text();
    // Both families get the second subset, each with the range of characters it is for.
    expect(faces(extended)).toHaveLength(4);
    expect(extended.match(/U\+0100-02BA/g)).toHaveLength(2);
    expect(extended).toContain('Łódź');
  });

  it('uses the dark palette and can leave the background out', async () => {
    const net = example('producer-consumer');
    await netToPng(net, { dark: true, transparent: false, inscriptions: true, scale: 1 });
    expect(await mock.objectUrls[0]!.text()).toContain('#111114');
    await netToPng(net, { dark: false, transparent: true, inscriptions: true, scale: 1 });
    expect(await mock.objectUrls[1]!.text()).not.toContain('fill="#fafafa"/>');
  });

  it('draws the given marking and can leave inscriptions out', async () => {
    const net = example('order-processing');
    const withInscriptions = netSvg(net, LIGHT).svg;
    const without = netSvg(net, { ...LIGHT, inscriptions: false }).svg;
    expect(withInscriptions).toContain('amount');
    expect(without).not.toContain('amount');
    const marked = netSvg(net, {
      ...LIGHT,
      marking: { [net.places[0]!.id]: [1, 1, 1, 1, 1, 1, 1] },
    });
    expect(marked.svg).toContain('>7</text>');
  });

  it('refuses images larger than a browser can make', async () => {
    expect(() => pngSize(10_000, 100, 3)).toThrow(ImageExportError);
    expect(() => pngSize(100, 100, 3)).not.toThrow();
    expect(pngSize(MAX_PNG_SIDE / 3, 10, 3)).toEqual({ width: MAX_PNG_SIDE, height: 30 });
    const net = createEmptyNet('Huge');
    net.places.push({ id: 'a', name: 'a', position: { x: 0, y: 0 } });
    net.places.push({ id: 'b', name: 'b', position: { x: 9000, y: 0 } });
    await expect(netToPng(net, { ...LIGHT, scale: 3 })).rejects.toThrow('more than a browser');
  });

  it('reports a canvas that cannot be had', async () => {
    mock.restore();
    mock = mockCanvas();
    const { vi } = await import('vitest');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(netToPng(example('producer-consumer'), { ...LIGHT, scale: 1 })).rejects.toThrow(
      'no canvas',
    );
  });
});

describe('domainToPng', () => {
  it('draws the domain view at the scale, with a margin, on a solid background', async () => {
    const net = example('parcel-center');
    const view = genericDomainView(net, { canvas: { width: 900, height: 500 }, at: 'x' });
    const result = await domainToPng(net, view, { scale: 2, dark: false, transparent: false });
    expect(result.blob.type).toBe('image/png');
    expect(result.width).toBe((900 + 32) * 2);
    expect(result.height).toBe((500 + 32) * 2);
    expect(mock.fillRect).toHaveBeenCalledWith(0, 0, result.width, result.height);
    expect(mock.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 32, 32);
  });

  it('leaves the background out when transparent', async () => {
    const net = example('parcel-center');
    const view = genericDomainView(net, { canvas: { width: 900, height: 500 }, at: 'x' });
    await domainToPng(net, view, { scale: 1, dark: true, transparent: true });
    expect(mock.fillRect).not.toHaveBeenCalledWith(0, 0, 932, 532);
  });
});
