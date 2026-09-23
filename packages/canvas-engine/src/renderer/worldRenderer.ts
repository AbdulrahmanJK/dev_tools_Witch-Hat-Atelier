import type {
  ArchipelagoCluster,
  DependencySeal,
  DiagnosticFilter,
  DevToolsTelemetryEvent,
  GrimoireGraph,
  MandalaSector,
  SealEdge,
  SealNode,
} from '@wha/core';
import type { Camera, ViewportBounds } from '../camera/camera.js';
import { GlyphRenderer } from '../glyphs/glyphRenderer.js';
import { PulseManager } from '../telemetry/pulseManager.js';
import { InkFlameRenderer } from '../telemetry/inkFlameRenderer.js';
import type { VFXEngine } from '../vfx/vfxEngine.js';
import type { VFXItem } from '../vfx/vfxTypes.js';

export class WorldRenderer {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public camera: Camera;
  public glyphRenderer: GlyphRenderer;
  public pulseManager: PulseManager;
  public inkFlameRenderer: InkFlameRenderer;
  public vfxEngine: VFXEngine | null = null;

  public nodes: SealNode[] = [];
  public edges: SealEdge[] = [];
  public clusters: ArchipelagoCluster[] = [];
  public dependencies: DependencySeal[] = [];
  public selectedDependencyId: string | null = null;
  public nodeMap = new Map<string, SealNode>();
  public mandalaSectors: MandalaSector[] = [];
  public rootRadius = 1140;

  public selectedNodeId: string | null = null;
  public hoveredNodeId: string | null = null;
  public lineageNodeIds = new Set<string>();
  public lineageEdgeKeys = new Set<string>();

  public unifiedMode = false;
  public realisticMode = false;
  public devToolsMode = false;
  public activeFilter = 'all';
  public diagnosticFilter: DiagnosticFilter = 'all';

