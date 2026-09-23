import type { ArchipelagoCluster, GrimoireGraph, RawGraphData, SealEdge, SealNode } from '../types/index.js';
import { NestedPacker } from './nestedPacker.js';
import { UnifiedFractalLayout } from './unifiedFractalLayout.js';

export interface ClusterLayoutOptions {
  padding?: number;
  clusterSpacing?: number;
}

interface PackedClusterInfo {
  name: string;
  nodes: SealNode[];
  radius: number;
}

export class ClusterLayout {
  private padding: number;
  private nestedPacker: NestedPacker;
  private unifiedPacker: UnifiedFractalLayout;

  constructor(options: ClusterLayoutOptions = {}) {
    this.padding = options.padding || 32;
    this.nestedPacker = new NestedPacker();
    this.unifiedPacker = new UnifiedFractalLayout();
  }

  public computeLayout(graph: RawGraphData): GrimoireGraph {
    const { nodes, edges, clusters } = graph;
    const nodeMap = new Map<string, SealNode>(nodes.map((n: SealNode) => [n.id, n]));

    // 1. Group nodes by cluster
    const clusterNodesMap = new Map<string, SealNode[]>();
    clusters.forEach((c: { name: string; nodeIds: string[]; count: number }) => {
      clusterNodesMap.set(
        c.name,
        c.nodeIds.map((id: string) => nodeMap.get(id)!).filter(Boolean)
      );
    });

    // 2. Pre-pack nodes inside each cluster locally around (0, 0) to know exact cluster radii
    const packedClustersMap = new Map<string, PackedClusterInfo>();
    clusters.forEach((c) => {
      const cNodes = clusterNodesMap.get(c.name) || [];
      if (cNodes.length === 0) return;
      const packed = this.packClusterNodes(cNodes, { x: 0, y: 0 });
      packedClustersMap.set(c.name, {
        name: c.name,
        nodes: packed.nodes,
        radius: packed.clusterRadius,
      });
    });

    // 3. Compute Radial Grimoire cluster positions with affinity and relaxation
    const clusterCenters = this.positionRadialGrimoireClusters(
      clusters,
      packedClustersMap,
      edges,
      nodeMap
    );

    // 4. Translate nodes to their cluster centers and compute realistic sub-seals
    const layoutNodes: SealNode[] = [];
    const layoutClusters: ArchipelagoCluster[] = [];

    for (const cluster of clusters) {
      const packed = packedClustersMap.get(cluster.name);
      if (!packed) continue;

      const center = clusterCenters.get(cluster.name) || { x: 0, y: 0 };

      // Shift local relative node positions to the absolute cluster center
      const placedNodes = packed.nodes.map((node) => {
        const absoluteNode: SealNode = {
          ...node,
          x: Math.round(center.x + node.x),
          y: Math.round(center.y + node.y),
        };
        absoluteNode.realisticLayout = this.nestedPacker.packComponentInternalSeals(absoluteNode);
        return absoluteNode;
      });

      layoutNodes.push(...placedNodes);

      layoutClusters.push({
        id: `cluster-${cluster.name}`,
        name: cluster.name,
        files: [],
        nodeIds: placedNodes.map((n) => n.id),
        x: center.x,
        y: center.y,
        radius: packed.radius,
      });
    }

    // 5. Compute Unified Single Grand Spell Fractal Layout
    const unifiedResult = this.unifiedPacker.computeUnifiedLayout(graph);
    const unifiedMap = new Map<string, SealNode>(unifiedResult.nodes.map((n) => [n.id, n]));

    layoutNodes.forEach((n) => {
      const uNode = unifiedMap.get(n.id);
      if (uNode) {
        n.unifiedX = uNode.unifiedX;
        n.unifiedY = uNode.unifiedY;
        n.unifiedR = uNode.unifiedR;
        n.consumers = uNode.consumers || [];
        n.reuseCount = uNode.reuseCount || 0;
        n.isSharedHub = !!uNode.isSharedHub;
      }
    });

    return {
      nodes: layoutNodes,
      edges,
      clusters: layoutClusters,
      bounds: this.calculateOverallBounds(layoutNodes, layoutClusters),
      stats: graph.stats,
      diagnostics: graph.diagnostics,
      unifiedLayout: {
        rootRadius: unifiedResult.rootRadius,
        mandalaSectors: unifiedResult.mandalaSectors,
      },
    };
  }

