import type { SealNode, SubSeal } from '../types/index.js';

export interface PackedInternalLayout {
  realisticRadius: number;
  subSeals: SubSeal[];
  conduits: Array<{ from: string; to: string }>;
}

export class NestedPacker {
  public packComponentInternalSeals(node: SealNode): PackedInternalLayout {
    const circuit = node.internalCircuit || {
      stateVariables: [],
      effects: [],
      handlers: [],
    };
    const stateVars = circuit.stateVariables || [];
    const effects = circuit.effects || [];
    const handlers = circuit.handlers || [];
    const children = node.children || [];

    const baseRadius = node.metrics.radius;
    const subSeals: SubSeal[] = [];
    const conduits: Array<{ from: string; to: string }> = [];

    const hasInternalCircuit =
      stateVars.length > 0 || effects.length > 0 || handlers.length > 0 || children.length > 0;

    // 1. Center: Core Elemental Sigil Sub-Seal (always at origin with 0.18 radius ratio)
    subSeals.push({
      id: `${node.id}#core`,
      type: 'core',
      name: node.metrics.element,
      element: node.metrics.element,
      angle: 0,
      distRatio: 0,
      radiusRatio: 0.18,
      details: ['Elemental Core'],
    });

    if (hasInternalCircuit) {
      const chamberOrbitRatio = 0.4;
      const subRadiusRatio = 0.14;

      // 2. West Quadrant: State Orbit Sub-Seal (useState / useReducer / ref)
      if (
        stateVars.length > 0 ||
        node.hooks.some((h) => ['useState', 'useReducer', 'ref', 'reactive'].includes(h.name))
      ) {
        subSeals.push({
          id: `${node.id}#state`,
          type: 'state',
          name: 'State Orbit',
          element: 'Light',
          keystone: 'Diamond',
          angle: Math.PI * 0.95, // West
          distRatio: chamberOrbitRatio,
          radiusRatio: subRadiusRatio,
          count: stateVars.length || 1,
          details: stateVars.map((v) => v.name).slice(0, 5),
        });

        conduits.push({ from: 'state', to: 'core' });
      }

      // 3. East Quadrant: Lifecycle & Effects Chamber (useEffect / watch)
      if (
        effects.length > 0 ||
        node.hooks.some((h) => ['useEffect', 'useLayoutEffect', 'watch'].includes(h.name))
      ) {
        const depSummary = effects
          .flatMap((e) => e.deps)
          .filter(Boolean)
          .slice(0, 4);

        subSeals.push({
          id: `${node.id}#effects`,
          type: 'effects',
          name: 'Lifecycle Chamber',
          element: 'Water',
          keystone: 'Repetition',
          angle: -Math.PI * 0.05, // East
          distRatio: chamberOrbitRatio,
          radiusRatio: subRadiusRatio,
          count: effects.length || 1,
          details: depSummary.length > 0 ? depSummary : ['Auto-trigger'],
        });

        conduits.push({ from: 'core', to: 'effects' });
        if (subSeals.some((s) => s.type === 'state')) {
          conduits.push({ from: 'effects', to: 'state' });
        }
      }

      // 4. South Quadrant: Internal Function Handlers (Logic Sub-Seals)
      const topHandlers = handlers.slice(0, 3);
      if (topHandlers.length > 0) {
        const startAngle = Math.PI * 0.35;
        const endAngle = Math.PI * 0.65;

        topHandlers.forEach((h, idx) => {
          const step =
            topHandlers.length > 1 ? (endAngle - startAngle) / (topHandlers.length - 1) : 0;
          const angle = topHandlers.length === 1 ? Math.PI * 0.5 : startAngle + idx * step;
          const subId = `fn-${h.name}`;

          subSeals.push({
            id: `${node.id}#${subId}`,
            type: 'handler',
            name: h.name,
            element: 'Fire',
            keystone: 'Column',
            angle,
            distRatio: chamberOrbitRatio,
            radiusRatio: subRadiusRatio * 0.9,
            loc: h.loc,
            details: [`${h.loc} LOC`],
          });

          if (subSeals.some((s) => s.type === 'state')) {
            conduits.push({ from: 'state', to: subId });
          }
          conduits.push({ from: subId, to: 'core' });
        });
      }

      // 5. North Quadrant: Inlined Sub-Components (Children)
      const topChildren = children.slice(0, 2);
      if (topChildren.length > 0) {
        const angles =
          topChildren.length === 1 ? [-Math.PI * 0.5] : [-Math.PI * 0.65, -Math.PI * 0.35];

        topChildren.forEach((ch, idx) => {
          const angle = angles[idx] || -Math.PI * 0.5;
          const subId = `child-${ch}`;

          subSeals.push({
            id: `${node.id}#${subId}`,
            type: 'child',
            name: ch,
            element: 'Wind',
            keystone: 'Direction',
            angle,
            distRatio: chamberOrbitRatio,
            radiusRatio: subRadiusRatio * 0.9,
            details: ['JSX Child'],
          });

          conduits.push({ from: 'core', to: subId });
        });
      }
    }

    // Materialize pixel offsets based on baseRadius
    subSeals.forEach((s) => {
      const d = baseRadius * s.distRatio;
      s.dx = Math.round(Math.cos(s.angle) * d);
      s.dy = Math.round(Math.sin(s.angle) * d);
      s.radius = Math.max(6, Math.round(baseRadius * s.radiusRatio));
    });

    const realisticRadius = Math.round(baseRadius * 1.25);

    return {
      realisticRadius,
      subSeals,
      conduits,
    };
  }
}
