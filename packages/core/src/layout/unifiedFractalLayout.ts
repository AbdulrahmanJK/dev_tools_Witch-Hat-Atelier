import type { MandalaSector, RawGraphData, SealNode } from '../types/index.js';

export interface UnifiedLayoutOptions {
  leafBaseRadius?: number;
  padding?: number;
}

export interface InternalPackedNode extends SealNode {
  unifiedRadius?: number;
  unifiedChildren?: InternalPackedNode[];
  udx?: number;
  udy?: number;
  ux?: number;
  uy?: number;
}

export interface UnifiedLayoutResult {
  rootId: string;
  rootRadius: number;
  mandalaSectors: MandalaSector[];
  nodes: SealNode[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
}

export class UnifiedFractalLayout {
  private leafBaseRadius: number;
  private padding: number;

  constructor(options: UnifiedLayoutOptions = {}) {
    this.leafBaseRadius = options.leafBaseRadius || 30;
    this.padding = options.padding || 12;
  }

  public computeUnifiedLayout(graph: RawGraphData): UnifiedLayoutResult {
    const { nodes, edges } = graph;
    const nodeMap = new Map<string, SealNode>(nodes.map((n: SealNode) => [n.id, n]));

    // 1. Identify Master Root Node (App.jsx / App.tsx / App.vue)
    let rootNode = nodes.find(
      (n: SealNode) => n.name === 'App' || (n.cluster && n.cluster.includes('Root'))
    );
    if (!rootNode && nodes.length > 0) {
      rootNode = nodes.reduce(
        (best: SealNode, curr: SealNode) =>
          (curr.children?.length || 0) > (best.children?.length || 0) ? curr : best,
        nodes[0]!
      );
    }
    if (!rootNode) {
      return {
        rootId: '',
        rootRadius: 100,
        mandalaSectors: [],
        nodes: [],
        bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100, width: 200, height: 200 },
      };
    }

    // 2. Calculate In-Degree / Reuse Counts for Every Component
    const consumersMap = new Map<string, Set<string>>();
    nodes.forEach((n: SealNode) => consumersMap.set(n.id, new Set<string>()));

    edges.forEach((e) => {
      if (e.source !== rootNode!.id && e.source !== e.target) {
        if (consumersMap.has(e.target)) {
          consumersMap.get(e.target)!.add(e.source);
        }
      }
    });

    // Also check JSX children references
    nodes.forEach((p: SealNode) => {
      if (p.id !== rootNode!.id) {
        (p.children || []).forEach((chName: string) => {
          const cNode = nodes.find((n: SealNode) => n.name === chName);
          if (cNode && cNode.id !== p.id && consumersMap.has(cNode.id)) {
            consumersMap.get(cNode.id)!.add(p.id);
          }
        });
      }
    });

    nodes.forEach((n: SealNode) => {
      const consumers = Array.from(consumersMap.get(n.id) || []);
      n.consumers = consumers;
      n.reuseCount = consumers.length;
      // Master Forge rule: if reused across multiple components, it is a Shared Atelier Hub
      n.isSharedHub = n.reuseCount >= 2;
    });

    // 3. Classify into Sacred Domain Sectors
    const classifyDomain = (
      node: SealNode
    ): 'FORGE' | 'SHELL' | 'COMMERCE' | 'OPERATIONS' | 'GOVERNANCE' => {
      const p = (node.file || '').toLowerCase();
      const n = (node.name || '').toLowerCase();

      if (node.isSharedHub) {
        return 'FORGE';
      }
      if (
        p.includes('header') ||
        p.includes('menu') ||
        p.includes('crumbs') ||
        p.includes('context') ||
        n === 'app'
      ) {
        return 'SHELL'; // North
      }
      if (
        p.includes('products') ||
        p.includes('orders') ||
        p.includes('ordercode') ||
        p.includes('labeleditor')
      ) {
        return 'COMMERCE'; // East
      }
      if (
        p.includes('reports') ||
        p.includes('consignments') ||
        p.includes('aggregates') ||
        p.includes('checkup') ||
        p.includes('line') ||
        p.includes('realization')
      ) {
        return 'OPERATIONS'; // South
      }
      if (
        p.includes('auth') ||
        p.includes('user') ||
        p.includes('company') ||
        p.includes('settings') ||
        p.includes('productowner') ||
        p.includes('log') ||
        p.includes('legal')
      ) {
        return 'GOVERNANCE'; // West
      }
      return 'FORGE';
    };

