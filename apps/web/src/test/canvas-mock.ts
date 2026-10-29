import { vi } from 'vitest';

export interface CanvasMock {
  /** Sizes of the canvases that were drawn on, in order. */
  sizes: Array<{ width: number; height: number }>;
  drawImage: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  /** The blobs handed to `URL.createObjectURL`, in order. */
  objectUrls: Blob[];
  restore(): void;
}

/**
 * jsdom has no canvas and does not load images. This replaces what the export needs: a 2D context
 * that records calls, `toBlob`, an `Image` that loads at once and the object URLs.
 */
export function mockCanvas(): CanvasMock {
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const setTransform = vi.fn();
  const sizes: CanvasMock['sizes'] = [];
  const objectUrls: Blob[] = [];
  const context: object = new Proxy(
    { drawImage, fillRect, setTransform },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target];
        // Every other method of the context does nothing (the painters call many). What a call
        // returns can be used like the context itself, for gradients for example.
        if (key === 'measureText') return () => ({ width: 10 });
        return () => context;
      },
      set() {
        return true;
      },
    },
  );
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(function (this: HTMLCanvasElement) {
      sizes.push({ width: this.width, height: this.height });
      return context as unknown as CanvasRenderingContext2D;
    } as never);
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    callback: BlobCallback,
    type?: string,
  ) {
    callback(new Blob(['png-bytes'], { type: type ?? 'image/png' }));
  } as never);

  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decode(): Promise<void> {
      return Promise.resolve();
    }
    set src(_value: string) {
      queueMicrotask(() => {
        this.onload?.();
      });
    }
  }
  vi.stubGlobal('Image', FakeImage);
  let counter = 0;
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    objectUrls.push(blob as Blob);
    counter += 1;
    return `blob:mock-${counter}`;
  });
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  return {
    sizes,
    drawImage,
    fillRect,
    setTransform,
    objectUrls,
    restore() {
      getContext.mockRestore();
      toBlob.mockRestore();
      create.mockRestore();
      revoke.mockRestore();
      vi.unstubAllGlobals();
    },
  };
}
