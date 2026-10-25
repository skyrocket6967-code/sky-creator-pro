'use strict';
// Aurelia Strike renderer: instanced meshes, linear lighting with a baked sun shadow map,
// ground ambient occlusion, sky, point lights, particles and a bloom/FXAA post stack.
window.StrikeRenderer = (() => {
  const canvas = document.getElementById('world');
  const ctxOptions = { alpha: false, antialias: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false };
  let gl = null, gl2 = false;
  try {
    gl = canvas.getContext('webgl2', ctxOptions);
    gl2 = !!gl && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  } catch (e) { gl = null; }
  if (!gl) gl = canvas.getContext('webgl', ctxOptions) || canvas.getContext('experimental-webgl', ctxOptions);
  if (!gl) throw Error('WebGL unavailable');

  const angle = gl2 ? null : gl.getExtension('ANGLE_instanced_arrays');
  const instancing = gl2 || !!angle;
  const divisor = (l, d) => gl2 ? gl.vertexAttribDivisor(l, d) : angle && angle.vertexAttribDivisorANGLE(l, d);
  const drawInstanced = (mode, count, n) => gl2 ? gl.drawArraysInstanced(mode, 0, count, n) : angle.drawArraysInstancedANGLE(mode, 0, count, n);
  const depthTextures = gl2 || !!gl.getExtension('WEBGL_depth_texture');

  // ------------------------------------------------------------------ colors & math
  const colorCache = new Map();
  /** Hex sRGB -> linear RGB triple (cached). */
  function rgb(hex) {
    let c = colorCache.get(hex);
    if (c) return c;
    const s = v => Math.pow(parseInt(hex.slice(v, v + 2), 16) / 255, 2.2);
    c = [s(0), s(2), s(4)];
    colorCache.set(hex, c);
    return c;
  }
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function mul(a, b, o = new Float32Array(16)) {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }
  function perspective(fov, aspect, n, f, o = new Float32Array(16)) {
    const t = 1 / Math.tan(fov / 2);
    o.fill(0); o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
    return o;
  }
  function ortho(l, r, b, t, n, f, o = new Float32Array(16)) {
    o.fill(0); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
    return o;
  }
  function lookBasis(f) {
    const z = [-f[0], -f[1], -f[2]];
    const x = unit(cross(Math.abs(z[1]) > .99 ? [0, 0, 1] : [0, 1, 0], z));
    const y = cross(z, x);
    return [x, y, z];
  }
  function viewMatrix(eye, yaw, pitch, roll = 0, o = new Float32Array(16)) {
    const f = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    let [x, y, z] = lookBasis(f);
    if (roll) {
      const c = Math.cos(roll), s = Math.sin(roll);
      const nx = [x[0] * c + y[0] * s, x[1] * c + y[1] * s, x[2] * c + y[2] * s];
      y = [y[0] * c - x[0] * s, y[1] * c - x[1] * s, y[2] * c - x[2] * s];
      x = nx;
    }
    o.set([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
    return o;
  }
  function invert(m, o = new Float32Array(16)) {
    const a = m, inv = o;
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    det = det ? 1 / det : 0;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  }

  /** Affine transform stack (3x4 row-major), used to build hierarchical models. */
  class Stack {
    constructor() { this.m = []; for (let i = 0; i < 24; i++) this.m.push(new Float32Array(12)); this.i = 0; this.reset(); }
    get top() { return this.m[this.i]; }
    reset() { this.i = 0; this.m[0].set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]); return this; }
    push() { this.m[this.i + 1].set(this.m[this.i]); this.i++; return this; }
    pop() { this.i--; return this; }
    translate(x, y, z) {
      const m = this.top;
      m[3] += m[0] * x + m[1] * y + m[2] * z; m[7] += m[4] * x + m[5] * y + m[6] * z; m[11] += m[8] * x + m[9] * y + m[10] * z;
      return this;
    }
    rotY(a) {
      if (!a) return this;
      const m = this.top, c = Math.cos(a), s = Math.sin(a);
      for (let r = 0; r < 12; r += 4) { const c0 = m[r], c2 = m[r + 2]; m[r] = c * c0 - s * c2; m[r + 2] = s * c0 + c * c2; }
      return this;
    }
    rotX(a) {
      if (!a) return this;
      const m = this.top, c = Math.cos(a), s = Math.sin(a);
      for (let r = 0; r < 12; r += 4) { const c1 = m[r + 1], c2 = m[r + 2]; m[r + 1] = c * c1 + s * c2; m[r + 2] = -s * c1 + c * c2; }
      return this;
    }
    rotZ(a) {
      if (!a) return this;
      const m = this.top, c = Math.cos(a), s = Math.sin(a);
      for (let r = 0; r < 12; r += 4) { const c0 = m[r], c1 = m[r + 1]; m[r] = c * c0 + s * c1; m[r + 1] = -s * c0 + c * c1; }
      return this;
    }
    scale(x, y = x, z = x) {
      const m = this.top;
      for (let r = 0; r < 12; r += 4) { m[r] *= x; m[r + 1] *= y; m[r + 2] *= z; }
      return this;
    }
  }

  // ------------------------------------------------------------------ shaders
  const PRECISION = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';

  const SCENE_VS = `
attribute vec3 p; attribute vec3 n;
attribute vec4 r0; attribute vec4 r1; attribute vec4 r2; attribute vec4 col; attribute vec4 mat;
uniform mat4 vp; uniform mat4 shadowVP;
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal; varying vec3 vLN; varying vec3 vScale;
varying vec4 vCol; varying vec4 vMat; varying vec3 vShadow;
void main(){
  vec4 lp = vec4(p, 1.0);
  vec3 w = vec3(dot(r0, lp), dot(r1, lp), dot(r2, lp));
  vec3 c0 = vec3(r0.x, r1.x, r2.x), c1 = vec3(r0.y, r1.y, r2.y), c2 = vec3(r0.z, r1.z, r2.z);
  vec3 sc = vec3(length(c0), length(c1), length(c2));
  vec3 ns = n / max(sc * sc, vec3(1e-6));
  vNormal = c0 * ns.x + c1 * ns.y + c2 * ns.z;
  vScale = sc; vLocal = p; vLN = n; vWorld = w; vCol = col; vMat = mat;
  vec4 s = shadowVP * vec4(w, 1.0);
  vShadow = s.xyz * 0.5 + 0.5;
  gl_Position = vp * vec4(w, 1.0);
}`;

  const SCENE_FS = `
uniform vec3 eye; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 skyCol; uniform vec3 groundCol; uniform vec3 upDir;
uniform vec3 fogCol; uniform float fogDensity; uniform float exposure; uniform float time; uniform float shadowOn;
uniform sampler2D noiseTex; uniform sampler2D aoTex; uniform sampler2D shadowTex; uniform vec4 aoRect; uniform float shadowTexel;
uniform vec4 lightPos[LIGHTS]; uniform vec4 lightCol[LIGHTS]; uniform vec3 flashCol;
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal; varying vec3 vLN; varying vec3 vScale;
varying vec4 vCol; varying vec4 vMat; varying vec3 vShadow;

float noise(vec2 uv){ return texture2D(noiseTex, uv).r; }
float shadowAt(vec2 uv, float z){ return step(z, texture2D(shadowTex, uv).r); }
float sunShadow(float ndl){
#ifdef SHADOWS
  if (shadowOn < 0.5) return 1.0;
  vec3 s = vShadow;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return 1.0;
  float z = s.z - (0.0008 + 0.0022 * (1.0 - ndl));
  float t = shadowTexel;
  float sum = shadowAt(s.xy + vec2(-0.6, -0.6) * t, z) + shadowAt(s.xy + vec2(0.6, -0.6) * t, z)
            + shadowAt(s.xy + vec2(-0.6, 0.6) * t, z) + shadowAt(s.xy + vec2(0.6, 0.6) * t, z);
#ifdef SOFT_SHADOWS
  sum += shadowAt(s.xy + vec2(-1.6, 0.2) * t, z) + shadowAt(s.xy + vec2(1.6, -0.2) * t, z)
       + shadowAt(s.xy + vec2(0.2, 1.6) * t, z) + shadowAt(s.xy + vec2(-0.2, -1.6) * t, z);
  return sum / 8.0;
#else
  return sum / 4.0;
#endif
#else
  return 1.0;
#endif
}
vec3 aces(vec3 x){ return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

void main(){
  vec3 base = vCol.rgb;
  float rough = vCol.a, glow = vMat.x, mode = vMat.y, bevelW = vMat.z, metal = vMat.w;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(eye - vWorld);
  float dist = length(eye - vWorld);
  vec3 wsz = vLocal * vScale;            // local position in meters
  vec2 uvTri = abs(N.y) > 0.6 ? vWorld.xz : vec2(vWorld.x + vWorld.z, vWorld.y);

  // Emissive and unlit surfaces.
  if (mode > 2.5 && mode < 3.5) {
    vec3 e = base * (1.0 + glow);
    float fog = 1.0 - exp(-dist * fogDensity * 0.6);
    gl_FragColor = vec4(sqrt(aces(mix(e, fogCol, fog) * exposure)), 1.0);
    return;
  }

  float grain = noise(uvTri * 0.31) * 0.6 + noise(uvTri * 1.7) * 0.4;
  float seam = 0.0;
  // Bevelled edges on boxes: brighter rim where two faces meet.
  float edge = 1.0;
  if (bevelW > 0.0) {
    vec3 d = (0.5 - abs(vLocal)) * vScale;
    vec3 an = abs(vLN);
    float e = 1e3;
    if (an.x < 0.5) e = min(e, d.x);
    if (an.y < 0.5) e = min(e, d.y);
    if (an.z < 0.5) e = min(e, d.z);
    edge = smoothstep(0.0, bevelW, e);
  }

  if (mode > 0.5 && mode < 1.5) {          // concrete / wall panels
    vec2 g = abs(N.y) > 0.6 ? wsz.xz : vec2(wsz.x + wsz.z, wsz.y);
    vec2 f = abs(fract(g / vec2(2.0, 1.5)) - 0.5);
    seam = 1.0 - smoothstep(0.476, 0.49, max(f.x, f.y));
    base *= 0.82 + grain * 0.32;
    base *= mix(0.72, 1.0, seam);
  } else if (mode > 1.5 && mode < 2.5) {   // floor tiles
    vec2 f = abs(fract(vWorld.xz * 0.5) - 0.5);
    float line = smoothstep(0.485, 0.497, max(f.x, f.y));
    float tileVar = noise(floor(vWorld.xz * 0.5) * 0.37) * 0.16;
    base *= (0.78 + grain * 0.34 + tileVar) * (1.0 - line * 0.35);
    float wet = smoothstep(0.55, 0.75, noise(vWorld.xz * 0.045));
    rough = mix(rough, 0.18, wet * 0.8);
    base *= 1.0 - wet * 0.25;
  } else if (mode > 3.5 && mode < 4.5) {   // armour plates
    base *= 0.9 + grain * 0.2;
  } else if (mode > 4.5 && mode < 5.5) {   // visor / glass
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 refl = mix(groundCol, skyCol * 1.6, clamp(reflect(-V, N).y * 0.5 + 0.5, 0.0, 1.0));
    vec3 c = base * 0.25 + refl * (0.12 + fres * 0.8) + base * glow;
    float fog = 1.0 - exp(-dist * fogDensity);
    gl_FragColor = vec4(sqrt(aces(mix(c, fogCol, fog) * exposure)), 1.0);
    return;
  } else if (mode > 5.5 && mode < 6.5) {   // distant towers with lit windows
    vec2 g = vec2((wsz.x + wsz.z) * 0.9, wsz.y * 0.75);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.75);
    float lit = step(0.62, noise(cell * 0.123 + floor(vLocal.xz * 3.0) * 0.31));
    vec3 c = base * (0.55 + grain * 0.2) * (skyCol * 0.6 + groundCol * 0.4) + vec3(1.0, 0.72, 0.42) * win * lit * 1.6 * step(abs(N.y), 0.5);
    float fog = 1.0 - exp(-dist * fogDensity * 0.55);
    gl_FragColor = vec4(sqrt(aces(mix(c, fogCol, fog) * exposure)), 1.0);
    return;
  } else if (mode > 6.5 && mode < 7.5) {   // corrugated container walls
    float along = abs(N.x) > 0.5 ? wsz.z : wsz.x;
    if (abs(N.y) < 0.5) {
      float rib = sin(along * 18.0);
      N = normalize(N + (abs(N.x) > 0.5 ? vec3(0.0, 0.0, rib * 0.35) : vec3(rib * 0.35, 0.0, 0.0)));
    }
    float rust = smoothstep(0.55, 0.85, noise(uvTri * 0.6 + 3.0));
    base = mix(base * (0.85 + grain * 0.25), vec3(0.28, 0.12, 0.05), rust * 0.45);
  } else if (mode > 7.5 && mode < 8.5) {   // hazard stripes
    float s = step(0.5, fract((wsz.x + wsz.y + wsz.z) * 2.2));
    base = mix(vec3(0.02), vec3(0.85, 0.55, 0.05), s) * (0.85 + grain * 0.2);
  } else {
    base *= 0.92 + grain * 0.14;
  }

  // Ground occlusion texture: darker near walls and at the base of cover.
  vec2 aoUV = (vWorld.xz - aoRect.xy) / aoRect.zw;
  float ao = 1.0;
  if (aoUV.x > 0.0 && aoUV.x < 1.0 && aoUV.y > 0.0 && aoUV.y < 1.0) {
    float a = texture2D(aoTex, aoUV).r;
    ao = mix(a, 1.0, smoothstep(0.0, 1.4, vWorld.y));
  }
  ao *= mix(0.55, 1.0, edge * 0.5 + 0.5);

  float ndl = max(dot(N, sunDir), 0.0);
  float sh = sunShadow(ndl);
  vec3 H = normalize(sunDir + V);
  float shin = exp2(10.0 * (1.0 - rough) + 1.0);
  float spec = pow(max(dot(N, H), 0.0), shin) * (shin + 8.0) / 40.0;
  vec3 F0 = mix(vec3(0.04), base, metal);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 F = F0 + (1.0 - F0) * fres * (1.0 - rough) * 0.6;
  vec3 diff = base * (1.0 - metal * 0.85);

  float hemi = dot(N, upDir) * 0.5 + 0.5;
  vec3 ambient = mix(groundCol, skyCol, hemi) * ao;
  vec3 color = diff * ambient + (diff + F * spec) * sunCol * ndl * sh;
  color += F * mix(groundCol, skyCol, clamp(reflect(-V, N).y * 0.5 + 0.5, 0.0, 1.0)) * ao * (1.0 - rough) * 0.5;

  for (int i = 0; i < LIGHTS; i++) {
    vec3 L = lightPos[i].xyz - vWorld;
    float d = length(L);
    float att = clamp(1.0 - d / max(lightPos[i].w, 0.001), 0.0, 1.0);
    att *= att;
    L /= max(d, 0.0001);
    float nl = max(dot(N, L), 0.0);
    float sp = pow(max(dot(N, normalize(L + V)), 0.0), shin) * (shin + 8.0) / 40.0;
    color += (diff + F * sp) * lightCol[i].rgb * lightCol[i].a * nl * att;
  }
  color += diff * flashCol;

  // Bevel catch-light and seams.
  color += (1.0 - edge) * (diff * (sunCol * 0.3 * sh + ambient * 0.7) + F0 * sunCol * 0.25 * sh) * (1.0 - rough * 0.4);
  color += base * glow;

  // Distance fog with sun-tinted in-scattering.
  float fog = 1.0 - exp(-dist * fogDensity);
  float heightFog = exp(-max(vWorld.y, 0.0) * 0.12);
  fog *= mix(0.65, 1.0, heightFog);
  vec3 fc = fogCol + sunCol * 0.18 * pow(max(dot(-V, sunDir), 0.0), 6.0);
  color = mix(color, fc, fog);
  gl_FragColor = vec4(sqrt(aces(color * exposure)), 1.0);
}`;

  const DEPTH_VS = `
attribute vec3 p; attribute vec4 r0; attribute vec4 r1; attribute vec4 r2;
uniform mat4 vp;
void main(){ vec4 lp = vec4(p, 1.0); gl_Position = vp * vec4(dot(r0, lp), dot(r1, lp), dot(r2, lp), 1.0); }`;
  const DEPTH_FS = `void main(){ gl_FragColor = vec4(1.0); }`;

  const QUAD_VS = `attribute vec2 q; varying vec2 uv; void main(){ uv = q * 0.5 + 0.5; gl_Position = vec4(q, 0.0, 1.0); }`;
  const SKY_VS = `attribute vec2 q; uniform mat4 invVP; varying vec3 ray;
void main(){ vec4 far = invVP * vec4(q, 1.0, 1.0); vec4 near = invVP * vec4(q, -1.0, 1.0); ray = far.xyz / far.w - near.xyz / near.w; gl_Position = vec4(q, 0.99999, 1.0); }`;
  const SKY_FS = `
uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 zenith; uniform vec3 horizon; uniform vec3 fogCol; uniform float exposure; uniform float time; uniform sampler2D noiseTex;
varying vec3 ray;
vec3 aces(vec3 x){ return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  vec3 d = normalize(ray);
  float h = d.y;
  vec3 c = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.45));
  c = mix(c, fogCol, smoothstep(0.08, -0.05, h));
  float sd = max(dot(d, sunDir), 0.0);
  c += sunCol * (pow(sd, 900.0) * 30.0 + pow(sd, 24.0) * 0.45 + pow(sd, 4.0) * 0.18);
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12);
    float n = texture2D(noiseTex, uv * 0.045 + vec2(time * 0.002, 0.0)).r * 0.6 + texture2D(noiseTex, uv * 0.13 - vec2(time * 0.003, 0.0)).r * 0.4;
    float cloud = smoothstep(0.52, 0.85, n) * smoothstep(0.0, 0.25, h);
    vec3 cc = mix(horizon * 1.25, sunCol * 0.9, pow(sd, 3.0)) + vec3(0.05);
    c = mix(c, cc, cloud * 0.65);
  }
  gl_FragColor = vec4(sqrt(aces(c * exposure)), 1.0);
}`;

  const PARTICLE_VS = `
attribute vec2 q; attribute vec4 pp; attribute vec4 pc; attribute vec4 pd;
uniform mat4 vp; uniform vec3 camRight; uniform vec3 camUp; uniform vec3 eye;
varying vec2 uv; varying vec4 col; varying float kind;
void main(){
  uv = q; col = pc; kind = pd.w;
  vec3 pos = pp.xyz; float size = pp.w; vec3 world;
  if (kind > 3.5 && kind < 4.5) {
    world = pos + vec3(q.x * size, 0.0, q.y * size);
  } else if (dot(pd.xyz, pd.xyz) > 1e-6) {
    vec3 side = normalize(cross(pd.xyz, eye - pos)) * size;
    world = pos + pd.xyz * (q.y * 0.5) + side * q.x;
  } else {
    world = pos + (camRight * q.x + camUp * q.y) * size;
  }
  gl_Position = vp * vec4(world, 1.0);
}`;
  const PARTICLE_FS = `
uniform float additive; uniform sampler2D noiseTex;
varying vec2 uv; varying vec4 col; varying float kind;
void main(){
  float r2 = dot(uv, uv);
  float a;
  if (kind < 0.5) a = pow(max(1.0 - r2, 0.0), 2.0);
  else if (kind < 1.5) a = (1.0 - uv.x * uv.x) * (1.0 - smoothstep(0.4, 1.0, abs(uv.y)));
  else if (kind < 2.5) a = pow(max(1.0 - r2, 0.0), 1.5) * (0.55 + 0.45 * texture2D(noiseTex, uv * 0.35 + col.rg).r);
  else if (kind < 3.5) { float ang = atan(uv.y, uv.x); a = pow(max(1.0 - r2, 0.0), 3.0) + pow(max(1.0 - sqrt(r2), 0.0), 2.0) * pow(abs(cos(ang * 3.0)), 18.0); }
  else if (kind < 4.5) a = pow(max(1.0 - r2, 0.0), 1.6);
  else a = smoothstep(0.12, 0.0, abs(sqrt(r2) - 0.82));
  a = clamp(a, 0.0, 1.0);
  if (additive > 0.5) gl_FragColor = vec4(col.rgb * a * col.a, 1.0);
  else gl_FragColor = vec4(col.rgb, col.a * a);
}`;

  const BRIGHT_FS = `
uniform sampler2D tex; uniform vec2 texel; uniform float threshold; varying vec2 uv;
void main(){
  vec3 c = texture2D(tex, uv + vec2(-1.0, -1.0) * texel).rgb + texture2D(tex, uv + vec2(1.0, -1.0) * texel).rgb
         + texture2D(tex, uv + vec2(-1.0, 1.0) * texel).rgb + texture2D(tex, uv + vec2(1.0, 1.0) * texel).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = clamp((l - threshold) / (1.0 - threshold), 0.0, 1.0);
  gl_FragColor = vec4(c * k * k, 1.0);
}`;
  const BLUR_FS = `
uniform sampler2D tex; uniform vec2 dir; varying vec2 uv;
void main(){
  vec3 c = texture2D(tex, uv).rgb * 0.2270270270;
  c += (texture2D(tex, uv + dir * 1.3846153846).rgb + texture2D(tex, uv - dir * 1.3846153846).rgb) * 0.3162162162;
  c += (texture2D(tex, uv + dir * 3.2307692308).rgb + texture2D(tex, uv - dir * 3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;
  const COMPOSITE_FS = `
uniform sampler2D scene; uniform sampler2D bloom; uniform vec2 texel; uniform float bloomStrength; uniform float fxaa;
uniform float vignette; uniform float damage; uniform float aberration; uniform float time; uniform float saturation; uniform float contrast;
varying vec2 uv;
vec3 sceneAA(vec2 p){
  vec3 m = texture2D(scene, p).rgb;
  if (fxaa < 0.5) return m;
  vec3 L = vec3(0.299, 0.587, 0.114);
  vec3 nw = texture2D(scene, p + vec2(-1.0, -1.0) * texel).rgb, ne = texture2D(scene, p + vec2(1.0, -1.0) * texel).rgb;
  vec3 sw = texture2D(scene, p + vec2(-1.0, 1.0) * texel).rgb, se = texture2D(scene, p + vec2(1.0, 1.0) * texel).rgb;
  float lnw = dot(nw, L), lne = dot(ne, L), lsw = dot(sw, L), lse = dot(se, L), lm = dot(m, L);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  if (lmax - lmin < max(0.0312, lmax * 0.125)) return m;
  vec2 d = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
  d = clamp(d / (min(abs(d.x), abs(d.y)) + red), -8.0, 8.0) * texel;
  vec3 a = 0.5 * (texture2D(scene, p + d * (-1.0 / 6.0)).rgb + texture2D(scene, p + d * (1.0 / 6.0)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(scene, p - d * 0.5).rgb + texture2D(scene, p + d * 0.5).rgb);
  float lb = dot(b, L);
  return (lb < lmin || lb > lmax) ? a : b;
}
void main(){
  vec2 c = uv - 0.5;
  vec3 col;
  if (aberration > 0.001) {
    vec2 o = c * aberration * 0.02;
    col = vec3(texture2D(scene, uv + o).r, sceneAA(uv).g, texture2D(scene, uv - o).b);
  } else col = sceneAA(uv);
  col += texture2D(bloom, uv).rgb * bloomStrength;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, saturation);
  col = (col - 0.5) * contrast + 0.5;
  float v = 1.0 - dot(c, c) * vignette;
  col *= v;
  col = mix(col, vec3(0.75, 0.05, 0.03), damage * (0.25 + 0.75 * smoothstep(0.15, 0.7, length(c))));
  float g = fract(sin(dot(uv * 431.0 + time, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
}`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs, defines = '', attribs = [], uniforms = []) {
    const head = defines;
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, head + vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, PRECISION + head + fs));
    if (attribs.length) gl.bindAttribLocation(p, 0, attribs[0]);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error('Program: ' + gl.getProgramInfoLog(p));
    const loc = { program: p };
    for (const a of attribs) loc[a] = gl.getAttribLocation(p, a);
    for (const u of uniforms) loc[u] = gl.getUniformLocation(p, u);
    return loc;
  }

  // ------------------------------------------------------------------ meshes
  function buffer(data) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return b;
  }
  function cubeMesh() {
    const d = [];
    const faces = [
      [[0, 0, 1], [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]]],
      [[0, 0, -1], [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]]],
      [[1, 0, 0], [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]]],
      [[-1, 0, 0], [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]]],
      [[0, 1, 0], [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]]],
      [[0, -1, 0], [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]]]];
    for (const [n, v] of faces) for (const i of [0, 1, 2, 0, 2, 3]) d.push(...v[i], ...n);
    return d;
  }
  function cylinderMesh(seg = 14) {
    const d = [];
    for (let i = 0; i < seg; i++) {
      const a = i / seg * Math.PI * 2, b = (i + 1) / seg * Math.PI * 2;
      const ca = Math.cos(a) * .5, sa = Math.sin(a) * .5, cb = Math.cos(b) * .5, sb = Math.sin(b) * .5;
      const na = [Math.cos(a), 0, Math.sin(a)], nb = [Math.cos(b), 0, Math.sin(b)];
      d.push(ca, -.5, sa, ...na, cb, .5, sb, ...nb, cb, -.5, sb, ...nb);
      d.push(ca, -.5, sa, ...na, ca, .5, sa, ...na, cb, .5, sb, ...nb);
      d.push(0, .5, 0, 0, 1, 0, cb, .5, sb, 0, 1, 0, ca, .5, sa, 0, 1, 0);
      d.push(0, -.5, 0, 0, -1, 0, ca, -.5, sa, 0, -1, 0, cb, -.5, sb, 0, -1, 0);
    }
    return d;
  }
  function sphereMesh(slices = 14, stacks = 9) {
    const d = [];
    const pt = (i, j) => {
      const a = i / slices * Math.PI * 2, b = j / stacks * Math.PI;
      const n = [Math.cos(a) * Math.sin(b), Math.cos(b), Math.sin(a) * Math.sin(b)];
      return [n[0] * .5, n[1] * .5, n[2] * .5, ...n];
    };
    for (let j = 0; j < stacks; j++) for (let i = 0; i < slices; i++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), e = pt(i, j + 1);
      d.push(...a, ...c, ...b, ...a, ...e, ...c);
    }
    return d;
  }
  const MESH = { CUBE: 0, CYL: 1, BALL: 2 };
  const meshes = [cubeMesh(), cylinderMesh(), sphereMesh()].map(d => ({ buffer: buffer(d), count: d.length / 6 }));
  const quad = buffer([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
  const tri = buffer([-1, -1, 3, -1, -1, 3]);

  // ------------------------------------------------------------------ textures
  function makeTexture(w, h, data, format, filter, wrap) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }
  // Smooth tileable value noise.
  const NS = 128;
  const noiseData = new Uint8Array(NS * NS);
  {
    let seed = 3917;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const lattice = new Float32Array(32 * 32).map(() => rnd());
    const fine = new Float32Array(NS * NS).map(() => rnd());
    for (let y = 0; y < NS; y++) for (let x = 0; x < NS; x++) {
      const fx = x / NS * 32, fy = y / NS * 32, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const s = t => t * t * (3 - 2 * t);
      const L = (i, j) => lattice[((j & 31) * 32) + (i & 31)];
      const a = L(ix, iy) + (L(ix + 1, iy) - L(ix, iy)) * s(tx), b = L(ix, iy + 1) + (L(ix + 1, iy + 1) - L(ix, iy + 1)) * s(tx);
      noiseData[y * NS + x] = Math.round(((a + (b - a) * s(ty)) * .75 + fine[y * NS + x] * .25) * 255);
    }
  }
  const noiseTex = makeTexture(NS, NS, noiseData, gl.LUMINANCE, gl.LINEAR, gl.REPEAT);
  let aoTex = makeTexture(1, 1, new Uint8Array([255]), gl.LUMINANCE, gl.LINEAR, gl.CLAMP_TO_EDGE);
  let aoRect = [-32, -40, 64, 80];

  // ------------------------------------------------------------------ batches
  const FLOATS = 20;
  const instanceLocs = ['r0', 'r1', 'r2', 'col', 'mat'];
  class Batch {
    constructor(isStatic = false) {
      this.isStatic = isStatic;
      this.lists = meshes.map(() => ({ data: new Float32Array(FLOATS * 256), n: 0, buf: gl.createBuffer(), uploaded: false }));
    }
    clear() { for (const l of this.lists) { l.n = 0; l.uploaded = false; } }
    get count() { let n = 0; for (const l of this.lists) n += l.n; return n; }
    slot(mesh) {
      const l = this.lists[mesh];
      if ((l.n + 1) * FLOATS > l.data.length) { const g = new Float32Array(l.data.length * 2); g.set(l.data); l.data = g; }
      l.uploaded = false;
      return l;
    }
    /** Adds a mesh with transform = stack top * translate(x,y,z) * scale(sx,sy,sz). */
    part(mesh, st, x, y, z, sx, sy, sz, c, rough = .5, metal = 0, glow = 0, mode = 0) {
      const l = this.slot(mesh), d = l.data, o = l.n * FLOATS, m = st.top;
      d[o] = m[0] * sx; d[o + 1] = m[1] * sy; d[o + 2] = m[2] * sz; d[o + 3] = m[0] * x + m[1] * y + m[2] * z + m[3];
      d[o + 4] = m[4] * sx; d[o + 5] = m[5] * sy; d[o + 6] = m[6] * sz; d[o + 7] = m[4] * x + m[5] * y + m[6] * z + m[7];
      d[o + 8] = m[8] * sx; d[o + 9] = m[9] * sy; d[o + 10] = m[10] * sz; d[o + 11] = m[8] * x + m[9] * y + m[10] * z + m[11];
      d[o + 12] = c[0]; d[o + 13] = c[1]; d[o + 14] = c[2]; d[o + 15] = rough;
      d[o + 16] = glow; d[o + 17] = mode; d[o + 18] = mesh === MESH.CUBE ? Math.min(.035, Math.min(sx, sy, sz) * .12) : 0; d[o + 19] = metal;
      l.n++;
    }
    /** Box with Euler rotation (yaw ry, pitch rx, roll rz) in world space. */
    add(mesh, x, y, z, sx, sy, sz, c, rough = .5, metal = 0, glow = 0, mode = 0, rx = 0, ry = 0, rz = 0) {
      tmp.reset().translate(x, y, z).rotY(ry).rotX(rx).rotZ(rz);
      this.part(mesh, tmp, 0, 0, 0, sx, sy, sz, c, rough, metal, glow, mode);
    }
    /** Cylinder between two points. */
    beam(a, b, radius, c, rough = .5, metal = 0, glow = 0, mode = 0) {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) || 1e-4;
      tmp.reset().translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2).rotY(Math.atan2(dx, dz)).rotX(Math.acos(Math.max(-1, Math.min(1, dy / len))));
      this.part(MESH.CYL, tmp, 0, 0, 0, radius * 2, len, radius * 2, c, rough, metal, glow, mode);
    }
  }
  const tmp = new Stack();

  class Particles {
    constructor(cap = 1024) { this.data = new Float32Array(cap * 12); this.n = 0; this.cap = cap; this.buf = gl.createBuffer(); }
    clear() { this.n = 0; }
    add(x, y, z, size, r, g, b, a, kind = 0, dx = 0, dy = 0, dz = 0) {
      if (this.n >= this.cap) return;
      const o = this.n++ * 12, d = this.data;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size; d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a;
      d[o + 8] = dx; d[o + 9] = dy; d[o + 10] = dz; d[o + 11] = kind;
    }
  }

  // ------------------------------------------------------------------ settings & programs
  const PRESETS = {
    performance: { renderScale: .62, shadows: false, bloom: false, fxaa: false, lights: 2, softShadows: false, shadowSize: 1024, particles: .5 },
    balanced: { renderScale: .78, shadows: true, bloom: true, fxaa: true, lights: 4, softShadows: false, shadowSize: 2048, particles: 1 },
    high: { renderScale: .9, shadows: true, bloom: true, fxaa: true, lights: 6, softShadows: true, shadowSize: 2048, particles: 1 },
    ultra: { renderScale: 1, shadows: true, bloom: true, fxaa: true, lights: 8, softShadows: true, shadowSize: 4096, particles: 1.4 }
  };
  const opts = Object.assign({ preset: 'balanced', dynamicRes: true, fpsCap: 120, maxScale: 1 }, PRESETS.balanced);
  let scene = null, depthProg = null, skyProg = null, partProg = null, brightProg = null, blurProg = null, compProg = null;
  const sceneUniforms = ['vp', 'shadowVP', 'eye', 'sunDir', 'sunCol', 'skyCol', 'groundCol', 'upDir', 'fogCol', 'fogDensity', 'exposure', 'time', 'shadowOn',
    'noiseTex', 'aoTex', 'shadowTex', 'aoRect', 'shadowTexel', 'lightPos', 'lightCol', 'flashCol'];
  function buildPrograms() {
    const lights = Math.max(1, opts.lights | 0);
    let defs = '#define LIGHTS ' + lights + '\n';
    if (opts.shadows && depthTextures) defs += '#define SHADOWS\n';
    if (opts.softShadows) defs += '#define SOFT_SHADOWS\n';
    scene = program(SCENE_VS, SCENE_FS, defs, ['p', 'n', ...instanceLocs], sceneUniforms);
    scene.lights = lights;
    if (!depthProg) {
      depthProg = program(DEPTH_VS, DEPTH_FS, '', ['p', 'r0', 'r1', 'r2'], ['vp']);
      skyProg = program(SKY_VS, SKY_FS, '', ['q'], ['invVP', 'sunDir', 'sunCol', 'zenith', 'horizon', 'fogCol', 'exposure', 'time', 'noiseTex']);
      partProg = program(PARTICLE_VS, PARTICLE_FS, '', ['q', 'pp', 'pc', 'pd'], ['vp', 'camRight', 'camUp', 'eye', 'additive', 'noiseTex']);
      brightProg = program(QUAD_VS, BRIGHT_FS, '', ['q'], ['tex', 'texel', 'threshold']);
      blurProg = program(QUAD_VS, BLUR_FS, '', ['q'], ['tex', 'dir']);
      compProg = program(QUAD_VS, COMPOSITE_FS, '', ['q'], ['scene', 'bloom', 'texel', 'bloomStrength', 'fxaa', 'vignette', 'damage', 'aberration', 'time', 'saturation', 'contrast']);
    }
  }

  // Lighting rig: late-afternoon sun over an industrial district.
  const env = {
    sunDir: unit([-0.55, 0.40, 0.45]),
    sunCol: [2.5, 1.6, 0.92],
    skyCol: [0.15, 0.21, 0.33],
    groundCol: [0.085, 0.07, 0.06],
    fogCol: [0.16, 0.155, 0.195],
    zenith: [0.05, 0.11, 0.27],
    horizon: [0.78, 0.44, 0.27],
    fogDensity: 0.0085,
    exposure: 1.0
  };

  // ------------------------------------------------------------------ framebuffers
  let width = 0, height = 0, scale = opts.renderScale, fpsSmooth = 60, adaptClock = 0;
  let sceneFB = null, sceneTex = null, sceneDepth = null, bloomA = null, bloomB = null, postReady = false;
  let shadowFB = null, shadowTex = null, shadowReady = false, shadowSize = 0;
  const shadowVP = new Float32Array(16);
  function colorTarget(w, h) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { tex: t, fb, w, h };
  }
  function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } }
  function buildPost() {
    freeTarget(sceneFB && { tex: sceneTex, fb: sceneFB });
    freeTarget(bloomA); freeTarget(bloomB);
    if (sceneDepth) gl.deleteRenderbuffer(sceneDepth);
    sceneFB = sceneTex = sceneDepth = bloomA = bloomB = null;
    postReady = false;
    if (!(opts.bloom || opts.fxaa) || !width) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }
    try {
      const t = colorTarget(width, height);
      sceneTex = t.tex; sceneFB = t.fb;
      sceneDepth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, sceneDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl2 ? gl.DEPTH_COMPONENT24 : gl.DEPTH_COMPONENT16, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sceneDepth);
      postReady = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (postReady && opts.bloom) {
        const bw = Math.max(1, width >> 2), bh = Math.max(1, height >> 2);
        bloomA = colorTarget(bw, bh);
        bloomB = colorTarget(bw, bh);
        postReady = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      }
    } catch (e) { postReady = false; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function resize(force) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(16, Math.round((window.innerWidth || 1) * dpr * scale)), h = Math.max(16, Math.round((window.innerHeight || 1) * dpr * scale));
    if (w !== width || h !== height || force) {
      canvas.width = width = w;
      canvas.height = height = h;
      buildPost();
    }
  }

  // ------------------------------------------------------------------ static world: shadows + AO
  let staticBatches = [];
  function computeShadowMatrix() {
    const f = [-env.sunDir[0], -env.sunDir[1], -env.sunDir[2]];
    const [x, y, z] = lookBasis(f);
    const center = [0, 3, 0];
    const eye = [center[0] - f[0] * 60, center[1] - f[1] * 60, center[2] - f[2] * 60];
    const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const cx of [-34, 34]) for (const cy of [-0.5, 14]) for (const cz of [-42, 42]) {
      const p = [cx, cy, cz];
      const v = [dot(x, p) - dot(x, eye), dot(y, p) - dot(y, eye), dot(z, p) - dot(z, eye)];
      for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], v[i]); mx[i] = Math.max(mx[i], v[i]); }
    }
    mul(ortho(mn[0], mx[0], mn[1], mx[1], -mx[2] - 5, -mn[2] + 5), view, shadowVP);
  }
  function renderShadowMap() {
    shadowReady = false;
    if (!opts.shadows || !depthTextures || !staticBatches.length) return;
    try {
      const size = Math.min(opts.shadowSize, +gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048);
      if (size !== shadowSize || !shadowTex) {
        if (shadowTex) gl.deleteTexture(shadowTex);
        if (shadowFB) gl.deleteFramebuffer(shadowFB);
        shadowSize = size;
        shadowTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, shadowTex);
        if (gl2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        shadowFB = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
        if (!gl2) {
          const rb = gl.createRenderbuffer();
          gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, size, size);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }
      computeShadowMatrix();
      gl.viewport(0, 0, shadowSize, shadowSize);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.colorMask(false, false, false, false);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 3);
      gl.useProgram(depthProg.program);
      gl.uniformMatrix4fv(depthProg.vp, false, shadowVP);
      for (const b of staticBatches) drawBatchWith(depthProg, b, true);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.colorMask(true, true, true, true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      shadowReady = true;
    } catch (e) {
      shadowReady = false;
      gl.colorMask(true, true, true, true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }
  /** Bakes a soft occlusion map for the floor from the static collision boxes. */
  function bakeGroundAO(boxes, rect) {
    aoRect = rect;
    const res = 4, w = Math.round(rect[2] * res), h = Math.round(rect[3] * res);
    const data = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      const z = rect[1] + (j + .5) / res;
      for (let i = 0; i < w; i++) {
        const x = rect[0] + (i + .5) / res;
        let occ = 0;
        for (const o of boxes) {
          const dx = Math.max(Math.abs(x - o.x) - o.w / 2, 0), dz = Math.max(Math.abs(z - o.z) - o.d / 2, 0);
          const d = Math.hypot(dx, dz);
          if (d > 2.6) continue;
          const reach = Math.min(1.9, .35 + o.h * .45);
          occ = Math.max(occ, Math.exp(-d / (reach * .55)) * (d === 0 ? 1 : .62));
        }
        data[j * w + i] = Math.round((1 - occ * .62) * 255);
      }
    }
    gl.deleteTexture(aoTex);
    aoTex = makeTexture(w, h, data, gl.LUMINANCE, gl.LINEAR, gl.CLAMP_TO_EDGE);
  }
  function setStatic(batches, boxes, rect) {
    staticBatches = batches;
    if (boxes) bakeGroundAO(boxes, rect || aoRect);
    renderShadowMap();
  }

  // ------------------------------------------------------------------ drawing
  function bindMesh(loc, mesh, withNormal) {
    gl.bindBuffer(gl.ARRAY_BUFFER, meshes[mesh].buffer);
    gl.enableVertexAttribArray(loc.p);
    gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 24, 0);
    if (withNormal && loc.n >= 0) {
      gl.enableVertexAttribArray(loc.n);
      gl.vertexAttribPointer(loc.n, 3, gl.FLOAT, false, 24, 12);
    }
  }
  function drawBatchWith(loc, batch, depthOnly) {
    const attrs = depthOnly ? ['r0', 'r1', 'r2'] : instanceLocs;
    for (let mesh = 0; mesh < batch.lists.length; mesh++) {
      const l = batch.lists[mesh];
      if (!l.n) continue;
      bindMesh(loc, mesh, !depthOnly);
      gl.bindBuffer(gl.ARRAY_BUFFER, l.buf);
      if (!l.uploaded) {
        gl.bufferData(gl.ARRAY_BUFFER, l.data.subarray(0, l.n * FLOATS), batch.isStatic ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW);
        l.uploaded = true;
      }
      if (instancing) {
        for (let i = 0; i < attrs.length; i++) {
          const a = loc[attrs[i]];
          if (a < 0) continue;
          gl.enableVertexAttribArray(a);
          gl.vertexAttribPointer(a, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
          divisor(a, 1);
        }
        drawInstanced(gl.TRIANGLES, meshes[mesh].count, l.n);
        for (const name of attrs) { const a = loc[name]; if (a >= 0) { divisor(a, 0); gl.disableVertexAttribArray(a); } }
      } else {
        for (const name of attrs) if (loc[name] >= 0) gl.disableVertexAttribArray(loc[name]);
        const d = l.data;
        for (let k = 0; k < l.n; k++) {
          const o = k * FLOATS;
          for (let i = 0; i < attrs.length; i++) if (loc[attrs[i]] >= 0) gl.vertexAttrib4f(loc[attrs[i]], d[o + i * 4], d[o + i * 4 + 1], d[o + i * 4 + 2], d[o + i * 4 + 3]);
          gl.drawArrays(gl.TRIANGLES, 0, meshes[mesh].count);
        }
      }
    }
    if (loc.n >= 0) gl.disableVertexAttribArray(loc.n);
  }

  const proj = new Float32Array(16), viewM = new Float32Array(16), vpM = new Float32Array(16), invVP = new Float32Array(16);
  const lightPos = new Float32Array(8 * 4), lightCol = new Float32Array(8 * 4);
  const cam = { eye: [0, 1.6, 0], right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, -1] };
  let frameTime = 0, weaponFlash = [0, 0, 0], lights = [];

  function setLights(list) { lights = list; }
  function setWeaponFlash(r, g, b) { weaponFlash = [r, g, b]; }

  function applySceneUniforms(isWeapon) {
    const L = scene;
    gl.useProgram(L.program);
    gl.uniformMatrix4fv(L.shadowVP, false, shadowVP);
    gl.uniform1f(L.shadowOn, !isWeapon && shadowReady ? 1 : 0);
    gl.uniform1f(L.shadowTexel, 1 / Math.max(1, shadowSize));
    gl.uniform3fv(L.sunCol, env.sunCol);
    gl.uniform3fv(L.skyCol, env.skyCol);
    gl.uniform3fv(L.groundCol, env.groundCol);
    gl.uniform3fv(L.fogCol, env.fogCol);
    gl.uniform1f(L.fogDensity, isWeapon ? 0 : env.fogDensity);
    gl.uniform1f(L.exposure, env.exposure);
    gl.uniform1f(L.time, frameTime);
    gl.uniform4fv(L.aoRect, aoRect);
    gl.uniform3fv(L.flashCol, isWeapon ? weaponFlash : [0, 0, 0]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, noiseTex); gl.uniform1i(L.noiseTex, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, aoTex); gl.uniform1i(L.aoTex, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, shadowReady ? shadowTex : noiseTex); gl.uniform1i(L.shadowTex, 2);
    gl.activeTexture(gl.TEXTURE0);
    const n = L.lights;
    lightPos.fill(0); lightCol.fill(0);
    if (!isWeapon) {
      for (let i = 0; i < Math.min(n, lights.length); i++) {
        const l = lights[i];
        lightPos.set([l.x, l.y, l.z, l.radius], i * 4);
        lightCol.set([l.r, l.g, l.b, l.intensity], i * 4);
      }
    }
    gl.uniform4fv(L.lightPos, lightPos.subarray(0, n * 4));
    gl.uniform4fv(L.lightCol, lightCol.subarray(0, n * 4));
  }

  /** Starts a frame from the player's camera. */
  function begin(eye, yaw, pitch, fov = 75, roll = 0, time = 0) {
    resize();
    frameTime = time;
    perspective(fov * Math.PI / 180, width / height, .08, 240, proj);
    viewMatrix(eye, yaw, pitch, roll, viewM);
    mul(proj, viewM, vpM);
    invert(vpM, invVP);
    cam.eye = eye;
    cam.right = [viewM[0], viewM[4], viewM[8]];
    cam.up = [viewM[1], viewM[5], viewM[9]];
    cam.fwd = [-viewM[2], -viewM[6], -viewM[10]];
    gl.bindFramebuffer(gl.FRAMEBUFFER, postReady ? sceneFB : null);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.disable(gl.BLEND);
    gl.clearColor(env.fogCol[0], env.fogCol[1], env.fogCol[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    applySceneUniforms(false);
    gl.uniformMatrix4fv(scene.vp, false, vpM);
    gl.uniform3fv(scene.eye, eye);
    gl.uniform3fv(scene.sunDir, env.sunDir);
    gl.uniform3fv(scene.upDir, [0, 1, 0]);
  }
  function draw(batch) {
    gl.disable(gl.CULL_FACE);
    drawBatchWith(scene, batch, false);
  }
  function drawSky() {
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.useProgram(skyProg.program);
    gl.uniformMatrix4fv(skyProg.invVP, false, invVP);
    gl.uniform3fv(skyProg.sunDir, env.sunDir);
    gl.uniform3fv(skyProg.sunCol, env.sunCol);
    gl.uniform3fv(skyProg.zenith, env.zenith);
    gl.uniform3fv(skyProg.horizon, env.horizon);
    gl.uniform3fv(skyProg.fogCol, env.fogCol);
    gl.uniform1f(skyProg.exposure, env.exposure);
    gl.uniform1f(skyProg.time, frameTime);
    gl.bindTexture(gl.TEXTURE_2D, noiseTex);
    gl.uniform1i(skyProg.noiseTex, 0);
    fullscreen(skyProg, tri, 3);
    gl.depthMask(true);
  }
  function fullscreen(loc, buf, count) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc.q);
    gl.vertexAttribPointer(loc.q, 2, gl.FLOAT, false, 8, 0);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.disableVertexAttribArray(loc.q);
  }
  function drawParticles(list, additive, viewSpace) {
    if (!list.n || !instancing) return;
    gl.useProgram(partProg.program);
    gl.uniformMatrix4fv(partProg.vp, false, viewSpace ? weaponVP : vpM);
    gl.uniform3fv(partProg.camRight, viewSpace ? [1, 0, 0] : cam.right);
    gl.uniform3fv(partProg.camUp, viewSpace ? [0, 1, 0] : cam.up);
    gl.uniform3fv(partProg.eye, viewSpace ? [0, 0, 0] : cam.eye);
    gl.uniform1f(partProg.additive, additive ? 1 : 0);
    gl.bindTexture(gl.TEXTURE_2D, noiseTex);
    gl.uniform1i(partProg.noiseTex, 0);
    gl.enable(gl.BLEND);
    if (additive) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(partProg.q);
    gl.vertexAttribPointer(partProg.q, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, list.buf);
    gl.bufferData(gl.ARRAY_BUFFER, list.data.subarray(0, list.n * 12), gl.DYNAMIC_DRAW);
    const names = ['pp', 'pc', 'pd'];
    for (let i = 0; i < 3; i++) {
      const a = partProg[names[i]];
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 48, i * 16);
      divisor(a, 1);
    }
    drawInstanced(gl.TRIANGLES, 6, list.n);
    for (const nme of names) { divisor(partProg[nme], 0); gl.disableVertexAttribArray(partProg[nme]); }
    gl.disableVertexAttribArray(partProg.q);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
  const weaponVP = new Float32Array(16);
  /** Switches to the first-person weapon camera (view space, separate depth range). */
  function weaponView(fov = 64) {
    gl.clear(gl.DEPTH_BUFFER_BIT);
    perspective(fov * Math.PI / 180, width / height, .02, 8, weaponVP);
    applySceneUniforms(true);
    gl.uniformMatrix4fv(scene.vp, false, weaponVP);
    gl.uniform3fv(scene.eye, [0, 0, 0]);
    // World-space sun and up expressed in view space so the gun is lit like the world.
    const s = env.sunDir;
    gl.uniform3fv(scene.sunDir, [viewM[0] * s[0] + viewM[4] * s[1] + viewM[8] * s[2], viewM[1] * s[0] + viewM[5] * s[1] + viewM[9] * s[2], viewM[2] * s[0] + viewM[6] * s[1] + viewM[10] * s[2]]);
    gl.uniform3fv(scene.upDir, [viewM[4], viewM[5], viewM[6]]);
  }
  /** Finishes the frame: bloom, FXAA, grading and screen effects. */
  function end(fx = {}) {
    if (!postReady) return;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    if (opts.bloom && bloomA) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb);
      gl.viewport(0, 0, bloomA.w, bloomA.h);
      gl.useProgram(brightProg.program);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.uniform1i(brightProg.tex, 0);
      gl.uniform2f(brightProg.texel, 1.5 / width, 1.5 / height);
      gl.uniform1f(brightProg.threshold, .7);
      fullscreen(brightProg, quad, 6);
      gl.useProgram(blurProg.program);
      gl.uniform1i(blurProg.tex, 0);
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fb);
        gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
        gl.uniform2f(blurProg.dir, (1 + i) / bloomA.w, 0);
        fullscreen(blurProg, quad, 6);
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb);
        gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
        gl.uniform2f(blurProg.dir, 0, (1 + i) / bloomA.h);
        fullscreen(blurProg, quad, 6);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(compProg.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex); gl.uniform1i(compProg.scene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomA ? bloomA.tex : sceneTex); gl.uniform1i(compProg.bloom, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(compProg.texel, 1 / width, 1 / height);
    gl.uniform1f(compProg.bloomStrength, opts.bloom && bloomA ? (fx.bloom ?? .85) : 0);
    gl.uniform1f(compProg.fxaa, opts.fxaa ? 1 : 0);
    gl.uniform1f(compProg.vignette, fx.vignette ?? .75);
    gl.uniform1f(compProg.damage, fx.damage || 0);
    gl.uniform1f(compProg.aberration, fx.aberration || 0);
    gl.uniform1f(compProg.time, frameTime % 100);
    gl.uniform1f(compProg.saturation, fx.saturation ?? 1.08);
    gl.uniform1f(compProg.contrast, fx.contrast ?? 1.06);
    fullscreen(compProg, quad, 6);
    gl.enable(gl.DEPTH_TEST);
  }

  // ------------------------------------------------------------------ quality & adaptation
  function configure(o) {
    const progKey = () => JSON.stringify([opts.shadows, opts.softShadows, opts.lights, opts.shadowSize]);
    const targetKey = () => JSON.stringify([opts.renderScale, opts.bloom, opts.fxaa]);
    const beforeProg = progKey(), beforeTarget = targetKey();
    Object.assign(opts, o);
    const progChanged = progKey() !== beforeProg;
    if (!scene || progChanged) buildPrograms();
    if (targetKey() !== beforeTarget || !width) {
      scale = Math.min(opts.renderScale, opts.maxScale || 1);
      resize(true);
    }
    if (progChanged || (opts.shadows && !shadowReady)) renderShadowMap();
  }
  /** Applies a named preset (performance, balanced, high, ultra). */
  function quality(name) {
    const preset = PRESETS[name] ? name : 'balanced';
    configure(Object.assign({ preset }, PRESETS[preset]));
    return preset;
  }
  function adapt(dt) {
    if (dt > 0 && dt < 2) fpsSmooth += (1 / dt - fpsSmooth) * .05;
    adaptClock += dt;
    if (!opts.dynamicRes || adaptClock < 2) return;
    adaptClock = 0;
    // Keep a smooth 60 (or the lower cap); spare headroom goes to higher frame rates, not lower resolution.
    const target = opts.fpsCap > 0 ? Math.min(opts.fpsCap, 60) : 60;
    if (fpsSmooth < target * .86 && scale > .45) { scale = Math.max(.45, scale - .07); resize(); }
    else if (fpsSmooth > target * .97 && scale < opts.renderScale) { scale = Math.min(opts.renderScale, scale + .04); resize(); }
  }
  /** Projects a world point to CSS pixels; returns null when behind the camera. */
  function project(x, y, z) {
    const m = vpM;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= .05) return null;
    return [(cx / cw * .5 + .5) * (window.innerWidth || 1), (1 - (cy / cw * .5 + .5)) * (window.innerHeight || 1)];
  }

  buildPrograms();
  quality('balanced');
  window.addEventListener('resize', () => resize());

  return {
    gl, canvas, gl2, instancing, MESH, Batch, Particles, Stack, rgb, mix: mixc, env, PRESETS,
    begin, draw, drawSky, drawParticles, weaponView, end, setLights, setWeaponFlash, setStatic, renderShadowMap,
    quality, configure, adapt, project, camera: cam,
    options: () => Object.assign({}, opts),
    stats: () => ({ fps: fpsSmooth, resolution: scale, instanced: instancing, width, height, gl2, shadows: shadowReady, post: postReady }),
    math: { unit, cross, dot },
    clearDepth: () => gl.clear(gl.DEPTH_BUFFER_BIT)
  };
})();
