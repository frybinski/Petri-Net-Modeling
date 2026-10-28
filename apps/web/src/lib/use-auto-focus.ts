import { useEffect, type RefObject } from 'react';

/**
 * Focuses (and selects the text of) an element right after it mounted. React Flow keeps
 * freshly added nodes hidden until they are measured, and hidden elements cannot take
 * focus, so the attempt is repeated for a few animation frames.
 */
export function useAutoFocus(ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>): void {
  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    const tryFocus = (): void => {
      const element = ref.current;
      if (!element) return;
      element.focus();
      if (document.activeElement === element) {
        element.select();
        return;
      }
      attempts += 1;
      if (attempts < 12) frame = requestAnimationFrame(tryFocus);
    };
    tryFocus();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [ref]);
}
