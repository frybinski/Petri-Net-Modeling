import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom lacks the browser APIs that React Flow relies on for measuring and zooming.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}
globalThis.DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom has no canvas: give components a context that accepts every call.
if (typeof HTMLCanvasElement !== 'undefined') {
  const recorder = new Proxy({} as Record<string, unknown>, {
    get(store, key: string) {
      if (key in store) return store[key];
      if (key === 'measureText') return () => ({ width: 20 });
      return () => undefined;
    },
    set(store, key: string, value: unknown) {
      store[key] = value;
      return true;
    },
  });
  HTMLCanvasElement.prototype.getContext = (() =>
    recorder) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
