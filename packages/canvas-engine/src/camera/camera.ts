import type { SealNode } from '@wha/core';

export interface ViewportBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export class Camera {
  public x = 0;
  public y = 0;
  public zoom = 0.45;
  public minZoom = 0.04;
  public maxZoom = 4.0;
  public width = 1000;
  public height = 800;
  public dpr = 1;

  public isDragging = false;
  public hasMoved = false;
  public animating = false;
  public reducedMotion = false;

  private dragStart = { x: 0, y: 0 };
  private dragLast = { x: 0, y: 0 };
  private animationFrameId: number | null = null;
  private canvas: HTMLCanvasElement;
  private unbindEvents: (() => void) | null = null;

  public onUpdate: (() => void) | null = null;
  public onClick: ((e: PointerEvent, worldPos: { x: number; y: number }) => void) | null = null;
  public onDoubleClick: ((e: MouseEvent, worldPos: { x: number; y: number }) => void) | null = null;
  public onHover: ((worldPos: { x: number; y: number } | null) => void) | null = null;
  private hoverFrameId: number | null = null;
  private pendingHover: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.bindEvents();
  }

  public resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  }

  public screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.width / 2) / this.zoom + this.x,
      y: (sy - this.height / 2) / this.zoom + this.y,
    };
  }

  public worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + this.width / 2,
      y: (wy - this.y) * this.zoom + this.height / 2,
    };
  }

  public getViewportBounds(): ViewportBounds {
    const halfW = this.width / (2 * this.zoom);
    const halfH = this.height / (2 * this.zoom);
    const margin = 200; // Extra buffer to eliminate edge clipping
    return {
      x1: this.x - halfW - margin,
      y1: this.y - halfH - margin,
      x2: this.x + halfW + margin,
      y2: this.y + halfH + margin,
    };
  }

  public getLOD(): 0 | 1 | 2 {
    if (this.zoom < 0.22) return 0; // Far: simplified symbols
    if (this.zoom < 0.65) return 1; // Mid: standard symbols without tiny sub-text
    return 2; // Close: full intricate ink glyphs and details
  }

  public zoomAt(cursorX: number, cursorY: number, factor: number): void {
    const prevZoom = this.zoom;
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    if (newZoom === prevZoom) return;

    // Zoom centered towards mouse cursor
    const wx = (cursorX - this.width / 2) / prevZoom + this.x;
    const wy = (cursorY - this.height / 2) / prevZoom + this.y;

    this.zoom = newZoom;
    this.x = wx - (cursorX - this.width / 2) / this.zoom;
    this.y = wy - (cursorY - this.height / 2) / this.zoom;

    if (this.onUpdate) this.onUpdate();
  }

  public fitBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }, animate = true): void {
    this.stopAnimation();
    if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) return;
    const w = Math.max(100, bounds.maxX - bounds.minX);
    const h = Math.max(100, bounds.maxY - bounds.minY);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;

    const padding = Math.min(140, this.width * 0.16, this.height * 0.16);
    const zoomX = Math.max(1, this.width - padding) / w;
    const zoomY = Math.max(1, this.height - padding) / h;
    const targetZoom = Math.min(0.85, zoomX, zoomY);
    // A fixed 4% floor clips large repositories. Keep room for one extra
    // zoom-out step after fitting while preserving the normal small-map floor.
    this.minZoom = Math.min(this.minZoom, targetZoom * 0.8);

    if (animate) this.animateTo(cx, cy, targetZoom, this.zoom / targetZoom > 12 ? 180 : 400);
    else {
      this.x = cx;
      this.y = cy;
      this.zoom = targetZoom;
      this.onUpdate?.();
    }
  }

  public focusOnNode(node: SealNode, targetZoom = 0.9): void {
    this.animateTo(node.x, node.y, targetZoom);
  }

  public stopAnimation(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.animating = false;
  }

  public animateTo(targetX: number, targetY: number, targetZoom: number, duration = 400): void {
    this.stopAnimation();
    if (this.reducedMotion) {
      this.x = targetX;
      this.y = targetY;
      this.zoom = targetZoom;
      this.onUpdate?.();
      return;
    }
    const startX = this.x;
    const startY = this.y;
    const startZoom = this.zoom;
    const startTime = performance.now();

    this.animating = true;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);

      this.x = startX + (targetX - startX) * ease;
      this.y = startY + (targetY - startY) * ease;
      this.zoom = startZoom + (targetZoom - startZoom) * ease;

      if (this.onUpdate) this.onUpdate();

      if (progress < 1) {
        this.animationFrameId = requestAnimationFrame(tick);
      } else {
        this.animationFrameId = null;
        this.animating = false;
        if (this.onUpdate) this.onUpdate();
      }
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  private bindEvents(): void {
    const el = this.canvas;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.stopAnimation();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const rect = el.getBoundingClientRect();
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    };

    const onPointerDown = (e: PointerEvent) => {
      const wasAnimating = this.animating;
      this.stopAnimation();
      if (wasAnimating) this.onUpdate?.();
      if (this.hoverFrameId !== null) cancelAnimationFrame(this.hoverFrameId);
      this.hoverFrameId = null;
      this.pendingHover = null;
      this.isDragging = true;
      this.hasMoved = false;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.dragLast = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (this.isDragging) {
        const dx = e.clientX - this.dragLast.x;
        const dy = e.clientY - this.dragLast.y;

        // Pan lock threshold
        const totalDist = Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y);
        if (totalDist > 5) {
          this.hasMoved = true;
        }

        this.x -= dx / this.zoom;
        this.y -= dy / this.zoom;
        this.dragLast = { x: e.clientX, y: e.clientY };

        if (this.onUpdate) this.onUpdate();
      }
    };

    const onCanvasPointerMove = (e: PointerEvent) => {
      if (this.isDragging || !this.onHover) return;
      this.pendingHover = { x: e.clientX, y: e.clientY };
      if (this.hoverFrameId !== null) return;
      this.hoverFrameId = requestAnimationFrame(() => {
        this.hoverFrameId = null;
        const point = this.pendingHover;
        this.pendingHover = null;
        if (!point || this.isDragging || !this.onHover) return;
        const rect = el.getBoundingClientRect();
        if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) {
          this.onHover(null);
        } else {
          this.onHover(this.screenToWorld(point.x - rect.left, point.y - rect.top));
        }
      });
    };

    const onCanvasPointerLeave = () => {
      if (this.hoverFrameId !== null) cancelAnimationFrame(this.hoverFrameId);
      this.hoverFrameId = null;
      this.pendingHover = null;
      if (!this.isDragging) this.onHover?.(null);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer was lost
      }

      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        this.onHover?.(null);
      }

      // If user did not drag, trigger click
      if (!this.hasMoved && this.onClick) {
        const worldPos = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        this.onClick(e, worldPos);
      }
    };

    const onDblClick = (e: MouseEvent) => {
      if (this.onDoubleClick) {
        const rect = el.getBoundingClientRect();
        const worldPos = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        this.onDoubleClick(e, worldPos);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onCanvasPointerMove);
    el.addEventListener('pointerleave', onCanvasPointerLeave);
    el.addEventListener('dblclick', onDblClick);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    this.unbindEvents = () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onCanvasPointerMove);
      el.removeEventListener('pointerleave', onCanvasPointerLeave);
      el.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (this.hoverFrameId !== null) cancelAnimationFrame(this.hoverFrameId);
      this.hoverFrameId = null;
      this.pendingHover = null;
    };
  }

  public destroy(): void {
    this.stopAnimation();
    if (this.unbindEvents) {
      this.unbindEvents();
      this.unbindEvents = null;
    }
  }
}
