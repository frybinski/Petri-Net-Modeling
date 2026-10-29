import { addPlace, createEmptyNet, serializeNet } from '@pnm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../store/editor-store';
import { useExportStore } from '../store/export-store';
import { useImportStore } from '../store/import-store';
import { useUiStore } from '../store/ui-store';
import {
  exportJson,
  fileStem,
  guardUnsaved,
  netFileName,
  looksLikePnml,
  newNetGuarded,
  openExportImage,
  openExportPnml,
  openExportTikz,
  openFile,
  openFileGuarded,
  saveNet,
} from './files';

const toasts = () => useUiStore.getState().toasts;

beforeEach(() => {
  useEditorStore.getState().newNet();
  useUiStore.setState({ toasts: [], confirm: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('file names', () => {
  it('makes safe names', () => {
    expect(fileStem('Producer/consumer')).toBe('Producer-consumer');
    expect(fileStem('  My net: v2? ')).toBe('My-net-v2');
    expect(fileStem('///')).toBe('net');
    expect(fileStem('')).toBe('net');
    expect(fileStem('a\u0001b')).toBe('ab');
    expect(netFileName('Lights')).toBe('Lights.pn.json');
  });
});

describe('opening files', () => {
  it('loads a valid file', async () => {
    const net = addPlace(createEmptyNet('From file'), { position: { x: 0, y: 0 } });
    await openFile(new File([serializeNet(net)], 'x.pn.json', { type: 'application/json' }));
    expect(useEditorStore.getState().net.name).toBe('From file');
    expect(useEditorStore.getState().fileName).toBe('x.pn.json');
    // The result is visible on the canvas, so there is no toast.
    expect(toasts()).toHaveLength(0);
  });

  it('shows a readable message for text that is not JSON', async () => {
    await openFile(new File(['{ nope'], 'bad.pn.json'));
    const toast = toasts().at(-1);
    expect(toast?.kind).toBe('error');
    expect(toast?.message).toBe('Could not open bad.pn.json');
    expect(toast?.details?.[0]).toMatch(/not valid JSON/);
    expect(useEditorStore.getState().net.name).toBe('Untitled net');
  });

  it('lists structural problems of JSON that is not a net', async () => {
    await openFile(new File([JSON.stringify({ version: '1.0', places: 3 })], 'odd.pn.json'));
    const toast = toasts().at(-1);
    expect(toast?.kind).toBe('error');
    expect(toast?.details?.some((d) => d.startsWith('places:'))).toBe(true);
  });

  it('opens nets with errors but reports them', async () => {
    const json = JSON.parse(
      serializeNet(addPlace(createEmptyNet('Broken'), { id: 'p', position: { x: 0, y: 0 } })),
    );
    json.arcs = [{ id: 'a', source: 'p', target: 'ghost', weight: 1 }];
    await openFile(new File([JSON.stringify(json)], 'broken.pn.json'));
    expect(useEditorStore.getState().net.name).toBe('Broken');
    expect(toasts().at(-1)?.message).toMatch(/Opened with 1 error/);
    expect(useEditorStore.getState().diagnostics.some((d) => d.code === 'ARC_DANGLING')).toBe(true);
  });
});

describe('unsaved changes guard', () => {
  it('runs the action directly when nothing changed', () => {
    const action = vi.fn();
    guardUnsaved(action);
    expect(action).toHaveBeenCalledOnce();
    expect(useUiStore.getState().confirm).toBeNull();
  });

  it('asks before discarding changes', () => {
    useEditorStore.getState().addPlace({ x: 0, y: 0 });
    newNetGuarded();
    expect(useEditorStore.getState().net.places).toHaveLength(1);
    const request = useUiStore.getState().confirm;
    expect(request?.danger).toBe(true);
    request?.onConfirm();
    expect(useEditorStore.getState().net.places).toHaveLength(0);
  });

  it('guards opening dropped files', async () => {
    useEditorStore.getState().addPlace({ x: 0, y: 0 });
    openFileGuarded(new File([serializeNet(createEmptyNet('Dropped'))], 'd.pn.json'));
    expect(useEditorStore.getState().net.name).toBe('Untitled net');
    useUiStore.getState().confirm?.onConfirm();
    await vi.waitFor(() => {
      expect(useEditorStore.getState().net.name).toBe('Dropped');
    });
  });
});

describe('saving and exporting', () => {
  function captureDownloads(): Array<{ name: string; blob: Blob }> {
    const downloads: Array<{ name: string; blob: Blob }> = [];
    let pending: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      pending = blob as Blob;
      return 'blob:test';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ name: this.download, blob: pending as Blob });
    });
    return downloads;
  }

  it('downloads the net as .pn.json and marks it saved', async () => {
    const downloads = captureDownloads();
    useEditorStore.getState().renameNet('My Net');
    useEditorStore.getState().addPlace({ x: 10, y: 10 });
    saveNet();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.name).toBe('My-Net.pn.json');
    const text = await downloads[0]?.blob.text();
    expect(JSON.parse(text ?? '{}')).toMatchObject({ name: 'My Net', version: '1.0' });
    expect(useEditorStore.getState().net).toBe(useEditorStore.getState().savedNet);
    expect(useEditorStore.getState().fileName).toBe('My-Net.pn.json');
  });

  it('opens the image export instead of downloading an SVG directly', () => {
    useEditorStore.getState().addPlace({ x: 10, y: 10 });
    openExportImage();
    expect(useExportStore.getState().open).toEqual({ kind: 'image', source: 'net' });
    openExportPnml();
    expect(useExportStore.getState().open).toEqual({ kind: 'pnml', source: 'net' });
    openExportTikz();
    expect(useExportStore.getState().open).toEqual({ kind: 'tikz', source: 'net' });
    useExportStore.getState().close();
  });

  it('exports the net as JSON without marking it saved', async () => {
    const downloads = captureDownloads();
    useEditorStore.getState().addPlace({ x: 10, y: 10 });
    exportJson();
    expect(downloads[0]?.name).toBe('Untitled-net.pn.json');
    expect(JSON.parse((await downloads[0]?.blob.text()) ?? '{}')).toMatchObject({ version: '1.0' });
    expect(useEditorStore.getState().net).not.toBe(useEditorStore.getState().savedNet);
  });
});

