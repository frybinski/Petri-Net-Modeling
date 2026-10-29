import { genericDomainView, validateDomainView, type DomainView } from '@pnm/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadExample, smallNet } from '../test/domain-fixtures';
import { useEditorStore } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';
import {
  analyseDomainView,
  applyViewText,
  checkViewText,
  countSeverities,
  fillMissingEntries,
  removeStaleEntries,
  generateGenericView,
  hasHandMadeEntries,
  originCounts,
  removeDomainView,
  stampEdited,
  updateViewHash,
  updateViewMeta,
  viewToText,
} from './domain-view';

const store = () => useEditorStore.getState();
const AT = '2026-10-28T09:00:00.000Z';

function load(name: string): void {
  store().loadNet(loadExample(name), `${name}.pn.json`);
}

function viewOf(): DomainView {
  const view = analyseDomainView(store().net).validation?.view;
  if (!view) throw new Error('no valid view');
  return view;
}

function problems(): string[] {
  return (analyseDomainView(store().net).validation?.diagnostics ?? []).map((d) => d.rule);
}

beforeEach(() => {
  store().newNet();
  useUiStore.setState({ toasts: [], confirm: null });
});

describe('analyseDomainView', () => {
  it('says whether there is a view and what is wrong with it', () => {
    expect(analyseDomainView(smallNet())).toEqual({ present: false, validation: null });
    const net = loadExample('parcel-center');
    const analysis = analyseDomainView(net);
    expect(analysis.present).toBe(true);
    expect(analysis.validation?.diagnostics).toEqual([]);
    const broken = analyseDomainView({ ...net, domainView: { schemaVersion: 2 } });
    expect(broken.present).toBe(true);
    expect(broken.validation?.view).toBeUndefined();
    expect(countSeverities(broken.validation?.diagnostics ?? []).errors).toBeGreaterThan(0);
  });
});

describe('generateGenericView', () => {
  it('adds a generic view that is free of errors, in one undo step', async () => {
    load('complaint-handling');
    expect(store().net.domainView).toBeUndefined();
    generateGenericView();
    await vi.waitFor(() => {
      expect(store().net.domainView).toBeDefined();
    });
    expect(problems().filter((rule) => rule !== 'V6')).toEqual([]);
    const counts = originCounts(viewOf());
    expect(counts.generic).toBeGreaterThan(10);
    expect(counts.user + counts.llm).toBe(0);
    store().undo();
    expect(store().net.domainView).toBeUndefined();
  });

  it('asks before replacing entries that a person wrote', async () => {
    load('parcel-center');
    const before = store().net.domainView;
    generateGenericView();
    const request = useUiStore.getState().confirm;
    expect(request?.danger).toBe(true);
    expect(store().net.domainView).toBe(before);
    request?.onConfirm();
    await vi.waitFor(() => {
      expect(store().net.domainView).not.toBe(before);
    });
    expect(originCounts(viewOf()).user).toBe(0);
  });

  it('does not ask when the view is generic', async () => {
    load('complaint-handling');
    generateGenericView();
    await vi.waitFor(() => {
      expect(store().net.domainView).toBeDefined();
    });
    generateGenericView();
    expect(useUiStore.getState().confirm).toBeNull();
    await vi.waitFor(() => {
      expect(store().past.length).toBeGreaterThan(1);
    });
  });
});

describe('after the net has changed', () => {
  it('reports removed elements (V2) and a stale hash (V7); removing the stale entries and the hash update clean up', () => {
    load('parcel-center');
    store().select(['p_B']);
    store().removeSelected();
    expect(problems()).toEqual(expect.arrayContaining(['V2', 'V7']));
    expect(analyseDomainView(store().net).validation?.ok).toBe(false);

    // Filling only adds: the entry of the removed place stays until it is removed on purpose.
    fillMissingEntries();
    expect(problems()).toEqual(expect.arrayContaining(['V2', 'V7']));
    expect(viewOf().places['p_B']).toBeDefined();

    removeStaleEntries();
    expect(problems()).toEqual(['V7']);
    expect(viewOf().places['p_B']).toBeUndefined();
    // Arcs of the removed place are gone with it, the rest of the view is untouched.
    expect(viewOf().places['p_A']?.kind).toBe('buffer');

    updateViewHash();
    expect(problems()).toEqual([]);
  });

  it('reports new elements (V3); fill gives them generic entries', () => {
    load('parcel-center');
    const id = store().addPlace({ x: 300, y: 600 }) as string;
    expect(problems()).toEqual(expect.arrayContaining(['V3', 'V7']));
    fillMissingEntries();
    const view = viewOf();
    expect(view.places[id]).toBeDefined();
    expect(view.provenance[`places.${id}`]?.source).toBe('generic');
    expect(problems()).toEqual(['V7']);
    updateViewHash();
    expect(problems()).toEqual([]);
  });

  it('can be undone step by step', () => {
    load('parcel-center');
    store().select(['p_B']);
    store().removeSelected();
    removeStaleEntries();
    updateViewHash();
    store().undo();
    expect(problems()).toEqual(['V7']);
    store().undo();
    expect(problems()).toEqual(expect.arrayContaining(['V2', 'V7']));
  });
});

