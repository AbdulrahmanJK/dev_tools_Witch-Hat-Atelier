import { NestedPacker } from './nestedPacker.js';

export class ClusterLayout {
  constructor(options = {}) {
    this.padding = options.padding || 36;
    this.clusterSpacing = options.clusterSpacing || 380;
    this.nestedPacker = new NestedPacker();
  }

  computeLayout(graph) {
    const { nodes, edges, clusters } = graph;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // 1. Group nodes by cluster
    const clusterNodesMap = new Map();
    clusters.forEach((c) => {
      clusterNodesMap.set(c.name, c.nodeIds.map((id) => nodeMap.get(id)).filter(Boolean));
    });

    // 2. Position Cluster Centers
    const clusterCenters = this.positionClusters(clusters);

    // 3. Layout nodes inside each cluster
    const layoutNodes = [];
    const layoutClusters = [];

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
        name: cluster.name,
        x: cCenter.x,
        y: cCenter.y,
        radius: positioned.clusterRadius,
        nodeCount: cNodes.length,
      });
    }

    // 4. Return graph enriched with (x, y) coordinates
    return {
      nodes: layoutNodes,
      edges,
      clusters: layoutClusters,
      bounds: this.calculateOverallBounds(layoutNodes, layoutClusters),
      stats: graph.stats,
    };
  }

  positionClusters(clusters) {
    const centers = new Map();

    // Categorize clusters by realm
    const rootClusters = [];
    const pageClusters = [];
    const atelierClusters = [];
    const powerClusters = [];
    const otherClusters = [];

    clusters.forEach((c) => {
      const name = c.name;
      if (name.includes('Core & Root')) rootClusters.push(c);
      else if (name.startsWith('Province:')) pageClusters.push(c);
      else if (name.startsWith('Atelier:')) atelierClusters.push(c);
      else if (name.includes('Redux') || name.includes('APIs') || name.includes('Contexts')) powerClusters.push(c);
      else otherClusters.push(c);
    });

    // 1. Center the Root
    rootClusters.forEach((c) => {
      centers.set(c.name, { x: 0, y: 0 });
    });

    // Helper to distribute items along an orbit ring
    const placeRing = (items, radius, startAngle = 0) => {
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

    // 2. Ring 1: Provinces (Pages) at Radius ~1300
    placeRing(pageClusters, 1350, 0);

    // 3. Ring 2: Ateliers (UI Components) at Radius ~2500
    placeRing(atelierClusters, 2450, Math.PI / (atelierClusters.length || 1));

    // 4. Ring 3: Power Veins, APIs, Constants at Radius ~3500
    const outerGroup = [...powerClusters, ...otherClusters];
    placeRing(outerGroup, 3450, 0.4);

    return centers;
  }

  packClusterNodes(nodes, center) {
    // Sort nodes within cluster: largest (most LOC / central) first
    const sorted = [...nodes].sort((a, b) => b.metrics.radius - a.metrics.radius);

    // Initial spiral placement
    const placed = [];
    const phi = (1 + Math.sqrt(5)) / 2; // Golden ratio

    sorted.forEach((node, idx) => {
      if (idx === 0) {
        placed.push({
          ...node,
          x: center.x,
          y: center.y,
        });
      } else {
        const theta = idx * 2.39996; // Golden angle in radians
        // Distance increases with square root of index and node sizes
        const dist = Math.sqrt(idx) * (node.metrics.radius * 2.1 + this.padding);
        placed.push({
          ...node,
          x: center.x + Math.cos(theta) * dist,
          y: center.y + Math.sin(theta) * dist,
        });
      }
    });

    // Collision Resolution / Relaxation iterations
    const iterations = 35;
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const n1 = placed[i];
          const n2 = placed[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const minDist = n1.metrics.radius + n2.metrics.radius + this.padding;

          if (dist < minDist) {
            const overlap = (minDist - dist) / 2;
            const nx = (dx / dist) * overlap;
            const ny = (dy / dist) * overlap;

            // Anchor the primary central node more strongly
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

    // Calculate bounding radius of the cluster
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

  calculateOverallBounds(nodes, clusters) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

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
      width: Math.round(maxX - minX + 400),
      height: Math.round(maxY - minY + 400),
    };
  }
}