const PNML = `<?xml version="1.0"?>
<pnml><net id="n" type="http://www.pnml.org/version-2009/grammar/ptnet">
<name><text>Imported</text></name>
<page id="p"><place id="a"><name><text>A</text></name><graphics><position x="0" y="0"/></graphics><initialMarking><text>1</text></initialMarking></place>
<transition id="t"><name><text>T</text></name><graphics><position x="100" y="0"/></graphics></transition>
<arc id="x" source="a" target="t"/></page></net></pnml>`;

describe('importing PNML', () => {
  beforeEach(() => {
    useImportStore.getState().close();
  });

  it('recognises PNML by its content and its name', () => {
    expect(looksLikePnml('<?xml version="1.0"?><pnml/>', 'whatever')).toBe(true);
    expect(looksLikePnml('\ufeff  <pnml/>', 'x.json')).toBe(true);
    expect(looksLikePnml('{"version":"1.0"}', 'x.pnml')).toBe(false);
    expect(looksLikePnml('', 'net.pnml')).toBe(true);
    expect(looksLikePnml('', 'net.pn.json')).toBe(false);
  });

  it('opens a PNML file as an unsaved document and says so with a toast', async () => {
    await openFile(new File([PNML], 'imported.pnml', { type: 'application/xml' }));
    const state = useEditorStore.getState();
    expect(state.net.name).toBe('Imported');
    expect(state.net.places).toHaveLength(1);
    expect(state.net.marking['a']).toEqual([1]);
    expect(state.fileName).toBeNull();
    // Not saved as .pn.json yet.
    expect(state.net).not.toBe(state.savedNet);
    expect(toasts().at(-1)?.message).toBe('Imported imported.pnml');
    expect(useImportStore.getState().report).toBeNull();
  });

  it('shows the remarks of the import in a dialog', async () => {
    const withArc = PNML.replace('</page>', '<arc id="y" source="t" target="nowhere"/></page>');
    await openFile(new File([withArc], 'odd.pnml'));
    const report = useImportStore.getState().report;
    expect(report?.fileName).toBe('odd.pnml');
    expect(report?.places).toBe(1);
    expect(report?.warnings.some((w) => w.includes('nowhere'))).toBe(true);
    expect(toasts().at(-1)?.message).toContain('remark');
  });

  it('reports a layout that had to be computed', async () => {
    const noPositions = PNML.replace(/<graphics>.*?<\/graphics>/g, '');
    await openFile(new File([noPositions], 'plain.pnml'));
    expect(useImportStore.getState().report?.laidOut).toBe(true);
  });

  it('rejects files that are not PNML with a message', async () => {
    await openFile(new File(['<html></html>'], 'page.xml'));
    expect(toasts().at(-1)).toMatchObject({ kind: 'error', message: 'Could not open page.xml' });
    expect(toasts().at(-1)?.details?.[0]).toContain('not a PNML document');
    await openFile(new File(['<pnml><net></pnml>'], 'broken.pnml'));
    expect(toasts().at(-1)?.details?.[0]).toContain('not well-formed');
    expect(useEditorStore.getState().net.name).not.toBe('Imported');
  });
});
