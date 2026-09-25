import { CANONICAL_GLYPHS } from './whaPaths.js';

interface InkStroke { path: Path2D; pressure: number }
interface InkVariant { strokes: InkStroke[]; width: number; height: number }

const GLYPH_VARIANTS = new Map<string, InkVariant | null>();
const RING_PATHS = new Map<string, Path2D>();
const SVG_NS = 'http://www.w3.org/2000/svg';

export function artSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function variantIndex(seed: number): number {
  return (seed >>> 0) % 4;
}

function getInkVariant(name: string, variant: number): InkVariant | null {
  const key = `${name}:${variant}`;
  if (GLYPH_VARIANTS.has(key)) return GLYPH_VARIANTS.get(key)!;
  const data = CANONICAL_GLYPHS[name];
  if (!data || typeof document === 'undefined') return null;

  try {
    const strokes: InkStroke[] = [];
    const parts = data.d.match(/[Mm][^Mm]*/g) || [];
    const amplitude = Math.max(data.w, data.h) * 0.018;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const fragment = parts[partIndex]!;
      const source = document.createElementNS(SVG_NS, 'path');
      source.setAttribute('d', fragment);
      const length = source.getTotalLength();
      if (!Number.isFinite(length) || length < 0.1) continue;
      const count = Math.min(120, Math.max(8, Math.ceil(length / 1.7)));
      const points = Array.from({ length: count + 1 }, (_, index) => source.getPointAtLength(length * index / count));
      const phase = variant * 1.67 + partIndex * 2.13;
      const closed = /[Zz]\s*$/.test(fragment);
      const path = new Path2D();
      for (let index = 0; index <= count; index++) {
        const point = points[index]!;
        const before = points[Math.max(0, index - 1)]!;
        const after = points[Math.min(count, index + 1)]!;
        const dx = after.x - before.x;
        const dy = after.y - before.y;
        const magnitude = Math.hypot(dx, dy) || 1;
        const t = index / count;
        const taper = closed ? 1 : Math.sin(Math.PI * t);
        const wobble = amplitude * taper * (
          0.62 * Math.sin(2 * Math.PI * 3 * t + phase) +
          0.38 * Math.sin(2 * Math.PI * 7 * t + phase * 1.7)
        );
        const x = point.x - dy / magnitude * wobble;
        const y = point.y + dx / magnitude * wobble;
        if (index === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      if (closed) path.closePath();
      strokes.push({ path, pressure: 0.82 + 0.28 * (0.5 + 0.5 * Math.sin(partIndex * 2.7 + phase)) });
    }
    const result = strokes.length ? { strokes, width: data.w, height: data.h } : null;
    GLYPH_VARIANTS.set(key, result);
    return result;
  } catch {
    // Browser implementations without SVG path metrics keep the clean glyph.
    GLYPH_VARIANTS.set(key, null);
    return null;
  }
}

/** Draw a stable hand-inked variant; false lets the caller use its clean path. */
export function drawHandDrawnGlyph(ctx: CanvasRenderingContext2D, name: string, size: number, seed: number): boolean {
  const ink = getInkVariant(name, variantIndex(seed));
  if (!ink || !Number.isFinite(size) || size <= 0) return false;
  const scale = size / Math.max(ink.width, ink.height);
  ctx.save();
  const lineWidth = ctx.lineWidth;
  ctx.rotate(((seed >>> 3) % 7 - 3) * 0.006);
  ctx.scale(scale, scale);
  ctx.translate(-ink.width / 2, -ink.height / 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of ink.strokes) {
    ctx.lineWidth = lineWidth * stroke.pressure / scale;
    ctx.stroke(stroke.path);
  }
  ctx.restore();
  return true;
}

function getInkRing(radius: number, seed: number): Path2D {
  const roundedRadius = Math.round(radius * 10) / 10;
  const variant = variantIndex(seed);
  const key = `${roundedRadius}:${variant}`;
  const cached = RING_PATHS.get(key);
  if (cached) return cached;
  const path = new Path2D();
  const count = Math.min(144, Math.max(48, Math.round(roundedRadius * 1.35)));
  const phase = variant * 1.37;
  for (let index = 0; index < count; index++) {
    const angle = index * Math.PI * 2 / count;
    const wobble = 0.35 * Math.sin(angle * 5 + phase) + 0.18 * Math.sin(angle * 13 + phase * 1.9);
    const localRadius = roundedRadius + wobble;
    const x = Math.cos(angle) * localRadius;
    const y = Math.sin(angle) * localRadius;
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  RING_PATHS.set(key, path);
  if (RING_PATHS.size > 1024) RING_PATHS.delete(RING_PATHS.keys().next().value!);
  return path;
}

export function drawHandDrawnRing(ctx: CanvasRenderingContext2D, radius: number, seed: number, lineWidth: number): void {
  const path = getInkRing(radius, seed);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.stroke(path);
  ctx.globalAlpha *= 0.18;
  ctx.lineWidth = lineWidth * 0.55;
  ctx.translate(0.35, -0.2);
  ctx.stroke(path);
  ctx.restore();
}
