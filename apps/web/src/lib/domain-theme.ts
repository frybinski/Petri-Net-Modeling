import { DARK_PALETTE, LIGHT_PALETTE, type ScenePalette } from '@pnm/domain';
import type { Theme } from '../store/ui-store';

/** The colors of the domain view for the current theme of the app. */
export function paletteFor(theme: Theme): ScenePalette {
  return theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}
