import { beforeEach, describe, expect, it } from 'vitest';
import { SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, useUiStore } from './ui-store';

const ui = () => useUiStore.getState();

beforeEach(() => {
  useUiStore.setState({
    viewMode: 'net',
    rightTab: 'main',
    hover: { id: null, source: null },
    splitRatio: SPLIT_DEFAULT,
    domainZoom: 1,
  });
});

describe('view mode', () => {
  it('starts with the net editor', () => {
    expect(ui().viewMode).toBe('net');
    expect(ui().rightTab).toBe('main');
  });

  it('shows the domain panel with the domain view and the main panel without it', () => {
    ui().setViewMode('domain');
    expect(ui()).toMatchObject({ viewMode: 'domain', rightTab: 'domain' });
    ui().setRightTab('main');
    expect(ui().rightTab).toBe('main');
    ui().setViewMode('both');
    expect(ui()).toMatchObject({ viewMode: 'both', rightTab: 'domain' });
    ui().setViewMode('net');
    expect(ui()).toMatchObject({ viewMode: 'net', rightTab: 'main' });
  });

  it('forgets the hover when the views change', () => {
    ui().setHover('p1', 'net');
    ui().setViewMode('domain');
    expect(ui().hover).toEqual({ id: null, source: null });
  });
});

describe('hover', () => {
  it('remembers the element and the view the pointer is in', () => {
    ui().setHover('p1', 'domain');
    expect(ui().hover).toEqual({ id: 'p1', source: 'domain' });
    ui().setHover('t1', 'net');
    expect(ui().hover).toEqual({ id: 't1', source: 'net' });
  });

  it('is only cleared by the view that set it', () => {
    ui().setHover('p1', 'domain');
    ui().setHover(null, 'net');
    expect(ui().hover).toEqual({ id: 'p1', source: 'domain' });
    ui().setHover(null, 'domain');
    expect(ui().hover).toEqual({ id: null, source: null });
  });

  it('does not change the state when nothing changes', () => {
    ui().setHover('p1', 'net');
    const before = ui().hover;
    ui().setHover('p1', 'net');
    expect(ui().hover).toBe(before);
  });
});

describe('split ratio and zoom', () => {
  it('keeps the ratio within its limits and remembers it', () => {
    ui().setSplitRatio(0.6);
    expect(ui().splitRatio).toBe(0.6);
    expect(localStorage.getItem('pnm:split')).toBe('0.6');
    ui().setSplitRatio(0.05);
    expect(ui().splitRatio).toBe(SPLIT_MIN);
    ui().setSplitRatio(0.99);
    expect(ui().splitRatio).toBe(SPLIT_MAX);
  });

  it('keeps the zoom of the domain view for the status bar', () => {
    ui().setDomainZoom(0.54);
    expect(ui().domainZoom).toBe(0.54);
  });
});

describe('the controls and the followed case of the domain view', () => {
  it('shows the controls by default and remembers hiding them', () => {
    expect(ui().domainControls).toBe(true);
    ui().toggleDomainControls();
    expect(ui().domainControls).toBe(false);
    expect(localStorage.getItem('pnm:domain-controls')).toBe('off');
    ui().toggleDomainControls();
    expect(ui().domainControls).toBe(true);
    expect(localStorage.getItem('pnm:domain-controls')).toBe('on');
  });

  it('follows one case at a time and lets go', () => {
    expect(ui().followedCase).toBeNull();
    ui().followCase('P-0007');
    expect(ui().followedCase).toBe('P-0007');
    ui().followCase('P-0008');
    expect(ui().followedCase).toBe('P-0008');
    ui().followCase(null);
    expect(ui().followedCase).toBeNull();
  });
});