  /**
   * Radial Grimoire Positioning:
   * 1. Core & Root placed at (0, 0)
   * 2. Honeycomb Two-Tier Crown: Pages & Ateliers distributed in 2 concentric interleaved arcs
   * 3. Foundation Arc (State, APIs, Utils, Constants) nested in the bottom pedestal
   * 4. Inward Centripetal Gravity + Strict Air-Gap Relaxation:
   *    Eliminates empty radial corridors while strictly maintaining ~90px air gap between archipelagos
   */
  private positionRadialGrimoireClusters(
    clusters: Array<{ name: string; nodeIds: string[]; count: number }>,
    packedMap: Map<string, PackedClusterInfo>,
    _edges: SealEdge[],
    _nodeMap: Map<string, SealNode>
  ): Map<string, { x: number; y: number }> {
    const centers = new Map<string, { x: number; y: number }>();

    type ClusterItem = { name: string; nodeIds: string[]; count: number };
    const rootCluster: ClusterItem | undefined = clusters.find((c) => c.name.includes('Core & Root'));
    const pageClusters: ClusterItem[] = [];
    const atelierClusters: ClusterItem[] = [];
    const foundationClusters: ClusterItem[] = [];
    const otherClusters: ClusterItem[] = [];

    clusters.forEach((c) => {
      const name = c.name;
      if (name.includes('Core & Root')) {
        // Handled as rootCluster
      } else if (name.startsWith('Province:')) {
        pageClusters.push(c);
      } else if (name.startsWith('Atelier:')) {
        atelierClusters.push(c);
      } else if (
        name.includes('Power') ||
        name.includes('State') ||
        name.includes('Redux') ||
        name.includes('Gateways') ||
        name.includes('APIs') ||
        name.includes('Grimoires') ||
        name.includes('Utils') ||
        name.includes('Runes') ||
        name.includes('Constants') ||
        name.includes('Keystones') ||
        name.includes('Hooks')
      ) {
        foundationClusters.push(c);
      } else {
        otherClusters.push(c);
      }
    });

    // Clean airy channel between island archipelagos
    const AIR_GAP = 95;

    // 1. Center the Root Sanctuary at (0, 0)
    const rootRadius = rootCluster ? packedMap.get(rootCluster.name)?.radius || 180 : 180;
    if (rootCluster) {
      centers.set(rootCluster.name, { x: 0, y: 0 });
    }

    // Sort domain clusters by size (largest closer to center for structural stability)
    pageClusters.sort((a, b) => b.nodeIds.length - a.nodeIds.length);
    atelierClusters.sort((a, b) => b.nodeIds.length - a.nodeIds.length);

    // 2. Crown Placement: Distribute Pages and Ateliers in 2 balanced concentric crown arcs
    // Crown arc spans from -0.84 * PI to +0.84 * PI (~300 degrees around top, left and right)
    const crownItems = [...pageClusters, ...atelierClusters].sort(
      (a, b) => b.nodeIds.length - a.nodeIds.length
    );

    // Tier 1: 14 largest domain modules
    const tier1Count = Math.min(14, crownItems.length);
    const tier1 = crownItems.slice(0, tier1Count);
    const tier2 = crownItems.slice(tier1Count);

    const t1Orbit = rootRadius + 240 + AIR_GAP;
    const t1ArcStart = -Math.PI * 0.83;
    const t1ArcSpan = Math.PI * 1.66;
    const t1Step = tier1.length > 1 ? t1ArcSpan / (tier1.length - 1) : 0;

    tier1.forEach((item, idx) => {
      const angle = tier1.length > 1 ? t1ArcStart + idx * t1Step : -Math.PI / 2;
      centers.set(item.name, {
        x: Math.round(Math.cos(angle) * t1Orbit),
        y: Math.round(Math.sin(angle) * t1Orbit),
      });
    });

    // Tier 2: Outer crown nestled in interleaved angles
    const t2Orbit = t1Orbit + 290 + AIR_GAP;
    const t2ArcStart = -Math.PI * 0.84;
    const t2ArcSpan = Math.PI * 1.68;
    const t2Step = tier2.length > 1 ? t2ArcSpan / (tier2.length - 1) : 0;

    tier2.forEach((item, idx) => {
      const angle = tier2.length > 1 ? t2ArcStart + (idx + 0.5) * t2Step : -Math.PI / 2;
      centers.set(item.name, {
        x: Math.round(Math.cos(angle) * t2Orbit),
        y: Math.round(Math.sin(angle) * t2Orbit),
      });
    });

    // 3. Foundation Arc (State, APIs, Utils, Constants, Hooks) in Bottom Pedestal
    // Bottom arc spans from +0.22 * PI to +0.78 * PI (~100 degrees)
    const foundationGroup = [...foundationClusters, ...otherClusters].sort(
      (a, b) => b.nodeIds.length - a.nodeIds.length
    );
    const foundCount = foundationGroup.length;
    if (foundCount > 0) {
      const fOrbit = rootRadius + 260 + AIR_GAP;
      const fArcStart = Math.PI * 0.22;
      const fArcEnd = Math.PI * 0.78;
      const fStep = foundCount > 1 ? (fArcEnd - fArcStart) / (foundCount - 1) : 0;

      foundationGroup.forEach((fc, idx) => {
        const angle = foundCount > 1 ? fArcStart + idx * fStep : Math.PI / 2;
        centers.set(fc.name, {
          x: Math.round(Math.cos(angle) * fOrbit),
          y: Math.round(Math.sin(angle) * fOrbit),
        });
      });
    }

    // 4. Inward Centripetal Gravity + Collision Repulsion Relaxation Pass (90 iterations)
    const clusterKeys = Array.from(centers.keys());
    const relaxationIterations = 90;

    for (let iter = 0; iter < relaxationIterations; iter++) {
      // Step A: Inward Centripetal Gravity pulls islands toward center to fill empty pockets
      for (const k of clusterKeys) {
        if (rootCluster && k === rootCluster.name) continue;
        const p = centers.get(k)!;
        p.x *= 0.985;
        p.y *= 0.985;
      }

      // Step B: Circle Collision Repulsion with exact air gap
      for (let i = 0; i < clusterKeys.length; i++) {
        for (let j = i + 1; j < clusterKeys.length; j++) {
          const k1 = clusterKeys[i]!;
          const k2 = clusterKeys[j]!;

          if (rootCluster) {
            const rcName = (rootCluster as ClusterItem).name;
            if (k1 === rcName || k2 === rcName) continue;
          }

          const p1 = centers.get(k1)!;
          const p2 = centers.get(k2)!;
          const r1 = packedMap.get(k1)?.radius || 150;
          const r2 = packedMap.get(k2)?.radius || 150;

          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const minDist = r1 + r2 + AIR_GAP;

          if (dist < minDist) {
            const overlap = (minDist - dist) / 2;
            const nx = (dx / dist) * overlap;
            const ny = (dy / dist) * overlap;

            if (rootCluster && k1 === (rootCluster as ClusterItem).name) {
              p2.x += nx * 2;
              p2.y += ny * 2;
            } else if (rootCluster && k2 === (rootCluster as ClusterItem).name) {
              p1.x -= nx * 2;
              p1.y -= ny * 2;
            } else {
              p1.x -= nx;
              p1.y -= ny;
              p2.x += nx;
              p2.y += ny;
            }
          }
        }
      }

      // Step C: Protect Root Sanctuary at center
      if (rootCluster) {
        const rcName = (rootCluster as ClusterItem).name;
        for (const k of clusterKeys) {
          if (k === rcName) continue;
          const p = centers.get(k)!;
          const r = packedMap.get(k)?.radius || 150;
          const d = Math.hypot(p.x, p.y) || 0.01;
          const minRootDist = rootRadius + r + AIR_GAP;
          if (d < minRootDist) {
            const push = minRootDist - d;
            p.x += (p.x / d) * push;
            p.y += (p.y / d) * push;
          }
        }
      }
    }

    return centers;
  }

