import { addPlace, addTransition, addArc, createEmptyNet, type PetriNet } from '@pnm/core';
import { genericDomainView } from '@pnm/domain';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_IMAGE,
  DEFAULT_PNML,
  DEFAULT_TIKZ,
  useExportStore,
} from '../../store/export-store';
import { useEditorStore } from '../../store/editor-store';
import { useImportStore } from '../../store/import-store';
import { useUiStore } from '../../store/ui-store';
import { mockCanvas, type CanvasMock } from '../../test/canvas-mock';
import { loadExample } from '../../test/domain-fixtures';
import { TooltipProvider } from '../ui/tooltip';
import { ExportDialog } from './export-dialog';
import { ImportReportDialog } from './import-report-dialog';

interface Download {
  name: string;
  blob: Blob;
}

let canvas: CanvasMock;
let downloads: Download[];

function captureDownloads(): void {
  downloads = [];
  const create = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    // The anchor's href is the blob URL that `createObjectURL` returned last for it.
    const index = Number(this.href.replace(/^.*mock-/, '')) - 1;
    const blob = canvas.objectUrls[index];
    if (blob) downloads.push({ name: this.download, blob });
    void create;
  });
}

function netWithTokens(): PetriNet {
  let net = createEmptyNet('Small & sweet');
  net = addPlace(net, { id: 'p', name: 'In', position: { x: 0, y: 0 } });
  net = addTransition(net, { id: 't', name: 'Go', position: { x: 120, y: 0 } });
  net = addArc(net, 'p', 't', { id: 'a', weight: 3 });
  return { ...net, marking: { p: [1, 1] } };
}

function renderDialogs() {
  return render(
    <TooltipProvider>
      <ExportDialog />
      <ImportReportDialog />
    </TooltipProvider>,
  );
}

const toasts = () => useUiStore.getState().toasts;

beforeEach(() => {
  localStorage.clear();
  canvas = mockCanvas();
  captureDownloads();
  useEditorStore.getState().loadNet(netWithTokens(), null);
  useExportStore.setState({
    open: null,
    image: { ...DEFAULT_IMAGE },
    tikz: { ...DEFAULT_TIKZ },
    pnml: { ...DEFAULT_PNML },
  });
  useUiStore.setState({ toasts: [], viewMode: 'net' });
});

afterEach(() => {
  canvas.restore();
  vi.restoreAllMocks();
});

function open(kind: 'image' | 'pnml' | 'tikz', source: 'net' | 'domain' = 'net'): void {
  act(() => {
    useExportStore.getState().openDialog(kind, source);
  });
}

