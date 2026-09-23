import type { Camera } from '../../camera/camera.js';
import type { VFXItem, VFXPass } from '../vfxTypes.js';
import { SAKUGA_FIRE_VERT } from '../shaders/sakugaFire.vert.js';
import { SAKUGA_FIRE_FRAG } from '../shaders/sakugaFire.frag.js';

export class SakugaFirePass implements VFXPass {
  public readonly id = 'sakuga-fire';

  private gl: (WebGLRenderingContext | WebGL2RenderingContext) | null = null;
  private program: WebGLProgram | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;

  // Maximum concurrent hot nodes in one batch
  private maxInstances = 256;
  private floatsPerInstance = 7; // x, y, radius, state, intensity, seed, padding
  private instanceData: Float32Array;

  // WebGL 1 instancing extension (native in WebGL 2)
  private extInstancing: any = null;

  // Uniform locations
  private uCameraLoc: WebGLUniformLocation | null = null;
  private uViewportLoc: WebGLUniformLocation | null = null;
  private uTimeLoc: WebGLUniformLocation | null = null;

  // Attribute locations
  private aQuadLoc = -1;
  private aWorldPosLoc = -1;
  private aRadiusLoc = -1;
  private aStateLoc = -1;
  private aIntensityLoc = -1;
  private aSeedLoc = -1;

  constructor() {
    this.instanceData = new Float32Array(this.maxInstances * this.floatsPerInstance);
  }

  public init(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.gl = gl;

    // Detect instancing capability (WebGL2 has it built-in, WebGL1 requires extension)
    if ('vertexAttribDivisor' in gl) {
      this.extInstancing = gl;
    } else {
      this.extInstancing = gl.getExtension('ANGLE_instanced_arrays');
    }

    const vert = this.compileShader(gl.VERTEX_SHADER, SAKUGA_FIRE_VERT);
    const frag = this.compileShader(gl.FRAGMENT_SHADER, SAKUGA_FIRE_FRAG);
    if (!vert || !frag) return;

    this.program = gl.createProgram();
    if (!this.program) return;

    gl.attachShader(this.program, vert);
    gl.attachShader(this.program, frag);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('SakugaFirePass link error:', gl.getProgramInfoLog(this.program));
      return;
    }

    // Uniforms
    this.uCameraLoc = gl.getUniformLocation(this.program, 'u_camera');
    this.uViewportLoc = gl.getUniformLocation(this.program, 'u_viewport');
    this.uTimeLoc = gl.getUniformLocation(this.program, 'u_time');

    // Attributes
    this.aQuadLoc = gl.getAttribLocation(this.program, 'a_quad');
    this.aWorldPosLoc = gl.getAttribLocation(this.program, 'a_worldPos');
    this.aRadiusLoc = gl.getAttribLocation(this.program, 'a_radius');
    this.aStateLoc = gl.getAttribLocation(this.program, 'a_state');
    this.aIntensityLoc = gl.getAttribLocation(this.program, 'a_intensity');
    this.aSeedLoc = gl.getAttribLocation(this.program, 'a_seed');

