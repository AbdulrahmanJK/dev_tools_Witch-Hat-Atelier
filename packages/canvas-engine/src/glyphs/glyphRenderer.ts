import type { RadialSign, SealElement, SealNode, SubSeal } from '@wha/core';
import { CANONICAL_GLYPHS } from './whaPaths.js';
import { appendSealShape } from './sealShape.js';
import { artSeed, drawHandDrawnGlyph, drawHandDrawnRing } from './handDrawn.js';

export interface ThemeColors {
  stroke: string;
  glow: string;
  bg: string;
  label: string;
}

export const WHA_THEMES: Record<string, ThemeColors> = {
  Fire: { stroke: '#b83a14', glow: 'rgba(184, 58, 20, 0.45)', bg: '#fbf4eb', label: '#8a2207' },
  Water: { stroke: '#106ba3', glow: 'rgba(16, 107, 163, 0.4)', bg: '#f0f6fa', label: '#0a466b' },
  Earth: { stroke: '#785420', glow: 'rgba(120, 84, 32, 0.4)', bg: '#fcf8f2', label: '#4f3410' },
  Wind: { stroke: '#1c7343', glow: 'rgba(28, 115, 67, 0.4)', bg: '#f2fbf5', label: '#0f4727' },
  Light: { stroke: '#a88915', glow: 'rgba(168, 137, 21, 0.4)', bg: '#fffdf2', label: '#6e5f0b' },
  Arcane: { stroke: '#681da8', glow: 'rgba(104, 29, 168, 0.4)', bg: '#faf5ff', label: '#430f70' },
  Ink: { stroke: '#141311', glow: 'rgba(20, 19, 17, 0.20)', bg: '#f6f3e5', label: '#141311' },
  Mono: { stroke: '#141311', glow: 'rgba(20, 19, 17, 0.15)', bg: '#faf8f0', label: '#141311' },
};

// Cache of parsed Path2D objects for peak 120 FPS performance
const PATH_CACHE = new Map<string, { path: Path2D; w: number; h: number }>();

export function getCanonicalPath(name: string): { path: Path2D; w: number; h: number } | null {
  if (PATH_CACHE.has(name)) return PATH_CACHE.get(name)!;
  const data = CANONICAL_GLYPHS[name];
  if (!data) return null;
  const path = new Path2D(data.d);
  const item = { path, w: data.w, h: data.h };
  PATH_CACHE.set(name, item);
  return item;
}

export function drawCanonicalGlyph(
  ctx: CanvasRenderingContext2D,
  name: string,
  size: number
): boolean {
  const item = getCanonicalPath(name);
  if (!item) return false;
  ctx.save();
  const maxDim = Math.max(item.w, item.h);
  const s = size / maxDim;
  ctx.scale(s, s);
  // Canvas scales strokes together with the path. Keep the caller's line width
  // in seal/screen coordinates so small canonical paths do not become blobs.
  ctx.lineWidth /= s;
  ctx.translate(-item.w / 2, -item.h / 2);
  ctx.stroke(item.path);
  ctx.restore();
  return true;
}

export interface PerimeterSignLayout {
  dense: boolean;
  outer: RadialSign[];
  inner: RadialSign[];
  omitted: number;
  glyphSize: number;
}

const PERIMETER_CACHE = new WeakMap<RadialSign[], { radius: number; count: number; layout: PerimeterSignLayout }>();

