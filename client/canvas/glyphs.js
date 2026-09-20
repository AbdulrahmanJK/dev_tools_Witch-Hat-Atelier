// ═══════════════════════════════════════════════════════════════════
// WITCH HAT ATELIER PROCEDURAL GLYPH RENDERER
// Authentic vector rendering of WHA Seals, Sigils, and Keystones
// ═══════════════════════════════════════════════════════════════════

import { CANONICAL_GLYPHS } from './whaPaths.js';

// Cache of parsed Path2D objects for peak 120 FPS performance
const PATH_CACHE = new Map();

export function getCanonicalPath(name) {
  if (PATH_CACHE.has(name)) return PATH_CACHE.get(name);
  const data = CANONICAL_GLYPHS[name];
  if (!data) return null;
  const path = new Path2D(data.d);
  const item = { path, w: data.w, h: data.h };
  PATH_CACHE.set(name, item);
  return item;
}

export function drawCanonicalGlyph(ctx, name, size) {
  const item = getCanonicalPath(name);
  if (!item) return false;
  ctx.save();
  const maxDim = Math.max(item.w, item.h);
  const s = size / maxDim;
  ctx.scale(s, s);
  ctx.translate(-item.w / 2, -item.h / 2);
  ctx.stroke(item.path);
  ctx.restore();
  return true;
}

export const WHA_THEMES = {
  Fire:   { stroke: '#b83a14', glow: 'rgba(184, 58, 20, 0.45)', bg: '#fbf4eb', label: '#8a2207' },
  Water:  { stroke: '#106ba3', glow: 'rgba(16, 107, 163, 0.4)', bg: '#f0f6fa', label: '#0a466b' },
  Earth:  { stroke: '#785420', glow: 'rgba(120, 84, 32, 0.4)', bg: '#fcf8f2', label: '#4f3410' },
  Wind:   { stroke: '#1c7343', glow: 'rgba(28, 115, 67, 0.4)', bg: '#f2fbf5', label: '#0f4727' },
  Light:  { stroke: '#a88915', glow: 'rgba(168, 137, 21, 0.4)', bg: '#fffdf2', label: '#6e5f0b' },
  Arcane: { stroke: '#681da8', glow: 'rgba(104, 29, 168, 0.4)', bg: '#faf5ff', label: '#430f70' },
  Ink:    { stroke: '#141311', glow: 'rgba(20, 19, 17, 0.20)', bg: '#f6f3e5', label: '#141311' },
  Mono:   { stroke: '#141311', glow: 'rgba(20, 19, 17, 0.15)', bg: '#faf8f0', label: '#141311' },
};

export class GlyphRenderer {
  constructor() {
    this.inkColor = '#141311';
    this.guideColor = 'rgba(20, 19, 17, 0.14)';
  }

  // ═══════════ MAIN NODE RENDERER ═══════════
  renderNode(ctx, node, lod, isSelected, isHovered, artMode = false) {
    // If in Art Blueprint Mode (черно-белый чертеж / картина без интерактива)
    if (artMode) {
      this.renderArtBlueprintSeal(ctx, node, lod);
      return;
    }

    // By DEFAULT: render full complex nested compound seal!
    if (node.realisticLayout && node.realisticLayout.subSeals?.length > 0) {
      this.renderRealisticCompoundSeal(ctx, node, lod, isSelected, isHovered);
      return;
    }

    // Fallback simple seal (if no sub-seals exist)
    const x = node.x;
    const y = node.y;
    const r = node.metrics.radius;
    const element = node.metrics.element || 'Arcane';
    const theme = WHA_THEMES[element] || WHA_THEMES.Arcane;

    ctx.save();
    ctx.translate(x, y);

    if (lod === 0) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
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
    this.drawSigil(ctx, 0, 0, r * 0.42, element, theme);

    if (lod >= 2 && node.metrics.keystones && node.metrics.keystones.length > 0) {
      this.drawKeystones(ctx, r, node.metrics.keystones, theme);
    }

    this.drawLabels(ctx, r, node, lod, isSelected || isHovered);
    ctx.restore();
  }

