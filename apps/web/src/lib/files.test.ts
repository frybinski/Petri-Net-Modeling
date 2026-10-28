import { addPlace, createEmptyNet, serializeNet } from '@pnm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';
import {
  exportSvg,
  fileStem,
  guardUnsaved,
  netFileName,
  newNetGuarded,
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

  it('downloads an SVG', async () => {
    const downloads = captureDownloads();
    useEditorStore.getState().addPlace({ x: 10, y: 10 });
    exportSvg();
    expect(downloads[0]?.name).toBe('Untitled-net.svg');
    expect(await downloads[0]?.blob.text()).toContain('<svg');
  });
});
