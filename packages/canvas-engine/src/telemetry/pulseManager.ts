import type { DevToolsTelemetryEvent } from '@wha/core';

export interface ActivePulse {
  nodeId: string;
  startTime: number;
  duration: number;
  type: DevToolsTelemetryEvent['type'];
  color: string;
  durationMs: number;
  renderCount: number;
}

export class PulseManager {
  private activePulses = new Map<string, ActivePulse>();
  private renderCounts = new Map<string, { count: number; windowStart: number }>();

  public triggerPulse(nodeId: string, event: DevToolsTelemetryEvent): void {
    const now = performance.now();

    // Track frequency for overheating detection (excessive re-renders)
    let freq = this.renderCounts.get(nodeId);
    if (!freq || now - freq.windowStart > 1000) {
      freq = { count: 1, windowStart: now };
      this.renderCounts.set(nodeId, freq);
    } else {
      freq.count++;
    }

    const isOverheating = freq.count > 15;

    let color = '#e6b122'; // Default golden arcane flash
    if (isOverheating) {
      color = '#e82c2c'; // Overheating danger red!
    } else if (event.type === 'STATE_MUTATION') {
      color = '#e04b16'; // Fire orange
    } else if (event.type === 'EFFECT_TRIGGER') {
      color = '#158ad4'; // Water azure
    }

    this.activePulses.set(nodeId, {
      nodeId,
      startTime: now,
      duration: 750,
      type: event.type,
      color,
      durationMs: event.durationMs || 1,
      renderCount: freq.count,
    });
  }

  public hasActivePulses(now = performance.now()): boolean {
    for (const [nodeId, pulse] of this.activePulses.entries()) {
      if (now - pulse.startTime > pulse.duration) {
        this.activePulses.delete(nodeId);
      }
    }
    return this.activePulses.size > 0;
  }

  public drawPulses(
    ctx: CanvasRenderingContext2D,
    nodePosGetter: (nodeId: string) => { x: number; y: number; r: number } | null,
    now = performance.now()
  ): void {
    if (this.activePulses.size === 0) return;

    for (const [nodeId, pulse] of this.activePulses.entries()) {
      const elapsed = now - pulse.startTime;
      if (elapsed > pulse.duration) {
        this.activePulses.delete(nodeId);
        continue;
      }

      const progress = elapsed / pulse.duration;
      const pos = nodePosGetter(nodeId);
      if (!pos) continue;

      const baseR = pos.r;
      const rippleR = baseR + progress * 24;
      const alpha = (1 - progress) * 0.85;

      ctx.save();
      ctx.translate(pos.x, pos.y);

      // Outer expanding ripple ring
      ctx.beginPath();
      ctx.arc(0, 0, rippleR, 0, Math.PI * 2);
      ctx.strokeStyle = pulse.color;
      ctx.lineWidth = 3.0 * (1 - progress);
      ctx.globalAlpha = alpha;
      ctx.stroke();

      // Subtle flash glow over seal
      ctx.beginPath();
      ctx.arc(0, 0, baseR, 0, Math.PI * 2);
      ctx.fillStyle = pulse.color;
      ctx.globalAlpha = alpha * 0.22;
      ctx.fill();

      // Render count badge if rapid re-rendering
      if (pulse.renderCount > 1) {
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 11px Palatino, Georgia, serif';
        ctx.fillStyle = pulse.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`⚡ ${pulse.renderCount}`, 0, -baseR - 12);
      }

      ctx.restore();
    }
  }
}
