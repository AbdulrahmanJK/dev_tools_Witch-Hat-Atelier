import type { SealNode } from '@wha/core';

export type SealKind = SealNode['kind'];

type ShapePath = Pick<Path2D, 'moveTo' | 'lineTo' | 'arc' | 'closePath'>;

/** Older graphs stored a module's category in `kind`; normalize them at the drawing boundary. */
export function normalizeSealKind(kind: unknown): SealKind {
  if (kind === 'component' || kind === 'module' || kind === 'class' || kind === 'function' || kind === 'hub') return kind;
  return 'module';
}

/** A small, stable silhouette that remains readable before the inner glyphs appear. */
export function appendSealShape(path: ShapePath, rawKind: unknown, x: number, y: number, radius: number): void {
  const kind = normalizeSealKind(rawKind);
  if (kind === 'component') {
    path.moveTo(x + radius, y);
    path.arc(x, y, radius, 0, Math.PI * 2);
    return;
  }

  const points: Array<[number, number]> = kind === 'class'
    ? [[0, -1], [0.87, -0.5], [0.87, 0.5], [0, 1], [-0.87, 0.5], [-0.87, -0.5]]
    : kind === 'module'
      ? [[-0.83, -0.83], [0.83, -0.83], [0.83, 0.83], [-0.83, 0.83]]
      : kind === 'hub'
        ? [[0, -1], [0.32, -0.32], [1, 0], [0.32, 0.32], [0, 1], [-0.32, 0.32], [-1, 0], [-0.32, -0.32]]
        : [[0, -1], [1, 0], [0, 1], [-1, 0]];
  path.moveTo(x + points[0]![0] * radius, y + points[0]![1] * radius);
  for (let i = 1; i < points.length; i++) {
    path.lineTo(x + points[i]![0] * radius, y + points[i]![1] * radius);
  }
  path.closePath();
}
