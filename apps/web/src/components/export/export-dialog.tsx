import { toPnml, toTikz } from '@pnm/io';
import { Copy, Download, Loader2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { en } from '../../i18n/en';
import { downloadBlob, downloadText, fileStem } from '../../lib/files';
import { validDomainView } from '../../lib/domain-view';
import { domainToPng } from '../../lib/export-domain';
import {
  ImageExportError,
  PNG_SCALES,
  netSvg,
  netToPng,
  pngSize,
  type ImageOptions,
} from '../../lib/export-image';
import { useEditorStore } from '../../store/editor-store';
import { useExportStore, type ExportSource } from '../../store/export-store';
import { notify } from '../../store/ui-store';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog } from '../ui/dialog';
import { NumberField, SelectField, inputClass } from '../ui/fields';
import { Segmented } from '../ui/segmented';

/** The longest stretch of text that the preview shows; the file has all of it. */
const PREVIEW_CHARS = 12_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The layout of the dialog: options on the left, the preview on the right. */
function Layout({
  options,
  preview,
  note,
}: {
  options: ReactNode;
  preview: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]" data-testid="export-dialog">
      <div className="flex flex-col gap-3">{options}</div>
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
          {en.exporting.preview}
        </h3>
        {preview}
        {note}
      </div>
    </div>
  );
}

function FileNameField({
  value,
  onChange,
  extension,
}: {
  value: string;
  onChange: (value: string) => void;
  extension: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {en.exporting.fileName}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="text"
          value={value}
          className={inputClass}
          data-testid="export-filename"
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <span className="text-sm text-muted" aria-hidden="true">
          {extension}
        </span>
      </div>
    </div>
  );
}

const CHECKERBOARD: React.CSSProperties = {
  backgroundColor: '#ffffff',
  backgroundImage:
    'linear-gradient(45deg, #d4d4d8 25%, transparent 25%, transparent 75%, #d4d4d8 75%), linear-gradient(45deg, #d4d4d8 25%, transparent 25%, transparent 75%, #d4d4d8 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
};

interface ImagePreview {
  url: string;
  /** Pixels of the drawing. */
  width: number;
  height: number;
}

