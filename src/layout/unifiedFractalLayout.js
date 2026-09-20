export class UnifiedFractalLayout {
  constructor(options = {}) {
    this.leafBaseRadius = options.leafBaseRadius || 36;
    this.padding = options.padding || 14;
  }

  computeUnifiedLayout(graph) {
    const { nodes, edges, clusters } = graph;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // 1. Identify Master Root Node (App.jsx)
    let rootNode = nodes.find((n) => n.name === 'App' || (n.cluster && n.cluster.includes('Root')));
    if (!rootNode) {
      rootNode = nodes.reduce((best, curr) => (curr.children?.length > best.children?.length ? curr : best), nodes[0]);
    }

    // 2. Classify Every Node into Sacred Domain Sectors (Секторальная мандала)
    const classifyDomain = (node) => {
      const p = (node.file || '').toLowerCase();
      const n = (node.name || '').toLowerCase();

      // North: Shell, Navigation, Framework
      if (p.includes('header') || p.includes('menu') || p.includes('crumbs') || p.includes('context') || n === 'app') {
        return 'SHELL';
      }
      // East: Products, Catalog, LabelEditor, Orders
      if (p.includes('products') || p.includes('orders') || p.includes('ordercode') || p.includes('labeleditor')) {
        return 'COMMERCE';
      }
      // South: Reports, Consignments, Aggregates, Checkup, Logistics
      if (p.includes('reports') || p.includes('consignments') || p.includes('aggregates') || p.includes('checkup') || p.includes('line') || p.includes('realization')) {
        return 'OPERATIONS';
      }
      // West: Users, Auth, Company, Settings, Legal, Logs
      if (p.includes('auth') || p.includes('user') || p.includes('company') || p.includes('settings') || p.includes('productowner') || p.includes('log') || p.includes('legal')) {
        return 'GOVERNANCE';
      }
      // Outer Belt: Reusable Components & Ateliers
      return 'ATELIER';
    };

    nodes.forEach((n) => {
      n.domainSector = classifyDomain(n);
    });

    // 3. Build Strict Parent -> Children Tree (Acyclic Hierarchy)
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
        if (candidate) {
          assignedNodes.add(candidate.id);
          children.push(candidate);
        }
      }

      if (parent.id === rootNode.id) {
        // Partition remaining nodes into root children
        const remaining = nodes.filter((n) => !assignedNodes.has(n.id));
        remaining.sort((a, b) => b.loc - a.loc);
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

    // 4. Apollonian Tangent Circle Packing for Children inside Parent
    const packApollonian = (children, domainAngles = null) => {
      if (children.length === 0) return { radius: 40, placed: [] };

      // Sort largest to smallest for tight Apollonian settlement
      const sorted = [...children].sort((a, b) => b.unifiedRadius - a.unifiedRadius);
      const placed = [];

      // Initial placement
      sorted.forEach((child, idx) => {
        let angle = 0;
        let dist = 0;

        if (domainAngles && child.domainSector && domainAngles[child.domainSector]) {
          // In root: Place child in its domain sector!
          const sector = domainAngles[child.domainSector];
          const jitter = (idx % 7 - 3) * 0.12;
          angle = sector.baseAngle + jitter;
          dist = sector.baseDist + Math.sqrt(idx) * (child.unifiedRadius * 0.6 + this.padding);
        } else if (idx === 0) {
          // Central or near-center
          angle = 0;
          dist = child.unifiedRadius * 0.4;
        } else {
          // Phyllotaxis / Golden spiral start
          angle = idx * 2.39996;
          dist = Math.sqrt(idx) * (child.unifiedRadius * 1.3 + this.padding);
        }

        child.udx = Math.cos(angle) * dist;
        child.udy = Math.sin(angle) * dist;
        placed.push(child);
      });

      // Apollonian Relaxation: Gravity Pull toward Center + Strict Tangent Repulsion
      const iterations = 45;
      for (let iter = 0; iter < iterations; iter++) {
        // 1. Inward Gravity force: pulls circles tight together
        for (let i = 0; i < placed.length; i++) {
          const c = placed[i];
          c.udx *= 0.96;
          c.udy *= 0.96;
        }

        // 2. Pairwise Hard Collision Repulsion with Organic Interlocking Overlap (~15% intersection)
        for (let i = 0; i < placed.length; i++) {
          for (let j = i + 1; j < placed.length; j++) {
            const c1 = placed[i];
            const c2 = placed[j];
            const dx = c2.udx - c1.udx;
            const dy = c2.udy - c1.udy;
            const dist = Math.hypot(dx, dy) || 0.001;
            // 15% overlap allowance for interlocking sacred geometry circles
            const targetDist = (c1.unifiedRadius + c2.unifiedRadius) * 0.85;

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

      // Compute tight enclosing circle radius
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

    // 5. Bottom-Up Recursive Packing
    const packNodeChildren = (node, isRoot = false) => {
      const children = treeMap.get(node.id) || [];
      children.forEach((c) => packNodeChildren(c, false));

      if (children.length === 0) {
        const loc = node.loc || 1;
        node.unifiedRadius = Math.round(this.leafBaseRadius + Math.min(35, Math.log2(Math.max(1, loc)) * 6));
        node.unifiedChildren = [];
        return;
      }

      let domainAngles = null;
      if (isRoot) {
        // Define domain sector angles for App (Секторальная мандала)
        domainAngles = {
          SHELL:      { baseAngle: -Math.PI / 2, baseDist: 650 }, // North
          COMMERCE:   { baseAngle: 0,             baseDist: 750 }, // East
          OPERATIONS: { baseAngle: Math.PI / 2,  baseDist: 750 }, // South
          GOVERNANCE: { baseAngle: Math.PI,       baseDist: 700 }, // West
          ATELIER:    { baseAngle: 0.8,           baseDist: 1450 }, // Outer Belt
        };
      }

      const { radius, placed } = packApollonian(children, domainAngles);
      node.unifiedRadius = radius;
      node.unifiedChildren = placed;
    };

    packNodeChildren(rootNode, true);

    // 6. Top-Down Absolute Coordinate Assignment
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

    // 7. Domain Sector Banners Metadata for Drawing
    const rootRadius = rootNode.unifiedRadius;
    const mandalaSectors = [
      { name: 'NAVIGATION & SHELL', angle: -Math.PI / 2, radius: rootRadius * 0.48 },
      { name: 'COMMERCE & PRODUCTS', angle: 0, radius: rootRadius * 0.52 },
      { name: 'OPERATIONS & REPORTS', angle: Math.PI / 2, radius: rootRadius * 0.52 },
      { name: 'GOVERNANCE & IDENTITY', angle: Math.PI, radius: rootRadius * 0.48 },
      { name: 'REUSABLE ATELIERS', angle: Math.PI * 0.28, radius: rootRadius * 0.85 },
    ];

    const unifiedNodes = nodes.map((n) => ({
      ...n,
      unifiedX: n.ux || 0,
      unifiedY: n.uy || 0,
      unifiedR: n.unifiedRadius || n.metrics.radius,
      domainSector: n.domainSector,
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