describe('Export image', () => {
  it('shows a preview of the drawing and the size of the PNG', async () => {
    renderDialogs();
    expect(screen.queryByTestId('export-dialog')).toBeNull();
    open('image');
    const preview = await screen.findByTestId('export-preview');
    expect(preview).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    expect(screen.getByRole('dialog', { name: 'Export image' })).toBeInTheDocument();
    // Default: PNG at 2x.
    const size = screen.getByTestId('export-size').textContent ?? '';
    const [, w, h] = /(\d+) × (\d+) px/.exec(size) ?? [];
    expect(Number(w) % 2).toBe(0);
    expect(Number(h) % 2).toBe(0);
    await userEvent.click(screen.getByTestId('export-scale-3'));
    await waitFor(() => {
      expect(screen.getByTestId('export-size').textContent).toContain(`${(Number(w) / 2) * 3} ×`);
    });
    await userEvent.click(screen.getByTestId('export-scale-1'));
    await waitFor(() => {
      expect(screen.getByTestId('export-size').textContent).toContain(`${Number(w) / 2} ×`);
    });
  });

  it('downloads a PNG with the chosen file name', async () => {
    renderDialogs();
    open('image');
    await screen.findByTestId('export-preview');
    const name = screen.getByTestId('export-filename');
    await userEvent.clear(name);
    await userEvent.type(name, 'my picture');
    await userEvent.click(screen.getByTestId('export-download'));
    await waitFor(() => {
      expect(downloads.map((d) => d.name)).toEqual(['my-picture.png']);
    });
    expect(downloads[0]?.blob.type).toBe('image/png');
    // The canvas has twice the size of the drawing.
    expect(canvas.drawImage).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByTestId('export-dialog')).toBeNull();
    });
    expect(toasts().at(-1)?.message).toBe('Exported my-picture.png');
  });

  it('downloads an SVG, dark and transparent on request', async () => {
    renderDialogs();
    open('image');
    await screen.findByTestId('export-preview');
    await userEvent.click(screen.getByTestId('export-format-svg'));
    expect(screen.queryByTestId('export-scale')).toBeNull();
    await userEvent.click(screen.getByTestId('export-theme-dark'));
    await userEvent.click(screen.getByTestId('export-background-transparent'));
    await userEvent.click(screen.getByTestId('export-download'));
    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(downloads[0]?.name).toBe('Small-&-sweet.svg');
    const svg = await downloads[0]!.blob.text();
    expect(svg).toContain('<svg');
    expect(svg).toContain('Small &amp; sweet');
    expect(svg).toContain('#f4f4f5');
    expect(svg).not.toContain('fill="#111114"/>');
  });

  it('remembers the options for the next time', async () => {
    renderDialogs();
    open('image');
    await screen.findByTestId('export-preview');
    await userEvent.click(screen.getByTestId('export-scale-3'));
    await userEvent.click(screen.getByTestId('export-theme-dark'));
    const stored = JSON.parse(localStorage.getItem('pnm:export') ?? '{}') as {
      image: { scale: number; theme: string };
    };
    expect(stored.image).toMatchObject({ scale: 3, theme: 'dark' });
  });

  it('can be reached with the keyboard: radio groups move with the arrow keys', async () => {
    renderDialogs();
    open('image');
    await screen.findByTestId('export-preview');
    const two = screen.getByTestId('export-scale-2');
    expect(two).toHaveAttribute('aria-checked', 'true');
    two.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByTestId('export-scale-3')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('export-scale-3')).toHaveFocus();
    expect(screen.getByRole('radiogroup', { name: 'Scale' })).toBeInTheDocument();
  });

  it('offers the domain view only if the net has a valid one', async () => {
    renderDialogs();
    open('image');
    await screen.findByTestId('export-preview');
    expect(screen.queryByTestId('export-source')).toBeNull();
    act(() => {
      useExportStore.getState().close();
    });
    const net = loadExample('parcel-center');
    act(() => {
      useEditorStore.getState().loadNet(net, null);
    });
    open('image', 'domain');
    await screen.findByTestId('export-preview');
    expect(screen.getByTestId('export-source-domain')).toHaveAttribute('aria-checked', 'true');
    // Only PNG for the domain view.
    expect(screen.getByTestId('export-format-svg')).toBeDisabled();
    expect(screen.getByTestId('export-filename')).toHaveValue('Paketzentrum-domain');
    await userEvent.click(screen.getByTestId('export-download'));
    await waitFor(() => {
      expect(downloads.map((d) => d.name)).toEqual(['Paketzentrum-domain.png']);
    });
    expect(downloads[0]?.blob.type).toBe('image/png');
  });

  it('draws the marking of the simulation if asked', async () => {
    const net = useEditorStore.getState().net;
    const marked = { p: Array.from({ length: 9 }, () => 1) };
    act(() => {
      useEditorStore.setState({ mode: 'simulate', simMarking: marked });
    });
    renderDialogs();
    open('image');
    await screen.findByTestId('export-preview');
    await userEvent.click(screen.getByTestId('export-format-svg'));
    expect(screen.getByTestId('export-sim-marking')).toBeChecked();
    await userEvent.click(screen.getByTestId('export-download'));
    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(await downloads[0]!.blob.text()).toContain('>9</text>');
    act(() => {
      useEditorStore.setState({ mode: 'edit', simMarking: null });
    });
    void net;
  });

  it('says so when the image would be too large', async () => {
    const net = createEmptyNet('Wide');
    net.places.push({ id: 'a', name: 'a', position: { x: 0, y: 0 } });
    net.places.push({ id: 'b', name: 'b', position: { x: 6000, y: 0 } });
    act(() => {
      useEditorStore.getState().loadNet(net, null);
    });
    renderDialogs();
    open('image');
    await userEvent.click(await screen.findByTestId('export-scale-3'));
    expect(await screen.findByTestId('export-error')).toHaveTextContent('more than a browser');
    expect(screen.getByTestId('export-download')).toBeDisabled();
    await userEvent.click(screen.getByTestId('export-scale-1'));
    await waitFor(() => {
      expect(screen.queryByTestId('export-error')).toBeNull();
    });
    expect(screen.getByTestId('export-download')).toBeEnabled();
  });

  it('closes with the close button', async () => {
    renderDialogs();
    open('image');
    await screen.findByTestId('export-preview');
    await userEvent.click(screen.getByTestId('export-close'));
    expect(useExportStore.getState().open).toBeNull();
  });
});

