export class UnifiedFractalLayout {
  constructor(options = {}) {
    this.leafBaseRadius = options.leafBaseRadius || 30;
    this.padding = options.padding || 12;
  }

  computeUnifiedLayout(graph) {
    const { nodes, edges, clusters } = graph;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // 1. Identify Master Root Node (App.jsx)
    let rootNode = nodes.find((n) => n.name === 'App' || (n.cluster && n.cluster.includes('Root')));
    if (!rootNode) {
      rootNode = nodes.reduce((best, curr) => (curr.children?.length > best.children?.length ? curr : best), nodes[0]);
    }

    // 2. Calculate In-Degree / Reuse Counts for Every Component
    const consumersMap = new Map();
    nodes.forEach((n) => consumersMap.set(n.id, new Set()));

    edges.forEach((e) => {
      if (e.source !== rootNode?.id && e.source !== e.target) {
        if (consumersMap.has(e.target)) {
          consumersMap.get(e.target).add(e.source);
        }
      }
    });

    // Also check JSX children references
    nodes.forEach((p) => {
      if (p.id !== rootNode?.id) {
        (p.children || []).forEach((chName) => {
          const cNode = nodes.find((n) => n.name === chName);
          if (cNode && cNode.id !== p.id && consumersMap.has(cNode.id)) {
            consumersMap.get(cNode.id).add(p.id);
          }
        });
      }
    });

    nodes.forEach((n) => {
      const consumers = Array.from(consumersMap.get(n.id) || []);
      n.consumers = consumers;
      n.reuseCount = consumers.length;
      // Master Forge rule: if reused across multiple components, it is a Shared Atelier Hub
      n.isSharedHub = n.reuseCount >= 2;
    });

    // 3. Classify into Sacred Domain Sectors
    const classifyDomain = (node) => {
      const p = (node.file || '').toLowerCase();
      const n = (node.name || '').toLowerCase();

      if (node.isSharedHub) {
        return 'FORGE'; // Shared Atelier Hub Belt
      }
      if (p.includes('header') || p.includes('menu') || p.includes('crumbs') || p.includes('context') || n === 'app') {
        return 'SHELL'; // North
      }
      if (p.includes('products') || p.includes('orders') || p.includes('ordercode') || p.includes('labeleditor')) {
        return 'COMMERCE'; // East
      }
      if (p.includes('reports') || p.includes('consignments') || p.includes('aggregates') || p.includes('checkup') || p.includes('line') || p.includes('realization')) {
        return 'OPERATIONS'; // South
      }
      if (p.includes('auth') || p.includes('user') || p.includes('company') || p.includes('settings') || p.includes('productowner') || p.includes('log') || p.includes('legal')) {
        return 'GOVERNANCE'; // West
      }
      return 'FORGE';
    };

    nodes.forEach((n) => {
      n.domainSector = classifyDomain(n);
    });

    // 4. Build Strict Parent -> Children Tree (Acyclic Hierarchy)
    // Shared hubs sit at the domain/atelier level, while private children nest inside their parent
    const treeMap = new Map();
    const assignedNodes = new Set([rootNode.id]);

    const childSetMap = new Map();
    nodes.forEach((n) => {
      const childNames = new Set(n.children || []);
      edges.forEach((e) => {
        if (e.source === n.id && e.type === 'render') {
          const tNode = nodeMap.get(e.target);
          if (tNode) childNames.add(tNode.name);
        }
      });
      childSetMap.set(n.id, childNames);
    });

    const buildHierarchy = (parent) => {
      const childNames = childSetMap.get(parent.id) || new Set();
      const children = [];

      for (const name of childNames) {
        const candidate = nodes.find((n) => n.name === name && !assignedNodes.has(n.id));
        // Private children nest inside their unique parent
        if (candidate && (!candidate.isSharedHub || parent.id === rootNode.id)) {
          assignedNodes.add(candidate.id);
          children.push(candidate);
        }
      }

      if (parent.id === rootNode.id) {
        // Collect remaining shared hubs and unassigned nodes into root's sectors
        const remaining = nodes.filter((n) => !assignedNodes.has(n.id));
        remaining.sort((a, b) => b.reuseCount - a.reuseCount || b.loc - a.loc);
        remaining.forEach((rem) => {
          if (!assignedNodes.has(rem.id)) {
            assignedNodes.add(rem.id);
            children.push(rem);
          }
        });
      }

      treeMap.set(parent.id, children);
      children.forEach((c) => buildHierarchy(c));
    };

    buildHierarchy(rootNode);

    // 5. Apollonian Tangent Circle Packing for Nested Children
    const packApollonian = (children, domainAngles = null) => {
      if (children.length === 0) return { radius: 36, placed: [] };

      // Sort largest to smallest
      const sorted = [...children].sort((a, b) => b.unifiedRadius - a.unifiedRadius);
      const placed = [];

      sorted.forEach((child, idx) => {
        let angle = 0;
        let dist = 0;

        if (domainAngles && child.domainSector && domainAngles[child.domainSector]) {
          const sector = domainAngles[child.domainSector];
          const jitter = ((idx % 9) - 4) * 0.11;
          angle = sector.baseAngle + jitter;
          dist = sector.baseDist + Math.sqrt(idx) * (child.unifiedRadius * 0.65 + this.padding);
        } else if (idx === 0) {
          angle = 0;
          dist = child.unifiedRadius * 0.35;
        } else {
          angle = idx * 2.39996; // Golden angle
          dist = Math.sqrt(idx) * (child.unifiedRadius * 1.25 + this.padding);
        }

        child.udx = Math.cos(angle) * dist;
        child.udy = Math.sin(angle) * dist;
        placed.push(child);
      });

      // Pairwise Hard Collision Repulsion (ensures kissing tangency, no overlaps)
      const iterations = 45;
      for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < placed.length; i++) {
          const c = placed[i];
          c.udx *= 0.96;
          c.udy *= 0.96;
        }

        for (let i = 0; i < placed.length; i++) {
          for (let j = i + 1; j < placed.length; j++) {
            const c1 = placed[i];
            const c2 = placed[j];
            const dx = c2.udx - c1.udx;
            const dy = c2.udy - c1.udy;
            const dist = Math.hypot(dx, dy) || 0.001;
            const targetDist = c1.unifiedRadius + c2.unifiedRadius + this.padding;

            if (dist < targetDist) {
              const push = (targetDist - dist) / 2;
              const nx = (dx / dist) * push;
              const ny = (dy / dist) * push;
              c1.udx -= nx;
              c1.udy -= ny;
              c2.udx += nx;
              c2.udy += ny;
            }
          }
        }
      }

