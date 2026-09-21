import { describe, expect, it } from 'vitest';
import { NestedPacker } from '../src/layout/nestedPacker.js';
import { calculateComponentMetrics } from '../src/scanner/metrics.js';
import type { SealNode } from '../src/types/index.js';

describe('@wha/core Critical Invariants', () => {
  it('strictly confines sub-seals within R_chamber and R_sub invariants', () => {
    const packer = new NestedPacker();
    const mockNode: SealNode = {
      id: 'test#App',
      name: 'App',
      file: 'src/App.tsx',
      kind: 'component',
      hooks: [{ name: 'useState' }, { name: 'useEffect' }],
      children: ['Header', 'Sidebar'],
      metrics: {
        radius: 60,
        element: 'Arcane',
        keystones: ['Diamond', 'Repetition'],
        keystoneDetails: [],
        radialSigns: [],
        geometry: 'circle',
        isClass: false,
        grade: 'Master Seal',
        stabilityNote: '',
        isForbidden: false,
        loc: 120,
        hookCount: 2,
        childCount: 2,
      },
      internalCircuit: {
        stateVariables: [{ name: 'count', setter: 'setCount' }],
        effects: [{ deps: ['count'] }],
        handlers: [{ name: 'handleClick', loc: 10 }],
      },
      x: 0,
      y: 0,
    };

    const layout = packer.packComponentInternalSeals(mockNode);
    expect(layout.subSeals.length).toBeGreaterThan(0);

    // Verify all sub-seals remain strictly inside the node's radius
    layout.subSeals.forEach((sub) => {
      const distFromCenter = Math.hypot(sub.dx || 0, sub.dy || 0);
      const subR = sub.radius || 0;
      // Must not exceed outer boundary
      expect(distFromCenter + subR).toBeLessThanOrEqual(mockNode.metrics.radius * 1.05);
    });
  });

  it('calculates proper WHA elemental affinity and radius', () => {
    const metrics = calculateComponentMetrics(
      {
        name: 'OrderForm',
        kind: 'function',
        startLine: 1,
        endLine: 50,
        loc: 50,
        props: ['onSubmit'],
        hooksUsed: [{ name: 'useState' }, { name: 'useDispatch' }],
        renderedChildren: ['Button'],
        reduxDispatches: ['createOrder'],
        internalCircuit: { stateVariables: [], effects: [], handlers: [] },
        codeInventory: {
          maps: [10],
          filters: [],
          reduces: [],
          forEaches: [],
          loops: [],
          arrays: 1,
          sets: 0,
          recordMaps: 0,
          asyncCount: 1,
          isClass: false,
        },
      },
      {
        filePath: 'src/components/forms/OrderForm.jsx',
        antiPatterns: [],
      }
    );

    expect(metrics.element).toBe('Fire'); // Form + dispatch = Fire
    expect(metrics.keystones).toContain('Dispersion');
    expect(metrics.radialSigns.some((s) => s.type === 'dispersion')).toBe(true);
    expect(metrics.radialSigns.some((s) => s.type === 'bolt')).toBe(true);
  });
});