describe('Export PNML', () => {
  it('previews the file and downloads it', async () => {
    renderDialogs();
    open('pnml');
    const preview = await screen.findByTestId('export-preview-text');
    expect(preview.textContent).toContain('<pnml');
    expect(preview.textContent).toContain('ptnet');
    expect(preview.textContent).toContain('tool="pnm"');
    await userEvent.click(screen.getByTestId('export-download'));
    expect(downloads.map((d) => d.name)).toEqual(['Small-&-sweet.pnml']);
    expect(await downloads[0]!.blob.text()).toContain('<initialMarking>');
    expect(toasts().at(-1)?.message).toBe('Exported Small-&-sweet.pnml');
  });

  it('leaves the tool specific data out on request', async () => {
    renderDialogs();
    open('pnml');
    await screen.findByTestId('export-preview-text');
    await userEvent.click(screen.getByTestId('export-toolspecific'));
    await waitFor(() => {
      expect(screen.getByTestId('export-preview-text').textContent).not.toContain('tool="pnm"');
    });
    await userEvent.click(screen.getByTestId('export-download'));
    expect(await downloads[0]!.blob.text()).not.toContain('toolspecific');
  });

  it('copies the text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderDialogs();
    open('pnml');
    await screen.findByTestId('export-preview-text');
    await userEvent.click(screen.getByTestId('export-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(String(writeText.mock.calls[0]?.[0])).toContain('<pnml');
    expect(toasts().at(-1)?.message).toBe('Copied to the clipboard');
  });

  it('says so when the clipboard is not available', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    renderDialogs();
    open('pnml');
    await screen.findByTestId('export-preview-text');
    await userEvent.click(screen.getByTestId('export-copy'));
    await waitFor(() => {
      expect(toasts().at(-1)?.kind).toBe('error');
    });
  });
});

describe('Export TikZ', () => {
  it('previews the fragment and downloads a .tex file', async () => {
    renderDialogs();
    open('tikz');
    const preview = await screen.findByTestId('export-preview-text');
    expect(preview.textContent).toContain('\\begin{tikzpicture}');
    expect(preview.textContent).toContain('\\tikzset{');
    expect(preview.textContent).not.toContain('\\documentclass');
    await userEvent.click(screen.getByTestId('export-download'));
    expect(downloads.map((d) => d.name)).toEqual(['Small-&-sweet.tex']);
    expect(await downloads[0]!.blob.text()).toContain('\\node[place');
  });

  it('follows the options', async () => {
    renderDialogs();
    open('tikz');
    await screen.findByTestId('export-preview-text');
    const text = () => screen.getByTestId('export-preview-text').textContent ?? '';
    await userEvent.click(screen.getByTestId('export-standalone'));
    await waitFor(() => {
      expect(text()).toContain('\\documentclass[tikz');
    });
    await userEvent.selectOptions(screen.getByTestId('export-styles'), 'external');
    await waitFor(() => {
      expect(text()).not.toContain('\\tikzset');
    });
    expect(screen.getByTestId('export-grayscale')).toBeDisabled();
    await userEvent.selectOptions(screen.getByTestId('export-tokens'), 'count');
    await waitFor(() => {
      expect(text()).not.toContain('[token]');
      expect(text()).toContain('{2};');
    });
    await userEvent.selectOptions(screen.getByTestId('export-labels'), 'ids');
    await waitFor(() => {
      expect(text()).toContain('label={below:{p}}');
    });
    await userEvent.click(screen.getByTestId('export-tikz-inscriptions'));
    await waitFor(() => {
      expect(text()).not.toContain('{3}');
    });
    expect(useExportStore.getState().tikz).toMatchObject({
      standalone: true,
      styles: 'external',
      tokens: 'count',
      labels: 'ids',
      inscriptions: false,
    });
  });
});

describe('Import remarks', () => {
  it('lists the remarks and the layout note, and closes', async () => {
    renderDialogs();
    act(() => {
      useImportStore.getState().show({
        fileName: 'odd.pnml',
        netName: 'Odd net',
        places: 3,
        transitions: 2,
        arcs: 4,
        laidOut: true,
        warnings: ['First remark', 'Second remark'],
      });
    });
    const dialog = await screen.findByTestId('import-report');
    expect(dialog).toHaveTextContent('Odd net: 3 places, 2 transitions, 4 arcs.');
    expect(screen.getByTestId('import-laid-out')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['First remark', 'Second remark']);
    expect(screen.getByRole('list', { name: 'Remarks about the import' })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('import-report-ok'));
    expect(useImportStore.getState().report).toBeNull();
  });
});

describe('domain view fixture', () => {
  it('has a view without errors', () => {
    const net = loadExample('parcel-center');
    expect(genericDomainView(net).meta.canvas.width).toBeGreaterThan(0);
  });
});
