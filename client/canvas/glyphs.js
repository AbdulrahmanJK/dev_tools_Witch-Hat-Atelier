// ═══════════════════════════════════════════════════════════════════
// WITCH HAT ATELIER PROCEDURAL GLYPH RENDERER
// Authentic vector rendering of WHA Seals, Sigils, and Keystones
// ═══════════════════════════════════════════════════════════════════

export const WHA_THEMES = {
  Fire:   { stroke: '#b83a14', glow: 'rgba(184, 58, 20, 0.45)', bg: '#fbf4eb', label: '#8a2207' },
  Water:  { stroke: '#106ba3', glow: 'rgba(16, 107, 163, 0.4)', bg: '#f0f6fa', label: '#0a466b' },
  Earth:  { stroke: '#785420', glow: 'rgba(120, 84, 32, 0.4)', bg: '#fcf8f2', label: '#4f3410' },
  Wind:   { stroke: '#1c7343', glow: 'rgba(28, 115, 67, 0.4)', bg: '#f2fbf5', label: '#0f4727' },
  Light:  { stroke: '#a88915', glow: 'rgba(168, 137, 21, 0.4)', bg: '#fffdf2', label: '#6e5f0b' },
  Arcane: { stroke: '#681da8', glow: 'rgba(104, 29, 168, 0.4)', bg: '#faf5ff', label: '#430f70' },
  Ink:    { stroke: '#1c1b18', glow: 'rgba(28, 27, 24, 0.25)', bg: '#f4f1e3', label: '#1c1b18' },
};

export class GlyphRenderer {
  constructor() {
    this.inkColor = '#1a1916';
    this.guideColor = 'rgba(26, 25, 22, 0.12)';
  }

