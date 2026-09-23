import type { Camera } from '../camera/camera.js';

export interface VFXItem {
  id: string;
  x: number;          // World X
  y: number;          // World Y
  radius: number;     // Seal base radius in world units
  intensity: number;  // 0.0 to 1.0
  state: 0 | 1 | 2 | 3; // 0 = harmonious, 1 = warm (smoke), 2 = overcharged (sakuga flame), 3 = smoldering embers (dimmed)
  seed: number;       // Random phase offset (0.0 to 100.0)
}

export interface VFXPass {
  readonly id: string;
  init(gl: WebGL2RenderingContext | WebGLRenderingContext): void;
  resize(width: number, height: number, dpr: number): void;
  render(
    gl: WebGL2RenderingContext | WebGLRenderingContext,
    camera: Camera,
    items: VFXItem[],
    timeSec: number
  ): void;
  destroy(): void;
}
