import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../store/editor-store';
import { ToolPalette } from './tool-palette';
import { TooltipProvider } from './ui/tooltip';

const store = () => useEditorStore.getState();

beforeEach(() => {
  store().newNet();
});

describe('ToolPalette', () => {
  it('selects a tool with a click and makes it sticky with a double click', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <ToolPalette />
      </TooltipProvider>,
    );
    const place = screen.getByTestId('tool-place');
    await user.click(place);
    expect(store()).toMatchObject({ tool: 'place', toolSticky: false });
    expect(screen.queryByTestId('tool-sticky-place')).toBeNull();
    await user.dblClick(place);
    expect(store()).toMatchObject({ tool: 'place', toolSticky: true });
    expect(screen.getByTestId('tool-sticky-place')).toBeInTheDocument();
    await user.dblClick(place);
    expect(store().toolSticky).toBe(false);
    expect(screen.queryByTestId('tool-sticky-place')).toBeNull();
  });

  it('turns stickiness off when another tool is chosen', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <ToolPalette />
      </TooltipProvider>,
    );
    await user.dblClick(screen.getByTestId('tool-transition'));
    expect(store().toolSticky).toBe(true);
    await user.click(screen.getByTestId('tool-select'));
    expect(store()).toMatchObject({ tool: 'select', toolSticky: false });
  });
});