    // Unit billboard quad geometry [-1, 1]
    const quadVertices = new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
      -1.0,  1.0,
       1.0, -1.0,
       1.0,  1.0,
    ]);

    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    // Dynamic instance buffer
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
  }

  public resize(_w: number, _h: number, _dpr: number): void {
    // Shaders read viewport uniform directly
  }

  public render(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    camera: Camera,
    items: VFXItem[],
    timeSec: number
  ): void {
    if (!this.program || items.length === 0 || !this.extInstancing) return;

    const count = Math.min(items.length, this.maxInstances);
    let offset = 0;

    for (let i = 0; i < count; i++) {
      const item = items[i]!;
      this.instanceData[offset++] = item.x;
      this.instanceData[offset++] = item.y;
      this.instanceData[offset++] = item.radius;
      this.instanceData[offset++] = item.state;
      this.instanceData[offset++] = item.intensity;
      this.instanceData[offset++] = item.seed;
      this.instanceData[offset++] = 0;
    }

    gl.useProgram(this.program);

    // Enable Alpha Blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Set Uniforms
    gl.uniform4f(this.uCameraLoc, camera.x, camera.y, camera.zoom, camera.dpr);
    gl.uniform2f(this.uViewportLoc, camera.width, camera.height);
    gl.uniform1f(this.uTimeLoc, timeSec);

    const setDivisor = (loc: number, div: number) => {
      if (loc < 0) return;
      if ('vertexAttribDivisor' in gl) {
        (gl as WebGL2RenderingContext).vertexAttribDivisor(loc, div);
      } else if (this.extInstancing && this.extInstancing.vertexAttribDivisorANGLE) {
        this.extInstancing.vertexAttribDivisorANGLE(loc, div);
      }
    };

    const drawArrays = (mode: number, first: number, vertCount: number, primCount: number) => {
      if ('drawArraysInstanced' in gl) {
        (gl as WebGL2RenderingContext).drawArraysInstanced(mode, first, vertCount, primCount);
      } else if (this.extInstancing && this.extInstancing.drawArraysInstancedANGLE) {
        this.extInstancing.drawArraysInstancedANGLE(mode, first, vertCount, primCount);
      }
    };

    // Bind Quad Vertex Buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.aQuadLoc);
    gl.vertexAttribPointer(this.aQuadLoc, 2, gl.FLOAT, false, 0, 0);
    setDivisor(this.aQuadLoc, 0); // 0 = per-vertex

    // Bind Dynamic Instance Buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * this.floatsPerInstance));

    const stride = this.floatsPerInstance * 4; // bytes

    // a_worldPos (vec2)
    gl.enableVertexAttribArray(this.aWorldPosLoc);
    gl.vertexAttribPointer(this.aWorldPosLoc, 2, gl.FLOAT, false, stride, 0);
    setDivisor(this.aWorldPosLoc, 1);

    // a_radius (float)
    gl.enableVertexAttribArray(this.aRadiusLoc);
    gl.vertexAttribPointer(this.aRadiusLoc, 1, gl.FLOAT, false, stride, 2 * 4);
    setDivisor(this.aRadiusLoc, 1);

    // a_state (float)
    gl.enableVertexAttribArray(this.aStateLoc);
    gl.vertexAttribPointer(this.aStateLoc, 1, gl.FLOAT, false, stride, 3 * 4);
    setDivisor(this.aStateLoc, 1);

    // a_intensity (float)
    gl.enableVertexAttribArray(this.aIntensityLoc);
    gl.vertexAttribPointer(this.aIntensityLoc, 1, gl.FLOAT, false, stride, 4 * 4);
    setDivisor(this.aIntensityLoc, 1);

    // a_seed (float)
    gl.enableVertexAttribArray(this.aSeedLoc);
    gl.vertexAttribPointer(this.aSeedLoc, 1, gl.FLOAT, false, stride, 5 * 4);
    setDivisor(this.aSeedLoc, 1);

    // 1 SINGLE DRAW CALL FOR ALL HOT NODES!
    drawArrays(gl.TRIANGLES, 0, 6, count);

    // Reset divisors to prevent state leaks
    setDivisor(this.aWorldPosLoc, 0);
    setDivisor(this.aRadiusLoc, 0);
    setDivisor(this.aStateLoc, 0);
    setDivisor(this.aIntensityLoc, 0);
    setDivisor(this.aSeedLoc, 0);
  }

  public destroy(): void {
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }
    if (this.gl && this.quadBuffer) {
      this.gl.deleteBuffer(this.quadBuffer);
      this.quadBuffer = null;
    }
    if (this.gl && this.instanceBuffer) {
      this.gl.deleteBuffer(this.instanceBuffer);
      this.instanceBuffer = null;
    }
  }

  private compileShader(type: number, src: string): WebGLShader | null {
    if (!this.gl) return null;
    const shader = this.gl.createShader(type);
    if (!shader) return null;
    this.gl.shaderSource(shader, src);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('SakugaFirePass shader compile error:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
}
