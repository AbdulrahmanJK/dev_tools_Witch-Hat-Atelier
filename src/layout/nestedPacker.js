export class NestedPacker {
  packComponentInternalSeals(node) {
    const circuit = node.internalCircuit || {};
    const stateVars = circuit.stateVariables || [];
    const effects = circuit.effects || [];
    const handlers = circuit.handlers || [];
    const children = node.children || [];

    const baseRadius = node.metrics.radius;
    // Harmonious radius for Realistic Mode
    const realisticRadius = Math.round(baseRadius * 1.25);

    const subSeals = [];
    const conduits = [];

    // 1. Center: Core Elemental Sigil Sub-Seal
    const coreR = Math.round(realisticRadius * 0.28);
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

    // 2. West Quadrant: State Orbit Sub-Seal (useState / useReducer)
    if (stateVars.length > 0 || node.hooks.some((h) => h.name === 'useState')) {
      const stateR = Math.round(realisticRadius * 0.26);
      const angle = Math.PI * 0.92; // Slightly above West
      const dist = realisticRadius * 0.58;
      const dx = Math.round(Math.cos(angle) * dist);
      const dy = Math.round(Math.sin(angle) * dist);

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
      const effectR = Math.round(realisticRadius * 0.26);
      const angle = -Math.PI * 0.08; // Slightly above East
      const dist = realisticRadius * 0.58;
      const dx = Math.round(Math.cos(angle) * dist);
      const dy = Math.round(Math.sin(angle) * dist);

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
      // Closes the circuit: effects flow back to state
      if (subSeals.some((s) => s.type === 'state')) {
        conduits.push({ from: 'effects', to: 'state' });
      }
    }

    // 4. South Quadrant: Internal Function Handlers (Logic Sub-Seals)
    const topHandlers = handlers.slice(0, 3);
    if (topHandlers.length > 0) {
      const startAngle = Math.PI * 0.35;
      const endAngle = Math.PI * 0.65;
      const dist = realisticRadius * 0.60;

      topHandlers.forEach((h, idx) => {
        const step = topHandlers.length > 1 ? (endAngle - startAngle) / (topHandlers.length - 1) : 0;
        const angle = topHandlers.length === 1 ? Math.PI * 0.5 : startAngle + idx * step;
        const fnR = Math.round(realisticRadius * 0.20);
        const dx = Math.round(Math.cos(angle) * dist);
        const dy = Math.round(Math.sin(angle) * dist);

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

        // Conduits from State to Handlers
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
      const dist = realisticRadius * 0.62;

      topChildren.forEach((ch, idx) => {
        const angle = angles[idx];
        const chR = Math.round(realisticRadius * 0.19);
        const dx = Math.round(Math.cos(angle) * dist);
        const dy = Math.round(Math.sin(angle) * dist);

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

    return {
      realisticRadius,
      subSeals,
      conduits,
    };
  }
}