    nodes.forEach((n) => {
      n.domainSector = classifyDomain(n);
    });

    // 4. Build Strict Parent -> Children Tree (Acyclic Hierarchy)
    const treeMap = new Map<string, InternalPackedNode[]>();
    const assignedNodes = new Set<string>([rootNode.id]);

    const childSetMap = new Map<string, Set<string>>();
    nodes.forEach((n: SealNode) => {
      const childNames = new Set<string>(n.children || []);
      edges.forEach((e) => {
        if (e.source === n.id && e.type === 'render') {
          const tNode = nodeMap.get(e.target);
          if (tNode) childNames.add(tNode.name);
        }
      });
      childSetMap.set(n.id, childNames);
    });

    const buildHierarchy = (parent: InternalPackedNode): void => {
      const childNames = childSetMap.get(parent.id) || new Set<string>();
      const children: InternalPackedNode[] = [];

      for (const name of childNames) {
        const candidate = nodes.find(
          (n: SealNode) => n.name === name && !assignedNodes.has(n.id)
        ) as InternalPackedNode | undefined;
        if (candidate && (!candidate.isSharedHub || parent.id === rootNode!.id)) {
          assignedNodes.add(candidate.id);
          children.push(candidate);
        }
      }

      if (parent.id === rootNode!.id) {
        const remaining = nodes.filter(
          (n: SealNode) => !assignedNodes.has(n.id)
        ) as InternalPackedNode[];
        remaining.sort(
          (a, b) =>
            (b.reuseCount || 0) - (a.reuseCount || 0) ||
            (b.loc || b.metrics?.loc || 0) - (a.loc || a.metrics?.loc || 0)
        );
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

    const rootInternal = rootNode as InternalPackedNode;
    buildHierarchy(rootInternal);

    // 5. Apollonian Tangent Circle Packing for Nested Children
    const packApollonian = (
      children: InternalPackedNode[],
      domainAngles: Record<string, { baseAngle: number; baseDist: number }> | null = null
    ): { radius: number; placed: InternalPackedNode[] } => {
      if (children.length === 0) return { radius: 36, placed: [] };

      const sorted = [...children].sort(
        (a, b) => (b.unifiedRadius || 30) - (a.unifiedRadius || 30)
      );
      const placed: InternalPackedNode[] = [];

      sorted.forEach((child, idx) => {
        let angle = 0;
        let dist = 0;
        const cRadius = child.unifiedRadius || 30;

        if (domainAngles && child.domainSector && domainAngles[child.domainSector]) {
          const sector = domainAngles[child.domainSector]!;
          const jitter = ((idx % 9) - 4) * 0.11;
          angle = sector.baseAngle + jitter;
          dist = sector.baseDist + Math.sqrt(idx) * (cRadius * 0.65 + this.padding);
        } else if (idx === 0) {
          angle = 0;
          dist = cRadius * 0.35;
        } else {
          angle = idx * 2.39996; // Golden angle
          dist = Math.sqrt(idx) * (cRadius * 1.25 + this.padding);
        }

        child.udx = Math.cos(angle) * dist;
        child.udy = Math.sin(angle) * dist;
        placed.push(child);
      });

      // Pairwise Hard Collision Repulsion (ensures kissing tangency, no overlaps)
      const iterations = 45;
      for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < placed.length; i++) {
          const c = placed[i]!;
          c.udx = (c.udx || 0) * 0.96;
          c.udy = (c.udy || 0) * 0.96;
        }

        for (let i = 0; i < placed.length; i++) {
          for (let j = i + 1; j < placed.length; j++) {
            const c1 = placed[i]!;
            const c2 = placed[j]!;
            const dx = (c2.udx || 0) - (c1.udx || 0);
            const dy = (c2.udy || 0) - (c1.udy || 0);
            const dist = Math.hypot(dx, dy) || 0.001;
            const targetDist = (c1.unifiedRadius || 30) + (c2.unifiedRadius || 30) + this.padding;

            if (dist < targetDist) {
              const push = (targetDist - dist) / 2;
              const nx = (dx / dist) * push;
              const ny = (dy / dist) * push;
              c1.udx = (c1.udx || 0) - nx;
              c1.udy = (c1.udy || 0) - ny;
              c2.udx = (c2.udx || 0) + nx;
              c2.udy = (c2.udy || 0) + ny;
            }
          }
        }
      }

      let maxDist = 30;
      placed.forEach((c) => {
        const d = Math.hypot(c.udx || 0, c.udy || 0) + (c.unifiedRadius || 30);
        if (d > maxDist) maxDist = d;
      });

      return {
        radius: Math.round(maxDist + 35),
        placed,
      };
    };