      let maxDist = 30;
      placed.forEach((c) => {
        const d = Math.hypot(c.udx, c.udy) + c.unifiedRadius;
        if (d > maxDist) maxDist = d;
      });

      return {
        radius: Math.round(maxDist + 35),
        placed,
      };
    };

    // 6. Bottom-Up Recursive Packing: Parents strictly larger than children
    const packNodeChildren = (node, isRoot = false) => {
      const children = treeMap.get(node.id) || [];
      children.forEach((c) => packNodeChildren(c, false));

      if (children.length === 0) {
        if (node.isSharedHub) {
          // Reused components scale larger than the components using them!
          node.unifiedRadius = Math.round(44 + Math.min(80, node.reuseCount * 2.8) + Math.log2(Math.max(1, node.loc)) * 3.2);
        } else {
          const loc = node.loc || 1;
          node.unifiedRadius = Math.round(this.leafBaseRadius + Math.min(26, Math.log2(Math.max(1, loc)) * 4.2));
        }
        node.unifiedChildren = [];
        return;
      }

      let domainAngles = null;
      if (isRoot) {
        domainAngles = {
          SHELL:      { baseAngle: -Math.PI / 2, baseDist: 600 },  // North
          COMMERCE:   { baseAngle: 0,             baseDist: 720 },  // East
          OPERATIONS: { baseAngle: Math.PI / 2,  baseDist: 720 },  // South
          GOVERNANCE: { baseAngle: Math.PI,       baseDist: 660 },  // West
          FORGE:      { baseAngle: 0.85,          baseDist: 1100 }, // Outer Master Forges Belt
        };
      }

      const { radius, placed } = packApollonian(children, domainAngles);

      // Parent must be strictly larger than any child and enclose all placed children
      const maxChildR = Math.max(...children.map((c) => c.unifiedRadius));
      node.unifiedRadius = Math.max(radius, Math.round(maxChildR * 1.5 + 40));
      node.unifiedChildren = placed;
    };

    packNodeChildren(rootNode, true);

    // 7. Top-Down Absolute Coordinate Assignment
    rootNode.ux = 0;
    rootNode.uy = 0;

    const assignAbsoluteCoords = (parent) => {
      const children = treeMap.get(parent.id) || [];
      children.forEach((c) => {
        c.ux = Math.round(parent.ux + (c.udx || 0));
        c.uy = Math.round(parent.uy + (c.udy || 0));
        assignAbsoluteCoords(c);
      });
    };

    assignAbsoluteCoords(rootNode);

    // 8. Domain Sector Metadata for Drawing
    const rootRadius = rootNode.unifiedRadius;
    const mandalaSectors = [
      { name: 'NAVIGATION & SHELL', angle: -Math.PI / 2, radius: rootRadius * 0.45 },
      { name: 'COMMERCE & PRODUCTS', angle: 0, radius: rootRadius * 0.50 },
      { name: 'OPERATIONS & REPORTS', angle: Math.PI / 2, radius: rootRadius * 0.50 },
      { name: 'GOVERNANCE & IDENTITY', angle: Math.PI, radius: rootRadius * 0.45 },
      { name: 'SHARED ATELIER FORGES', angle: Math.PI * 0.28, radius: rootRadius * 0.82 },
    ];

    const unifiedNodes = nodes.map((n) => ({
      ...n,
      unifiedX: n.ux || 0,
      unifiedY: n.uy || 0,
      unifiedR: n.unifiedRadius || n.metrics.radius,
      domainSector: n.domainSector,
      reuseCount: n.reuseCount,
      isSharedHub: n.isSharedHub,
      consumers: n.consumers,
    }));

    const bounds = {
      minX: -rootRadius - 150,
      minY: -rootRadius - 150,
      maxX: rootRadius + 150,
      maxY: rootRadius + 150,
      width: (rootRadius + 150) * 2,
      height: (rootRadius + 150) * 2,
    };

    return {
      rootId: rootNode.id,
      rootRadius,
      mandalaSectors,
      nodes: unifiedNodes,
      bounds,
    };
  }
}
