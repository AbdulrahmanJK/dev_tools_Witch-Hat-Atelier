import { useEffect, useRef } from 'react';
import { appendSealShape, drawCanonicalGlyph, normalizeSealKind } from '@wha/canvas-engine';

const ELEMENT_GLYPHS: Record<string, string> = {
  Fire: 'fire', Water: 'water', Earth: 'earth', Wind: 'wind-underfoot',
  Light: 'light', Arcane: 'arcane',
};

export function SealKindIcon({ kind, color = '#60452a', className = '' }: { kind: unknown; color?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 64, 64);
    ctx.beginPath();
    appendSealShape(ctx, normalizeSealKind(kind), 32, 32, 23);
    ctx.fillStyle = '#fffaf0';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(32, 32, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, [kind, color]);
  return <canvas ref={ref} width={64} height={64} className={`seal-legend-icon ${className}`} aria-hidden="true" />;
}

export function SealElementIcon({ element, color = '#60452a', className = '' }: { element: string; color?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 64, 64);
    ctx.save();
    ctx.translate(32, 32);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (!drawCanonicalGlyph(ctx, ELEMENT_GLYPHS[element] || ELEMENT_GLYPHS.Arcane!, 43)) {
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }, [element, color]);
  return <canvas ref={ref} width={64} height={64} className={`seal-legend-icon ${className}`} aria-hidden="true" />;
}
