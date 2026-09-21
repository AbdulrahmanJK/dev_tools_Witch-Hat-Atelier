import type { ArchipelagoCluster, GrimoireGraph, RawGraphData, SealNode } from '../types/index.js';
import { NestedPacker } from './nestedPacker.js';
import { UnifiedFractalLayout } from './unifiedFractalLayout.js';

export interface ClusterLayoutOptions {
  padding?: number;
  clusterSpacing?: number;
}

export class ClusterLayout {
  private padding: number;
  private nestedPacker: NestedPacker;
  private unifiedPacker: UnifiedFractalLayout;

  constructor(options: ClusterLayoutOptions = {}) {
    this.padding = options.padding || 36;
    this.nestedPacker = new NestedPacker();
    this.unifiedPacker = new UnifiedFractalLayout();
  }

  public computeLayout(graph: RawGraphData): GrimoireGraph {
    const { nodes, edges, clusters } = graph;
    const nodeMap = new Map<string, SealNode>(nodes.map((n: SealNode) => [n.id, n]));

    // 1. Group nodes by cluster
    const clusterNodesMap = new Map<string, SealNode[]>();
    clusters.forEach((c: { name: string; nodeIds: string[]; count: number }) => {
      clusterNodesMap.set(c.name, c.nodeIds.map((id: string) => nodeMap.get(id)!).filter(Boolean));
    });

    // 2. Position Cluster Centers
    const clusterCenters = this.positionClusters(clusters);

    // 3. Layout nodes inside each cluster
    const layoutNodes: SealNode[] = [];
    const layoutClusters: ArchipelagoCluster[] = [];

    for (const cluster of clusters) {
      const cCenter = clusterCenters.get(cluster.name) || { x: 0, y: 0 };
      const cNodes = clusterNodesMap.get(cluster.name) || [];

      if (cNodes.length === 0) continue;

      // Pack nodes around cluster center
      const positioned = this.packClusterNodes(cNodes, cCenter);

      // Compute Realistic Mode internal sub-seals for each node
      positioned.nodes.forEach((n) => {
        n.realisticLayout = this.nestedPacker.packComponentInternalSeals(n);
      });

      layoutNodes.push(...positioned.nodes);

      layoutClusters.push({
        id: `cluster-${cluster.name}`,
        name: cluster.name,
        files: [],
        nodeIds: cNodes.map((n) => n.id),
        x: cCenter.x,
        y: cCenter.y,
        radius: positioned.clusterRadius,
      });
    }

    // Compute Unified Single Grand Spell Fractal Layout
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
      unifiedLayout: {
        rootRadius: unifiedResult.rootRadius,
        mandalaSectors: unifiedResult.mandalaSectors,
      },
    };
  }

  private positionClusters(
    clusters: Array<{ name: string; nodeIds: string[]; count: number }>
  ): Map<string, { x: number; y: number }> {
    const centers = new Map<string, { x: number; y: number }>();

    const rootClusters: typeof clusters = [];
    const pageClusters: typeof clusters = [];
    const atelierClusters: typeof clusters = [];
    const powerClusters: typeof clusters = [];
    const otherClusters: typeof clusters = [];

    clusters.forEach((c) => {
      const name = c.name;
      if (name.includes('Core & Root')) rootClusters.push(c);
      else if (name.startsWith('Province:')) pageClusters.push(c);
      else if (name.startsWith('Atelier:')) atelierClusters.push(c);
      else if (
        name.includes('Redux') ||
        name.includes('State') ||
        name.includes('APIs') ||
        name.includes('Contexts')
      )
        powerClusters.push(c);
      else otherClusters.push(c);
    });

    // 1. Center the Root
    rootClusters.forEach((c) => {
      centers.set(c.name, { x: 0, y: 0 });
    });

    // Helper to distribute items along an orbit ring
    const placeRing = (items: typeof clusters, radius: number, startAngle = 0): void => {
      const count = items.length;
      if (count === 0) return;
      const step = (Math.PI * 2) / count;
      items.forEach((c, idx) => {
        const a = startAngle + idx * step;
        const x = Math.round(Math.cos(a) * radius);
        const y = Math.round(Math.sin(a) * radius);
        centers.set(c.name, { x, y });
      });
    };

    // 2. Ring 1: Provinces (Pages) at Radius ~1750
    placeRing(pageClusters, 1750, 0);

    // 3. Ring 2: Ateliers (UI Components) at Radius ~2950
    placeRing(atelierClusters, 2950, Math.PI / (atelierClusters.length || 1));

    // 4. Ring 3: Power Veins, APIs, Constants at Radius ~4150
    const outerGroup = [...powerClusters, ...otherClusters];
    placeRing(outerGroup, 4150, 0.4);

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

    // Collision Resolution
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

    let maxDistFromCenter = 120;
    placed.forEach((n) => {
      const d = Math.hypot(n.x - center.x, n.y - center.y) + n.metrics.radius;
      if (d > maxDistFromCenter) maxDistFromCenter = d;
    });

    return {
      nodes: placed,
      clusterRadius: Math.round(maxDistFromCenter + 40),
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
      minX: Math.round(minX - 200),
      minY: Math.round(minY - 200),
      maxX: Math.round(maxX + 200),
      maxY: Math.round(maxY + 200),
    };
  }
}