/** Fit semantic signs to the available circumference, keeping crowded seals readable. */
export function getPerimeterSignLayout(signs: RadialSign[], radius: number): PerimeterSignLayout {
  const cached = PERIMETER_CACHE.get(signs);
  if (cached?.radius === radius && cached.count === signs.length) return cached.layout;

  const glyphSize = Math.max(7, Math.min(11, radius * 0.12));
  const spacing = glyphSize + 3.5;
  const outerCapacity = Math.max(1, Math.floor(2 * Math.PI * radius * 0.82 / spacing));
  const dense = radius >= 70 && signs.length > outerCapacity;
  const innerCapacity = dense ? Math.max(1, Math.floor(2 * Math.PI * radius * 0.66 / spacing)) : 0;
  const visibleCount = Math.min(signs.length, outerCapacity + innerCapacity);
  const selected = Array.from({ length: visibleCount }, (_, index) =>
    signs[Math.floor((index + 0.5) * signs.length / visibleCount)]!
  );
  const outer: RadialSign[] = [];
  const inner: RadialSign[] = [];
  const outerTarget = dense ? Math.min(outerCapacity, Math.ceil(visibleCount * outerCapacity / (outerCapacity + innerCapacity))) : visibleCount;
  for (let index = 0; index < selected.length; index++) {
    if (outer.length < outerTarget && (index % 2 === 0 || inner.length >= visibleCount - outerTarget)) outer.push(selected[index]!);
    else inner.push(selected[index]!);
  }
  const layout = { dense, outer, inner, omitted: signs.length - visibleCount, glyphSize };
  PERIMETER_CACHE.set(signs, { radius, count: signs.length, layout });
  return layout;
}

export class GlyphRenderer {
  public inkColor = '#141311';
  public guideColor = 'rgba(20, 19, 17, 0.14)';
  public auraDashOffset = 0;

  public setAuraDashOffset(offset: number): void {
    this.auraDashOffset = offset;
  }

  /** A readable seal for the low-cost map: no radial signs, sub-seals or animated detail. */
  public renderCompactNode(ctx: CanvasRenderingContext2D, node: SealNode, lod: 0 | 1 | 2, isHighlighted: boolean, artMode: boolean): void {
    const r = node.metrics?.radius || 40;
    const element = node.metrics?.element || 'Arcane';
    const theme = artMode ? WHA_THEMES.Mono! : (WHA_THEMES[element] || WHA_THEMES.Arcane!);
    ctx.save();
    ctx.translate(node.x, node.y);
    ctx.beginPath();
    appendSealShape(ctx, node.kind, 0, 0, r);
    ctx.fillStyle = theme.bg;
    ctx.fill();
    ctx.strokeStyle = isHighlighted ? '#c48b26' : theme.stroke;
    ctx.lineWidth = isHighlighted ? 3 : 1.8;
    ctx.stroke();
    if (lod >= 1 || isHighlighted) {
      this.drawSigil(ctx, 0, 0, Math.min(r * 0.72, 28), element, theme);
      this.drawLabels(ctx, r, node, lod, isHighlighted);
    }
    ctx.restore();
  }

  // ═══════════ MAIN NODE RENDERER ═══════════
  public renderNode(
    ctx: CanvasRenderingContext2D,
    node: SealNode,
    lod: 0 | 1 | 2,
    isSelected: boolean,
    isHovered: boolean,
    artMode = false,
    isLineageNode = false
  ): void {
    if (artMode) {
      this.renderArtBlueprintSeal(ctx, node, lod);
      return;
    }

    if (node.realisticLayout && (node.realisticLayout.subSeals?.length || 0) > 0) {
      this.renderRealisticCompoundSeal(ctx, node, lod, isSelected, isHovered, isLineageNode);
      return;
    }

    // Fallback simple seal
    const x = node.x;
    const y = node.y;
    const r = node.metrics?.radius || 40;
    const element = node.metrics?.element || 'Arcane';
    const theme = WHA_THEMES[element] || WHA_THEMES.Arcane!;

    ctx.save();
    ctx.translate(x, y);

    if (lod === 0) {
      ctx.beginPath();
      appendSealShape(ctx, node.kind, 0, 0, r);
      ctx.fillStyle = theme.stroke;
      ctx.globalAlpha = isHovered || isSelected ? 0.8 : 0.45;
      ctx.fill();
      ctx.restore();
      return;
    }

    if (isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 14, 0, Math.PI * 2);
      ctx.fillStyle = theme.glow;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = theme.bg || '#f7f4e8';
    ctx.fill();

    this.drawOuterRing(ctx, r, node, theme, lod);
    this.drawKindMark(ctx, r, node, theme);
    this.drawSigil(ctx, 0, 0, r * 0.42, element, theme);

    if (lod >= 2 && node.metrics.keystones && node.metrics.keystones.length > 0) {
      this.drawKeystones(ctx, r, node.metrics.keystones, theme);
    }

    this.drawLabels(ctx, r, node, lod, isSelected || isHovered);
    ctx.restore();
  }

