export class UnifiedFractalLayout {
  constructor(options = {}) {
    this.leafBaseRadius = options.leafBaseRadius || 42;
    this.padding = options.padding || 28;
  }

  computeUnifiedLayout(graph) {
    const { nodes, edges, clusters } = graph;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // 1. Identify Root Node (App or node with most rendered children)
    let rootNode = nodes.find((n) => n.name === 'App' || (n.cluster && n.cluster.includes('Root')));
    if (!rootNode) {
      rootNode = nodes.reduce((best, curr) => (curr.children?.length > best.children?.length ? curr : best), nodes[0]);
    }

    // 2. Build Strict Parent -> Children Tree (Acyclic)
    const treeMap = new Map(); // parentId -> [childNode]
    const assignedNodes = new Set([rootNode.id]);

    // Track children rendered via JSX or imports
    const childSetMap = new Map();
    nodes.forEach((n) => {
      const childNames = new Set(n.children || []);
      // Add render edges
      edges.forEach((e) => {
        if (e.source === n.id && e.type === 'render') {
          const tNode = nodeMap.get(e.target);
          if (tNode) childNames.add(tNode.name);
        }
      });
      childSetMap.set(n.id, childNames);
    });

    // Queue-based hierarchical tree builder starting from root
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

      // If root, also gather remaining unassigned cluster nodes grouped into major provinces
      if (parent.id === rootNode.id) {
        // Group remaining unassigned nodes by province/atelier
        const remaining = nodes.filter((n) => !assignedNodes.has(n.id));
        // Sort remaining by LOC descending
        remaining.sort((a, b) => b.loc - a.loc);

        // Pick top level remaining nodes as root children
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

    // 3. Post-Order (Bottom-Up) Radius & Internal Packing Calculation
    const packNodeChildren = (node) => {
      const children = treeMap.get(node.id) || [];

      // Recursively pack children first to determine their radii
      children.forEach((c) => packNodeChildren(c));

      // If leaf node (no children)
      if (children.length === 0) {
        const loc = node.loc || 1;
        node.unifiedRadius = Math.round(this.leafBaseRadius + Math.min(45, Math.log2(Math.max(1, loc)) * 8));
        node.unifiedChildren = [];
        return;
      }

      // Pack children around center (0, 0)
      const sortedChildren = [...children].sort((a, b) => b.unifiedRadius - a.unifiedRadius);
      const placed = [];

      // Sort by size and arrange along golden spiral orbits
      const coreSafeRadius = Math.max(35, sortedChildren[0].unifiedRadius * 0.7);

      sortedChildren.forEach((child, idx) => {
        if (idx === 0 && sortedChildren.length > 3) {
          // If many children, largest sits at an inner orbit
          const a = 0;
          const dist = coreSafeRadius + child.unifiedRadius + this.padding;
          child.udx = Math.round(Math.cos(a) * dist);
          child.udy = Math.round(Math.sin(a) * dist);
        } else {
          const theta = idx * 2.39996; // Golden angle
          const dist = coreSafeRadius + Math.sqrt(idx) * (child.unifiedRadius * 1.8 + this.padding);
          child.udx = Math.round(Math.cos(theta) * dist);
          child.udy = Math.round(Math.sin(theta) * dist);
        }
        placed.push(child);
      });

      // Relaxation iterations for circle collision
      for (let iter = 0; iter < 30; iter++) {
        for (let i = 0; i < placed.length; i++) {
          for (let j = i + 1; j < placed.length; j++) {
            const c1 = placed[i];
            const c2 = placed[j];
            const dx = c2.udx - c1.udx;
            const dy = c2.udy - c1.udy;
            const dist = Math.hypot(dx, dy) || 0.01;
            const minDist = c1.unifiedRadius + c2.unifiedRadius + this.padding;

            if (dist < minDist) {
              const overlap = (minDist - dist) / 2;
              const nx = (dx / dist) * overlap;
              const ny = (dy / dist) * overlap;
              c1.udx -= nx;
              c1.udy -= ny;
              c2.udx += nx;
              c2.udy += ny;
            }
          }
        }
      }

      // Compute bounding radius of parent enclosing all children
      let maxDist = coreSafeRadius + 40;
      placed.forEach((c) => {
        const d = Math.hypot(c.udx, c.udy) + c.unifiedRadius;
        if (d > maxDist) maxDist = d;
      });

      node.unifiedRadius = Math.round(maxDist + 50);
      node.unifiedChildren = placed;
    };

    packNodeChildren(rootNode);

    // 4. Pre-Order (Top-Down) Absolute World Coordinate Assignment
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

    // 5. Structure Unified Grand Diagram Result
    const unifiedNodes = nodes.map((n) => ({
      ...n,
      // In Unified mode, coordinates and radius come from the nested fractal tree!
      unifiedX: n.ux || 0,
      unifiedY: n.uy || 0,
      unifiedR: n.unifiedRadius || n.metrics.radius,
    }));

    const rootRadius = rootNode.unifiedRadius;
    const bounds = {
      minX: -rootRadius - 200,
      minY: -rootRadius - 200,
      maxX: rootRadius + 200,
      maxY: rootRadius + 200,
      width: (rootRadius + 200) * 2,
      height: (rootRadius + 200) * 2,
    };

    return {
      rootId: rootNode.id,
      rootRadius,
      nodes: unifiedNodes,
      bounds,
    };
  }
}