    // 6. Bottom-Up Recursive Packing: Parents strictly larger than children
    const packNodeChildren = (node: InternalPackedNode, isRoot = false): void => {
      const children = treeMap.get(node.id) || [];
      children.forEach((c) => packNodeChildren(c, false));

      if (children.length === 0) {
        const nodeLoc = node.loc || node.metrics?.loc || 1;
        if (node.isSharedHub) {
          node.unifiedRadius = Math.round(
            44 + Math.min(80, (node.reuseCount || 0) * 2.8) + Math.log2(Math.max(1, nodeLoc)) * 3.2
          );
        } else {
          node.unifiedRadius = Math.round(
            this.leafBaseRadius + Math.min(26, Math.log2(Math.max(1, nodeLoc)) * 4.2)
          );
        }
        node.unifiedChildren = [];
        return;
      }

      let domainAngles: Record<string, { baseAngle: number; baseDist: number }> | null = null;
      if (isRoot) {
        domainAngles = {
          SHELL: { baseAngle: -Math.PI / 2, baseDist: 600 },
          COMMERCE: { baseAngle: 0, baseDist: 720 },
          OPERATIONS: { baseAngle: Math.PI / 2, baseDist: 720 },
          GOVERNANCE: { baseAngle: Math.PI, baseDist: 660 },
          FORGE: { baseAngle: 0.85, baseDist: 1100 },
        };
      }

      const { radius, placed } = packApollonian(children, domainAngles);
      const maxChildR = Math.max(...children.map((c) => c.unifiedRadius || 30));
      node.unifiedRadius = Math.max(radius, Math.round(maxChildR * 1.5 + 40));
      node.unifiedChildren = placed;
    };

    packNodeChildren(rootInternal, true);

    // 7. Top-Down Absolute Coordinate Assignment
    rootInternal.ux = 0;
    rootInternal.uy = 0;

    const assignAbsoluteCoords = (parent: InternalPackedNode): void => {
      const children = treeMap.get(parent.id) || [];
      children.forEach((c) => {
        c.ux = Math.round((parent.ux || 0) + (c.udx || 0));
        c.uy = Math.round((parent.uy || 0) + (c.udy || 0));
        assignAbsoluteCoords(c);
      });
    };

    assignAbsoluteCoords(rootInternal);

    // 8. Domain Sector Metadata for Drawing
    const rootRadius = rootInternal.unifiedRadius || 1140;
    const mandalaSectors: MandalaSector[] = [
      {
        id: 'shell',
        name: 'NAVIGATION & SHELL',
        label: 'Navigation & Shell',
        element: 'Wind',
        angleStart: -Math.PI * 0.75,
        angleEnd: -Math.PI * 0.25,
        color: '#1c7343',
      },
      {
        id: 'commerce',
        name: 'COMMERCE & PRODUCTS',
        label: 'Commerce & Products',
        element: 'Fire',
        angleStart: -Math.PI * 0.25,
        angleEnd: Math.PI * 0.25,
        color: '#b83a14',
      },
      {
        id: 'operations',
        name: 'OPERATIONS & REPORTS',
        label: 'Operations & Reports',
        element: 'Water',
        angleStart: Math.PI * 0.25,
        angleEnd: Math.PI * 0.75,
        color: '#106ba3',
      },
      {
        id: 'governance',
        name: 'GOVERNANCE & IDENTITY',
        label: 'Governance & Identity',
        element: 'Earth',
        angleStart: Math.PI * 0.75,
        angleEnd: Math.PI * 1.25,
        color: '#785420',
      },
      {
        id: 'forge',
        name: 'SHARED ATELIER FORGES',
        label: 'Shared Atelier Forges',
        element: 'Arcane',
        angleStart: 0,
        angleEnd: Math.PI * 2,
        color: '#681da8',
      },
    ];

    const unifiedNodes = nodes.map((n: SealNode) => {
      const internal = n as InternalPackedNode;
      return {
        ...n,
        unifiedX: internal.ux || 0,
        unifiedY: internal.uy || 0,
        unifiedR: internal.unifiedRadius || n.metrics.radius,
        domainSector: n.domainSector,
        reuseCount: n.reuseCount,
        isSharedHub: n.isSharedHub,
        consumers: n.consumers,
      };
    });

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
