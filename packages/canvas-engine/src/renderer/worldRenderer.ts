import type {
  ArchipelagoCluster,
  DependencySeal,
  DiagnosticFilter,
  DevToolsTelemetryEvent,
  GrimoireGraph,
  SealEdge,
  SealNode,
} from '@wha/core';
import type { Camera, ViewportBounds } from '../camera/camera.js';
import { GlyphRenderer, WHA_THEMES } from '../glyphs/glyphRenderer.js';
import { appendSealShape } from '../glyphs/sealShape.js';
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

  public selectedNodeId: string | null = null;
  public hoveredNodeId: string | null = null;
  public lineageNodeIds = new Set<string>();
  public realisticMode = false;
  public lightweightMode = false;
  public devToolsMode = false;
  public activeFilter = 'all';
  public diagnosticFilter: DiagnosticFilter = 'all';

  private readonly spatialCell = 512;
  private ordinaryIndex = new Map<string, SealNode[]>();
  private edgeAdjacency = new Map<string, SealEdge[]>();
  private lightweightEdges: SealEdge[] = [];
  private maxNodeRadius = 120;
  private ordinaryOrder = new Map<string, number>();
  private farCacheCanvas: HTMLCanvasElement | null = null;
  private farCacheKey = '';
  private telemetryVersion = 0;
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
    this.farCacheKey = '';
    this.nodes = data.nodes || [];
    this.edges = data.edges || [];
    this.clusters = data.clusters || [];
    this.dependencies = data.dependencies || [];
    this.nodeMap = new Map(this.nodes.map((n) => [n.id, n]));

    // Pre-calculate edge keys for zero runtime allocations
    this.edges.forEach((e) => {
      e._key1 = `${e.source}->${e.target}`;
      e._key2 = `${e.target}->${e.source}`;
    });

    this.ordinaryOrder = new Map(this.nodes.map((node, index) => [node.id, index]));
    this.ordinaryIndex = this.buildSpatialIndex();
    this.maxNodeRadius = this.nodes.reduce((max, node) => Math.max(max, node.metrics.radius + 4), 120);
    this.edgeAdjacency = new Map();
    this.lightweightEdges = [];
    for (const edge of this.edges) {
      const source = this.nodeMap.get(edge.source);
      const target = this.nodeMap.get(edge.target);
      if (source && target && (source.cluster !== target.cluster || source.isSharedHub || target.isSharedHub || edge.isCircular || edge.isArchitectureViolation)) {
        this.lightweightEdges.push(edge);
      }
      for (const id of [edge.source, edge.target]) {
        const list = this.edgeAdjacency.get(id) || [];
        list.push(edge);
        this.edgeAdjacency.set(id, list);
      }
    }
  }

  private buildSpatialIndex(): Map<string, SealNode[]> {
    const index = new Map<string, SealNode[]>();
    for (const node of this.nodes) {
      const key = `${Math.floor(node.x / this.spatialCell)}:${Math.floor(node.y / this.spatialCell)}`;
      const cell = index.get(key) || [];
      cell.push(node);
      index.set(key, cell);
    }
    return index;
  }

  public getNodePos(node: SealNode): { x: number; y: number; r: number } {
    return {
      x: node.x,
      y: node.y,
      r: node.metrics.radius,
    };
  }

  public setSelectedNode(
    nodeId: string | null,
    lineageNodes: string[] = []
  ): void {
    this.selectedNodeId = nodeId;
    this.lineageNodeIds = new Set(lineageNodes);
  }

  public setHoveredNode(nodeId: string | null): void {
    this.hoveredNodeId = nodeId;
  }

  public hoverAffectsRender(): boolean {
    return this.usesFarNodeMarkers() || (!this.realisticMode && !this.selectedNodeId);
  }

  /** Query spatial cells while preserving the original paint order. */
  private visibleNodes(vp: ViewportBounds, marginFactor = 1): SealNode[] {
    const list = this.nodes;
    if (list.length <= 800) return list;
    const index = this.ordinaryIndex;
    const order = this.ordinaryOrder;
    const margin = this.maxNodeRadius * marginFactor + 30;
    const x1 = Math.floor((vp.x1 - margin) / this.spatialCell);
    const x2 = Math.floor((vp.x2 + margin) / this.spatialCell);
    const y1 = Math.floor((vp.y1 - margin) / this.spatialCell);
    const y2 = Math.floor((vp.y2 + margin) / this.spatialCell);
    if ((x2 - x1 + 1) * (y2 - y1 + 1) > index.size * 2) return list;
    const visible: SealNode[] = [];
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) {
      const cell = index.get(`${x}:${y}`);
      if (cell) visible.push(...cell);
    }
    if (visible.length > list.length * 0.7) return list;
    visible.sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0));
    return visible;
  }

  public setModes(options: {
    realisticMode?: boolean;
    lightweightMode?: boolean;
    activeFilter?: string;
    devToolsMode?: boolean;
    diagnosticFilter?: DiagnosticFilter;
  }): void {
    if (options.realisticMode !== undefined) this.realisticMode = options.realisticMode;
    if (options.lightweightMode !== undefined && options.lightweightMode !== this.lightweightMode) {
      this.lightweightMode = options.lightweightMode;
      this.farCacheKey = '';
      if (this.lightweightMode) this.pulseManager.clear();
    }
    if (options.activeFilter !== undefined) this.activeFilter = options.activeFilter;
    if (options.devToolsMode !== undefined) this.devToolsMode = options.devToolsMode;
    if (options.diagnosticFilter !== undefined) this.diagnosticFilter = options.diagnosticFilter;
  }

  public setVFXEngine(vfx: VFXEngine | null): void {
    this.vfxEngine = vfx;
  }

  public triggerDevToolsPulse(nodeId: string, event: DevToolsTelemetryEvent): void {
    this.telemetryVersion++;
    if (!this.lightweightMode) this.pulseManager.triggerPulse(nodeId, event);
  }

  public hitTestNode(worldX: number, worldY: number): SealNode | null {
    return this.hitTestNodeCandidates(worldX, worldY, 1)[0] || null;
  }

  public hitTestNodeCandidates(worldX: number, worldY: number, limit = 8): SealNode[] {
    const index = this.ordinaryIndex;
    const markerReach = this.usesFarNodeMarkers() ? 5 / this.camera.zoom : 0;
    const reach = Math.max(this.maxNodeRadius, markerReach);
    const minX = Math.floor((worldX - reach) / this.spatialCell);
    const maxX = Math.floor((worldX + reach) / this.spatialCell);
    const minY = Math.floor((worldY - reach) / this.spatialCell);
    const maxY = Math.floor((worldY + reach) / this.spatialCell);
    const matches: Array<{ node: SealNode; distance: number }> = [];
    const compare = (a: { node: SealNode; distance: number }, b: { node: SealNode; distance: number }) => a.distance - b.distance || Number(b.node.id === this.selectedNodeId) - Number(a.node.id === this.selectedNodeId);
    const consider = (node: SealNode) => {
        if (this.activeFilter !== 'all' && node.metrics?.element !== this.activeFilter) return;
        const pos = this.getNodePos(node);
        const dx = worldX - pos.x;
        const dy = worldY - pos.y;
        const radius = Math.max(pos.r + 4, markerReach);
        const distance = dx * dx + dy * dy;
        if (distance > radius * radius) return;
        const item = { node, distance };
        if (matches.length === limit && compare(item, matches[matches.length - 1]!) >= 0) return;
        let position = matches.length;
        while (position > 0 && compare(item, matches[position - 1]!) < 0) position--;
        matches.splice(position, 0, item);
        if (matches.length > limit) matches.pop();
    };
    const cellCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (cellCount > index.size * 2) {
      for (const node of this.nodes) consider(node);
    } else {
      for (let cx = minX; cx <= maxX; cx++) for (let cy = minY; cy <= maxY; cy++) {
        for (const node of index.get(`${cx}:${cy}`) || []) consider(node);
      }
    }
    return matches.map((item) => item.node);
  }

  public hitTestDependency(worldX: number, worldY: number): DependencySeal | null {
    return this.dependencies.find((seal) => {
      const dx = worldX - seal.x;
      const dy = worldY - seal.y;
      const radius = this.usesFarNodeMarkers() ? Math.max(seal.radius + 6, 8 / this.camera.zoom) : seal.radius + 6;
      return Math.abs(dx) <= radius && Math.abs(dy) <= radius && dx * dx + dy * dy <= radius * radius;
    }) || null;
  }

  /** WebGL fire can advance while the architecture canvas stays unchanged. */
  public canRenderEffectsOnly(): boolean {
    return !this.camera.animating && !this.lightweightMode && !this.realisticMode &&
      !this.usesFarNodeMarkers() && !this.selectedNodeId && !this.pulseManager.hasQueuedPulses();
  }

  public renderEffectsOnly(time = performance.now()): { hasActiveAnimation: boolean } {
    const active = this.renderVFX(this.camera.getViewportBounds(), this.usesFarNodeMarkers(), time / 1000);
    return { hasActiveAnimation: active };
  }

  public render(time = performance.now()): { hasActiveAnimation: boolean } {
    const ctx = this.ctx;
    const cam = this.camera;
    const dpr = cam.dpr;

    const nowSec = time / 1000;
    this.pulseOffset = this.lightweightMode ? 0 : (nowSec * 24) % 12;
    this.auraDashOffset = this.lightweightMode ? 0 : -((nowSec * 15) % 10);
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

    const vp = cam.getViewportBounds();
    const lod = cam.getLOD();
    const farNodeMarkers = this.usesFarNodeMarkers();
    // Every component stays on the map. At very small scales only its mark is
    // simplified; archipelagos never replace the individual nodes.
    if (farNodeMarkers) this.drawCachedFarMap(ctx, vp, lod);
    else {
      ctx.save();
      ctx.translate(cam.width / 2, cam.height / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);
      this.drawClustersBackdrop(ctx, vp, lod);
      this.drawEdges(ctx, vp, lod);
      this.drawNodes(ctx, vp, lod);
      this.drawDependencies(ctx, vp);
      ctx.restore();
    }

    // Screen-space pulses stay legible when the architecture is zoomed far out.
    if (!this.lightweightMode) this.pulseManager.drawPulses(
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

    const vfxActive = this.renderVFX(vp, farNodeMarkers, nowSec);

    // Determine if next frame should be scheduled
    const hasActiveAnimation =
      cam.animating ||
      (!this.lightweightMode && !farNodeMarkers && !this.realisticMode && !!this.selectedNodeId) ||
      (!this.lightweightMode && this.devToolsMode && !this.realisticMode && vfxActive) ||
      (!this.lightweightMode && this.pulseManager.hasActivePulses(time));

    return { hasActiveAnimation };
  }

  private renderVFX(vp: ViewportBounds, farNodeMarkers: boolean, nowSec: number): boolean {
    // Dispatch GPU WebGL VFX items independently of the static map.
    const vfxItems: VFXItem[] = [];
    const allowFlame =
      this.devToolsMode &&
      !this.realisticMode &&
      !this.lightweightMode &&
      (this.diagnosticFilter === 'all' || this.diagnosticFilter === 'hot');

    if (allowFlame && !farNodeMarkers) {
      const activeNodeId = this.selectedNodeId || this.hoveredNodeId;
      const list = this.visibleNodes(vp, 1.35);

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
    return vfxRes.hasActiveAnimation;
  }

  private usesFarNodeMarkers(): boolean {
    return this.nodes.length > 1500 && this.camera.zoom < 0.07;
  }

  private drawCachedFarMap(ctx: CanvasRenderingContext2D, vp: ViewportBounds, lod: 0 | 1 | 2): void {
    const cam = this.camera;
    if (!this.farCacheCanvas) this.farCacheCanvas = document.createElement('canvas');
    const cache = this.farCacheCanvas;
    const key = [cam.x, cam.y, cam.zoom, cam.width, cam.height, cam.dpr, this.realisticMode,
      this.devToolsMode, this.lightweightMode, this.activeFilter, this.diagnosticFilter, this.selectedNodeId, this.hoveredNodeId,
      this.selectedDependencyId, this.telemetryVersion].join('|');
    if (cache.width !== this.canvas.width || cache.height !== this.canvas.height || key !== this.farCacheKey) {
      cache.width = this.canvas.width;
      cache.height = this.canvas.height;
      const cached = cache.getContext('2d');
      if (!cached) return;
      cached.scale(cam.dpr, cam.dpr);
      cached.translate(cam.width / 2, cam.height / 2);
      cached.scale(cam.zoom, cam.zoom);
      cached.translate(-cam.x, -cam.y);
      this.drawClustersBackdrop(cached, vp, lod);
      this.drawEdges(cached, vp, lod);
      this.drawFarNodeMarkers(cached, vp);
      this.drawDependencies(cached, vp);
      this.farCacheKey = key;
    }
    ctx.drawImage(cache, 0, 0, cam.width, cam.height);
  }

  private drawFarNodeMarkers(ctx: CanvasRenderingContext2D, vp: ViewportBounds): void {
    const zoom = this.camera.zoom;
    const groups = new Map<string, Path2D>();
    const selected = new Path2D();
    const hot = new Path2D();
    const list = this.nodes;
    for (const node of list) {
      if (this.activeFilter !== 'all' && node.metrics?.element !== this.activeFilter) continue;
      const pos = this.getNodePos(node);
      if (pos.x < vp.x1 || pos.x > vp.x2 || pos.y < vp.y1 || pos.y > vp.y2) continue;
      const radius = Math.max(3, Math.min(5, pos.r * zoom)) / zoom;
      const isHot = node.telemetry?.isOverheating || ['overcharged', 'fissure'].includes(node.metrics?.devTools?.overloadState || '');
      const dim = this.devToolsMode && this.diagnosticFilter !== 'all' && (
        (this.diagnosticFilter === 'hot' && !isHot) ||
        (this.diagnosticFilter === 'cycles' && !node.isCircular) ||
        (this.diagnosticFilter === 'orphans' && !node.isOrphan) ||
        (this.diagnosticFilter === 'pact' && !node.architectureViolationIds?.length)
      );
      const key = `${this.realisticMode ? 'Ink' : node.metrics?.element || 'Arcane'}:${dim ? 'dim' : 'normal'}`;
      let path = groups.get(key);
      if (!path) { path = new Path2D(); groups.set(key, path); }
      appendSealShape(path, node.kind, pos.x, pos.y, radius);
      if (node.id === this.selectedNodeId || node.id === this.hoveredNodeId) {
        selected.moveTo(pos.x + radius + 2 / zoom, pos.y);
        selected.arc(pos.x, pos.y, radius + 2 / zoom, 0, Math.PI * 2);
      }
      if (this.devToolsMode && isHot && !dim) {
        hot.moveTo(pos.x + radius + 1.5 / zoom, pos.y);
        hot.arc(pos.x, pos.y, radius + 1.5 / zoom, 0, Math.PI * 2);
      }
    }
    ctx.save();
    for (const [key, path] of groups) {
      const [element, tone] = key.split(':');
      ctx.globalAlpha = tone === 'dim' ? 0.16 : 0.82;
      ctx.fillStyle = WHA_THEMES[element || 'Arcane']?.stroke || WHA_THEMES.Arcane!.stroke;
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.4 / zoom;
    ctx.strokeStyle = '#d43827';
    ctx.stroke(hot);
    ctx.lineWidth = 2 / zoom;
    ctx.strokeStyle = '#c48b26';
    ctx.stroke(selected);
    ctx.restore();
  }

  private drawDependencies(ctx: CanvasRenderingContext2D, vp: ViewportBounds): void {
    const active = this.selectedDependencyId;
    const far = this.usesFarNodeMarkers();
    for (const seal of this.dependencies) {
      if (seal.x + seal.radius < vp.x1 || seal.x - seal.radius > vp.x2 || seal.y + seal.radius < vp.y1 || seal.y - seal.radius > vp.y2) continue;
      const selected = active === seal.id;
      if (far) {
        ctx.beginPath();
        ctx.arc(seal.x, seal.y, (selected ? 5 : 2.6) / this.camera.zoom, 0, Math.PI * 2);
        ctx.fillStyle = seal.build?.emittedBytesEstimate && seal.build.emittedBytesEstimate > 100 * 1024 ? '#b54631' : '#806a9b';
        ctx.fill();
        continue;
      }
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

  /**
   * Draw ink connection lines with smart LOD filtering to prevent visual clutter
   */
  private drawEdges(ctx: CanvasRenderingContext2D, vp: ViewportBounds, _lod: 0 | 1 | 2): void {
    if (this.realisticMode) return;

    const activeNodeId = this.selectedNodeId || this.hoveredNodeId;
    const pulseOffset = this.pulseOffset;
    const isZoomedFarOut = this.camera.zoom < 0.32;
    const farNodeMarkers = this.usesFarNodeMarkers();

    const edges = farNodeMarkers ? activeNodeId ? this.edgeAdjacency.get(activeNodeId) || [] : []
      : this.lightweightMode ? activeNodeId ? this.edgeAdjacency.get(activeNodeId) || [] : this.lightweightEdges
      : this.edges;
    for (const edge of edges) {
      const s = this.nodeMap.get(edge.source);
      const t = this.nodeMap.get(edge.target);
      if (!s || !t) continue;

      // Smart LOD: When zoomed far out and no node is actively inspected,
      // filter out noisy internal button/icon micro-links, keeping major structural arteries clear!
      if (isZoomedFarOut && !activeNodeId) {
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

      const isConnectedToActive =
        !!activeNodeId &&
        (edge.source === activeNodeId || edge.target === activeNodeId);

      const isDimmed =
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

      if (this.lightweightMode) {
        const active = edge.source === activeNodeId || edge.target === activeNodeId;
        ctx.strokeStyle = edge.isArchitectureViolation ? '#b83a14' : edge.isCircular ? '#a82adb' : active ? '#a46d20' : 'rgba(83, 65, 42, 0.20)';
        ctx.lineWidth = active ? 1.7 : edge.isCircular || edge.isArchitectureViolation ? 1.25 : 0.75;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (this.devToolsMode && edge.isArchitectureViolation) {
        ctx.strokeStyle = '#b83a14';
        ctx.lineWidth = isPactFilter ? 3.2 : 2.2;
        ctx.setLineDash([3, 4]);
        ctx.globalAlpha = 1;
      } else if (isConnectedToActive) {
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
    if (activeNodeId) {
      for (const e of this.edgeAdjacency.get(activeNodeId) || []) {
        if (e.source === activeNodeId) connectedNodeIds.add(e.target);
        if (e.target === activeNodeId) connectedNodeIds.add(e.source);
      }
    }

    const renderList = this.visibleNodes(vp);

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
      const isConnected = !isArt && !!activeNodeId && connectedNodeIds.has(node.id);

      const shouldShowAura =
        !isArt &&
        !isSelected &&
        !isHovered &&
        isConnected;

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
        (!isArt && !!activeNodeId && !isSelected && !isConnected && !isHovered);

      ctx.save();
      // Keep unselected elements visible at exactly 20% opacity (or 12% in focused diagnostic mode)
      if (isDimmed) {
        ctx.globalAlpha = isDimmedByDiag ? (this.lightweightMode ? 0.28 : 0.10) : (this.lightweightMode ? 0.55 : 0.20);
      } else {
        ctx.globalAlpha = 1.0;
      }

      // 1. Lineage / Connection aura
      if (shouldShowAura && !this.lightweightMode) {
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

      if (this.lightweightMode) this.glyphRenderer.renderCompactNode(ctx, node, lod, isSelected || isHovered || shouldShowAura, isArt);
      else this.glyphRenderer.renderNode(ctx, node, lod, isSelected, isHovered, isArt, shouldShowAura);
      ctx.restore();
    }
  }
}