  private packClusterNodes(
    nodes: SealNode[],
    center: { x: number; y: number }
  ): { nodes: SealNode[]; clusterRadius: number } {
    const sorted = [...nodes].sort((a, b) => b.metrics.radius - a.metrics.radius);
    const placed: SealNode[] = [];
    const avgR = sorted.reduce((s, n) => s + n.metrics.radius, 0) / (sorted.length || 1);
    const stepDist = avgR * 1.15 + this.padding;

    sorted.forEach((node, idx) => {
      if (idx === 0) {
        placed.push({
          ...node,
          x: center.x,
          y: center.y,
        });
      } else {
        const theta = idx * 2.39996; // Golden angle
        const dist = Math.sqrt(idx) * stepDist;
        placed.push({
          ...node,
          x: center.x + Math.cos(theta) * dist,
          y: center.y + Math.sin(theta) * dist,
        });
      }
    });

    // Collision Resolution inside cluster
    const iterations = 35;
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const n1 = placed[i]!;
          const n2 = placed[j]!;
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const minDist = n1.metrics.radius + n2.metrics.radius + this.padding;

          if (dist < minDist) {
            const overlap = (minDist - dist) / 2;
            const nx = (dx / dist) * overlap;
            const ny = (dy / dist) * overlap;

            if (i === 0) {
              n2.x += nx * 1.8;
              n2.y += ny * 1.8;
            } else {
              n1.x -= nx;
              n1.y -= ny;
              n2.x += nx;
              n2.y += ny;
            }
          }
        }
      }
    }

    let maxDistFromCenter = 80;
    placed.forEach((n) => {
      const d = Math.hypot(n.x - center.x, n.y - center.y) + n.metrics.radius;
      if (d > maxDistFromCenter) maxDistFromCenter = d;
    });

    return {
      nodes: placed,
      clusterRadius: Math.round(maxDistFromCenter + 36),
    };
  }

  private calculateOverallBounds(
    nodes: SealNode[],
    clusters: ArchipelagoCluster[]
  ): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach((n) => {
      const r = n.metrics.radius;
      if (n.x - r < minX) minX = n.x - r;
      if (n.x + r > maxX) maxX = n.x + r;
      if (n.y - r < minY) minY = n.y - r;
      if (n.y + r > maxY) maxY = n.y + r;
    });

    clusters.forEach((c) => {
      if (c.x - c.radius < minX) minX = c.x - c.radius;
      if (c.x + c.radius > maxX) maxX = c.x + c.radius;
      if (c.y - c.radius < minY) minY = c.y - c.radius;
      if (c.y + c.radius > maxY) maxY = c.y + c.radius;
    });

    return {
      minX: Math.round(minX - 160),
      minY: Math.round(minY - 160),
      maxX: Math.round(maxX + 160),
      maxY: Math.round(maxY + 160),
    };
  }
}