  // ═══════════ MONOCHROME ART BLUEPRINT MODE ═══════════
  public renderArtBlueprintSeal(
    ctx: CanvasRenderingContext2D,
    node: SealNode,
    lod: 0 | 1 | 2
  ): void {
    const layout = node.realisticLayout || { realisticRadius: 45, subSeals: [], conduits: [] };
    const r = node.metrics?.radius || layout.realisticRadius || 45;
    const signs = node.metrics?.radialSigns || [];
    const signLayout = getPerimeterSignLayout(signs, r);
    const chamberR = Math.round(r * (signLayout.dense ? 0.56 : 0.64));
    const ink = '#141311';
    const seed = artSeed(node.id);

    ctx.save();
    ctx.translate(node.x, node.y);

    if (lod === 0 && r < 40) {
      ctx.beginPath();
      appendSealShape(ctx, node.kind, 0, 0, r);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
      ctx.restore();
      return;
    }

    // Solid paper background
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#faf8f0';
    ctx.fill();

    const isClass = node.metrics?.geometry === 'faceted-strengthen' || node.metrics?.isClass;
    if (isClass) {
      this.drawFacetedStrengthenRing(ctx, r, WHA_THEMES.Mono!, lod);
    } else {
      const ringWidth = r > 250 ? 3.4 : r > 80 ? 2.4 : 1.8;
      ctx.strokeStyle = ink;
      if (lod >= 1) drawHandDrawnRing(ctx, r, seed, ringWidth);
      else { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.lineWidth = ringWidth; ctx.stroke(); }
      ctx.strokeStyle = 'rgba(20, 19, 17, 0.45)';
      if (lod >= 2) drawHandDrawnRing(ctx, r * 0.9, seed + 1, 1);
      else { ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.lineWidth = 1; ctx.stroke(); }
    }
    this.drawKindMark(ctx, r, node, WHA_THEMES.Mono!);

    // Inner chamber dividing ring
    if (layout.subSeals && layout.subSeals.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(20, 19, 17, 0.45)';
      ctx.setLineDash([4, 4]);
      if (lod >= 2) drawHandDrawnRing(ctx, chamberR, seed + 2, 1.2);
      else { ctx.beginPath(); ctx.arc(0, 0, chamberR, 0, Math.PI * 2); ctx.lineWidth = 1.2; ctx.stroke(); }
      ctx.restore();
    }

    // Radial Keystone Crown
    if (lod >= 1 && signs.length > 0) this.drawAdaptivePerimeterSigns(ctx, r, signLayout, ink, seed);

    // Center canonical sigil or sub-seals
    if (layout.subSeals && layout.subSeals.length > 1 && lod >= 2) {
      layout.subSeals.forEach((sub: SubSeal, index: number) => {
        this.drawArtSubSeal(ctx, sub, r, lod, seed + index * 13);
      });
    } else {
      const sigilSize = Math.max(12, chamberR * 0.5);
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineWidth = r > 100 ? 2.4 : 1.8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const el = node.metrics?.element;
      if (el === 'Wind') {
        this.drawArtGlyph(ctx, 'wind-underfoot', sigilSize, seed);
      } else if (el === 'Fire') {
        this.drawArtGlyph(ctx, 'fire', sigilSize, seed);
      } else if (el === 'Water') {
        this.drawArtGlyph(ctx, 'water', sigilSize, seed);
      } else if (el === 'Earth') {
        this.drawArtGlyph(ctx, 'earth', sigilSize, seed);
      } else if (el === 'Light') {
        this.drawArtGlyph(ctx, 'light', sigilSize, seed);
      } else {
        this.drawArtGlyph(ctx, 'arcane', sigilSize, seed);
      }
    }

    this.drawArtLabels(ctx, r, node, lod);
    ctx.restore();
  }

