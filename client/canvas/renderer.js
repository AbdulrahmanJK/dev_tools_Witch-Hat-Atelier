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

    this.realisticMode = false;
    this.unifiedMode = false;
    this.lineageNodeIds = new Set();
    this.lineageEdgeKeys = new Set();
    this.mandalaSectors = [];
    this.rootRadius = 1140;
  }

  setRealisticMode(enabled) {
    this.realisticMode = !!enabled;
  }

  setUnifiedMode(enabled) {
    this.unifiedMode = !!enabled;
  }

  setData(data) {
    this.nodes = data.nodes || [];
    this.edges = data.edges || [];
    this.clusters = data.clusters || [];
    this.nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
    this.mandalaSectors = data.unifiedLayout?.mandalaSectors || [];
    this.rootRadius = data.unifiedLayout?.rootRadius || 1140;
  }

  getNodePos(node) {
    if (this.unifiedMode && node.unifiedX !== undefined) {
      return {
        x: node.unifiedX,
        y: node.unifiedY,
        r: node.unifiedR || node.metrics.radius,
      };
    }
    return {
      x: node.x,
      y: node.y,
      r: node.realisticLayout ? node.realisticLayout.realisticRadius : node.metrics.radius,
    };
  }

  setHighlightedLineage(ancestry = [], descendantTree = null) {
    this.lineageNodeIds = new Set();
    this.lineageEdgeKeys = new Set();

    if (!ancestry || ancestry.length === 0) return;

    for (let i = 0; i < ancestry.length; i++) {
      this.lineageNodeIds.add(ancestry[i].id);
      if (i > 0) {
        this.lineageEdgeKeys.add(`${ancestry[i - 1].id}->${ancestry[i].id}`);
        this.lineageEdgeKeys.add(`${ancestry[i].id}->${ancestry[i - 1].id}`);
      }
    }

    const walkDescendants = (tree) => {
      if (!tree || !tree.node) return;
      this.lineageNodeIds.add(tree.node.id);
      if (tree.children) {
        tree.children.forEach((childTree) => {
          this.lineageNodeIds.add(childTree.node.id);
          this.lineageEdgeKeys.add(`${tree.node.id}->${childTree.node.id}`);
          this.lineageEdgeKeys.add(`${childTree.node.id}->${tree.node.id}`);
          walkDescendants(childTree);
        });
      }
    };

    if (descendantTree) {
      walkDescendants(descendantTree);
    }
  }

  clearHighlightedLineage() {
    this.lineageNodeIds = new Set();
    this.lineageEdgeKeys = new Set();
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

    // Warm Vintage Parchment or Draftsman Paper background
    ctx.fillStyle = this.realisticMode ? '#f5f2e6' : '#f4f1e3';
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

    // 2. In Unified Grand Seal mode: Draw Master Enclosing Ring & Domain Mandala
    if (this.unifiedMode) {
      this.drawGrandMasterCircle(ctx, this.rootRadius, lod);
      if (lod <= 1) {
        this.drawMandalaSectors(ctx, this.mandalaSectors, this.rootRadius);
      }
    } else if (this.layers.clusters) {
      // Classic Archipelago Territories
      this.drawClusters(ctx, vp, lod);
    }

    // 3. Magical Connection Lines (Edges)
    if (this.layers.edges) {
      this.drawEdges(ctx, vp, lod);
    }

    // 4. Component Glyphs & Seals
    this.drawNodes(ctx, vp, lod);

    ctx.restore();

    // 5. In Art Blueprint Mode: Draw ornamental draftsman corner vignette
    if (this.realisticMode) {
      this.drawArtFrameVignette(ctx, w, h);
    }
  }

  drawGrandMasterCircle(ctx, r, lod) {
    const isArt = this.realisticMode;
    const ink = '#141311';

    // 1. Triple colossal master ring of App enclosing the entire application
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = isArt ? ink : '#3a342a';
    ctx.lineWidth = 4.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r - 8, 0, Math.PI * 2);
    ctx.strokeStyle = isArt ? 'rgba(20, 19, 17, 0.65)' : 'rgba(196, 139, 38, 0.65)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 64 Master clockwork teeth along the master circle
    for (let i = 0; i < 64; i++) {
      const a = (i * Math.PI * 2) / 64;
      const isCard = i % 16 === 0;
      const len = isCard ? 20 : i % 4 === 0 ? 12 : 6;
      ctx.beginPath();
      ctx.moveTo((r - 2) * Math.cos(a), (r - 2) * Math.sin(a));
      ctx.lineTo((r - len) * Math.cos(a), (r - len) * Math.sin(a));
      ctx.strokeStyle = isArt ? ink : '#3a342a';
      ctx.lineWidth = isCard ? 3.0 : 1.2;
      ctx.stroke();
    }

    // 4 Diagonal dividing rays separating the Sacred Domain Sectors (North, East, South, West)
    const diagAngles = [-Math.PI * 0.75, -Math.PI * 0.25, Math.PI * 0.25, Math.PI * 0.75];
    diagAngles.forEach((a) => {
      ctx.beginPath();
      ctx.moveTo(120 * Math.cos(a), 120 * Math.sin(a));
      ctx.lineTo((r - 12) * Math.cos(a), (r - 12) * Math.sin(a));
      ctx.strokeStyle = isArt ? 'rgba(20, 19, 17, 0.22)' : 'rgba(196, 139, 38, 0.25)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  drawMandalaSectors(ctx, sectors, rootR) {
    if (!sectors || sectors.length === 0) return;
    const isArt = this.realisticMode;

    ctx.save();
    sectors.forEach((sec) => {
      const x = Math.cos(sec.angle) * sec.radius;
      const y = Math.sin(sec.angle) * sec.radius;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `italic 700 20px 'Palatino Linotype', 'Book Antiqua', Georgia, serif`;
      ctx.fillStyle = isArt ? 'rgba(20, 19, 17, 0.65)' : 'rgba(184, 58, 20, 0.75)';
      ctx.fillText(`✦ ${sec.name} ✦`, x, y);
    });
    ctx.restore();
  }

  drawBackgroundCartography(ctx, vp, zoom) {
    const isArt = this.realisticMode;
    ctx.strokeStyle = isArt ? 'rgba(20, 19, 17, 0.08)' : 'rgba(26, 25, 22, 0.05)';
    ctx.lineWidth = isArt ? 1.0 : 1.2;

    const baseRadii = [400, 900, 1600, 2600, 4000, 6000, 8500];
    baseRadii.forEach((rad) => {
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Cardinal rays from origin
    ctx.beginPath();
    ctx.moveTo(-10000, 0); ctx.lineTo(10000, 0);
    ctx.moveTo(0, -10000); ctx.lineTo(0, 10000);
    ctx.stroke();

    // In Art Mode: Draw Master 16-Point Compass Rose at (0, 0)
    if (isArt) {
      this.drawMasterCompassRose(ctx, 0, 0, 320);
    }
  }

  drawMasterCompassRose(ctx, cx, cy, sz) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#141311';
    ctx.fillStyle = '#141311';

    // 16 Points of the Compass Rose
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI * 2) / 16;
      const isCard = i % 4 === 0;
      const isSemi = i % 2 === 0;
      const r = isCard ? sz : isSemi ? sz * 0.65 : sz * 0.45;
      const w = sz * 0.12;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a - 0.12) * w, Math.sin(a - 0.12) * w);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.closePath();
      if (i % 2 === 0) {
        ctx.fillStyle = '#141311';
        ctx.fill();
      } else {
        ctx.strokeStyle = '#141311';
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }
    }

    // Outer decorative compass ring
    ctx.beginPath();
    ctx.arc(0, 0, sz * 0.75, 0, Math.PI * 2);
    ctx.strokeStyle = '#141311';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  drawClusters(ctx, vp, lod) {
    const isArt = this.realisticMode;

    for (const c of this.clusters) {
      const cr = c.radius;
      if (c.x + cr < vp.minX || c.x - cr > vp.maxX || c.y + cr < vp.minY || c.y - cr > vp.maxY) {
        continue;
      }

      ctx.beginPath();
      ctx.arc(c.x, c.y, cr, 0, Math.PI * 2);
      ctx.fillStyle = isArt ? 'rgba(240, 237, 222, 0.45)' : 'rgba(234, 230, 208, 0.35)';
      ctx.fill();

      ctx.strokeStyle = isArt ? 'rgba(20, 19, 17, 0.25)' : 'rgba(26, 25, 22, 0.13)';
      ctx.lineWidth = isArt ? 1.8 : 1.5;
      ctx.setLineDash(isArt ? [4, 6] : [8, 8]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Territorial Archipelago Name Banner
      const titleFont = Math.max(14, Math.min(32, cr * 0.08));
      ctx.font = `italic 700 ${titleFont}px 'Palatino Linotype', Palatino, serif`;
      ctx.fillStyle = isArt ? 'rgba(20, 19, 17, 0.65)' : 'rgba(26, 25, 22, 0.45)';
      ctx.textAlign = 'center';
      ctx.fillText(c.name.toUpperCase(), c.x, c.y - cr - 16);
    }
  }

  drawEdges(ctx, vp, lod) {
    // In Realistic Mode: Hide ALL connection lines so circles stand out purely as manga art!
    if (this.realisticMode) return;

    const isArt = this.realisticMode;
    this.pulseOffset = (this.pulseOffset + 0.35) % 20;

    const activeNodeId = isArt ? null : (this.hoveredNodeId || this.selectedNodeId);
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

      const sPos = this.getNodePos(s);
      const tPos = this.getNodePos(t);

      const minEx = Math.min(sPos.x, tPos.x);
      const maxEx = Math.max(sPos.x, tPos.x);
      const minEy = Math.min(sPos.y, tPos.y);
      const maxEy = Math.max(sPos.y, tPos.y);

      if (maxEx < vp.minX || minEx > vp.maxX || maxEy < vp.minY || minEy > vp.maxY) {
        continue;
      }

      const edgeKey1 = `${edge.source}->${edge.target}`;
      const edgeKey2 = `${edge.target}->${edge.source}`;
      const isLineageEdge = this.lineageEdgeKeys && (this.lineageEdgeKeys.has(edgeKey1) || this.lineageEdgeKeys.has(edgeKey2));

      // Fast straight-line path for distant zoom
      if (lod === 0 && !isLineageEdge) {
        ctx.beginPath();
        ctx.moveTo(sPos.x, sPos.y);
        ctx.lineTo(tPos.x, tPos.y);
        ctx.strokeStyle = isArt ? 'rgba(20, 19, 17, 0.14)' : 'rgba(26, 25, 22, 0.08)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        continue;
      }

      const dx = tPos.x - sPos.x;
      const dy = tPos.y - sPos.y;
      const dist = Math.hypot(dx, dy);
      const normalX = -dy / dist;
      const normalY = dx / dist;
      const curvature = Math.min(60, dist * 0.12);
      const midX = (sPos.x + tPos.x) / 2 + normalX * curvature;
      const midY = (sPos.y + tPos.y) / 2 + normalY * curvature;

      ctx.beginPath();
      ctx.moveTo(sPos.x, sPos.y);
      ctx.quadraticCurveTo(midX, midY, tPos.x, tPos.y);

      if (isLineageEdge && !isArt) {
        // High-prominence illuminated golden thread showing full parent-to-child lineage
        ctx.strokeStyle = '#c48b26';
        ctx.lineWidth = 3.6;
        ctx.setLineDash([8, 4]);
        ctx.lineDashOffset = -this.pulseOffset;
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }

      if (isArt) {
        // Art Mode: pure drafting black ink lines with direction arrowhead
        ctx.strokeStyle = 'rgba(20, 19, 17, 0.30)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Draw small arrowhead along tangent
        if (lod >= 1) {
          const tAng = Math.atan2(tPos.y - midY, tPos.x - midX);
          const tr = tPos.r + 4;
          const ax = tPos.x - Math.cos(tAng) * tr;
          const ay = tPos.y - Math.sin(tAng) * tr;

          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - Math.cos(tAng - 0.35) * 8, ay - Math.sin(tAng - 0.35) * 8);
          ctx.lineTo(ax - Math.cos(tAng + 0.35) * 8, ay - Math.sin(tAng + 0.35) * 8);
          ctx.closePath();
          ctx.fillStyle = '#141311';
          ctx.fill();
        }
      } else {
        const isConnectedToActive = activeNodeId && (edge.source === activeNodeId || edge.target === activeNodeId);
        const isDormant = activeNodeId && !isConnectedToActive;

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
  }

  drawNodes(ctx, vp, lod) {
    const isArt = this.realisticMode;
    const activeNodeId = isArt ? null : (this.hoveredNodeId || this.selectedNodeId);
    const connectedNodeIds = new Set();
    if (activeNodeId) {
      connectedNodeIds.add(activeNodeId);
      this.edges.forEach((e) => {
        if (e.source === activeNodeId) connectedNodeIds.add(e.target);
        if (e.target === activeNodeId) connectedNodeIds.add(e.source);
      });
    }

    let renderList = [...this.nodes];
    if (this.unifiedMode) {
      // In Unified mode: Sort by radius descending so parents are drawn first, then children inside!
      renderList.sort((a, b) => (b.unifiedR || 0) - (a.unifiedR || 0));
    }

    for (const node of renderList) {
      const pos = this.getNodePos(node);
      const r = pos.r;

      if (pos.x + r + 40 < vp.minX || pos.x - r - 40 > vp.maxX || pos.y + r + 40 < vp.minY || pos.y - r - 40 > vp.maxY) {
        continue;
      }

      const isSelected = !isArt && node.id === this.selectedNodeId;
      const isHovered = !isArt && node.id === this.hoveredNodeId;
      const isLineageNode = !isArt && this.lineageNodeIds && this.lineageNodeIds.has(node.id);
      const isDimmed = activeNodeId && !connectedNodeIds.has(node.id) && !isLineageNode;

      // Draw subtle golden lineage aura on parent/child nodes in the transition chain
      if (isLineageNode && !isSelected && !isHovered) {
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.beginPath();
        ctx.arc(0, 0, r + 10, 0, Math.PI * 2);
        ctx.strokeStyle = '#c48b26';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      if (isDimmed) {
        ctx.globalAlpha = 0.22;
      }

      // Create proxy with active positioning
      const drawNodeProxy = {
        ...node,
        x: pos.x,
        y: pos.y,
        metrics: { ...node.metrics, radius: r },
        realisticLayout: node.realisticLayout ? { ...node.realisticLayout, realisticRadius: r } : null,
      };

      // Pass isArt to renderNode: when true, renders purely as black & white draftsman art!
      this.glyphRenderer.renderNode(ctx, drawNodeProxy, lod, isSelected, isHovered, isArt);
      ctx.restore();
    }
  }

  drawArtFrameVignette(ctx, w, h) {
    ctx.save();
    // Architectural Drafting Title in Bottom Right
    ctx.textAlign = 'right';
    ctx.font = `italic 700 13px 'Palatino Linotype', 'Book Antiqua', Palatino, serif`;
    ctx.fillStyle = '#141311';
    ctx.fillText('ARCHITECTURAL GRIMOIRE — MANUSCRIPT SURVEY', w - 24, h - 20);
    ctx.font = `600 10px 'Palatino Linotype', Palatino, serif`;
    ctx.fillStyle = 'rgba(20, 19, 17, 0.65)';
    ctx.fillText('CANONICAL MONOCHROME BLUEPRINT EDITION', w - 24, h - 8);

    // Decorative corner brackets
    ctx.strokeStyle = '#141311';
    ctx.lineWidth = 2.0;
    const m = 16, len = 30;

    // Top-left
    ctx.beginPath();
    ctx.moveTo(m, m + len); ctx.lineTo(m, m); ctx.lineTo(m + len, m);
    ctx.stroke();

    // Top-right
    ctx.beginPath();
    ctx.moveTo(w - m - len, m); ctx.lineTo(w - m, m); ctx.lineTo(w - m, m + len);
    ctx.stroke();

    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(m, h - m - len); ctx.lineTo(m, h - m); ctx.lineTo(m + len, h - m);
    ctx.stroke();

    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(w - m - len, h - m); ctx.lineTo(w - m, h - m); ctx.lineTo(w - m, h - m - len);
    ctx.stroke();
    ctx.restore();
  }

  findNodeAt(screenX, screenY) {
    // In Art Blueprint Mode: Interactivity is intentionally disabled!
    if (this.realisticMode) {
      return null;
    }

    const worldPos = this.camera.screenToWorld(screenX, screenY);
    let hitList = [...this.nodes];
    if (this.unifiedMode) {
      // In unified mode, hit-test smallest/innermost children first!
      hitList.sort((a, b) => (a.unifiedR || a.metrics.radius) - (b.unifiedR || b.metrics.radius));
    } else {
      hitList.reverse();
    }

    for (const node of hitList) {
      const pos = this.getNodePos(node);
      const dist = Math.hypot(worldPos.x - pos.x, worldPos.y - pos.y);
      if (dist <= pos.r + 8) {
        let hitSubSeal = null;
        if (node.realisticLayout?.subSeals) {
          for (const sub of node.realisticLayout.subSeals) {
            const subDist = Math.hypot(worldPos.x - (pos.x + sub.dx), worldPos.y - (pos.y + sub.dy));
            if (subDist <= sub.radius) {
              hitSubSeal = sub;
              break;
            }
          }
        }
        return { node, hitSubSeal };
      }
    }
    return null;
  }
}
