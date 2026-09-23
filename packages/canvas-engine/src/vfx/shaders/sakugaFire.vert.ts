export const SAKUGA_FIRE_VERT = `
precision highp float;

attribute vec2 a_quad;       // Quad corner: (-1,-1) to (1,1)
attribute vec2 a_worldPos;   // World X, Y of seal center
attribute float a_radius;    // Seal base radius in world units
attribute float a_state;     // 1.0 = warm, 2.0 = overcharged / fissure, 3.0 = smoldering embers
attribute float a_intensity; // 0.0 to 1.0
attribute float a_seed;      // 0.0 to 100.0

uniform vec4 u_camera;       // cam.x, cam.y, cam.zoom, cam.dpr
uniform vec2 u_viewport;     // width, height in CSS pixels

varying vec2 v_uv;           // Local quad coordinate [-1.0, 1.0]
varying float v_state;
varying float v_intensity;
varying float v_seed;
varying float v_sealNormR;    // Normalized radius of the seal inside the quad

void main() {
  v_uv = a_quad;
  v_state = a_state;
  v_intensity = a_intensity;
  v_seed = a_seed;

  float zoom = u_camera.z;
  vec2 camPos = u_camera.xy;

  // Tightly compact flame envelope: 28-30% for full fire, 12% for smoldering embers
  float reachMultiplier = (a_state > 2.5) ? 1.14 : 1.29;
  float quadWorldRadius = a_radius * reachMultiplier;
  v_sealNormR = 1.0 / reachMultiplier;

  vec2 worldVertex = a_worldPos + a_quad * quadWorldRadius;

  // World to screen CSS pixels
  vec2 screenPos = (worldVertex - camPos) * zoom + u_viewport * 0.5;

  // Screen CSS pixels to WebGL NDC [-1, 1]
  vec2 ndc = vec2(
    (screenPos.x / u_viewport.x) * 2.0 - 1.0,
    1.0 - (screenPos.y / u_viewport.y) * 2.0
  );

  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;
