import type { Camera } from '../camera/camera.js';
import type { VFXItem, VFXPass } from './vfxTypes.js';
import { SakugaFirePass } from './passes/sakugaFirePass.js';

export class VFXEngine {
  public canvas: HTMLCanvasElement;
  public gl: (WebGLRenderingContext | WebGL2RenderingContext) | null = null;
  private passes: Map<string, VFXPass> = new Map();
  private isClear = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initGL();
  }

  private initGL(): void {
    const opts: WebGLContextAttributes = {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    };

    // Prefer WebGL2, fallback to WebGL1
    let gl: (WebGLRenderingContext | WebGL2RenderingContext) | null = this.canvas.getContext('webgl2', opts);
    if (!gl) {
      gl = (this.canvas.getContext('webgl', opts) ||
        this.canvas.getContext('experimental-webgl', opts)) as WebGLRenderingContext | null;
    }

    if (!gl) {
      console.warn('VFXEngine: WebGL not supported in this environment.');
      return;
    }

    this.gl = gl;

    // Handle GPU Context Loss
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('VFXEngine: WebGL context lost.');
      this.gl = null;
    });

    this.canvas.addEventListener('webglcontextrestored', () => {
      console.info('VFXEngine: WebGL context restored. Re-initializing passes...');
      this.initGL();
      this.reinitPasses();
    });

    // Register Default Sakuga Fire Pass
    this.registerPass(new SakugaFirePass());
  }

  public registerPass(pass: VFXPass): void {
    this.passes.set(pass.id, pass);
    if (this.gl) {
      pass.init(this.gl);
    }
  }

  private reinitPasses(): void {
    if (!this.gl) return;
    for (const pass of this.passes.values()) {
      pass.init(this.gl);
    }
  }

  public resize(width: number, height: number, dpr: number): void {
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      for (const pass of this.passes.values()) {
        pass.resize(width, height, dpr);
      }
    }
    this.isClear = false;
  }

  public render(
    camera: Camera,
    items: VFXItem[],
    timeSec = performance.now() / 1000
  ): { hasActiveAnimation: boolean } {
    if (!this.gl) {
      return { hasActiveAnimation: false };
    }

    // Zero CPU / GPU Idle: If no hot items, keep canvas cleared and sleep!
    if (items.length === 0) {
      if (!this.isClear) {
        this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.isClear = true;
      }
      return { hasActiveAnimation: false };
    }

    this.isClear = false;

    // Clear transparent WebGL buffer
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    // Dispatch render to passes
    for (const pass of this.passes.values()) {
      pass.render(this.gl, camera, items, timeSec);
    }

    return { hasActiveAnimation: true };
  }

  public destroy(): void {
    for (const pass of this.passes.values()) {
      pass.destroy();
    }
    this.passes.clear();
    this.gl = null;
  }
}