  // ═══════════ REALISTIC COMPOUND SEAL (INTERACTIVE MODE) ═══════════
  public renderRealisticCompoundSeal(
    ctx: CanvasRenderingContext2D,
    node: SealNode,
    lod: 0 | 1 | 2,
    isSelected: boolean,
    isHovered: boolean,
    isLineageNode: boolean
  ): void {
    const layout = node.realisticLayout!;
    const r = node.metrics?.radius || layout.realisticRadius;
    const element = node.metrics?.element || 'Arcane';
    const theme = WHA_THEMES[element] || WHA_THEMES.Arcane!;

    ctx.save();
    ctx.translate(node.x, node.y);

    if (lod === 0 && r < 40) {
      ctx.beginPath();
      appendSealShape(ctx, node.kind, 0, 0, r);
      ctx.fillStyle = theme.stroke;
      ctx.globalAlpha = isHovered || isSelected ? 0.9 : 0.55;
      ctx.fill();
      ctx.restore();
      return;
    }

    // Interactive glow aura
    if (isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 14, 0, Math.PI * 2);
      ctx.fillStyle = theme.glow;
      ctx.fill();
    }

    // Solid paper parchment background
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = theme.bg || '#fbf8ef';
    ctx.fill();

    const isClass = node.metrics?.geometry === 'faceted-strengthen' || node.metrics?.isClass;
    if (isClass) {
      this.drawFacetedStrengthenRing(ctx, r, theme, lod);
    } else {
      this.drawOuterRing(ctx, r, node, theme, lod);
    }
    this.drawKindMark(ctx, r, node, theme);

