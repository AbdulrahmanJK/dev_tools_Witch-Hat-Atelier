export class NestedPacker {
  packComponentInternalSeals(node) {
    const circuit = node.internalCircuit || {};
    const stateVars = circuit.stateVariables || [];
    const effects = circuit.effects || [];
    const handlers = circuit.handlers || [];
    const children = node.children || [];

    const baseRadius = node.metrics.radius;
    const subSeals = [];
    const conduits = [];

    const hasInternalCircuit = stateVars.length > 0 || effects.length > 0 || handlers.length > 0 || children.length > 0;

    // Base sub-seal unit size (scaled moderately with LOC)
    const unitR = Math.max(16, Math.min(28, 14 + Math.log2(Math.max(1, node.loc)) * 1.8));

    // 1. Center: Core Elemental Sigil Sub-Seal
    const coreR = Math.round(unitR * 1.15);
    subSeals.push({
      id: `${node.id}#core`,
      type: 'core',
      name: node.metrics.element,
      element: node.metrics.element,
      dx: 0,
      dy: 0,
      radius: coreR,
      details: ['Elemental Core'],
    });

    if (hasInternalCircuit) {
      const chamberOrbit = Math.round(unitR * 2.2);

      // 2. West Quadrant: State Orbit Sub-Seal (useState / useReducer)
      if (stateVars.length > 0 || node.hooks.some((h) => h.name === 'useState')) {
        const stateR = Math.round(unitR * 1.05);
        const angle = Math.PI * 0.95; // West
        const dx = Math.round(Math.cos(angle) * chamberOrbit);
        const dy = Math.round(Math.sin(angle) * chamberOrbit);

        subSeals.push({
          id: `${node.id}#state`,
          type: 'state',
          name: 'State Orbit',
          element: 'Light',
          keystone: 'Diamond',
          dx,
          dy,
          radius: stateR,
          count: stateVars.length || 1,
          details: stateVars.map((v) => v.name).slice(0, 5),
        });

        conduits.push({ from: 'state', to: 'core' });
      }

      // 3. East Quadrant: Lifecycle & Effects Chamber (useEffect)
      if (effects.length > 0 || node.hooks.some((h) => h.name === 'useEffect')) {
        const effectR = Math.round(unitR * 1.05);
        const angle = -Math.PI * 0.05; // East
        const dx = Math.round(Math.cos(angle) * chamberOrbit);
        const dy = Math.round(Math.sin(angle) * chamberOrbit);

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
          dx,
          dy,
          radius: effectR,
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
          const step = topHandlers.length > 1 ? (endAngle - startAngle) / (topHandlers.length - 1) : 0;
          const angle = topHandlers.length === 1 ? Math.PI * 0.5 : startAngle + idx * step;
          const fnR = Math.round(unitR * 0.9);
          const dx = Math.round(Math.cos(angle) * chamberOrbit);
          const dy = Math.round(Math.sin(angle) * chamberOrbit);

          const subId = `fn-${h.name}`;
          subSeals.push({
            id: `${node.id}#${subId}`,
            type: 'handler',
            name: h.name,
            element: 'Fire',
            keystone: 'Column',
            dx,
            dy,
            radius: fnR,
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
        const angles = topChildren.length === 1 ? [-Math.PI * 0.5] : [-Math.PI * 0.65, -Math.PI * 0.35];

        topChildren.forEach((ch, idx) => {
          const angle = angles[idx];
          const chR = Math.round(unitR * 0.9);
          const dx = Math.round(Math.cos(angle) * chamberOrbit);
          const dy = Math.round(Math.sin(angle) * chamberOrbit);

          const subId = `child-${ch}`;
          subSeals.push({
            id: `${node.id}#${subId}`,
            type: 'child',
            name: ch,
            element: 'Wind',
            keystone: 'Direction',
            dx,
            dy,
            radius: chR,
            details: ['JSX Child'],
          });

          conduits.push({ from: 'core', to: subId });
        });
      }
    }

    // 6. Compute Exact Three-Layer WHA Annular Zoning (Collision-Free Guarantee)
    let maxSubExtent = coreR;
    subSeals.forEach((s) => {
      const ext = Math.hypot(s.dx, s.dy) + s.radius;
      if (ext > maxSubExtent) maxSubExtent = ext;
    });

    // Layer 1: Inner Chamber boundary enclosing all sub-seals with clearance
    const chamberRadius = Math.round(maxSubExtent + 14);

    // Layer 2: Dedicated Keystone Crown Corridor for code signs (.map, .filter, Array, loops)
    const keystoneRadius = Math.round(chamberRadius + 22);

    // Layer 3: Outer Closing Boundary Ring
    const R_outer = Math.round(keystoneRadius + 20);
    const realisticRadius = Math.max(Math.round(baseRadius * 1.25), R_outer);

    return {
      realisticRadius,
      chamberRadius,
      keystoneRadius,
      subSeals,
      conduits,
    };
  }
}