  // ═══════════ MAIN NODE RENDERER ═══════════
  renderNode(ctx, node, lod, isSelected, isHovered) {
    const x = node.x;
    const y = node.y;
    const r = node.metrics.radius;
    const element = node.metrics.element || 'Arcane';
    const theme = WHA_THEMES[element] || WHA_THEMES.Arcane;

    ctx.save();
    ctx.translate(x, y);

    // 1. LOD 0 (Distant zoom): Just glowing aura and minimal circular beacon
    if (lod === 0) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = theme.stroke;
      ctx.globalAlpha = isHovered || isSelected ? 0.8 : 0.45;
      ctx.fill();

      // Glowing aura
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
        ctx.strokeStyle = theme.stroke;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    // 2. Aura / Glow on selection or hover
    if (isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 14, 0, Math.PI * 2);
      ctx.fillStyle = theme.glow;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = theme.stroke;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 3. Fill interior of seal with warm parchment and subtle elemental tint
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = theme.bg || '#f7f4e8';
    ctx.fill();

    // 4. Outer Seal Ring (The Activation Circuit)
    this.drawOuterRing(ctx, r, node, theme, lod);

    // 5. Central Elemental Sigil (Fire, Water, Earth, Wind, Light, Arcane)
    this.drawSigil(ctx, 0, 0, r * 0.42, element, theme);

    // 6. LOD 2: Hook Keystones on orbit
    if (lod >= 2 && node.metrics.keystones && node.metrics.keystones.length > 0) {
      this.drawKeystones(ctx, r, node.metrics.keystones, theme);
    }

    // 7. Component Name & Meta
    this.drawLabels(ctx, r, node, lod, isSelected || isHovered);

    // 8. Overcharged / Forbidden Signs
    if (node.metrics.isForbidden) {
      this.drawForbiddenMarks(ctx, r);
    } else if (node.metrics.grade === 'Overcharged Monolith') {
      this.drawOverchargedCracks(ctx, r);
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

  // ═══════════ CANONICAL SIGILS (WHA CODES) ═══════════
  drawSigil(ctx, cx, cy, sz, element, theme) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = theme.stroke;
    ctx.fillStyle = theme.stroke;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (element) {
      case 'Fire':
        // Equilateral triangle apex up + vertical bisector extending below base as stem
        {
          const h = sz * 1.2;
          const w = sz * 1.0;
          const apexY = -h * 0.55;
          const baseY = h * 0.15;
          const stemY = baseY + h * 0.42;

          // Triangle
          ctx.beginPath();
          ctx.moveTo(0, apexY);
          ctx.lineTo(-w / 2, baseY);
          ctx.lineTo(w / 2, baseY);
          ctx.closePath();
          ctx.stroke();

          // Bisector & stem
          ctx.beginPath();
          ctx.moveTo(0, apexY);
          ctx.lineTo(0, stemY);
          ctx.stroke();

          // Cross tick at bottom of stem
          ctx.beginPath();
          ctx.moveTo(-w * 0.22, stemY);
          ctx.lineTo(w * 0.22, stemY);
          ctx.stroke();
        }
        break;

      case 'Water':
        // Sinuous vertical spine + alternating horizontal branch stubs (fish skeleton)
        {
          const h = sz * 1.2;
          const half = h / 2;
          ctx.beginPath();
          ctx.moveTo(0, -half);
          ctx.bezierCurveTo(-sz * 0.25, -half * 0.4, sz * 0.25, half * 0.4, 0, half);
          ctx.stroke();

          // Branches
          const branches = [-half * 0.5, -half * 0.15, half * 0.2, half * 0.55];
          branches.forEach((by, idx) => {
            const dir = idx % 2 === 0 ? 1 : -1;
            const len = sz * 0.4;
            ctx.beginPath();
            ctx.moveTo(0, by);
            ctx.lineTo(dir * len, by - dir * 2);
            ctx.stroke();
          });
        }
        break;

      case 'Earth':
        // Downward triangle + internal crossbar in upper third + lateral dots
        {
          const h = sz * 1.1;
          const w = sz * 1.0;
          const baseY = -h * 0.4;
          const apexY = h * 0.45;
          const barY = baseY + h * 0.28;

          // Triangle pointing down
          ctx.beginPath();
          ctx.moveTo(-w / 2, baseY);
          ctx.lineTo(w / 2, baseY);
          ctx.lineTo(0, apexY);
          ctx.closePath();
          ctx.stroke();

          // Crossbar extending beyond sides
          ctx.beginPath();
          ctx.moveTo(-w * 0.65, barY);
          ctx.lineTo(w * 0.65, barY);
          ctx.stroke();

          // Lateral dots
          ctx.beginPath();
          ctx.arc(-w * 0.6, 0, 2.2, 0, Math.PI * 2);
          ctx.arc(w * 0.6, 0, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      case 'Wind':
        // S-curve spine + 2 outward-pointing chevrons
        {
          const half = sz * 0.55;
          ctx.beginPath();
          ctx.moveTo(-half * 0.6, -half);
          ctx.bezierCurveTo(half * 0.8, -half * 0.5, -half * 0.8, half * 0.5, half * 0.6, half);
          ctx.stroke();

          // Chevron left (pointing outward-left)
          ctx.beginPath();
          ctx.moveTo(-half * 0.2, -half * 0.3);
          ctx.lineTo(-half * 0.8, -half * 0.1);
          ctx.lineTo(-half * 0.2, half * 0.1);
          ctx.stroke();

          // Chevron right (pointing outward-right)
          ctx.beginPath();
          ctx.moveTo(half * 0.2, -half * 0.1);
          ctx.lineTo(half * 0.8, half * 0.1);
          ctx.lineTo(half * 0.2, half * 0.3);
          ctx.stroke();
        }
        break;

      case 'Light':
        // Diamond outline (rotated 45deg) + 8 radiating spokes
        {
          const rD = sz * 0.42;
          ctx.beginPath();
          ctx.moveTo(0, -rD);
          ctx.lineTo(rD, 0);
          ctx.lineTo(0, rD);
          ctx.lineTo(-rD, 0);
          ctx.closePath();
          ctx.stroke();

          // 8 Spokes extending through vertices & edges
          const spokeLen = rD * 1.55;
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(a) * spokeLen, Math.sin(a) * spokeLen);
            ctx.stroke();
          }
        }
        break;

      case 'Arcane':
      default:
        // Compound Core: Nested concentric ring with eye & 4 star rays
        {
          ctx.beginPath();
          ctx.arc(0, 0, sz * 0.45, 0, Math.PI * 2);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(0, 0, sz * 0.18, 0, Math.PI * 2);
          ctx.fill();

          for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2 + Math.PI / 4;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * sz * 0.25, Math.sin(a) * sz * 0.25);
            ctx.lineTo(Math.cos(a) * sz * 0.72, Math.sin(a) * sz * 0.72);
            ctx.stroke();
          }
        }
        break;
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
