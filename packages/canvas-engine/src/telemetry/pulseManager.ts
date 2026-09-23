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

    // Only profiler events count as renders. Browser DOM observations have different semantics.
    let freq = this.renderCounts.get(nodeId);
    if (event.type === 'RENDER') {
      if (!freq || now - freq.windowStart > 1000) {
        freq = { count: 1, windowStart: now };
        this.renderCounts.set(nodeId, freq);
      } else {
        freq.count++;
      }
    }

    const isOverheating = event.type === 'RENDER' && (freq?.count || 0) > 15;

    let color = '#e6b122'; // Default golden arcane flash
    if (isOverheating) {
      color = '#e82c2c'; // Overheating danger red!
    } else if (event.type === 'RENDER' && event.changeReasons?.[0] === 'mount') {
      color = '#4e8278'; // First mount is distinct from a repeated update.
    } else if (event.type === 'STATE_MUTATION') {
      color = '#e04b16'; // Fire orange
    } else if (event.type === 'EFFECT_TRIGGER') {
      color = '#158ad4'; // Water azure
    } else if (event.type === 'DOM_UPDATE') {
      color = '#5f9862'; // Browser-observed DOM activity
    }

    this.activePulses.set(nodeId, {
      nodeId,
      startTime: now,
      duration: 1800,
      type: event.type,
      color,
      durationMs: event.durationMs || 1,
      renderCount: event.type === 'RENDER' ? freq?.count || 1 : 0,
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
      const rippleR = baseR + progress * 38;
      const alpha = Math.pow(1 - progress, 0.65) * 0.95;

      ctx.save();
      ctx.translate(pos.x, pos.y);

      // Outer expanding ripple ring
      ctx.beginPath();
      ctx.arc(0, 0, rippleR, 0, Math.PI * 2);
      ctx.strokeStyle = pulse.color;
      ctx.lineWidth = Math.max(1.5, 4.5 * (1 - progress));
      ctx.globalAlpha = alpha;
      ctx.shadowColor = pulse.color;
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(0, 0, baseR + 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff7df';
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha * 0.9;
      ctx.stroke();

      // Subtle flash glow over seal
      ctx.beginPath();
      ctx.arc(0, 0, baseR, 0, Math.PI * 2);
      ctx.fillStyle = pulse.color;
      ctx.globalAlpha = alpha * 0.38;
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
