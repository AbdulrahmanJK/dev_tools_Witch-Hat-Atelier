/**
 * Witch Hat Atelier — Anime Sakuga Fire Vortex & Ink Flame Engine
 *
 * Recreates authentic circular flame crescents matching the reference illustration:
 * - Sweeping dual-crescent fire vortex wrapping clockwise around the seal
 * - Layered fiery palette: Deep crimson edges -> blazing orange body -> white-hot gold core spine
 * - Organic flame tongues trailing clockwise along the orbital tangent
 * - Flame-tear negative space cutouts inside the liquid fire body
 * - Tier 1: Elegant golden-amber breathing vortex (~40%+ load / warm)
 * - Tier 2: Fierce anime flame slash vortex (Overcharged / Fissure)
 * - Zero floating sphere embers; strictly constrained within 25-40% of circle radius
 */

export class InkFlameRenderer {
  /**
   * Main entrypoint for DevTools flame rendering
   */
  public drawFlameVortex(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    timeSec: number,
    state: 'warm' | 'overcharged' | 'fissure'
  ): void {
    ctx.save();
    ctx.translate(x, y);

    const isFissure = state === 'fissure';
    const isWarm = state === 'warm';

    // Clockwise angular velocity
    const rotSpeed = isFissure ? 1.6 : isWarm ? 0.9 : 1.3;
    const baseAngle = (timeSec * rotSpeed) % (Math.PI * 2);

    if (isWarm) {
      // Tier 1: Soft breathing amber-gold crescent vortex
      this.drawCrescent(ctx, r, baseAngle, timeSec, {
        thicknessFactor: 0.22,
        crimson: 'rgba(215, 115, 20, 0.85)',
        orange: 'rgba(245, 165, 35, 0.90)',
        gold: 'rgba(255, 235, 145, 0.95)',
        stroke: 'rgba(175, 75, 12, 0.85)',
        tongueScale: 0.6,
        showTears: false,
      });
    } else {
      // Tier 2: Dual Sakuga Fire Crescents (matching reference art)
      // Primary Crescent (Main sweeping wave)
      this.drawCrescent(ctx, r, baseAngle, timeSec, {
        thicknessFactor: isFissure ? 0.38 : 0.30,
        crimson: '#cf220e',
        orange: '#fa6419',
        gold: '#fff0a8',
        stroke: '#8a1105',
        tongueScale: isFissure ? 1.2 : 0.95,
        showTears: true,
      });

      // Secondary Opposing Crescent (Offset by ~170 deg, creates the closed circular swirl)
      this.drawCrescent(ctx, r, baseAngle + Math.PI * 0.92, timeSec + 1.4, {
        thicknessFactor: isFissure ? 0.32 : 0.25,
        crimson: '#cf220e',
        orange: '#fa6419',
        gold: '#ffe58f',
        stroke: '#8a1105',
        tongueScale: isFissure ? 1.0 : 0.8,
        showTears: true,
      });
    }

    // Structural fissure crack lines for critically broken seals
    if (isFissure) {
      ctx.save();
      ctx.strokeStyle = '#9c1206';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(r * 0.35, -r * 0.2);
      ctx.lineTo(r * 0.65, -r * 0.55);
      ctx.lineTo(r * 0.8, -r * 0.48);
      ctx.lineTo(r * 1.15, -r * 0.82);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-r * 0.4, r * 0.3);
      ctx.lineTo(-r * 0.7, r * 0.5);
      ctx.lineTo(-r * 1.12, r * 0.74);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Draw a single curved anime fire crescent with lick tongues and glowing core
   */
  private drawCrescent(
    ctx: CanvasRenderingContext2D,
    r: number,
    startAngle: number,
    timeSec: number,
    cfg: {
      thicknessFactor: number;
      crimson: string;
      orange: string;
      gold: string;
      stroke: string;
      tongueScale: number;
      showTears: boolean;
    }
  ): void {
    const arcSpan = Math.PI * 1.18; // ~212 degrees wrap
    const steps = 28;
    const stepAngle = arcSpan / steps;

    const innerPoints: Array<{ x: number; y: number }> = [];
    const outerPoints: Array<{ x: number; y: number }> = [];
    const spinePoints: Array<{ x: number; y: number }> = [];

    const maxThickness = r * cfg.thicknessFactor;

    for (let i = 0; i <= steps; i++) {
      const u = i / steps; // 0 (tail) -> 1 (head)
      const theta = startAngle + i * stepAngle;

      // Profile: thin at tail, thick in mid-body, tapering at tip
      const profile = Math.pow(Math.sin(u * Math.PI), 0.75);

      // Organic pulsation wave
      const pulse = 1 + 0.14 * Math.sin(u * 12 + timeSec * 8);

      const baseInnerR = r + 2.5;
      const thickness = maxThickness * profile * pulse;

      // Tongue / flicker extension along outer perimeter
      let tongueOffset = 0;
      if (u > 0.15 && u < 0.92) {
        const tonguePhase = (i % 4) / 4;
        const tongueWave = Math.sin(u * 16 + timeSec * 9.5 + tonguePhase * Math.PI);
        if (tongueWave > 0.3) {
          tongueOffset = (tongueWave - 0.3) * (maxThickness * 0.65) * cfg.tongueScale;
        }
      }

      const innerR = baseInnerR;
      const outerR = baseInnerR + thickness + tongueOffset;
      const spineR = baseInnerR + thickness * 0.52;

      // Tangential clockwise drag on the tips
      const tipDrag = u * 0.04 * Math.sin(timeSec * 5 + i);

      innerPoints.push({
        x: Math.cos(theta) * innerR,
        y: Math.sin(theta) * innerR,
      });

      outerPoints.push({
        x: Math.cos(theta + tipDrag) * outerR,
        y: Math.sin(theta + tipDrag) * outerR,
      });

      spinePoints.push({
        x: Math.cos(theta) * spineR,
        y: Math.sin(theta) * spineR,
      });
    }

    // 1. Draw Main Fire Crescent Body
    ctx.save();
    ctx.beginPath();
    // Inner arc from tail to head
    ctx.moveTo(innerPoints[0]!.x, innerPoints[0]!.y);
    for (let i = 1; i < innerPoints.length; i++) {
      const prev = innerPoints[i - 1]!;
      const curr = innerPoints[i]!;
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.lineTo(innerPoints[innerPoints.length - 1]!.x, innerPoints[innerPoints.length - 1]!.y);

    // Outer arc from head back to tail (with jagged licking flickers)
    for (let i = outerPoints.length - 1; i >= 0; i--) {
      const pt = outerPoints[i]!;
      if (i === outerPoints.length - 1) {
        ctx.lineTo(pt.x, pt.y);
      } else {
        const next = outerPoints[i + 1]!;
        const mx = (pt.x + next.x) / 2;
        const my = (pt.y + next.y) / 2;
        ctx.quadraticCurveTo(next.x, next.y, mx, my);
      }
    }
    ctx.closePath();

    // Fiery body gradient fill
    const midIdx = Math.floor(steps * 0.55);
    const midInner = innerPoints[midIdx]!;
    const midOuter = outerPoints[midIdx]!;
    const bodyGrad = ctx.createLinearGradient(midInner.x, midInner.y, midOuter.x, midOuter.y);
    bodyGrad.addColorStop(0.0, cfg.gold);
    bodyGrad.addColorStop(0.35, cfg.orange);
    bodyGrad.addColorStop(0.85, cfg.crimson);
    bodyGrad.addColorStop(1.0, '#750e04');

    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // Anime ink outline
    ctx.strokeStyle = cfg.stroke;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // 2. White-Hot Golden Core Spine (The central brilliant ridge of the flame)
    ctx.save();
    ctx.beginPath();
    const spineStart = Math.floor(steps * 0.18);
    const spineEnd = Math.floor(steps * 0.88);
    ctx.moveTo(spinePoints[spineStart]!.x, spinePoints[spineStart]!.y);
    for (let i = spineStart + 1; i <= spineEnd; i++) {
      const prev = spinePoints[i - 1]!;
      const curr = spinePoints[i]!;
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.strokeStyle = cfg.gold;
    ctx.lineWidth = Math.max(1.8, maxThickness * 0.28);
    ctx.lineCap = 'round';
    ctx.stroke();

    // Pure white spine highlight in thickest section
    ctx.beginPath();
    const hotStart = Math.floor(steps * 0.38);
    const hotEnd = Math.floor(steps * 0.72);
    ctx.moveTo(spinePoints[hotStart]!.x, spinePoints[hotStart]!.y);
    for (let i = hotStart + 1; i <= hotEnd; i++) {
      const prev = spinePoints[i - 1]!;
      const curr = spinePoints[i]!;
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.0, maxThickness * 0.12);
    ctx.stroke();
    ctx.restore();

    // 3. Negative Space Flame Tears (Cutout gaps in the flame body, like the reference)
    if (cfg.showTears) {
      ctx.save();
      const tearIndices = [Math.floor(steps * 0.42), Math.floor(steps * 0.65)];
      tearIndices.forEach((tIdx) => {
        const pt = spinePoints[tIdx];
        if (!pt) return;
        const tearAngle = startAngle + tIdx * stepAngle;
        const tearLen = maxThickness * 0.45;
        const tearWidth = maxThickness * 0.16;

        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(tearAngle + Math.PI / 2);

        // Teardrop cutout shape
        ctx.beginPath();
        ctx.ellipse(0, 0, tearWidth * 0.5, tearLen * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#faf8f0'; // Matches parchment paper
        ctx.fill();
        ctx.strokeStyle = cfg.crimson;
        ctx.lineWidth = 1.0;
        ctx.stroke();

        ctx.restore();
      });
      ctx.restore();
    }
  }
}
