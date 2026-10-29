import { useEditorStore } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';

/**
 * Leads to the warm-up field of the net settings. The warm-up is fixed when a simulation starts,
 * so the simulation stops and the properties panel, which holds the field, takes its place.
 */
export function openWarmupSetting(): void {
  useEditorStore.getState().stopSimulation();
  useUiStore.getState().setRightTab('main');
  // The panel appears with the next render.
  requestAnimationFrame(() => {
    const field = document.querySelector<HTMLInputElement>('[data-testid="prop-warmup"]');
    field?.scrollIntoView({ block: 'center' });
    field?.focus();
  });
}
