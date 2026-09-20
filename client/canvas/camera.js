export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0; // World center X
    this.y = 0; // World center Y
    this.zoom = 0.45; // Default initial zoom
    this.minZoom = 0.03;
    this.maxZoom = 4.0;
    this.width = canvas.width;
    this.height = canvas.height;
    this.dpr = window.devicePixelRatio || 1;

    // Inertia & drag state
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.cameraStart = { x: 0, y: 0 };
    this.animating = false;

    this.onUpdate = null;
    this.bindEvents();
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
  }

  screenToWorld(sx, sy) {
    const cx = this.width / 2;
    const cy = this.height / 2;
    return {
      x: (sx - cx) / this.zoom + this.x,
      y: (sy - cy) / this.zoom + this.y,
    };
  }

  worldToScreen(wx, wy) {
    const cx = this.width / 2;
    const cy = this.height / 2;
    return {
      x: (wx - this.x) * this.zoom + cx,
      y: (wy - this.y) * this.zoom + cy,
    };
  }

  getViewportBounds() {
    const p1 = this.screenToWorld(0, 0);
    const p2 = this.screenToWorld(this.width, this.height);
    return {
      minX: Math.min(p1.x, p2.x),
      minY: Math.min(p1.y, p2.y),
      maxX: Math.max(p1.x, p2.x),
      maxY: Math.max(p1.y, p2.y),
    };
  }

  getLOD() {
    if (this.zoom < 0.14) return 0; // Distant macro galaxy
    if (this.zoom < 0.55) return 1; // Normal map view with sigils and names
    return 2; // Close inspection with keystones & runes
  }

  zoomAt(sx, sy, deltaFactor) {
    const before = this.screenToWorld(sx, sy);
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * deltaFactor));
    this.zoom = newZoom;
    const after = this.screenToWorld(sx, sy);

    this.x += before.x - after.x;
    this.y += before.y - after.y;

    if (this.onUpdate) this.onUpdate();
  }

  pan(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    if (this.onUpdate) this.onUpdate();
  }

  fitBounds(bounds, padding = 120) {
    const bw = bounds.width + padding * 2;
    const bh = bounds.height + padding * 2;
    const targetZoom = Math.max(0.18, Math.min(1.0, Math.min(this.width / bw, this.height / bh)));

    const targetX = (bounds.minX + bounds.maxX) / 2;
    const targetY = (bounds.minY + bounds.maxY) / 2;

    this.animateTo(targetX, targetY, targetZoom);
  }

  focusNode(node, targetZoom = 1.0) {
    this.animateTo(node.x, node.y, targetZoom);
  }

  animateTo(targetX, targetY, targetZoom, duration = 400) {
    const startX = this.x;
    const startY = this.y;
    const startZoom = this.zoom;
    const startTime = performance.now();
    this.animating = true;

    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Smooth cubic ease-out
      const ease = 1 - Math.pow(1 - progress, 3);

      this.x = startX + (targetX - startX) * ease;
      this.y = startY + (targetY - startY) * ease;
      this.zoom = startZoom + (targetZoom - startZoom) * ease;

      if (this.onUpdate) this.onUpdate();

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        this.animating = false;
      }
    };

    requestAnimationFrame(tick);
  }

  bindEvents() {
    const el = this.canvas;

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        this.zoomAt(e.clientX, e.clientY, factor);
      },
      { passive: false }
    );

    el.addEventListener('pointerdown', (e) => {
      // Allow drag on middle button, space+left, or normal drag if not clicking a node
      this.isDragging = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.cameraStart = { x: this.x, y: this.y };
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      this.x = this.cameraStart.x - dx / this.zoom;
      this.y = this.cameraStart.y - dy / this.zoom;
      if (this.onUpdate) this.onUpdate();
    });

    const stopDrag = (e) => {
      this.isDragging = false;
    };

    el.addEventListener('pointerup', stopDrag);
    el.addEventListener('pointercancel', stopDrag);
  }
}