  private sortedUnifiedNodes: SealNode[] = [];
  private pulseOffset = 0;
  private auraDashOffset = 0;

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.camera = camera;
    this.glyphRenderer = new GlyphRenderer();
    this.pulseManager = new PulseManager();
    this.inkFlameRenderer = new InkFlameRenderer();
  }

  public setData(data: GrimoireGraph): void {
    this.nodes = data.nodes || [];
    this.edges = data.edges || [];
    this.clusters = data.clusters || [];
    this.dependencies = data.dependencies || [];
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
    devToolsMode?: boolean;
    diagnosticFilter?: DiagnosticFilter;
  }): void {
    if (options.unifiedMode !== undefined) this.unifiedMode = options.unifiedMode;
    if (options.realisticMode !== undefined) this.realisticMode = options.realisticMode;
    if (options.activeFilter !== undefined) this.activeFilter = options.activeFilter;
    if (options.devToolsMode !== undefined) this.devToolsMode = options.devToolsMode;
    if (options.diagnosticFilter !== undefined) this.diagnosticFilter = options.diagnosticFilter;
  }

  public setVFXEngine(vfx: VFXEngine | null): void {
    this.vfxEngine = vfx;
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

  public hitTestDependency(worldX: number, worldY: number): DependencySeal | null {
    return this.dependencies.find((seal) => Math.hypot(worldX - seal.x, worldY - seal.y) <= seal.radius + 6) || null;
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

    // Clear 2D canvas so underlying WebGL VFX flames show through,
    // while solid node seal paper and all text labels stay 100% on top!
    ctx.clearRect(0, 0, cam.width, cam.height);
    if (this.realisticMode) {
      ctx.fillStyle = '#faf8f0';
      ctx.fillRect(0, 0, cam.width, cam.height);
    }

    // Apply Camera Transform
    ctx.save();
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
    this.drawDependencies(ctx, vp);

    ctx.restore(); // Keep device-pixel scaling, but return to screen coordinates.

    // Screen-space pulses stay legible when the architecture is zoomed far out.
    this.pulseManager.drawPulses(
      ctx,
      (nodeId) => {
        const node = this.nodeMap.get(nodeId);
        if (!node) return null;
        const pos = this.getNodePos(node);
        const screen = cam.worldToScreen(pos.x, pos.y);
        return { x: screen.x, y: screen.y, r: Math.max(13, Math.min(30, pos.r * cam.zoom)) };
      },
      time
    );

    ctx.restore();

    // 2. Dispatch GPU WebGL VFX items
    const vfxItems: VFXItem[] = [];
    const allowFlame =
      this.devToolsMode &&
      !this.realisticMode &&
      (this.diagnosticFilter === 'all' || this.diagnosticFilter === 'hot');

    if (allowFlame) {
      const activeNodeId = this.selectedNodeId || this.hoveredNodeId;
      const list = this.unifiedMode ? this.sortedUnifiedNodes : this.nodes;

      for (const node of list) {
        if (this.activeFilter !== 'all' && node.metrics?.element !== this.activeFilter) continue;
        const dt = node.metrics?.devTools;
        if (!dt) continue;
        const state = node.telemetry?.isOverheating ? 'overcharged' : dt.overloadState;
        if (state === 'warm' || state === 'overcharged' || state === 'fissure') {
          const pos = this.getNodePos(node);
          const boundR = pos.r * 1.35;
          // Viewport culling
          if (
            pos.x + boundR < vp.x1 ||
            pos.x - boundR > vp.x2 ||
            pos.y + boundR < vp.y1 ||
            pos.y - boundR > vp.y2
          ) {
            continue;
          }

          const isDimmed =
            !!activeNodeId &&
            node.id !== activeNodeId &&
            !this.lineageNodeIds.has(node.id) &&
            this.diagnosticFilter !== 'hot';

          // Option V: For dimmed nodes, use state = 3 (subtle smoldering runic embers along the rim)
          // For active / focused node or when in 'hot' filter, use state 1 (warm) or state 2 (overcharged/fissure)
          let vfxState: 1 | 2 | 3 = state === 'warm' ? 1 : 2;
          let intensity = state === 'fissure' ? 1.0 : state === 'overcharged' ? 0.85 : 0.45;

          if (isDimmed) {
            vfxState = 3; // Smoldering embers!
            intensity = 0.22;
          }

          vfxItems.push({
            id: node.id,
            x: pos.x,
            y: pos.y,
            radius: pos.r,
            intensity,
            state: vfxState,
            seed: ((node.loc || 1) * 3.17 + pos.r * 7.1) % 100.0,
          });
        }
      }
    }

    const vfxRes = this.vfxEngine
      ? this.vfxEngine.render(this.camera, vfxItems, nowSec)
      : { hasActiveAnimation: false };

    // Determine if next frame should be scheduled
    const hasActiveAnimation =
      cam.animating ||
      (!this.realisticMode && !!this.selectedNodeId) ||
      (this.devToolsMode && !this.realisticMode && vfxRes.hasActiveAnimation) ||
      this.pulseManager.hasActivePulses(time);

    return { hasActiveAnimation };
  }

  private drawDependencies(ctx: CanvasRenderingContext2D, vp: ViewportBounds): void {
    const active = this.selectedDependencyId;
    for (const seal of this.dependencies) {
      if (seal.x + seal.radius < vp.x1 || seal.x - seal.radius > vp.x2 || seal.y + seal.radius < vp.y1 || seal.y - seal.radius > vp.y2) continue;
      const selected = active === seal.id;
      ctx.save();
      if (selected) {
        ctx.strokeStyle = 'rgba(138, 97, 38, 0.28)';
        ctx.setLineDash([5, 6]);
        const groups = new Map<string, { x: number; y: number; count: number }>();
        for (const id of seal.importerNodeIds) {
          const node = this.nodeMap.get(id);
          if (!node) continue;
          const position = this.getNodePos(node);
          const key = node.cluster || 'Other';
          const group = groups.get(key) || { x: 0, y: 0, count: 0 };
          group.x += position.x; group.y += position.y; group.count++;
          groups.set(key, group);
        }
        for (const group of groups.values()) {
          const targetX = group.x / group.count;
          const targetY = group.y / group.count;
          const middleX = (seal.x + targetX) / 2;
          const middleY = (seal.y + targetY) / 2;
          ctx.lineWidth = Math.min(3, 1 + Math.log2(group.count) * 0.45);
          ctx.beginPath();
          ctx.moveTo(seal.x, seal.y);
          ctx.quadraticCurveTo(middleX - (targetY - seal.y) * 0.08, middleY + (targetX - seal.x) * 0.08, targetX, targetY);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      ctx.translate(seal.x, seal.y);
      ctx.fillStyle = '#fbf6e8';
      const weight = seal.build?.emittedBytesEstimate;
      ctx.strokeStyle = selected ? '#a05a20' : weight == null ? '#a98d60' : weight >= 100 * 1024 ? '#b54631' : weight >= 20 * 1024 ? '#b78a34' : '#6f865e';
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.beginPath(); ctx.arc(0, 0, seal.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#c5aa79'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(0, 0, seal.radius - 5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#654527';
      ctx.font = 'bold 13px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✦', 0, -5);
      ctx.font = '10px serif';
      ctx.fillText(String(seal.importerNodeIds.length), 0, 12);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = '#654527'; ctx.textAlign = 'center'; ctx.font = '12px serif';
      ctx.fillText(seal.name, seal.x, seal.y + seal.radius + 17);
      ctx.restore();
    }
  }

  /**
   * Draw classical Witch Hat Atelier archipelago boundary rings
   * Active in BOTH default interactive mode and realistic art mode!
   */
  private drawClustersBackdrop(
    ctx: CanvasRenderingContext2D,
    vp: ViewportBounds,
    _lod: 0 | 1 | 2
  ): void {
    const isArt = this.realisticMode;

    for (const cluster of this.clusters) {
      const r = cluster.radius;
      if (
        cluster.x + r + 50 < vp.x1 ||
        cluster.x - r - 50 > vp.x2 ||
        cluster.y + r + 50 < vp.y1 ||
        cluster.y - r - 50 > vp.y2
      ) {
        continue;
      }

      ctx.save();
      ctx.translate(cluster.x, cluster.y);

      if (isArt) {
        // Authentic Monochrome Manga Inscription Ring
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#141311';
        ctx.lineWidth = 1.6;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, r - 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(20, 19, 17, 0.28)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // 4 Cardinal keystone marks
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 2.8, 0, Math.PI * 2);
          ctx.fillStyle = '#141311';
          ctx.fill();
        }
      } else {
        // Interactive Mode: Golden Parchment Boundary Ring
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(196, 139, 38, 0.32)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([8, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(0, 0, r - 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(20, 19, 17, 0.10)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Archipelago Title (Visible across all zoom levels for structural clarity)
      ctx.font = 'bold 13px Palatino, Georgia, serif';
      ctx.fillStyle = isArt ? '#141311' : 'rgba(20, 19, 17, 0.72)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`✦ ${cluster.name} ✦`, 0, -r - 10);

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

    ctx.beginPath();
    ctx.arc(0, 0, R * 0.97, 0, Math.PI * 2);
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Sacred Sector Mandala Slices
    this.mandalaSectors.forEach((sec) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, sec.angleStart, sec.angleEnd);
      ctx.closePath();
      ctx.strokeStyle = '#141311';
      ctx.lineWidth = 1.8;
      ctx.stroke();

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

  /**
   * Draw ink connection lines with smart LOD filtering to prevent visual clutter
   */
  private drawEdges(ctx: CanvasRenderingContext2D, vp: ViewportBounds, _lod: 0 | 1 | 2): void {
    if (this.realisticMode) return;

    const activeNodeId = this.selectedNodeId || this.hoveredNodeId;
    const pulseOffset = this.pulseOffset;
    const isZoomedFarOut = this.camera.zoom < 0.32;

    for (const edge of this.edges) {
      const s = this.nodeMap.get(edge.source);
      const t = this.nodeMap.get(edge.target);
      if (!s || !t) continue;

      // Smart LOD: When zoomed far out and no node is actively inspected,
      // filter out noisy internal button/icon micro-links, keeping major structural arteries clear!
      if (isZoomedFarOut && !activeNodeId && !this.unifiedMode) {
        const isInterCluster = s.cluster !== t.cluster;
        const isCoreEdge =
          s.cluster?.includes('Core') ||
          t.cluster?.includes('Core') ||
          s.isSharedHub ||
          t.isSharedHub;
        if (!isInterCluster && !isCoreEdge) {
          continue;
        }
      }

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

      const isHotConnectedEdge =
        this.devToolsMode &&
        isConnectedToActive &&
        (s.metrics?.devTools?.overloadState === 'fissure' ||
          s.metrics?.devTools?.overloadState === 'overcharged' ||
          t.metrics?.devTools?.overloadState === 'fissure' ||
          t.metrics?.devTools?.overloadState === 'overcharged');

      const isCircularLoop = this.devToolsMode && (edge.isCircular || false);
      const isCyclesFilter = this.devToolsMode && this.diagnosticFilter === 'cycles';
      const isOrphansFilter = this.devToolsMode && this.diagnosticFilter === 'orphans';
      const isPactFilter = this.devToolsMode && this.diagnosticFilter === 'pact';

      ctx.save();

      if (this.devToolsMode && edge.isArchitectureViolation) {
        ctx.strokeStyle = '#b83a14';
        ctx.lineWidth = isPactFilter ? 3.2 : 2.2;
        ctx.setLineDash([3, 4]);
        ctx.globalAlpha = 1;
      } else if (isLineageEdge || isConnectedToActive) {
        // Active flowing golden / fiery ink thread
        ctx.strokeStyle = isHotConnectedEdge ? '#d43827' : isCircularLoop ? '#a82adb' : '#c48b26';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([8, 4]);
        ctx.lineDashOffset = -(isHotConnectedEdge ? pulseOffset * 2.2 : pulseOffset);
        ctx.globalAlpha = 1.0;
      } else if (isCircularLoop) {
        // Vibrant purple Ouroboros cycle thread
        ctx.strokeStyle = '#a82adb';
        ctx.lineWidth = isCyclesFilter ? 2.8 : 2.2;
        ctx.setLineDash([6, 3]);
        ctx.lineDashOffset = -(pulseOffset * 1.5);
        ctx.globalAlpha = 1.0;
      } else if (isCyclesFilter || isOrphansFilter || isPactFilter || isDimmed) {
        // Soft whisper threads: don't delete lines, keep them subtle so orphan circles pop out!
        ctx.strokeStyle = 'rgba(20, 19, 17, 0.04)';
        ctx.lineWidth = 0.6;
      } else {
        ctx.strokeStyle = 'rgba(20, 19, 17, 0.16)';
        ctx.lineWidth = 1.0;
      }

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);

      // Graceful curved ink line (quill stroke)
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy) || 1;
      const bend = Math.min(28, dist * 0.07);
      const cx = mx - (dy / dist) * bend;
      const cy = my + (dx / dist) * bend;

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

      let isDimmedByDiag = false;
      if (this.devToolsMode && this.diagnosticFilter !== 'all') {
        if (this.diagnosticFilter === 'cycles' && !node.isCircular) isDimmedByDiag = true;
        else if (this.diagnosticFilter === 'orphans' && !node.isOrphan) isDimmedByDiag = true;
        else if (this.diagnosticFilter === 'hot') {
          const st = node.metrics?.devTools?.overloadState;
          if (st !== 'overcharged' && st !== 'fissure' && !node.telemetry?.isOverheating) isDimmedByDiag = true;
        } else if (this.diagnosticFilter === 'pact' && !node.architectureViolationIds?.length) {
          isDimmedByDiag = true;
        }
      }

      const isDimmed =
        isDimmedByDiag ||
        (!isArt && !this.unifiedMode && !!activeNodeId && !isSelected && !isConnected && !isHovered);

      ctx.save();
      // Keep unselected elements visible at exactly 20% opacity (or 12% in focused diagnostic mode)
      if (isDimmed) {
        ctx.globalAlpha = isDimmedByDiag ? 0.10 : 0.20;
      } else {
        ctx.globalAlpha = 1.0;
      }

      // 1. Lineage / Connection aura
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

      // 2. DevTools Mode: Ouroboros Circular Loop Aura
      if (this.devToolsMode && !isArt && node.isCircular) {
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.beginPath();
        ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#a82adb';
        ctx.lineWidth = 2.0;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -this.auraDashOffset * 1.5;
        ctx.stroke();
        ctx.restore();
      }

      // 3. DevTools Mode: Ashen Dead Code Ghost Contour
      if (this.devToolsMode && !isArt && node.isOrphan) {
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.beginPath();
        ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = this.diagnosticFilter === 'orphans' ? '#c48b26' : '#8a857b';
        ctx.lineWidth = this.diagnosticFilter === 'orphans' ? 2.4 : 1.6;
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.restore();
      }

      if (this.devToolsMode && !isArt && node.architectureViolationIds?.length) {
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.beginPath();
        ctx.arc(0, 0, r + 10, 0, Math.PI * 2);
        ctx.strokeStyle = '#b83a14';
        ctx.lineWidth = this.diagnosticFilter === 'pact' ? 3 : 1.7;
        ctx.setLineDash([2, 5]);
        ctx.stroke();
        ctx.restore();
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
