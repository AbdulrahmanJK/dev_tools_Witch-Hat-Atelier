export const SAKUGA_FIRE_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;
varying float v_state;
varying float v_intensity;
varying float v_seed;
varying float v_sealNormR;

uniform float u_time;

void main() {
  float dist = length(v_uv);
  float innerR = v_sealNormR * 0.98; // Begins right at outer edge of seal
  float outerR = 0.98;

  if (dist < innerR || dist > outerR) {
    discard;
  }

  float angle = atan(v_uv.y, v_uv.x); // [-PI, PI]
  float deltaR = (dist - innerR) / (outerR - innerR); // 0.0 (inner) to 1.0 (outer)

  // ═══════════ OPTION V: DELICATE HAIRLINE SMOLDERING EMBERS FOR DIMMED NODES ═══════════
  if (v_state > 2.5) {
    // Hairline trace right along the perimeter (strictly max 22% thickness)
    if (deltaR > 0.22) {
      discard;
    }

    float emberAngle = angle - u_time * 0.7 - v_seed;
    // Delicate runic dash frequency
    float dash = sin(emberAngle * 22.0);
    float spark = sin(emberAngle * 44.0 - u_time * 5.0);

    if (dash < -0.15) {
      discard;
    }

    vec3 cEmberRed = vec3(0.82, 0.20, 0.06);
    vec3 cEmberGold = vec3(0.98, 0.72, 0.22);
    vec3 emberColor = mix(cEmberRed, cEmberGold, clamp(spark * 0.5 + 0.5, 0.0, 1.0));

    // Subtle 20% opacity matching the rest of the dimmed diagram
    float emberAlpha = 0.22 * (1.0 - deltaR / 0.22);
    gl_FragColor = vec4(emberColor, emberAlpha);
    return;
  }

  // ═══════════ TIER 1 & TIER 2: AUTHENTIC TWIN SAKUGA FIRE CRESCENTS ═══════════
  float isWarm = (v_state < 1.5) ? 1.0 : 0.0;
  float isFissure = (v_intensity > 0.8) ? 1.0 : 0.0;

  // Clockwise vortex rotation with speed depending on state
  float rotSpeed = isWarm > 0.5 ? 1.3 : (isFissure > 0.5 ? 2.5 : 1.9);
  float psi = angle - u_time * rotSpeed - v_seed * 0.73 - deltaR * 1.5;

  // Authentic Dual-Crescent Slashes with natural open gaps between them (NO continuous donut!)
  float w1 = max(0.0, sin(psi - 0.2));
  float w2 = max(0.0, sin(psi + 3.14159 * 0.94)) * 0.80;

  // Sharp power curves: needle-thin tail and head, thick surging mid-body
  float c1 = pow(w1, 0.78);
  float c2 = pow(w2, 1.15);
  float crescent = max(c1, c2);

  // If outside the crescent sweeps, keep the space completely open and clear!
  if (crescent < 0.035) {
    discard;
  }

  // Jagged anime flickers and licking tongues along the outer rim
  float wave = sin(psi * 7.0) * 0.16 + sin(psi * 15.0 - u_time * 5.5) * 0.10 + sin(psi * 23.0 + u_time * 8.0) * 0.05;
  float maxReach = crescent * 0.94 + wave * crescent;

  if (deltaR > maxReach) {
    discard;
  }

  float norm = deltaR / max(0.01, maxReach);

  // Negative Space Flame Tears (elongated cutout gaps in the dense body like the reference illustration)
  float tear = sin(psi * 4.2) * cos(deltaR * 8.0);
  if (crescent > 0.50 && deltaR > 0.18 && deltaR < 0.65 && tear > 0.66 && isWarm < 0.5) {
    discard;
  }

  // Anime Cell Shaded Color Palette matching the reference image:
  // Outer Edge: Deep anime ink outline / crimson (#8a1105 -> #cf220e)
  // Mid Body: Radiant fire orange (#fa6419)
  // Inner Ridge: Glowing golden plasma (#ffd666)
  // Core Spine: White-hot liquid highlight (#ffffff)
  vec3 cCrimson = vec3(0.54, 0.07, 0.02);
  vec3 cScarlet = vec3(0.88, 0.16, 0.06);
  vec3 cOrange  = vec3(0.98, 0.42, 0.10);
  vec3 cGold    = vec3(1.00, 0.84, 0.38);
  vec3 cWhite   = vec3(1.00, 0.98, 0.92);

  vec3 color;
  float alpha = 1.0;

  if (isWarm > 0.5) {
    // Warm Tier 1: Soft breathing golden-amber vortex
    vec3 cWarmGold = vec3(0.98, 0.75, 0.22);
    vec3 cWarmAmber = vec3(0.85, 0.45, 0.08);
    color = mix(cWarmGold, cWarmAmber, norm);
    alpha = (1.0 - smoothstep(0.75, 1.0, norm)) * 0.85;
  } else {
    // Overcharged / Fissure Tier 2: Full Anime Sakuga Fire Slashes
    if (norm > 0.82) {
      color = mix(cScarlet, cCrimson, (norm - 0.82) / 0.18);
    } else if (norm > 0.48) {
      color = mix(cOrange, cScarlet, (norm - 0.48) / 0.34);
    } else if (norm > 0.18) {
      color = mix(cGold, cOrange, (norm - 0.18) / 0.30);
    } else {
      // White-hot core spine along the inner crescent ridge
      color = mix(cWhite, cGold, norm / 0.18);
    }

    // White spine highlight running down the center of the crescent
    float spineDist = abs(norm - 0.32);
    if (spineDist < 0.12 && crescent > 0.30) {
      float spineIntensity = (1.0 - spineDist / 0.12) * crescent;
      color = mix(color, cWhite, spineIntensity * 0.95);
    }

    // Razor-sharp anime outline anti-aliasing
    alpha = 1.0 - smoothstep(0.96, 1.0, norm);
  }

  gl_FragColor = vec4(color, alpha);
}
`;