function ImageBody({ initialSource }: { initialSource: ExportSource }) {
  const net = useEditorStore((s) => s.net);
  const mode = useEditorStore((s) => s.mode);
  const simMarking = useEditorStore((s) => s.simMarking);
  const close = useExportStore((s) => s.close);
  const settings = useExportStore((s) => s.image);
  const setImage = useExportStore((s) => s.setImage);
  const view = useMemo(() => validDomainView(net), [net]);
  const [source, setSource] = useState<ExportSource>(view ? initialSource : 'net');
  const simulating = mode === 'simulate' && simMarking !== null && simMarking !== undefined;
  const [useSim, setUseSim] = useState(simulating);
  const [typedName, setTypedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImagePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const domain = source === 'domain' && view !== null;
  const defaultName = `${fileStem(net.name)}${domain ? '-domain' : ''}`;
  const name = typedName ?? defaultName;
  const dark = settings.theme === 'dark';
  const transparent = settings.background === 'transparent';
  const marking = useSim && simMarking ? simMarking : undefined;
  const format = domain ? 'png' : settings.format;

  const imageOptions: ImageOptions = useMemo(
    () => ({
      dark,
      transparent,
      inscriptions: settings.inscriptions,
      ...(marking ? { marking } : {}),
    }),
    [dark, transparent, settings.inscriptions, marking],
  );

  // The preview is the drawing itself (an SVG), or for the domain view a PNG at scale 1.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    void (async () => {
      try {
        if (domain && view) {
          const result = await domainToPng(net, view, {
            scale: 1,
            dark,
            transparent,
            ...(marking ? { marking } : {}),
          });
          url = URL.createObjectURL(result.blob);
          if (!cancelled) {
            setPreview({ url, width: result.width, height: result.height });
            setPreviewError(null);
          }
        } else {
          const { svg, width, height } = netSvg(net, imageOptions);
          url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
          if (!cancelled) {
            setPreview({ url, width, height });
            setPreviewError(null);
          }
        }
      } catch (caught) {
        if (!cancelled) setPreviewError(errorMessage(caught));
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [net, view, domain, dark, transparent, marking, imageOptions]);

  let target: { width: number; height: number } | null = null;
  let sizeProblem: string | null = null;
  if (preview) {
    try {
      target =
        format === 'png'
          ? pngSize(preview.width, preview.height, settings.scale)
          : { width: preview.width, height: preview.height };
    } catch (caught) {
      sizeProblem = errorMessage(caught);
    }
  }

  const download = async (): Promise<void> => {
    const stem = fileStem(name);
    setBusy(true);
    setError(null);
    try {
      let fileName: string;
      if (domain && view) {
        const result = await domainToPng(net, view, {
          scale: settings.scale,
          dark,
          transparent,
          ...(marking ? { marking } : {}),
        });
        fileName = `${stem}.png`;
        downloadBlob(fileName, result.blob);
      } else if (format === 'svg') {
        fileName = `${stem}.svg`;
        downloadText(fileName, netSvg(net, imageOptions).svg, 'image/svg+xml');
      } else {
        const result = await netToPng(net, { ...imageOptions, scale: settings.scale });
        fileName = `${stem}.png`;
        downloadBlob(fileName, result.blob);
      }
      notify('success', en.files.exported(fileName));
      close();
    } catch (caught) {
      setError(
        caught instanceof ImageExportError
          ? caught.message
          : `${en.exporting.failed}: ${errorMessage(caught)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const extension = format === 'svg' ? '.svg' : '.png';
  const shownError = error ?? previewError ?? sizeProblem;

  return (
    <>
      <Layout
        options={
          <>
            {view ? (
              <Segmented
                label={en.exporting.source}
                value={source}
                options={[
                  { value: 'net', label: en.exporting.sourceNet },
                  { value: 'domain', label: en.exporting.sourceDomain },
                ]}
                onChange={setSource}
                data-testid="export-source"
              />
            ) : null}
            <Segmented
              label={en.exporting.format}
              value={format}
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'svg', label: 'SVG', disabled: domain },
              ]}
              onChange={(value) => {
                setImage({ format: value });
              }}
              hint={domain ? en.exporting.domainPngOnly : undefined}
              data-testid="export-format"
            />
            {format === 'png' ? (
              <Segmented
                label={en.exporting.scale}
                value={settings.scale}
                options={PNG_SCALES.map((scale) => ({
                  value: scale,
                  label: en.exporting.scaleOption(scale),
                }))}
                onChange={(scale) => {
                  setImage({ scale });
                }}
                data-testid="export-scale"
              />
            ) : null}
            <Segmented
              label={en.exporting.theme}
              value={settings.theme}
              options={[
                { value: 'light', label: en.exporting.themeLight },
                { value: 'dark', label: en.exporting.themeDark },
              ]}
              onChange={(theme) => {
                setImage({ theme });
              }}
              data-testid="export-theme"
            />
            <Segmented
              label={en.exporting.background}
              value={settings.background}
              options={[
                { value: 'theme', label: en.exporting.backgroundTheme },
                { value: 'transparent', label: en.exporting.backgroundTransparent },
              ]}
              onChange={(background) => {
                setImage({ background });
              }}
              data-testid="export-background"
            />
            {!domain ? (
              <Checkbox
                label={en.exporting.inscriptions}
                checked={settings.inscriptions}
                onChange={(inscriptions) => {
                  setImage({ inscriptions });
                }}
                data-testid="export-inscriptions"
              />
            ) : null}
            {simulating ? (
              <Checkbox
                label={en.exporting.simMarking}
                checked={useSim}
                onChange={setUseSim}
                data-testid="export-sim-marking"
              />
            ) : null}
            <FileNameField value={name} onChange={setTypedName} extension={extension} />
          </>
        }
        preview={
          <>
            <div
              className="flex min-h-48 items-center justify-center overflow-auto rounded-md border border-border p-2"
              style={transparent ? CHECKERBOARD : { backgroundColor: dark ? '#111114' : '#fafafa' }}
            >
              {preview ? (
                <img
                  src={preview.url}
                  alt={en.exporting.previewImage}
                  className="max-h-80 max-w-full object-contain"
                  data-testid="export-preview"
                />
              ) : (
                <span className="flex items-center gap-2 text-xs text-muted" role="status">
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  {en.exporting.previewBusy}
                </span>
              )}
            </div>
            {target ? (
              <p className="m-0 text-xs text-muted tabular-nums" data-testid="export-size">
                {format === 'png'
                  ? en.exporting.size(target.width, target.height)
                  : en.exporting.sizeVector(target.width, target.height)}
              </p>
            ) : null}
          </>
        }
        note={
          shownError ? (
            <p className="m-0 text-xs text-danger" role="alert" data-testid="export-error">
              {shownError}
            </p>
          ) : null
        }
      />
      <ExportFooter
        busy={busy}
        disabled={preview === null || sizeProblem !== null}
        onDownload={() => {
          void download();
        }}
      />
    </>
  );
}

function ExportFooter({
  busy,
  disabled,
  onDownload,
  onCopy,
}: {
  busy: boolean;
  disabled: boolean;
  onDownload: () => void;
  onCopy?: () => void;
}) {
  const close = useExportStore((s) => s.close);
  return (
    <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
      <Button onClick={close} data-testid="export-close">
        {en.dialog.close}
      </Button>
      {onCopy ? (
        <Button
          icon={<Copy size={14} aria-hidden="true" />}
          onClick={onCopy}
          disabled={disabled}
          data-testid="export-copy"
        >
          {en.exporting.copy}
        </Button>
      ) : null}
      <Button
        variant="primary"
        icon={
          busy ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Download size={14} aria-hidden="true" />
          )
        }
        onClick={onDownload}
        disabled={disabled || busy}
        data-testid="export-download"
      >
        {busy ? en.exporting.working : en.exporting.download}
      </Button>
    </div>
  );
}

/** A text preview: the start of the file, with a note about the rest. */
function TextPreview({ text }: { text: string }) {
  const shown = text.length > PREVIEW_CHARS ? text.slice(0, PREVIEW_CHARS) : text;
  return (
    <>
      <pre
        tabIndex={0}
        aria-label={en.exporting.previewText}
        className="m-0 max-h-96 min-h-48 overflow-auto rounded-md border border-border bg-surface-2 p-2 font-mono text-xs leading-relaxed"
        data-testid="export-preview-text"
      >
        {shown}
      </pre>
      {text.length > shown.length ? (
        <p className="m-0 text-xs text-muted">
          {en.exporting.previewTruncated(text.length - shown.length)}
        </p>
      ) : null}
    </>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify('success', en.exporting.copied);
  } catch {
    notify('error', en.exporting.copyFailed);
  }
}

function PnmlBody() {
  const net = useEditorStore((s) => s.net);
  const close = useExportStore((s) => s.close);
  const settings = useExportStore((s) => s.pnml);
  const setPnml = useExportStore((s) => s.setPnml);
  const [typedName, setTypedName] = useState<string | null>(null);
  const name = typedName ?? fileStem(net.name);
  const text = useMemo(
    () => toPnml(net, { toolspecific: settings.toolspecific }),
    [net, settings.toolspecific],
  );
  return (
    <>
      <Layout
        options={
          <>
            <Checkbox
              label={en.exporting.toolspecific}
              checked={settings.toolspecific}
              onChange={(toolspecific) => {
                setPnml({ toolspecific });
              }}
              hint={en.exporting.toolspecificHint}
              data-testid="export-toolspecific"
            />
            <FileNameField value={name} onChange={setTypedName} extension=".pnml" />
          </>
        }
        preview={<TextPreview text={text} />}
        note={<p className="m-0 text-xs text-muted">{en.exporting.pnmlNote}</p>}
      />
      <ExportFooter
        busy={false}
        disabled={false}
        onCopy={() => {
          void copyText(text);
        }}
        onDownload={() => {
          const fileName = `${fileStem(name)}.pnml`;
          downloadText(fileName, text, 'application/xml');
          notify('success', en.files.exported(fileName));
          close();
        }}
      />
    </>
  );
}

function TikzBody() {
  const net = useEditorStore((s) => s.net);
  const close = useExportStore((s) => s.close);
  const settings = useExportStore((s) => s.tikz);
  const setTikz = useExportStore((s) => s.setTikz);
  const [typedName, setTypedName] = useState<string | null>(null);
  const name = typedName ?? fileStem(net.name);
  const text = useMemo(() => toTikz(net, settings), [net, settings]);
  return (
    <>
      <Layout
        options={
          <>
            <Checkbox
              label={en.exporting.standalone}
              checked={settings.standalone}
              onChange={(standalone) => {
                setTikz({ standalone });
              }}
              data-testid="export-standalone"
            />
            <SelectField
              label={en.exporting.labels}
              value={settings.labels}
              options={[
                { value: 'names', label: en.exporting.labelsNames },
                { value: 'ids', label: en.exporting.labelsIds },
                { value: 'none', label: en.exporting.labelsNone },
              ]}
              onChange={(value) => {
                if (value === 'names' || value === 'ids' || value === 'none') {
                  setTikz({ labels: value });
                }
              }}
              data-testid="export-labels"
            />
            <SelectField
              label={en.exporting.tokens}
              value={settings.tokens}
              options={[
                { value: 'dots', label: en.exporting.tokensDots },
                { value: 'count', label: en.exporting.tokensCount },
                { value: 'none', label: en.exporting.tokensNone },
              ]}
              onChange={(value) => {
                if (value === 'dots' || value === 'count' || value === 'none') {
                  setTikz({ tokens: value });
                }
              }}
              data-testid="export-tokens"
            />
            <SelectField
              label={en.exporting.styles}
              value={settings.styles}
              options={[
                { value: 'inline', label: en.exporting.stylesInline },
                { value: 'external', label: en.exporting.stylesExternal },
              ]}
              onChange={(value) => {
                if (value === 'inline' || value === 'external') setTikz({ styles: value });
              }}
              hint={settings.styles === 'external' ? en.exporting.stylesHint : undefined}
              data-testid="export-styles"
            />
            <Checkbox
              label={en.exporting.inscriptions}
              checked={settings.inscriptions}
              onChange={(inscriptions) => {
                setTikz({ inscriptions });
              }}
              data-testid="export-tikz-inscriptions"
            />
            <Checkbox
              label={en.exporting.grayscale}
              checked={settings.grayscale}
              disabled={settings.styles === 'external'}
              onChange={(grayscale) => {
                setTikz({ grayscale });
              }}
              data-testid="export-grayscale"
            />
            <NumberField
              label={en.exporting.tikzScale}
              value={Math.round(settings.scale * 10000) / 100}
              min={0.5}
              max={20}
              step={0.5}
              decimals={2}
              onCommit={(value) => {
                if (value !== undefined) setTikz({ scale: value / 100 });
              }}
              data-testid="export-tikz-scale"
            />
            <FileNameField value={name} onChange={setTypedName} extension=".tex" />
          </>
        }
        preview={<TextPreview text={text} />}
        note={<p className="m-0 text-xs text-muted">{en.exporting.tikzNote}</p>}
      />
      <ExportFooter
        busy={false}
        disabled={false}
        onCopy={() => {
          void copyText(text);
        }}
        onDownload={() => {
          const fileName = `${fileStem(name)}.tex`;
          downloadText(fileName, text, 'application/x-tex');
          notify('success', en.files.exported(fileName));
          close();
        }}
      />
    </>
  );
}

/** The dialogs "Export image", "Export PNML" and "Export TikZ": options, preview and download. */
export function ExportDialog() {
  const open = useExportStore((s) => s.open);
  const close = useExportStore((s) => s.close);
  if (!open) return null;
  const title =
    open.kind === 'image'
      ? en.exporting.imageTitle
      : open.kind === 'pnml'
        ? en.exporting.pnmlTitle
        : en.exporting.tikzTitle;
  return (
    <Dialog open title={title} onClose={close} width="max-w-4xl">
      {open.kind === 'image' ? <ImageBody initialSource={open.source} /> : null}
      {open.kind === 'pnml' ? <PnmlBody /> : null}
      {open.kind === 'tikz' ? <TikzBody /> : null}
    </Dialog>
  );
}