describe('removeDomainView and updateViewMeta', () => {
  it('removes the view', () => {
    load('smart-office');
    removeDomainView();
    expect(store().net.domainView).toBeUndefined();
    store().undo();
    expect(store().net.domainView).toBeDefined();
  });

  it('changes the header and keeps the schema valid', () => {
    load('smart-office');
    updateViewMeta((meta) => ({ ...meta, entity: { ...meta.entity, sprite: 'vehicle' } }));
    expect(viewOf().meta.entity.sprite).toBe('vehicle');
    updateViewMeta((meta) => ({ ...meta, canvas: { width: -5, height: 10 } }));
    expect(viewOf().meta.canvas.width).toBe(1000);
    expect(useUiStore.getState().toasts[0]?.kind).toBe('error');
  });

  it('leaves the view alone while the simulation runs', () => {
    load('smart-office');
    const before = store().net.domainView;
    useEditorStore.setState({ mode: 'simulate' });
    removeDomainView();
    generateGenericView();
    fillMissingEntries();
    updateViewHash();
    updateViewMeta((meta) => ({ ...meta, theme: 'x' }));
    expect(applyViewText(viewToText(before))).toBe(false);
    expect(store().net.domainView).toBe(before);
    expect(useUiStore.getState().toasts[0]?.message).toMatch(/Stop the simulation/);
  });
});

describe('applyViewText', () => {
  beforeEach(() => {
    load('smart-office');
  });

  it('checks the text before it is applied', () => {
    const text = viewToText(store().net.domainView);
    expect(checkViewText(store().net, text)).toMatchObject({ ok: true, diagnostics: [] });
    expect(checkViewText(store().net, '{ nope')).toMatchObject({ ok: false });
    const bad = JSON.parse(text) as { places: Record<string, { kind: string }> };
    bad.places['o_foyer'] = { kind: 'teleporter' };
    const result = checkViewText(store().net, JSON.stringify(bad));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.rule).toBe('V1');
  });

  it('refuses text that is not JSON or does not follow the schema', () => {
    const before = store().net.domainView;
    expect(applyViewText('{ nope')).toBe(false);
    expect(applyViewText('{"schemaVersion": 1}')).toBe(false);
    expect(store().net.domainView).toBe(before);
    expect(useUiStore.getState().toasts[0]?.kind).toBe('error');
  });

  it('applies an edit in one undo step and marks the changed entries as user work', () => {
    // Start from a generic view, so that a changed entry visibly changes its origin.
    const generic = genericDomainView(store().net, { at: AT });
    store().setDomainView(generic);
    const edited = structuredClone(generic);
    const entry = edited.places['o_foyer'];
    if (entry?.kind !== 'conveyor') throw new Error('expected a conveyor');
    entry.path = [
      [100, 100],
      [400, 100],
    ];
    const depth = store().past.length;
    expect(applyViewText(viewToText(edited), '2027-01-01T00:00:00.000Z')).toBe(true);
    expect(store().past.length).toBe(depth + 1);
    const view = viewOf();
    expect(view.provenance['places.o_foyer']).toEqual({
      source: 'user',
      at: '2027-01-01T00:00:00.000Z',
    });
    expect(view.provenance['places.o_flur']?.source).toBe('generic');
    expect(useUiStore.getState().toasts[0]?.kind).toBe('success');
    store().undo();
    expect(viewOf().provenance['places.o_foyer']?.source).toBe('generic');
  });

  it('applies a view with errors in the other rules and reports them', () => {
    const edited = JSON.parse(viewToText(store().net.domainView)) as DomainView;
    delete edited.places['o_foyer'];
    expect(applyViewText(viewToText(edited))).toBe(true);
    expect(problems()).toEqual(['V3']);
    expect(useUiStore.getState().toasts[0]?.message).toMatch(/1 error/);
  });
});

describe('stampEdited', () => {
  const net = smallNet();
  const base = genericDomainView(net, { at: AT });

  it('marks new and changed entries and drops provenance of removed ones', () => {
    const next = structuredClone(base);
    next.places['done'] = { kind: 'pool', pos: [10, 10] };
    delete next.transitions['work'];
    const stamped = stampEdited(base, next, 'NOW');
    expect(stamped.provenance['places.done']).toEqual({ source: 'user', at: 'NOW' });
    expect(stamped.provenance['places.q']).toEqual({ source: 'generic', at: AT });
    expect(stamped.provenance['transitions.work']).toBeUndefined();
  });

  it('respects a provenance entry that the user wrote themselves', () => {
    const next = structuredClone(base);
    next.places['done'] = { kind: 'pool', pos: [10, 10] };
    next.provenance['places.done'] = { source: 'llm', model: 'm', at: 'THEN' };
    expect(stampEdited(base, next, 'NOW').provenance['places.done']?.source).toBe('llm');
  });

  it('stamps entries without provenance and keeps what a pasted view says about itself', () => {
    const bare = { ...structuredClone(base), provenance: {} };
    const stamped = stampEdited(null, bare, 'NOW');
    expect(new Set(Object.values(stamped.provenance).map((p) => p.source))).toEqual(
      new Set(['user']),
    );
    expect(stampEdited(null, base, 'NOW').provenance['places.q']).toEqual({
      source: 'generic',
      at: AT,
    });
  });
});

describe('hasHandMadeEntries', () => {
  it('is true for user and LLM entries only', () => {
    const net = smallNet();
    const generic = genericDomainView(net, { at: AT });
    expect(hasHandMadeEntries(generic)).toBe(false);
    expect(hasHandMadeEntries(null)).toBe(false);
    generic.provenance['places.q'] = { source: 'llm', at: AT };
    expect(hasHandMadeEntries(generic)).toBe(true);
    expect(validateDomainView(net, generic).ok).toBe(true);
  });
});
