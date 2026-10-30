import type { MetricsSnapshot } from '@pnm/sim';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../store/editor-store';
import { useUiStore } from '../../store/ui-store';
import { DomainKpis, MAX_SHOWN_INDICATORS } from './domain-kpis';

const indicator = (index: number, value: number | null = index + 0.25) => ({
  id: `i${index}`,
  label: `Indicator ${index}`,
  unit: index % 2 === 0 ? 'kg' : '',
  value,
  digits: 1,
});

function metrics(count: number, patch: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    time: 3600,
    observed: 3600,
    places: [],
    resources: [],
    casesInSystem: 7,
    completedCases: 40,
    throughputPerHour: 40.4,
    meanCycleTime: 600,
    maxCycleTime: 900,
    ...(count > 0 && { indicators: Array.from({ length: count }, (_, i) => indicator(i)) }),
    ...patch,
  };
}

beforeEach(() => {
  useUiStore.setState({ domainControls: true });
  useEditorStore.setState({ mode: 'simulate', simTimed: true, simMetrics: metrics(0) });
});

describe('the key figures of the domain view', () => {
  it('show the three fixed figures and nothing else for a net without indicators', () => {
    render(<DomainKpis />);
    const kpis = screen.getByTestId('domain-kpis');
    expect(within(kpis).getByTestId('domain-kpi-throughput')).toHaveTextContent('40');
    expect(within(kpis).getByTestId('domain-kpi-cases')).toHaveTextContent('7');
    expect(kpis.querySelectorAll('[data-testid^="domain-kpi-indicator-"]')).toHaveLength(0);
    expect(screen.queryByTestId('domain-kpi-more')).toBeNull();
  });

  it('add the indicators of the net after them, with unit and decimal places', () => {
    useEditorStore.setState({
      simMetrics: metrics(2, {
        indicators: [
          { id: 'co2', label: 'CO2e per frame', unit: 'kg', value: 14.837, digits: 1 },
          { id: 'share', label: 'Recycled share', unit: '%', value: 27.5, digits: 0 },
        ],
      }),
    });
    render(<DomainKpis />);
    const co2 = screen.getByTestId('domain-kpi-indicator-co2');
    expect(co2).toHaveTextContent('14.8');
    expect(co2.parentElement).toHaveTextContent('kg');
    expect(screen.getByTestId('domain-kpi-indicator-share')).toHaveTextContent('28');
    expect(screen.getByText('CO2e per frame')).toBeInTheDocument();
    // Fixed figures come first.
    const order = [...screen.getByTestId('domain-kpis').querySelectorAll('[data-testid]')]
      .map((e) => e.getAttribute('data-testid'))
      .filter((id) => id?.startsWith('domain-kpi-'));
    expect(order.slice(0, 3)).toEqual([
      'domain-kpi-throughput',
      'domain-kpi-cycle',
      'domain-kpi-cases',
    ]);
    expect(order.slice(3)).toEqual(['domain-kpi-indicator-co2', 'domain-kpi-indicator-share']);
  });

  it('show a dash while an indicator has no value yet', () => {
    useEditorStore.setState({
      simMetrics: metrics(1, {
        indicators: [{ id: 'x', label: 'X', unit: 'kg', value: null, digits: 1 }],
      }),
    });
    render(<DomainKpis />);
    expect(screen.getByTestId('domain-kpi-indicator-x')).toHaveTextContent('–');
  });

  it('show the first four indicators and point to the Metrics tab for the rest', () => {
    useEditorStore.setState({ simMetrics: metrics(6) });
    render(<DomainKpis />);
    for (let i = 0; i < MAX_SHOWN_INDICATORS; i += 1) {
      expect(screen.getByTestId(`domain-kpi-indicator-i${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('domain-kpi-indicator-i4')).toBeNull();
    expect(screen.getByTestId('domain-kpi-more')).toHaveTextContent(
      '2 more indicators in the Metrics tab',
    );
  });

  it('say nothing about more indicators for exactly four, and use the singular for one', () => {
    useEditorStore.setState({ simMetrics: metrics(4) });
    const { unmount } = render(<DomainKpis />);
    expect(screen.queryByTestId('domain-kpi-more')).toBeNull();
    unmount();
    useEditorStore.setState({ simMetrics: metrics(5) });
    render(<DomainKpis />);
    expect(screen.getByTestId('domain-kpi-more')).toHaveTextContent(
      '1 more indicator in the Metrics tab',
    );
  });

  it('wrap into rows and stay inside the view instead of overflowing', () => {
    useEditorStore.setState({ simMetrics: metrics(4) });
    render(<DomainKpis />);
    const kpis = screen.getByTestId('domain-kpis');
    expect(kpis.className).toContain('max-w-[calc(100%-1.5rem)]');
    const row = kpis.firstElementChild as HTMLElement;
    expect(row.className).toContain('flex-wrap');
  });

  it('are hidden outside the simulation, for untimed nets and with the controls hidden', () => {
    useEditorStore.setState({ mode: 'edit' });
    const { unmount, rerender } = render(<DomainKpis />);
    expect(screen.queryByTestId('domain-kpis')).toBeNull();
    useEditorStore.setState({ mode: 'simulate', simTimed: false });
    rerender(<DomainKpis />);
    expect(screen.queryByTestId('domain-kpis')).toBeNull();
    useEditorStore.setState({ simTimed: true });
    useUiStore.setState({ domainControls: false });
    rerender(<DomainKpis />);
    expect(screen.queryByTestId('domain-kpis')).toBeNull();
    unmount();
  });
});