  // ═══════════ MONOCHROME ART BLUEPRINT MODE (ЧЕРНО-БЕЛЫЙ ЧЕРТЕЖ КАК НА КАРТИНКЕ) ═══════════
  renderArtBlueprintSeal(ctx, node, lod) {
    const layout = node.realisticLayout || { realisticRadius: node.metrics.radius, subSeals: [], conduits: [] };
    const r = layout.realisticRadius;
    const ink = '#141311';

    ctx.save();
    ctx.translate(node.x, node.y);

    if (lod === 0 && r < 40) {
      // Tiny leaf circle at distant zoom: simple delicate ring with central dot
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.0;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
      ctx.restore();
      return;
    }

    // Translucent antique drawing paper base so overlapping intersecting rings show their crossing arcs
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(251, 249, 242, 0.72)';
    ctx.fill();

    // 1. Delicate, fine hand-drawn ink ring (fine quill thickness: 1.0 - 2.0px)
    const ringWidth = r > 250 ? 2.2 : r > 80 ? 1.4 : 1.0;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = ink;
    ctx.lineWidth = ringWidth;
    ctx.stroke();

    // Guideline circle for keystone orbit
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(20, 19, 17, 0.35)';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // 2. Canonical Radial Keystone Crown (only on large circles or when zoomed in)
    if (r >= 65 || lod >= 2) {
      this.drawRadialKeystoneCrown(ctx, r * 0.76, r > 140 ? 16 : 8, ink);

      // Inner ring enclosing the center core
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    // 3. Central Canonical Sigil or Inscribed Sub-Seals
    if (layout.subSeals && layout.subSeals.length > 2 && lod >= 2) {
      // Conduits
      this.drawArtConduits(ctx, layout.subSeals, layout.conduits);
      // Inscribed Sub-Seals
      layout.subSeals.forEach((sub) => {
        this.drawArtSubSeal(ctx, sub, lod);
      });
    } else {
      // Center: exact canonical vector sigil
      const sigilSize = Math.max(12, r * 0.44);
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineWidth = r > 100 ? 1.8 : 1.1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const el = node.metrics.element;
      if (el === 'Wind' || node.name === 'App') {
        drawCanonicalGlyph(ctx, 'wind-underfoot', sigilSize);
      } else if (el === 'Fire') {
        drawCanonicalGlyph(ctx, 'fire', sigilSize);
      } else if (el === 'Water') {
        drawCanonicalGlyph(ctx, 'water', sigilSize);
      } else if (el === 'Earth') {
        drawCanonicalGlyph(ctx, 'earth', sigilSize);
      } else if (el === 'Light') {
        drawCanonicalGlyph(ctx, 'light', sigilSize);
      } else {
        drawCanonicalGlyph(ctx, 'wind-underfoot', sigilSize);
      }
    }

    // Calligraphic Drafting Label (with intelligent LOD collision suppression)
    this.drawArtLabels(ctx, r, node, lod);

    ctx.restore();
  }

  // ═══════════ ART BLUEPRINT RINGS (ЧЕРТЕЖНЫЕ КОЛЬЦА) ═══════════
  drawArtBlueprintRings(ctx, r, lod) {
    const ink = '#141311';

    // 1. Outermost fine compass caliper ring
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.8;
    ctx.stroke();

    // 2. Second ring
    ctx.beginPath();
    ctx.arc(0, 0, r - 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(20, 19, 17, 0.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 3. Third hatch boundary ring
    ctx.beginPath();
    ctx.arc(0, 0, r - 14, 0, Math.PI * 2);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // 4. Inner dashed alignment ring
    ctx.beginPath();
    ctx.arc(0, 0, r - 20, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(20, 19, 17, 0.35)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 36 Degree Compass Ticks (every 10 degrees)
    for (let i = 0; i < 36; i++) {
      const a = (i * Math.PI * 2) / 36;
      const isMajor = i % 9 === 0; // 0, 90, 180, 270
      const isSemi = i % 3 === 0;
      const len = isMajor ? 16 : isSemi ? 9 : 5;

      ctx.beginPath();
      ctx.moveTo((r - 1) * Math.cos(a), (r - 1) * Math.sin(a));
      ctx.lineTo((r - len) * Math.cos(a), (r - len) * Math.sin(a));
      ctx.strokeStyle = ink;
      ctx.lineWidth = isMajor ? 2.4 : isSemi ? 1.4 : 0.8;
      ctx.stroke();

      // Cardinal drafting crosses
      if (isMajor && lod >= 2) {
        const cx = (r + 14) * Math.cos(a);
        const cy = (r + 14) * Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy);
        ctx.lineTo(cx + 4, cy);
        ctx.moveTo(cx, cy - 4);
        ctx.lineTo(cx, cy + 4);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // Cardinal Spikes extending outward
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo((r - 2) * Math.cos(a), (r - 2) * Math.sin(a));
      ctx.lineTo((r + 18) * Math.cos(a), (r + 18) * Math.sin(a));
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.0;
      ctx.stroke();
    }
  }

  // ═══════════ HATCHING EFFECT (ШТРИХОВКА ТУШЬЮ) ═══════════
  drawHatchingInRing(ctx, innerR, outerR, spacing = 5, color = 'rgba(20, 19, 17, 0.15)') {
    ctx.save();
    // Clip to the annular ring area
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2, false);
    ctx.arc(0, 0, innerR, 0, Math.PI * 2, true);
    ctx.clip();

    ctx.strokeStyle = color;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let x = -outerR; x <= outerR * 2; x += spacing) {
      ctx.moveTo(x - outerR, -outerR);
      ctx.lineTo(x, outerR);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ═══════════ TECHNICAL ART CONDUITS ═══════════
  drawArtConduits(ctx, subSeals, conduits) {
    if (!conduits || conduits.length === 0) return;
    const subMap = new Map();
    subSeals.forEach((s) => {
      subMap.set(s.type, s);
      subMap.set(s.id.split('#')[1], s);
    });

    conduits.forEach((c) => {
      const s1 = subMap.get(c.from);
      const s2 = subMap.get(c.to);
      if (!s1 || !s2) return;

      const dx = s2.dx - s1.dx;
      const dy = s2.dy - s1.dy;
      const dist = Math.hypot(dx, dy);
      if (dist < 5) return;

      const normalX = -dy / dist;
      const normalY = dx / dist;
      const curve = Math.min(22, dist * 0.16);
      const mx = (s1.dx + s2.dx) / 2 + normalX * curve;
      const my = (s1.dy + s2.dy) / 2 + normalY * curve;

      // Drafting construction line
      ctx.beginPath();
      ctx.moveTo(s1.dx, s1.dy);
      ctx.quadraticCurveTo(mx, my, s2.dx, s2.dy);
      ctx.strokeStyle = 'rgba(20, 19, 17, 0.45)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Tangent tick mark at midpoint
      ctx.beginPath();
      ctx.moveTo(mx - normalX * 4, my - normalY * 4);
      ctx.lineTo(mx + normalX * 4, my + normalY * 4);
      ctx.strokeStyle = '#141311';
      ctx.lineWidth = 1.0;
      ctx.stroke();

      // Terminal junction dots
      ctx.beginPath();
      ctx.arc(s1.dx, s1.dy, 2.2, 0, Math.PI * 2);
      ctx.arc(s2.dx, s2.dy, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = '#141311';
      ctx.fill();
    });
  }

  // ═══════════ INSCRIBED ART SUB-SEAL (ЧЕРНО-БЕЛЫЙ ПОД-КРУГ) ═══════════
  drawArtSubSeal(ctx, sub, lod) {
    ctx.save();
    ctx.translate(sub.dx, sub.dy);
    const sr = sub.radius;
    const ink = '#141311';

    // Sub-seal background: crisp parchment white
    ctx.beginPath();
    ctx.arc(0, 0, sr, 0, Math.PI * 2);
    ctx.fillStyle = '#fdfcf7';
    ctx.fill();

    // Double technical ring
    ctx.beginPath();
    ctx.arc(0, 0, sr, 0, Math.PI * 2);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.0;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, sr - 3.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(20, 19, 17, 0.55)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // 4 Cardinal ticks
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo((sr - 1) * Math.cos(a), (sr - 1) * Math.sin(a));
      ctx.lineTo((sr - 5) * Math.cos(a), (sr - 5) * Math.sin(a));
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // Micro-Sigil in Pure Black Ink
    if (sub.type === 'core') {
      this.drawSigil(ctx, 0, 0, sr * 0.65, sub.element, WHA_THEMES.Mono);
    } else if (sub.type === 'state') {
      const ds = sr * 0.42;
      ctx.beginPath();
      ctx.moveTo(0, -ds);
      ctx.lineTo(ds, 0);
      ctx.lineTo(0, ds);
      ctx.lineTo(-ds, 0);
      ctx.closePath();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      // Fine center crosshair
      ctx.beginPath();
      ctx.moveTo(-ds * 0.4, 0); ctx.lineTo(ds * 0.4, 0);
      ctx.moveTo(0, -ds * 0.4); ctx.lineTo(0, ds * 0.4);
      ctx.strokeStyle = 'rgba(20, 19, 17, 0.45)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    } else if (sub.type === 'effects') {
      ctx.beginPath();
      ctx.arc(0, 0, sr * 0.40, 0, Math.PI * 2);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
    } else if (sub.type === 'handler') {
      const ts = sr * 0.42;
      ctx.beginPath();
      ctx.moveTo(0, -ts);
      ctx.lineTo(0, ts * 0.8);
      ctx.moveTo(-ts * 0.6, ts * 0.8);
      ctx.lineTo(ts * 0.6, ts * 0.8);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if (sub.type === 'child') {
      const cs = sr * 0.38;
      ctx.beginPath();
      ctx.moveTo(-cs, cs * 0.6);
      ctx.lineTo(0, -cs * 0.6);
      ctx.lineTo(cs, cs * 0.6);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // Calligraphic technical sub-label
    if (lod >= 1) {
      ctx.textAlign = 'center';
      const fSize = Math.max(8, Math.min(11, sr * 0.22));
      ctx.font = `600 ${fSize}px 'Palatino Linotype', Palatino, serif`;
      ctx.fillStyle = '#141311';
      ctx.fillText(sub.name, 0, sr + 10);

      if (lod >= 2 && sub.details && sub.details.length > 0) {
        ctx.font = `italic 500 ${fSize * 0.88}px 'Palatino Linotype', Palatino, serif`;
        ctx.fillStyle = 'rgba(20, 19, 17, 0.65)';
        ctx.fillText(sub.details[0], 0, sr + 21);
      }
    }

    ctx.restore();
  }

  drawArtLabels(ctx, r, node, lod) {
    // Intelligent clutter suppression: only show label if circle is large enough at current zoom!
    if (lod === 0 && r < 75) return;
    if (lod === 1 && r < 35) return;

    ctx.textAlign = 'center';
    const fontSize = Math.max(9, Math.min(15, r * 0.18));
    ctx.font = `600 ${fontSize}px 'Palatino Linotype', 'Book Antiqua', Georgia, serif`;
    ctx.fillStyle = '#141311';
    ctx.fillText(node.name, 0, -r - 7);

    // Only show LOC subtitle on major circles or close zoom
    if ((lod >= 1 && r >= 75) || lod >= 2) {
      const subFont = Math.max(8, Math.min(12, r * 0.14));
      ctx.font = `italic 500 ${subFont}px 'Palatino Linotype', Palatino, serif`;
      ctx.fillStyle = 'rgba(20, 19, 17, 0.65)';
      ctx.fillText(`${node.loc} LOC`, 0, r + 16);
    }
  }

  drawArtFissures(ctx, r) {
    ctx.strokeStyle = '#141311';
    ctx.lineWidth = 1.8;
    const angles = [0.35, 2.5, 4.7];
    angles.forEach((ang) => {
      const sx = Math.cos(ang) * (r + 4);
      const sy = Math.sin(ang) * (r + 4);
      const mx = Math.cos(ang) * (r * 0.85) + (Math.sin(ang) * 8);
      const my = Math.sin(ang) * (r * 0.85) - (Math.cos(ang) * 8);
      const ex = Math.cos(ang) * (r * 0.60);
      const ey = Math.sin(ang) * (r * 0.60);

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(mx, my);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    });
  }

  // ═══════════ REALISTIC COMPOUND NESTED SEAL RENDERER ═══════════
  renderRealisticCompoundSeal(ctx, node, lod, isSelected, isHovered) {
    const layout = node.realisticLayout;
    const r = layout.realisticRadius;
    const element = node.metrics.element || 'Arcane';
    const theme = WHA_THEMES[element] || WHA_THEMES.Arcane;

    ctx.save();
    ctx.translate(node.x, node.y);

    if (lod === 0) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = theme.stroke;
      ctx.globalAlpha = isHovered || isSelected ? 0.85 : 0.5;
      ctx.fill();
      ctx.restore();
      return;
    }

    // Aura on selection or hover
    if (isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 16, 0, Math.PI * 2);
      ctx.fillStyle = theme.glow;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
      ctx.strokeStyle = theme.stroke;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Fill Mother Seal parchment body
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f8f5eb';
    ctx.fill();

    // 1. Triple Compound Gear-Toothed Outer Ring
    this.drawCompoundGearRing(ctx, r, theme, lod);

    // 2. Canonical Radial Keystone Crown (matching user's image)
    if (lod >= 1) {
      this.drawRadialKeystoneCrown(ctx, r * 0.82, 16, 'rgba(26, 25, 22, 0.75)');
    }

    // 3. Internal Conduits (Energy Pathways between sub-seals)
    this.drawInternalConduits(ctx, layout.subSeals, layout.conduits, theme);

    // 4. Render Each Inscribed Sub-Seal
    layout.subSeals.forEach((sub) => {
      this.drawSubSeal(ctx, sub, lod, theme);
    });

    // 4. Mother Seal Title Banner
    this.drawLabels(ctx, r, node, lod, isSelected || isHovered);

    // 5. Overcharged Cracks / Forbidden Glaives
    if (node.metrics.isForbidden) {
      this.drawForbiddenMarks(ctx, r);
    } else if (node.metrics.grade === 'Overcharged Monolith') {
      this.drawOverchargedCracks(ctx, r);
    }

    ctx.restore();
  }

  // ═══════════ TRIPLE COMPOUND GEAR RING ═══════════
  drawCompoundGearRing(ctx, r, theme, lod) {
    // Outer primary circuit
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = this.inkColor;
    ctx.lineWidth = 3.6;
    ctx.stroke();

    // Middle gear-toothed track
    ctx.beginPath();
    ctx.arc(0, 0, r - 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(26, 25, 22, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // 32 Clockwork / runic teeth between outer and middle ring
    for (let i = 0; i < 32; i++) {
      const a = (i * Math.PI * 2) / 32;
      const isCard = i % 4 === 0;
      ctx.beginPath();
      ctx.moveTo((r - 2) * Math.cos(a), (r - 2) * Math.sin(a));
      ctx.lineTo((r - (isCard ? 14 : 7)) * Math.cos(a), (r - (isCard ? 14 : 7)) * Math.sin(a));
      ctx.strokeStyle = this.inkColor;
      ctx.lineWidth = isCard ? 2.6 : 1.2;
      ctx.stroke();
    }

    // Inner boundary ring
    ctx.beginPath();
    ctx.arc(0, 0, r - 15, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(26, 25, 22, 0.35)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 8 Cardinal Arrowhead Spikes extending outward
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const isMajor = i % 2 === 0;
      const len = isMajor ? 18 : 10;
      const sx = (r - 2) * Math.cos(a);
      const sy = (r - 2) * Math.sin(a);
      const ex = (r + len) * Math.cos(a);
      const ey = (r + len) * Math.sin(a);

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = theme.stroke;
      ctx.lineWidth = isMajor ? 2.4 : 1.6;
      ctx.stroke();
    }
  }

  // ═══════════ INTERNAL DATA CONDUITS ═══════════
  drawInternalConduits(ctx, subSeals, conduits, theme) {
    if (!conduits || conduits.length === 0) return;
    const subMap = new Map();
    subSeals.forEach((s) => {
      // Map by id or type
      subMap.set(s.type, s);
      subMap.set(s.id.split('#')[1], s);
    });

    conduits.forEach((c) => {
      const s1 = subMap.get(c.from);
      const s2 = subMap.get(c.to);
      if (!s1 || !s2) return;

      const dx = s2.dx - s1.dx;
      const dy = s2.dy - s1.dy;
      const dist = Math.hypot(dx, dy);
      if (dist < 5) return;

      // Curved ink thread
      const normalX = -dy / dist;
      const normalY = dx / dist;
      const curve = Math.min(25, dist * 0.18);
      const mx = (s1.dx + s2.dx) / 2 + normalX * curve;
      const my = (s1.dy + s2.dy) / 2 + normalY * curve;

      ctx.beginPath();
      ctx.moveTo(s1.dx, s1.dy);
      ctx.quadraticCurveTo(mx, my, s2.dx, s2.dy);
      ctx.strokeStyle = 'rgba(26, 25, 22, 0.28)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Golden energy pulse core
      ctx.beginPath();
      ctx.moveTo(s1.dx, s1.dy);
      ctx.quadraticCurveTo(mx, my, s2.dx, s2.dy);
      ctx.strokeStyle = theme.stroke;
      ctx.lineWidth = 1.0;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  // ═══════════ INSCRIBED SUB-SEALS ═══════════
  drawSubSeal(ctx, sub, lod, parentTheme) {
    ctx.save();
    ctx.translate(sub.dx, sub.dy);
    const sr = sub.radius;
    const subTheme = WHA_THEMES[sub.element] || parentTheme;

    // Sub-seal background parchment tint
    ctx.beginPath();
    ctx.arc(0, 0, sr, 0, Math.PI * 2);
    ctx.fillStyle = subTheme.bg || '#fbf9f2';
    ctx.fill();

    // Outer ring of sub-seal
    ctx.beginPath();
    ctx.arc(0, 0, sr, 0, Math.PI * 2);
    ctx.strokeStyle = this.inkColor;
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // Inner ring
    ctx.beginPath();
    ctx.arc(0, 0, sr - 3.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(26, 25, 22, 0.45)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // 4 Cardinal ticks on sub-seal
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo((sr - 1) * Math.cos(a), (sr - 1) * Math.sin(a));
      ctx.lineTo((sr - 5) * Math.cos(a), (sr - 5) * Math.sin(a));
      ctx.strokeStyle = this.inkColor;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // Micro-Sigil / Keystone in Center of Sub-seal
    if (sub.type === 'core') {
      this.drawSigil(ctx, 0, 0, sr * 0.65, sub.element, subTheme);
    } else if (sub.type === 'state') {
      // Diamond / Light micro-sigil
      const ds = sr * 0.42;
      ctx.beginPath();
      ctx.moveTo(0, -ds);
      ctx.lineTo(ds, 0);
      ctx.lineTo(0, ds);
      ctx.lineTo(-ds, 0);
      ctx.closePath();
      ctx.strokeStyle = subTheme.stroke;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    } else if (sub.type === 'effects') {
      // Repetition concentric circles with pupil
      ctx.beginPath();
      ctx.arc(0, 0, sr * 0.40, 0, Math.PI * 2);
      ctx.strokeStyle = subTheme.stroke;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = subTheme.stroke;
      ctx.fill();
    } else if (sub.type === 'handler') {
      // Column inverted T
      const ts = sr * 0.42;
      ctx.beginPath();
      ctx.moveTo(0, -ts);
      ctx.lineTo(0, ts * 0.8);
      ctx.moveTo(-ts * 0.6, ts * 0.8);
      ctx.lineTo(ts * 0.6, ts * 0.8);
      ctx.strokeStyle = subTheme.stroke;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    } else if (sub.type === 'child') {
      // Chevron Direction
      const cs = sr * 0.38;
      ctx.beginPath();
      ctx.moveTo(-cs, cs * 0.6);
      ctx.lineTo(0, -cs * 0.6);
      ctx.lineTo(cs, cs * 0.6);
      ctx.strokeStyle = subTheme.stroke;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // Sub-seal labels (LOD >= 1)
    if (lod >= 1) {
      ctx.textAlign = 'center';
      const fSize = Math.max(8, Math.min(11, sr * 0.22));
      ctx.font = `600 ${fSize}px 'Palatino Linotype', Palatino, serif`;
      ctx.fillStyle = '#1c1b18';
      ctx.fillText(sub.name, 0, sr + 10);

      // Micro details below
      if (lod >= 2 && sub.details && sub.details.length > 0) {
        ctx.font = `italic 500 ${fSize * 0.88}px 'Palatino Linotype', Palatino, serif`;
        ctx.fillStyle = 'rgba(26, 25, 22, 0.70)';
        const topDetail = sub.details[0];
        ctx.fillText(topDetail, 0, sr + 21);
      }
    }

    ctx.restore();
  }

  // ═══════════ OUTER SEAL RING ═══════════
  drawOuterRing(ctx, r, node, theme, lod) {
    // Primary outer ring (Bold authentic ink)
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = this.inkColor;
    ctx.lineWidth = 3.2;
    ctx.stroke();

    // Secondary concentric inner boundary
    ctx.beginPath();
    ctx.arc(0, 0, r - 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(26, 25, 22, 0.65)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Faint inner guideline ring
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(26, 25, 22, 0.22)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 8 Cardinal compass tick marks
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const isMajor = i % 2 === 0;
      const tickLen = isMajor ? 14 : 8;
      ctx.beginPath();
      ctx.moveTo((r - 2) * Math.cos(a), (r - 2) * Math.sin(a));
      ctx.lineTo((r - tickLen) * Math.cos(a), (r - tickLen) * Math.sin(a));
      ctx.strokeStyle = this.inkColor;
      ctx.lineWidth = isMajor ? 2.6 : 1.6;
      ctx.stroke();
    }

    // Prop notches along outer perimeter
    const props = node.props || [];
    if (lod >= 2 && props.length > 0) {
      const maxProps = Math.min(props.length, 16);
      for (let i = 0; i < maxProps; i++) {
        const a = (i / maxProps) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(r * Math.cos(a), r * Math.sin(a));
        ctx.lineTo((r + 7) * Math.cos(a), (r + 7) * Math.sin(a));
        ctx.strokeStyle = theme.stroke;
        ctx.lineWidth = 2.0;
        ctx.stroke();
      }
    }
  }

  // ═══════════ CANONICAL RADIAL KEYSTONE CROWN (ПОЯС ЗНАКОВ КАК НА КАРТИНКЕ) ═══════════
  drawRadialKeystoneCrown(ctx, orbitR, count = 16, strokeColor = '#141311') {
    if (orbitR < 20) return; // Skip rendering subpixel details when zoomed out
    const actualCount = orbitR < 55 ? 8 : count;
    const step = (Math.PI * 2) / actualCount;
    const keystoneSize = Math.max(8, Math.min(22, orbitR * 0.20));

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = strokeColor;
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < actualCount; i++) {
      const a = i * step;
      const kx = Math.cos(a) * orbitR;
      const ky = Math.sin(a) * orbitR;

      ctx.save();
      ctx.translate(kx, ky);
      // Rotate radially along the circle
      ctx.rotate(a + Math.PI / 2);

      const isEven = i % 2 === 0;
      if (isEven) {
        // Triangle pointing inward toward center (Convergence) - exactly as in user image
        drawCanonicalGlyph(ctx, 'convergence', keystoneSize);
      } else {
        // Arrow pointing outward with base tick (Levitation) - exactly as in user image
        drawCanonicalGlyph(ctx, 'levitation', keystoneSize);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // ═══════════ CANONICAL SIGILS (WHA CODES) ═══════════
  drawSigil(ctx, cx, cy, sz, element, theme) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = theme.stroke;
    ctx.fillStyle = theme.stroke;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const elName = (element || '').toLowerCase();

    if (elName.includes('wind') || elName.includes('air')) {
      // Exact canonical Wind Underfoot double-volute nautilus
      drawCanonicalGlyph(ctx, 'wind-underfoot', sz * 1.35);
    } else if (elName.includes('fire')) {
      drawCanonicalGlyph(ctx, 'fire', sz * 1.35);
    } else if (elName.includes('water')) {
      drawCanonicalGlyph(ctx, 'water', sz * 1.35);
    } else if (elName.includes('earth')) {
      drawCanonicalGlyph(ctx, 'earth', sz * 1.35);
    } else if (elName.includes('light')) {
      drawCanonicalGlyph(ctx, 'light', sz * 1.35);
    } else {
      // Arcane / Compound core
      drawCanonicalGlyph(ctx, 'wind-underfoot', sz * 1.35);
    }

    ctx.restore();
  }

  // ═══════════ KEYSTONES (HOOKS ON ORBIT) ═══════════
  drawKeystones(ctx, nodeRadius, keystones, theme) {
    const orbitR = nodeRadius * 0.75;
    const count = keystones.length;
    const step = (Math.PI * 2) / count;

    keystones.forEach((keyName, idx) => {
      const a = idx * step - Math.PI / 2;
      const kx = Math.cos(a) * orbitR;
      const ky = Math.sin(a) * orbitR;
      const ks = 11; // keystone scale

      ctx.save();
      ctx.translate(kx, ky);
      ctx.strokeStyle = this.inkColor;
      ctx.fillStyle = this.inkColor;
      ctx.lineWidth = 1.4;

      switch (keyName) {
        case 'Repetition':
          // Concentric circle + center dot (useEffect)
          ctx.beginPath();
          ctx.arc(0, 0, ks, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, 2, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'Pull':
          // Arrow pointing down with multi-prong frayed terminus (useSelector)
          ctx.beginPath();
          ctx.moveTo(0, -ks);
          ctx.lineTo(0, ks * 0.4);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(-ks * 0.5, ks);
          ctx.lineTo(0, ks * 0.4);
          ctx.lineTo(ks * 0.5, ks);
          ctx.stroke();
          break;

        case 'Column':
          // Inverted T: stem + perpendicular base crossbar (useRef)
          ctx.beginPath();
          ctx.moveTo(0, -ks);
          ctx.lineTo(0, ks);
          ctx.moveTo(-ks * 0.6, ks);
          ctx.lineTo(ks * 0.6, ks);
          ctx.stroke();
          break;

        case 'Convergence':
          // Downward-pointing equilateral clean triangle (useMemo)
          ctx.beginPath();
          ctx.moveTo(-ks * 0.6, -ks * 0.5);
          ctx.lineTo(ks * 0.6, -ks * 0.5);
          ctx.lineTo(0, ks * 0.6);
          ctx.closePath();
          ctx.stroke();
          break;

        case 'Direction':
          // Single chevron pointing UP (useHistory / router)
          ctx.beginPath();
          ctx.moveTo(-ks * 0.6, ks * 0.5);
          ctx.lineTo(0, -ks * 0.5);
          ctx.lineTo(ks * 0.6, ks * 0.5);
          ctx.stroke();
          break;

        case 'Dispersion':
          // Stem + upward-curving arc (useDispatch / provider)
          ctx.beginPath();
          ctx.moveTo(0, -ks);
          ctx.lineTo(0, ks * 0.2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, ks * 0.6, 0, Math.PI, false);
          ctx.stroke();
          break;

        case 'Diamond':
          // Pure 4-sided rhombus (useState)
          ctx.beginPath();
          ctx.moveTo(0, -ks * 0.7);
          ctx.lineTo(ks * 0.7, 0);
          ctx.lineTo(0, ks * 0.7);
          ctx.lineTo(-ks * 0.7, 0);
          ctx.closePath();
          ctx.stroke();
          break;

        case 'Eye':
          // Horizontal lens with center pupil (formik / sensors)
          ctx.beginPath();
          ctx.moveTo(-ks, 0);
          ctx.quadraticCurveTo(0, -ks * 0.6, ks, 0);
          ctx.quadraticCurveTo(0, ks * 0.6, -ks, 0);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, 2, 0, Math.PI * 2);
          ctx.fill();
          break;

        default:
          // Small anchor star
          ctx.beginPath();
          ctx.arc(0, 0, 3, 0, Math.PI * 2);
          ctx.fill();
          break;
      }

      ctx.restore();
    });
  }

  // ═══════════ TEXT & LABELS ═══════════
  drawLabels(ctx, r, node, lod, isProminent) {
    const name = node.name;
    const loc = node.loc;
    ctx.textAlign = 'center';

    // Top title banner above ring
    const fontSize = Math.max(11, Math.min(16, r * 0.22));
    ctx.font = `600 ${fontSize}px 'Palatino Linotype', 'Book Antiqua', Palatino, serif`;
    ctx.fillStyle = isProminent ? '#b83a14' : '#1c1b18';
    ctx.fillText(name, 0, -r - 10);

    // Sub-label below ring (LOC and category)
    if (lod >= 1) {
      const subFont = Math.max(9, Math.min(12, r * 0.16));
      ctx.font = `italic 500 ${subFont}px 'Palatino Linotype', Palatino, serif`;
      ctx.fillStyle = 'rgba(28, 27, 24, 0.65)';
      ctx.fillText(`${loc} LOC • ${node.metrics.grade}`, 0, r + 18);
    }
  }

  // ═══════════ STABILITY ANOMALIES ═══════════
  drawOverchargedCracks(ctx, r) {
    ctx.strokeStyle = 'rgba(184, 58, 20, 0.75)';
    ctx.lineWidth = 1.6;
    // 3 lightning-like fissures running across outer seal
    const angles = [0.4, 2.6, 4.8];
    angles.forEach((ang) => {
      const sx = Math.cos(ang) * (r + 4);
      const sy = Math.sin(ang) * (r + 4);
      const mx = Math.cos(ang) * (r * 0.85) + (Math.sin(ang) * 6);
      const my = Math.sin(ang) * (r * 0.85) - (Math.cos(ang) * 6);
      const ex = Math.cos(ang) * (r * 0.65);
      const ey = Math.sin(ang) * (r * 0.65);

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(mx, my);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    });
  }

  drawForbiddenMarks(ctx, r) {
    // Glaives marks (curved claw hooks around the ring)
    ctx.strokeStyle = '#a81c1c';
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const x1 = Math.cos(a) * (r - 2);
      const y1 = Math.sin(a) * (r - 2);
      const x2 = Math.cos(a) * (r + 14);
      const y2 = Math.sin(a) * (r + 14);
      const hx = Math.cos(a + 0.3) * (r + 16);
      const hy = Math.sin(a + 0.3) * (r + 16);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }
  }
}
