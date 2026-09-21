import type {
  ArchipelagoCluster,
  DevToolsTelemetryEvent,
  GrimoireGraph,
  MandalaSector,
  SealEdge,
  SealNode,
} from '@wha/core';
import type { Camera, ViewportBounds } from '../camera/camera.js';
import { GlyphRenderer } from '../glyphs/glyphRenderer.js';
import { PulseManager } from '../telemetry/pulseManager.js';

export class WorldRenderer {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public camera: Camera;
  public glyphRenderer: GlyphRenderer;
  public pulseManager: PulseManager;

  public nodes: SealNode[] = [];
  public edges: SealEdge[] = [];
  public clusters: ArchipelagoCluster[] = [];
  public nodeMap = new Map<string, SealNode>();
  public mandalaSectors: MandalaSector[] = [];
  public rootRadius = 1140;

  public selectedNodeId: string | null = null;
  public hoveredNodeId: string | null = null;
  public lineageNodeIds = new Set<string>();
  public lineageEdgeKeys = new Set<string>();

  public unifiedMode = false;
  public realisticMode = false;
  public activeFilter = 'all';

  private sortedUnifiedNodes: SealNode[] = [];
  private pulseOffset = 0;
  private auraDashOffset = 0;

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.camera = camera;
    this.glyphRenderer = new GlyphRenderer();
    this.pulseManager = new PulseManager();
  }

  public setData(data: GrimoireGraph): void {
    this.nodes = data.nodes || [];
    this.edges = data.edges || [];
    this.clusters = data.clusters || [];
    this.nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
    this.mandalaSectors = data.unifiedLayout?.mandalaSectors || [];
    this.rootRadius = data.unifiedLayout?.rootRadius || 1140;

    // Pre-calculate edge keys for zero runtime allocations
    this.edges.forEach((e) => {
      e._key1 = `${e.source}->${e.target}`;
      e._key2 = `${e.target}->${e.source}`;
    });

    // Pre-sort nodes for unified mode descending by radius
    this.sortedUnifiedNodes = [...this.nodes].sort((a, b) => (b.unifiedR || 0) - (a.unifiedR || 0));
  }

  public getNodePos(node: SealNode): { x: number; y: number; r: number } {
    if (this.unifiedMode) {
      return {
        x: node.unifiedX || 0,
        y: node.unifiedY || 0,
        r: node.unifiedR || node.metrics.radius,
      };
    }
    return {
      x: node.x,
      y: node.y,
      r: node.metrics.radius,
    };
  }

  public setSelectedNode(
    nodeId: string | null,
    lineageNodes: string[] = [],
    lineageEdges: string[] = []
  ): void {
    this.selectedNodeId = nodeId;
    this.lineageNodeIds = new Set(lineageNodes);
    this.lineageEdgeKeys = new Set(lineageEdges);
  }

  public setHoveredNode(nodeId: string | null): void {
    this.hoveredNodeId = nodeId;
  }

  public setModes(options: {
    unifiedMode?: boolean;
    realisticMode?: boolean;
    activeFilter?: string;
  }): void {
    if (options.unifiedMode !== undefined) this.unifiedMode = options.unifiedMode;
    if (options.realisticMode !== undefined) this.realisticMode = options.realisticMode;
    if (options.activeFilter !== undefined) this.activeFilter = options.activeFilter;
  }

  public triggerDevToolsPulse(nodeId: string, event: DevToolsTelemetryEvent): void {
    this.pulseManager.triggerPulse(nodeId, event);
  }

  public hitTestNode(worldX: number, worldY: number): SealNode | null {
    // Check in reverse order so topmost drawn nodes are clicked first
    const list = this.unifiedMode
      ? [...(this.sortedUnifiedNodes || this.nodes)].reverse()
      : [...this.nodes].reverse();

    for (const node of list) {
      if (this.activeFilter !== 'all' && node.metrics?.element !== this.activeFilter) {
        continue;
      }
      const pos = this.getNodePos(node);
      const dist = Math.hypot(worldX - pos.x, worldY - pos.y);
      if (dist <= pos.r + 4) {
        return node;
      }
    }
    return null;
  }

  public render(time = performance.now()): { hasActiveAnimation: boolean } {
    const ctx = this.ctx;
    const cam = this.camera;
    const dpr = cam.dpr;

    const nowSec = time / 1000;
    this.pulseOffset = (nowSec * 24) % 12;
    this.auraDashOffset = -((nowSec * 15) % 10);
    this.glyphRenderer.setAuraDashOffset(this.auraDashOffset);

    ctx.save();
    ctx.scale(dpr, dpr);

    // Parchment background
    ctx.fillStyle = this.realisticMode ? '#faf8f0' : '#f7f4e8';
    ctx.fillRect(0, 0, cam.width, cam.height);

    // Apply Camera Transform
    ctx.translate(cam.width / 2, cam.height / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    const vp = cam.getViewportBounds();
    const lod = cam.getLOD();

    if (this.unifiedMode) {
      this.drawUnifiedMandalaBackdrop(ctx, vp, lod);
    } else {
      this.drawClustersBackdrop(ctx, vp, lod);
    }

    this.drawEdges(ctx, vp, lod);
    this.drawNodes(ctx, vp, lod);

    // DevTools telemetry pulses
    this.pulseManager.drawPulses(
      ctx,
      (nodeId) => {
        const node = this.nodeMap.get(nodeId);
        return node ? this.getNodePos(node) : null;
      },
      time
    );

    ctx.restore();

    // Determine if next frame should be scheduled
    const hasActiveAnimation =
      cam.animating ||
      (!this.realisticMode && !!this.selectedNodeId) ||
      this.pulseManager.hasActivePulses(time);

    return { hasActiveAnimation };
  }

  private drawClustersBackdrop(
    ctx: CanvasRenderingContext2D,
    vp: ViewportBounds,
    lod: 0 | 1 | 2
  ): void {
    if (this.realisticMode) return;

    for (const cluster of this.clusters) {
      const r = cluster.radius;
      if (
        cluster.x + r < vp.x1 ||
        cluster.x - r > vp.x2 ||
        cluster.y + r < vp.y1 ||
        cluster.y - r > vp.y2
      ) {
        continue;
      }

      ctx.save();
      ctx.translate(cluster.x, cluster.y);

      // Subtle atmospheric boundary
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(20, 19, 17, 0.09)';
      ctx.lineWidth = 1.0;
      ctx.setLineDash([6, 8]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (lod >= 1) {
        ctx.font = '12px Palatino, Georgia, serif';
        ctx.fillStyle = 'rgba(20, 19, 17, 0.45)';
        ctx.textAlign = 'center';
        ctx.fillText(`✦ ${cluster.name} ✦`, 0, -r - 14);
      }

      ctx.restore();
    }
  }

  private drawUnifiedMandalaBackdrop(
    ctx: CanvasRenderingContext2D,
    _vp: ViewportBounds,
    lod: 0 | 1 | 2
  ): void {
    ctx.save();
    ctx.translate(0, 0);

    const R = this.rootRadius;

    // Master Outer Circle
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#141311';
    ctx.lineWidth = 4.0;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, R * 0.985, 0, Math.PI * 2);
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Sacred Sectors
    this.mandalaSectors.forEach((sec) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, sec.angleStart, sec.angleEnd);
      ctx.closePath();
      ctx.fillStyle = sec.color;
      ctx.globalAlpha = 0.025;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      if (lod >= 1) {
        const midAngle = (sec.angleStart + sec.angleEnd) / 2;
        const textDist = R + 42;
        const tx = Math.cos(midAngle) * textDist;
        const ty = Math.sin(midAngle) * textDist;

        ctx.save();
        ctx.translate(tx, ty);
        ctx.font = 'bold 14px Palatino, Georgia, serif';
        ctx.fillStyle = sec.color;
        ctx.textAlign = 'center';
        ctx.fillText(`✦ ${sec.label} ✦`, 0, 0);
        ctx.restore();
      }
    });

    ctx.restore();
  }

  private drawEdges(ctx: CanvasRenderingContext2D, vp: ViewportBounds, _lod: 0 | 1 | 2): void {
    if (this.realisticMode) return;

    const activeNodeId = this.selectedNodeId || this.hoveredNodeId;
    const pulseOffset = this.pulseOffset;

    for (const edge of this.edges) {
      const s = this.nodeMap.get(edge.source);
      const t = this.nodeMap.get(edge.target);
      if (!s || !t) continue;

      const p1 = this.getNodePos(s);
      const p2 = this.getNodePos(t);

      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);

      if (maxX < vp.x1 || minX > vp.x2 || maxY < vp.y1 || minY > vp.y2) {
        continue;
      }

      const isLineageEdge =
        this.unifiedMode &&
        this.lineageEdgeKeys &&
        (this.lineageEdgeKeys.has(edge._key1 || '') || this.lineageEdgeKeys.has(edge._key2 || ''));

      const isConnectedToActive =
        !this.unifiedMode &&
        !!activeNodeId &&
        (edge.source === activeNodeId || edge.target === activeNodeId);

      const isDimmed =
        !this.unifiedMode &&
        !!activeNodeId &&
        edge.source !== activeNodeId &&
        edge.target !== activeNodeId;

      ctx.save();

      if (isLineageEdge || isConnectedToActive) {
        // Active golden flowing thread
        ctx.strokeStyle = '#c48b26';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([8, 4]);
        ctx.lineDashOffset = -pulseOffset;
        ctx.globalAlpha = 1.0;
      } else if (isDimmed) {
        ctx.strokeStyle = 'rgba(20, 19, 17, 0.08)';
        ctx.lineWidth = 0.8;
      } else {
        ctx.strokeStyle = 'rgba(20, 19, 17, 0.20)';
        ctx.lineWidth = 1.0;
      }

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);

      // Curved ink line
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const bend = Math.min(30, Math.hypot(dx, dy) * 0.08);
      const cx = mx - (dy / (Math.hypot(dx, dy) || 1)) * bend;
      const cy = my + (dx / (Math.hypot(dx, dy) || 1)) * bend;

      ctx.quadraticCurveTo(cx, cy, p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawNodes(ctx: CanvasRenderingContext2D, vp: ViewportBounds, lod: 0 | 1 | 2): void {
    const isArt = this.realisticMode;
    const activeNodeId = isArt ? null : this.selectedNodeId || this.hoveredNodeId;

    const connectedNodeIds = new Set<string>();
    if (activeNodeId && !this.unifiedMode) {
      for (const e of this.edges) {
        if (e.source === activeNodeId) connectedNodeIds.add(e.target);
        if (e.target === activeNodeId) connectedNodeIds.add(e.source);
      }
    }

    const renderList = this.unifiedMode ? this.sortedUnifiedNodes : this.nodes;

    for (const node of renderList) {
      if (this.activeFilter !== 'all' && node.metrics?.element !== this.activeFilter) {
        continue;
      }

      const pos = this.getNodePos(node);
      const r = pos.r;

      // Viewport culling
      if (
        pos.x + r + 30 < vp.x1 ||
        pos.x - r - 30 > vp.x2 ||
        pos.y + r + 30 < vp.y1 ||
        pos.y - r - 30 > vp.y2
      ) {
        continue;
      }

      const isSelected = !isArt && node.id === this.selectedNodeId;
      const isHovered = !isArt && !this.selectedNodeId && node.id === this.hoveredNodeId;
      const isConnected =
        !isArt && !this.unifiedMode && !!activeNodeId && connectedNodeIds.has(node.id);

      const shouldShowAura =
        !isArt &&
        !isSelected &&
        !isHovered &&
        (this.unifiedMode ? this.lineageNodeIds && this.lineageNodeIds.has(node.id) : isConnected);

      const isDimmed =
        !isArt && !this.unifiedMode && !!activeNodeId && !isSelected && !isConnected && !isHovered;

      if (shouldShowAura) {
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.beginPath();
        ctx.arc(0, 0, r + 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#c48b26';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = this.auraDashOffset;
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      if (isDimmed) {
        ctx.globalAlpha = 0.78;
        ctx.filter = 'grayscale(55%)';
      } else {
        ctx.globalAlpha = 1.0;
        ctx.filter = 'none';
      }

      const origX = node.x;
      const origY = node.y;
      const origR = node.metrics?.radius || 50;

      if (this.unifiedMode) {
        node.x = pos.x;
        node.y = pos.y;
        if (node.metrics) node.metrics.radius = r;
      }

      this.glyphRenderer.renderNode(ctx, node, lod, isSelected, isHovered, isArt, shouldShowAura);

      if (this.unifiedMode) {
        node.x = origX;
        node.y = origY;
        if (node.metrics) node.metrics.radius = origR;
      }
      ctx.restore();
    }
  }
}