    // Inner chamber dividing circle
    const signs = node.metrics?.radialSigns || [];
    const signLayout = getPerimeterSignLayout(signs, r);
    const chamberR = Math.round(r * (signLayout.dense ? 0.56 : 0.64));
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, chamberR, 0, Math.PI * 2);
    ctx.strokeStyle = theme.stroke;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();

    // Outer annular band: dynamic perimeter signs
    if (lod >= 1 && signs.length > 0) this.drawAdaptivePerimeterSigns(ctx, r, signLayout, theme.stroke);

    // Draw sub-seals (internal conduits removed as requested)
    this.drawRealisticSubSeals(ctx, r, layout.subSeals, layout.conduits, theme, lod);

    // Golden running dashed aura for selected node
    if (isSelected || isLineageNode) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = theme.stroke;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = isSelected ? this.auraDashOffset || 0 : 0;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    this.drawLabels(ctx, r, node, lod, isSelected || isHovered);
    ctx.restore();
  }

  public drawRealisticSubSeals(
    ctx: CanvasRenderingContext2D,
    baseR: number,
    subSeals: SubSeal[],
    _conduits: Array<{ from: string; to: string }>,
    theme: ThemeColors,
    lod: 0 | 1 | 2
  ): void {
    if (!subSeals || subSeals.length === 0) return;

    // Draw sub-seals (internal conduit dashed lines omitted for clean aesthetics)
    subSeals.forEach((sub) => {
      const sx = sub.dx || 0;
      const sy = sub.dy || 0;
      const sr = sub.radius || Math.max(6, Math.round(baseR * sub.radiusRatio));
      const subTheme = sub.element ? WHA_THEMES[sub.element] || theme : theme;

      ctx.save();
      ctx.translate(sx, sy);

      // Circle container
      ctx.beginPath();
      ctx.arc(0, 0, sr, 0, Math.PI * 2);
      ctx.fillStyle = subTheme.bg || '#ffffff';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, sr, 0, Math.PI * 2);
      ctx.strokeStyle = subTheme.stroke;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Glyphs inside sub-seal
      if (sub.type === 'core') {
        const coreSize = Math.max(10, sr * 1.2);
        ctx.strokeStyle = subTheme.stroke;
        ctx.lineWidth = 1.8;
        const el = sub.name;
        if (el === 'Wind') drawCanonicalGlyph(ctx, 'wind-underfoot', coreSize);
        else if (el === 'Fire') drawCanonicalGlyph(ctx, 'fire', coreSize);
        else if (el === 'Water') drawCanonicalGlyph(ctx, 'water', coreSize);
        else if (el === 'Earth') drawCanonicalGlyph(ctx, 'earth', coreSize);
        else if (el === 'Light') drawCanonicalGlyph(ctx, 'light', coreSize);
        else drawCanonicalGlyph(ctx, 'arcane', coreSize);
      } else if (lod >= 1) {
        ctx.strokeStyle = subTheme.stroke;
        ctx.lineWidth = 1.3;
        const iconSize = Math.max(8, sr * 0.9);
        if (sub.type === 'state') drawCanonicalGlyph(ctx, 'focus', iconSize);
        else if (sub.type === 'effects') drawCanonicalGlyph(ctx, 'repetition', iconSize);
        else if (sub.type === 'handler') drawCanonicalGlyph(ctx, 'column', iconSize);
        else drawCanonicalGlyph(ctx, 'aeroform', iconSize);
      }

      ctx.restore();
    });
  }

  public drawArtConduits(
    ctx: CanvasRenderingContext2D,
    subSeals: SubSeal[],
    conduits: Array<{ from: string; to: string }>,
    _baseR: number
  ): void {
    if (!conduits || conduits.length === 0) return;
    ctx.save();
    ctx.strokeStyle = '#141311';
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.1;
    ctx.setLineDash([3, 3]);

    conduits.forEach((c) => {
      const fromSeal = subSeals.find((s) => s.type === c.from || s.id.endsWith(c.from));
      const toSeal = subSeals.find((s) => s.type === c.to || s.id.endsWith(c.to));
      if (fromSeal && toSeal) {
        ctx.beginPath();
        ctx.moveTo(fromSeal.dx || 0, fromSeal.dy || 0);
        ctx.lineTo(toSeal.dx || 0, toSeal.dy || 0);
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  public drawArtSubSeal(
    ctx: CanvasRenderingContext2D,
    sub: SubSeal,
    baseR: number,
    lod: 0 | 1 | 2,
    seed = artSeed(sub.id)
  ): void {
    const sx = sub.dx || 0;
    const sy = sub.dy || 0;
    const sr = sub.radius || Math.max(6, Math.round(baseR * sub.radiusRatio));
    const ink = '#141311';

    ctx.save();
    ctx.translate(sx, sy);

    if (sub.type === 'core') {
      ctx.fillStyle = '#faf8f0';
      ctx.beginPath();
      ctx.arc(0, 0, sr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ink;
      if (lod >= 2) drawHandDrawnRing(ctx, sr, seed + 3, 1.3);
      else { ctx.lineWidth = 1.3; ctx.stroke(); }
      const coreSize = Math.max(10, sr * 1.2);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      const el = sub.name;
      if (el === 'Wind') this.drawArtGlyph(ctx, 'wind-underfoot', coreSize, seed);
      else if (el === 'Fire') this.drawArtGlyph(ctx, 'fire', coreSize, seed);
      else if (el === 'Water') this.drawArtGlyph(ctx, 'water', coreSize, seed);
      else if (el === 'Earth') this.drawArtGlyph(ctx, 'earth', coreSize, seed);
      else if (el === 'Light') this.drawArtGlyph(ctx, 'light', coreSize, seed);
      else this.drawArtGlyph(ctx, 'arcane', coreSize, seed);
    } else if (lod >= 1) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      const iconSize = Math.max(8, sr * 0.9);
      if (sub.type === 'state') this.drawArtGlyph(ctx, 'focus', iconSize, seed);
      else if (sub.type === 'effects') this.drawArtGlyph(ctx, 'repetition', iconSize, seed);
      else if (sub.type === 'handler') this.drawArtGlyph(ctx, 'column', iconSize, seed);
      else this.drawArtGlyph(ctx, 'aeroform', iconSize, seed);
    }

    ctx.restore();
  }

  public drawRadialKeystoneCrown(
    ctx: CanvasRenderingContext2D,
    keystoneR: number,
    signs: RadialSign[] | number,
    inkColor: string
  ): void {
    const entries = Array.isArray(signs) ? signs : Array.from({ length: Math.max(0, signs) }, () => ({ type: 'convergence', size: 11, loc: 0, label: '' }));
    const radius = keystoneR / 0.82;
    this.drawAdaptivePerimeterSigns(ctx, radius, getPerimeterSignLayout(entries, radius), inkColor);
  }

  public drawDynamicPerimeterSigns(
    ctx: CanvasRenderingContext2D,
    orbitR: number,
    signs: RadialSign[],
    theme: ThemeColors,
    lod: 0 | 1 | 2
  ): void {
    if (!signs?.length || lod === 0) return;
    const radius = orbitR / 0.82;
    this.drawAdaptivePerimeterSigns(ctx, radius, getPerimeterSignLayout(signs, radius), theme.stroke);
  }

  private drawAdaptivePerimeterSigns(
    ctx: CanvasRenderingContext2D,
    radius: number,
    layout: PerimeterSignLayout,
    color: string,
    artSeedValue?: number
  ): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;

    if (layout.dense) {
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.lineWidth = 1;
      if (artSeedValue !== undefined) drawHandDrawnRing(ctx, radius * 0.74, artSeedValue + 4, 1);
      else { ctx.beginPath(); ctx.arc(0, 0, radius * 0.74, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }

    const drawRow = (row: RadialSign[], orbit: number, offset: number) => {
      for (let index = 0; index < row.length; index++) {
        const sign = row[index]!;
        const angle = ((index + offset) * Math.PI * 2) / row.length;
        ctx.save();
        ctx.translate(Math.cos(angle) * orbit, Math.sin(angle) * orbit);
        ctx.rotate(angle + Math.PI / 2);
        const size = Math.min(sign.size || layout.glyphSize, layout.glyphSize);
        if (artSeedValue !== undefined) this.drawArtGlyph(ctx, sign.type, size, artSeedValue + index * 11 + (orbit < radius * 0.7 ? 5 : 0));
        else drawCanonicalGlyph(ctx, sign.type, size);
        ctx.restore();
      }
    };

    drawRow(layout.outer, radius * 0.82, 0);
    if (layout.dense) drawRow(layout.inner, radius * 0.66, 0.5);
    ctx.restore();
  }

  private drawArtGlyph(ctx: CanvasRenderingContext2D, name: string, size: number, seed: number): void {
    if (!drawHandDrawnGlyph(ctx, name, size, seed)) drawCanonicalGlyph(ctx, name, size);
  }

  public drawFacetedStrengthenRing(
    ctx: CanvasRenderingContext2D,
    r: number,
    theme: ThemeColors,
    _lod: 0 | 1 | 2
  ): void {
    ctx.save();
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth = 2.4;

    // Hexagon
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    // Inner concentric hexagon
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const px = Math.cos(a) * (r * 0.88);
      const py = Math.sin(a) * (r * 0.88);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.restore();
  }

  private drawKindMark(ctx: CanvasRenderingContext2D, r: number, node: SealNode, theme: ThemeColors): void {
    if (r < 34) return;
    ctx.save();
    ctx.beginPath();
    appendSealShape(ctx, node.kind, 0, -r * 0.94, Math.min(7, Math.max(4.5, r * 0.095)));
    ctx.fillStyle = theme.bg;
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  public drawOuterRing(
    ctx: CanvasRenderingContext2D,
    r: number,
    node: SealNode,
    theme: ThemeColors,
    lod: 0 | 1 | 2
  ): void {
    ctx.save();
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth = 2.4;

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.lineWidth = 1.0;
    ctx.stroke();

    if (lod >= 1) {
      const propCount = (node.children || []).length || 4;
      this.drawCompassTicks(ctx, r, theme, Math.min(24, Math.max(8, propCount * 2)));
    }

    ctx.restore();
  }

  public drawCompassTicks(
    ctx: CanvasRenderingContext2D,
    r: number,
    theme: ThemeColors,
    count: number
  ): void {
    ctx.save();
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth = 1.0;

    for (let i = 0; i < count; i++) {
      const a = (i * Math.PI * 2) / count;
      const len = i % 4 === 0 ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo((r - 1) * Math.cos(a), (r - 1) * Math.sin(a));
      ctx.lineTo((r - len) * Math.cos(a), (r - len) * Math.sin(a));
      ctx.stroke();
    }
    ctx.restore();
  }

  public drawSigil(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    element: SealElement | string,
    theme: ThemeColors
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth = 1.8;

    if (element === 'Fire') drawCanonicalGlyph(ctx, 'fire', size);
    else if (element === 'Water') drawCanonicalGlyph(ctx, 'water', size);
    else if (element === 'Earth') drawCanonicalGlyph(ctx, 'earth', size);
    else if (element === 'Wind') drawCanonicalGlyph(ctx, 'wind-underfoot', size);
    else if (element === 'Light') drawCanonicalGlyph(ctx, 'light', size);
    else drawCanonicalGlyph(ctx, 'arcane', size);

    ctx.restore();
  }

  public drawKeystones(
    ctx: CanvasRenderingContext2D,
    r: number,
    keystones: string[],
    theme: ThemeColors
  ): void {
    const orbitR = r * 0.81;
    const count = keystones.length;
    const step = (Math.PI * 2) / count;

    ctx.save();
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth = 1.2;

    keystones.forEach((_, idx) => {
      const a = idx * step;
      const kx = Math.cos(a) * orbitR;
      const ky = Math.sin(a) * orbitR;
      ctx.save();
      ctx.translate(kx, ky);
      drawCanonicalGlyph(ctx, 'convergence', 10);
      ctx.restore();
    });

    ctx.restore();
  }

  public drawLabels(
    ctx: CanvasRenderingContext2D,
    r: number,
    node: SealNode,
    lod: 0 | 1 | 2,
    isHighlight: boolean
  ): void {
    if (lod === 0 && !isHighlight) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const labelY = r + 8;
    const name = node.name || 'Component';
    const loc = node.loc || node.metrics?.loc || 0;

    // Academic Palatino / Georgia typography with protective parchment halo
    ctx.font = isHighlight ? 'bold 13px Palatino, Georgia, serif' : '12px Palatino, Georgia, serif';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = '#f7f4e8';
    ctx.lineWidth = 3.5;
    ctx.strokeText(name, 0, labelY);
    ctx.fillStyle = '#141311';
    ctx.fillText(name, 0, labelY);

    if (lod >= 2 || isHighlight) {
      let subLabel = `${loc} LOC`;
      if (node.isCircular) {
        subLabel = `🔄 Cycle • ${loc}L`;
      } else if (node.isOrphan) {
        subLabel = `🍂 0 in • ${loc}L`;
      }
      ctx.font = '10px Palatino, Georgia, serif';
      ctx.lineWidth = 3.0;
      ctx.strokeText(subLabel, 0, labelY + 15);
      ctx.fillStyle = node.isCircular ? '#8c1db8' : node.isOrphan ? '#78756d' : 'rgba(20, 19, 17, 0.72)';
      ctx.fillText(subLabel, 0, labelY + 15);
    }

    ctx.restore();
  }

  public drawArtLabels(
    ctx: CanvasRenderingContext2D,
    r: number,
    node: SealNode,
    lod: 0 | 1 | 2
  ): void {
    if (lod === 0) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const labelY = r + 8;
    const name = node.name || 'Component';

    ctx.font = '12px Palatino, Georgia, serif';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = '#faf8f0';
    ctx.lineWidth = 3.0;
    ctx.strokeText(name, 0, labelY);
    ctx.fillStyle = '#141311';
    ctx.fillText(name, 0, labelY);

    ctx.restore();
  }
}
