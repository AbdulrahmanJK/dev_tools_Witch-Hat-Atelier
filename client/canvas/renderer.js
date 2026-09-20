import { GlyphRenderer, WHA_THEMES } from './glyphs.js';

export class WorldRenderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.glyphRenderer = new GlyphRenderer();

    this.nodes = [];
    this.edges = [];
    this.clusters = [];
    this.nodeMap = new Map();

    this.selectedNodeId = null;
    this.hoveredNodeId = null;

    // Pulse animation for active lines
    this.animTime = 0;
    this.pulseOffset = 0;

    // Layer display toggles
    this.layers = {
      clusters: true,
      edges: true,
      labels: true,
      reduxVeins: true,
    };
  }

  setData(data) {
    this.nodes = data.nodes || [];
    this.edges = data.edges || [];
    this.clusters = data.clusters || [];
    this.nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
  }

  render() {
    const ctx = this.ctx;
    const cam = this.camera;
    const dpr = cam.dpr;
    const w = cam.width;
    const h = cam.height;

    // Reset transform and scale by Device Pixel Ratio for crisp HiDPI rendering
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Warm Vintage Parchment background
    ctx.fillStyle = '#f4f1e3';
    ctx.fillRect(0, 0, w, h);

    // Camera transform
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    const vp = cam.getViewportBounds();
    const lod = cam.getLOD();

    // 1. Ancient Cartography Grid & Cardinal Crosshair
    this.drawBackgroundCartography(ctx, vp, cam.zoom);

    // 2. Archipelago Territories (Cluster Halos & Labels)
    if (this.layers.clusters) {
      this.drawClusters(ctx, vp, lod);
    }

    // 3. Magical Connection Lines (Edges)
    if (this.layers.edges) {
      this.drawEdges(ctx, vp, lod);
    }

    // 4. Component Glyphs & Seals
    this.drawNodes(ctx, vp, lod);

    ctx.restore();
  }

  drawBackgroundCartography(ctx, vp, zoom) {
    // Subtle navigational concentric circles around origin (0, 0)
    ctx.strokeStyle = 'rgba(26, 25, 22, 0.05)';
    ctx.lineWidth = 1.2;

    const baseRadii = [400, 900, 1600, 2600, 4000, 6000, 8500];
    baseRadii.forEach((rad) => {
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Cardinal rays from origin
    ctx.beginPath();
    ctx.moveTo(-10000, 0);
    ctx.lineTo(10000, 0);
    ctx.moveTo(0, -10000);
    ctx.lineTo(0, 10000);
    ctx.stroke();
  }

  drawClusters(ctx, vp, lod) {
    for (const c of this.clusters) {
      const cr = c.radius;
      // Viewport culling for cluster
      if (c.x + cr < vp.minX || c.x - cr > vp.maxX || c.y + cr < vp.minY || c.y - cr > vp.maxY) {
        continue;
      }

      // Territorial parchment outline
      ctx.beginPath();
      ctx.arc(c.x, c.y, cr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(234, 230, 208, 0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(26, 25, 22, 0.13)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 8]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Territorial Archipelago Name Banner
      const titleFont = Math.max(14, Math.min(32, cr * 0.08));
      ctx.font = `italic 600 ${titleFont}px 'Palatino Linotype', Palatino, serif`;
      ctx.fillStyle = 'rgba(26, 25, 22, 0.45)';
      ctx.textAlign = 'center';
      ctx.fillText(c.name.toUpperCase(), c.x, c.y - cr - 16);
    }
  }

  drawEdges(ctx, vp, lod) {
    this.pulseOffset = (this.pulseOffset + 0.35) % 20;

    const activeNodeId = this.hoveredNodeId || this.selectedNodeId;
    const activeNode = activeNodeId ? this.nodeMap.get(activeNodeId) : null;

    // Find connected node IDs
    const connectedNodeIds = new Set();
    if (activeNodeId) {
      connectedNodeIds.add(activeNodeId);
      this.edges.forEach((e) => {
        if (e.source === activeNodeId) connectedNodeIds.add(e.target);
        if (e.target === activeNodeId) connectedNodeIds.add(e.source);
      });
    }

    for (const edge of this.edges) {
      const s = this.nodeMap.get(edge.source);
      const t = this.nodeMap.get(edge.target);
      if (!s || !t) continue;

      // Culling: check if line segment roughly overlaps viewport
      const minEx = Math.min(s.x, t.x);
      const maxEx = Math.max(s.x, t.x);
      const minEy = Math.min(s.y, t.y);
      const maxEy = Math.max(s.y, t.y);

      if (maxEx < vp.minX || minEx > vp.maxX || maxEy < vp.minY || minEy > vp.maxY) {
        continue;
      }

      const isConnectedToActive = activeNodeId && (edge.source === activeNodeId || edge.target === activeNodeId);
      const isDormant = activeNodeId && !isConnectedToActive;

      // Draw smooth curving ink thread
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.hypot(dx, dy);
      // Gentle curve offset perpendicular to direction
      const normalX = -dy / dist;
      const normalY = dx / dist;
      const curvature = Math.min(60, dist * 0.12);
      const midX = (s.x + t.x) / 2 + normalX * curvature;
      const midY = (s.y + t.y) / 2 + normalY * curvature;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(midX, midY, t.x, t.y);

      if (isConnectedToActive) {
        const isOutgoing = edge.source === activeNodeId;
        const color = isOutgoing ? '#b83a14' : '#106ba3';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.4;
        ctx.setLineDash([8, 4]);
        ctx.lineDashOffset = isOutgoing ? -this.pulseOffset : this.pulseOffset;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = isDormant ? 'rgba(26, 25, 22, 0.04)' : 'rgba(26, 25, 22, 0.13)';
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }
    }
  }

  drawNodes(ctx, vp, lod) {
    const activeNodeId = this.hoveredNodeId || this.selectedNodeId;
    const connectedNodeIds = new Set();
    if (activeNodeId) {
      connectedNodeIds.add(activeNodeId);
      this.edges.forEach((e) => {
        if (e.source === activeNodeId) connectedNodeIds.add(e.target);
        if (e.target === activeNodeId) connectedNodeIds.add(e.source);
      });
    }

    for (const node of this.nodes) {
      const r = node.metrics.radius;

      // Viewport culling: Skip nodes outside visible screen!
      if (node.x + r + 40 < vp.minX || node.x - r - 40 > vp.maxX || node.y + r + 40 < vp.minY || node.y - r - 40 > vp.maxY) {
        continue;
      }

      const isSelected = node.id === this.selectedNodeId;
      const isHovered = node.id === this.hoveredNodeId;
      const isDimmed = activeNodeId && !connectedNodeIds.has(node.id);

      ctx.save();
      if (isDimmed) {
        ctx.globalAlpha = 0.22;
      }

      this.glyphRenderer.renderNode(ctx, node, lod, isSelected, isHovered);
      ctx.restore();
    }
  }

  findNodeAt(screenX, screenY) {
    const worldPos = this.camera.screenToWorld(screenX, screenY);
    // Search in reverse so top-drawn nodes match first
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      const dist = Math.hypot(worldPos.x - node.x, worldPos.y - node.y);
      if (dist <= node.metrics.radius + 6) {
        return node;
      }
    }
    return null;
  }
}
