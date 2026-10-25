'use strict';
// The Expanse arena: collision boxes, ray tests and the static scene geometry.
window.StrikeWorld = (() => {
  const R = window.StrikeRenderer, M = R.MESH;
  const hex = R.rgb;
  const COL = {
    floor: hex('8a857c'), asphalt: hex('3b3b3d'), concrete: hex('7c8183'), concreteLight: hex('a3a7a4'), barrier: hex('9a9c97'),
    steelDark: hex('262c33'), steel: hex('56616a'), steelLight: hex('9ca7ab'), rubber: hex('1b1d20'),
    cyan: hex('3ff2e2'), amber: hex('ffae45'), red: hex('ff3d2e'), white: hex('fff1dc'), coolWhite: hex('dff4ff'),
    yellow: hex('d9a21b'), crate: hex('8a6a45'), crateDark: hex('5e4630'), plastic: hex('2d5a7a'),
    tower: hex('2c3440'), towerLight: hex('46505c')
  };
  const CONTAINER_COLORS = [hex('8c3426'), hex('2b4f73'), hex('3e5f36'), hex('b0602a'), hex('6d6f73'), hex('7a2f4c'), hex('2f6b6b'), hex('a48a2a')];

  const obstacles = [];
  const WALLS = [{ x: -32, z: 0, w: .8, d: 80, h: 9 }, { x: 32, z: 0, w: .8, d: 80, h: 9 }, { x: 0, z: -40, w: 64, d: .8, h: 9 }, { x: 0, z: 40, w: 64, d: .8, h: 9 }];
  const lamps = [];
  const batch = new R.Batch(true);
  const st = new R.Stack();

  const box = (x, y, z, sx, sy, sz, c, rough = .6, metal = 0, glow = 0, mode = 0, ry = 0, rx = 0, rz = 0) => batch.add(M.CUBE, x, y, z, sx, sy, sz, c, rough, metal, glow, mode, rx, ry, rz);
  const cylY = (x, y, z, d, h, c, rough = .5, metal = 0, glow = 0, mode = 0) => batch.add(M.CYL, x, y, z, d, h, d, c, rough, metal, glow, mode);
  const pipe = (a, b, r, c, rough = .4, metal = .7) => batch.beam(a, b, r, c, rough, metal);
  const light = (x, y, z, sx, sy, sz, c, glow = 1.5) => box(x, y, z, sx, sy, sz, c, .3, 0, glow, 3);
  function lamp(x, y, z, color, radius = 11, intensity = 2.2) { lamps.push({ x, y, z, r: color[0], g: color[1], b: color[2], radius, intensity }); }

  // ------------------------------------------------------------------ collision
  function addObstacle(x, z, w, d, h) { const o = { x, z, w, d, h }; obstacles.push(o); return o; }
  function freeAt(x, z, r = .35) {
    if (x < -31.4 + r || x > 31.4 - r || z < -39.4 + r || z > 39.4 - r) return false;
    for (const o of obstacles) if (x > o.x - o.w / 2 - r && x < o.x + o.w / 2 + r && z > o.z - o.d / 2 - r && z < o.z + o.d / 2 + r) return false;
    return true;
  }
  /** Height-aware check for the player: obstacles below the feet do not block. */
  function freeAtHeight(x, z, r, feet) {
    if (x < -31.4 + r || x > 31.4 - r || z < -39.4 + r || z > 39.4 - r) return false;
    for (const o of obstacles) {
      if (o.h <= feet + .3) continue;
      if (x > o.x - o.w / 2 - r && x < o.x + o.w / 2 + r && z > o.z - o.d / 2 - r && z < o.z + o.d / 2 + r) return false;
    }
    return true;
  }
  /** Highest walkable surface under a circle of radius r whose top is not above feet + step. */
  function groundAt(x, z, r, feet) {
    let g = 0;
    for (const o of obstacles) {
      if (o.h > feet + .3 || o.h <= g) continue;
      if (x > o.x - o.w / 2 - r * .6 && x < o.x + o.w / 2 + r * .6 && z > o.z - o.d / 2 - r * .6 && z < o.z + o.d / 2 + r * .6) g = o.h;
    }
    return g;
  }
  function move(body, dx, dz, r = .35) {
    if (freeAt(body.x + dx, body.z, r)) body.x += dx;
    if (freeAt(body.x, body.z + dz, r)) body.z += dz;
  }
  function rayBox(origin, dir, o) {
    let lo = 0, hi = 120;
    for (let i = 0; i < 3; i++) {
      const center = i === 0 ? o.x : i === 1 ? o.h / 2 : o.z, half = i === 0 ? o.w / 2 : i === 1 ? o.h / 2 : o.d / 2;
      if (Math.abs(dir[i]) < 1e-7) {
        if (origin[i] < center - half || origin[i] > center + half) return Infinity;
      } else {
        const a = (center - half - origin[i]) / dir[i], b = (center + half - origin[i]) / dir[i];
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
        if (hi < lo) return Infinity;
      }
    }
    return lo;
  }
  function wallDistance(origin, dir) {
    let closest = 120;
    for (const o of obstacles) { const d = rayBox(origin, dir, o); if (d < closest) closest = d; }
    for (const o of WALLS) { const d = rayBox(origin, dir, o); if (d < closest) closest = d; }
    return closest;
  }

  // ------------------------------------------------------------------ props
  function barrier(x, z, w, d, h) {
    addObstacle(x, z, w, d, h);
    box(x, h / 2, z, w, h, d, COL.barrier, .85, 0, 0, 1);
    box(x, h - .06, z, w + .06, .12, d + .06, COL.steel, .35, .75);
    box(x, .14, z, w + .08, .28, d + .08, COL.concrete, .9, 0, 0, 8);
    for (const s of [-1, 1]) {
      box(x, h * .62, z + s * (d / 2 + .02), w * .42, .07, .03, COL.cyan, .3, 0, 1.6, 3);
      for (const e of [-1, 1]) box(x + e * (w / 2 - .06), h / 2, z + s * (d / 2 + .015), .1, h - .2, .03, COL.steelLight, .3, .8);
      box(x + s * (w / 2 + .015), h * .45, z, .03, h * .5, d * .5, COL.steelDark, .5, .5);
    }
  }
  function crates(x, z, w, d, h) {
    addObstacle(x, z, w, d, h);
    const lower = h * .52;
    box(x, lower / 2, z, w, lower, d, COL.crate, .8, 0, 0, 0);
    box(x - w * .18, lower + (h - lower) / 2, z + d * .1, w * .62, h - lower, d * .7, COL.crateDark, .8);
    box(x + w * .26, lower + .2, z - d * .22, w * .4, .4, d * .45, COL.plastic, .5, .1);
    for (const s of [-1, 1]) {
      box(x, lower / 2, z + s * (d / 2 + .01), w + .02, .08, .02, COL.steelDark, .5, .6);
      box(x + s * (w / 2 + .01), lower / 2, z, .02, .08, d + .02, COL.steelDark, .5, .6);
    }
    box(x - w * .18, h + .02, z + d * .1, w * .3, .03, .3, COL.amber, .3, 0, 1.2, 3);
  }
  function container(x, z, w, d, h, color) {
    addObstacle(x, z, w, d, h);
    box(x, h / 2, z, w - .08, h - .06, d - .08, color, .55, .35, 0, 7);
    box(x, h - .03, z, w, .06, d, R.mix(color, COL.steelDark, .4), .6, .4);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(x + sx * (w / 2 - .09), h / 2, z + sz * (d / 2 - .09), .18, h, .18, COL.steelDark, .5, .7);
      box(x + sx * (w / 2 - .09), .09, z + sz * (d / 2 - .09), .22, .18, .22, COL.steel, .4, .8);
    }
    // Door end with lock rods.
    const dz = z + d / 2 + .005;
    box(x, h / 2, dz, .04, h - .3, .03, COL.steelDark, .5, .6);
    for (const i of [-3, -1, 1, 3]) cylY(x + i * w / 9, h / 2, dz + .04, .045, h - .4, COL.steelLight, .3, .9);
    box(x, h - .4, dz + .02, w * .6, .12, .02, COL.amber, .4, 0, .9, 3);
  }
  function generator(x, z, w, d, h) {
    addObstacle(x, z, w, d, h);
    box(x, h / 2 + .1, z, w - .1, h - .2, d - .1, COL.steel, .45, .6, 0, 0);
    box(x, .1, z, w + .1, .2, d + .1, COL.steelDark, .6, .4, 0, 8);
    box(x, h - .02, z, w, .06, d, COL.steelDark, .5, .6);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) box(x - w * .3 + i * w * .12, h * .5, z + s * (d / 2 - .03), w * .08, h * .45, .05, COL.steelDark, .7, .3);
      box(x + w * .36, h * .75, z + s * (d / 2 - .02), .25, .16, .03, COL.cyan, .2, 0, 1.4, 3);
      box(x + w * .36, h * .58, z + s * (d / 2 - .02), .08, .08, .03, COL.amber, .2, 0, 2.2, 3);
    }
    for (const s of [-1, 1]) {
      cylY(x + s * w * .3, h + .35, z - d * .2, .22, .7, COL.steelDark, .4, .7);
      cylY(x + s * w * .3, h + .72, z - d * .2, .28, .06, COL.steel, .4, .7);
    }
    pipe([x - w / 2 + .05, h * .3, z + d * .3], [x - w / 2 - .4, .05, z + d * .3], .07, COL.rubber, .8, 0);
  }
  function depot(x, z, w, d, h) {
    addObstacle(x, z, w, d, h);
    box(x, h / 2, z, w, h, d, COL.steelDark, .4, .65);
    box(x, h + .01, z, w * .96, .04, d * .9, COL.steel, .4, .6);
    for (const s of [-1, 1]) {
      box(x, h * .62, z + s * (d / 2 + .01), w * .78, h * .42, .03, COL.steelLight, .3, .6);
      box(x, h * .62, z + s * (d / 2 + .03), w * .7, h * .32, .02, hex('113a44'), .1, 0, 0, 5);
      for (let i = 0; i < 3; i++) box(x - w * .25 + i * w * .25, h * .62, z + s * (d / 2 + .045), w * .18, h * .2, .01, COL.cyan, .2, 0, .9 + i * .3, 3);
      box(x, .3, z + s * (d / 2 + .01), w * .9, .1, .02, COL.amber, .3, 0, 1.2, 3);
    }
    box(x - w * .3, h + .3, z, .7, .55, .6, COL.plastic, .5, .1);
    box(x + w * .28, h + .22, z + .1, .9, .4, .7, COL.crate, .8);
  }
  function barrels(x, z, w, d, h) {
    addObstacle(x, z, w, d, h);
    const spots = [[-.4, -.4], [.4, -.35], [-.35, .4], [.38, .42]];
    spots.forEach(([a, b], i) => {
      const c = i % 2 ? hex('2d5f8a') : hex('a8461f');
      cylY(x + a, .52, z + b, .62, 1.04, c, .45, .4);
      for (const y of [.2, .84]) cylY(x + a, y, z + b, .64, .05, R.mix(c, COL.steelDark, .5), .4, .6);
      cylY(x + a, 1.045, z + b, .5, .01, COL.steelDark, .5, .5);
    });
  }
  function post(x, z, w, h) {
    addObstacle(x, z, w, w, h);
    box(x, h / 2, z, w, h, w, COL.steelDark, .4, .75);
    box(x, .15, z, w + .16, .3, w + .16, COL.concrete, .9, 0, 0, 1);
    box(x, 1.2, z, w + .02, .5, w + .02, COL.concrete, .7, 0, 0, 8);
  }
  function lampPost(x, z, facing) {
    addObstacle(x, z, .3, .3, 6.4);
    cylY(x, 3.2, z, .16, 6.4, COL.steelDark, .4, .7);
    cylY(x, .2, z, .34, .4, COL.concrete, .9, 0);
    const hx = x + Math.sin(facing) * .9, hz = z + Math.cos(facing) * .9;
    pipe([x, 6.3, z], [hx, 6.25, hz], .05, COL.steelDark);
    box(hx, 6.12, hz, .55, .16, .32, COL.steel, .4, .6, 0, 0, facing);
    light(hx, 6.03, hz, .44, .03, .24, COL.white, 2.4);
    lamp(hx, 5.6, hz, [1, .78, .52], 12, 2.4);
  }

  // ------------------------------------------------------------------ scene
  function build() {
    // Ground.
    box(0, -.15, 0, 64, .3, 80, COL.floor, .72, 0, 0, 2);
    box(0, -.32, 0, 420, .3, 420, COL.asphalt, .85, 0, 0, 2);
    // Painted lanes and the spawn pad.
    for (const x of [-11, 11, -23, 23]) {
      box(x, .006, 0, .09, .012, 72, COL.yellow, .5, 0, .15);
      for (let z = -34; z < 36; z += 6) box(x + .55, .007, z, 1, .012, .08, COL.yellow, .5, 0, .15);
    }
    box(0, .006, 12, 5, .012, 3.7, COL.steelDark, .35, .3);
    for (const s of [-1, 1]) {
      light(s * 2.5, .015, 12, .05, .02, 3.7, COL.cyan, .9);
      light(0, .015, 12 + s * 1.85, 5, .02, .05, COL.cyan, .9);
    }

    // Perimeter walls.
    for (const wall of WALLS) box(wall.x, wall.h / 2, wall.z, wall.w, wall.h, wall.d, COL.concrete, .85, 0, 0, 1);
    for (const s of [-1, 1]) {
      box(s * 31.58, .36, 0, .06, .72, 79, COL.concrete, .8, 0, 0, 8);
      box(0, .36, s * 39.58, 63, .72, .06, COL.concrete, .8, 0, 0, 8);
      box(s * 32, 9.05, 0, 1.1, .2, 80.4, COL.steelDark, .5, .5);
      box(0, 9.05, s * 40, 64.4, .2, 1.1, COL.steelDark, .5, .5);
      for (let z = -36; z <= 36; z += 8) {
        box(s * 31.68, 4.5, z, .45, 9, .6, COL.steelDark, .4, .7);
        light(s * 31.42, 4.6, z + .5, .05, 2.6, .07, COL.cyan, 1.8);
        box(s * 31.62, 2.9, z + 4, .1, 3.6, 4.6, COL.concreteLight, .7, 0, 0, 1);
      }
      for (let x = -28; x <= 28; x += 8) {
        box(x, 4.5, s * 39.68, .6, 9, .45, COL.steelDark, .4, .7);
        light(x, 7.2, s * 39.42, 1.2, .1, .05, COL.amber, 1.8);
      }
      pipe([s * 31.45, 6.3, -39], [s * 31.45, 6.3, 39], .14, COL.steel);
      pipe([s * 31.42, 6.75, -39], [s * 31.42, 6.75, 39], .09, hex('8c3a2a'), .5, .5);
      // Big wall signs.
      light(s * 31.55, 7.6, -12, .04, .9, 5, s > 0 ? COL.amber : COL.cyan, 1.1);
      light(s * 31.55, 7.6, 18, .04, .9, 3.2, COL.white, .9);
    }

    // Overhead gantries with light panels.
    for (const z of [-17, 17]) {
      box(0, 7, z, 34.6, .55, .65, COL.steelDark, .4, .7);
      box(0, 7.32, z, 34.6, .1, .9, COL.steel, .4, .7);
      for (let x = -14; x <= 14; x += 4) {
        box(x, 6.68, z, 1.6, .1, .75, COL.steel, .3, .7);
        light(x, 6.62, z, 1.3, .03, .5, COL.coolWhite, 2.2);
      }
      for (const x of [-8, 0, 8]) lamp(x, 6.2, z, [.82, .92, 1], 10, 1.8);
      for (const s of [-1, 1]) post(s * 17.3, z, .5, 7);
    }
    // Side catwalk frames.
    for (const s of [-1, 1]) {
      post(s * 16, -27, .6, 8);
      post(s * 16, 27, .6, 8);
      box(s * 16, 8, 0, .55, .5, 54.6, COL.steelDark, .4, .7);
      box(s * 16, 8.3, 0, 1.6, .08, 54.6, COL.steel, .5, .6);
      for (let z = -24; z <= 24; z += 8) {
        pipe([s * 16, 7.75, z], [s * 16, 7.1, z], .02, COL.steelDark);
        box(s * 16, 7.02, z, .5, .14, .5, COL.steel, .4, .6);
        light(s * 16, 6.94, z, .38, .03, .38, COL.white, 2);
        if (z % 16 === 0) lamp(s * 16, 6.6, z, [1, .8, .58], 9, 1.6);
      }
    }

    // Central cover and structures (collision boxes match the 4.0 layout).
    barrier(-7, 5, 3.2, 2.1, 1.8); barrier(7, 5, 3.2, 2.1, 1.8);
    barrier(-5, -4, 3, 2.3, 1.55); barrier(5, -4, 3, 2.3, 1.55);
    generator(0, -11, 3.4, 2.1, 1.35);
    crates(-11, -13, 2.8, 3, 2.5); crates(11, -13, 2.8, 3, 2.5);
    barrier(0, 18, 4, 2, 2.2);
    let ci = 0;
    for (const x of [-22, 22]) for (const z of [-26, -9, 9, 26]) container(x, z, 4.5, 6, 2.6, CONTAINER_COLORS[ci++ % CONTAINER_COLORS.length]);
    for (const x of [-10, 10]) for (const z of [-29, 30]) generator(x, z, 4, 2.8, 1.9);
    for (const z of [-35, 35]) depot(0, z, 5, 2.8, 2.1);
    // Extra props on the flanks.
    barrels(-16, 6, 1.6, 1.6, 1.05); barrels(16, -6, 1.6, 1.6, 1.05);
    barrels(-27, -18, 1.6, 1.6, 1.05); barrels(27, 18, 1.6, 1.6, 1.05);
    crates(14, 22, 2, 2, 1.6); crates(-14, -22, 2, 2, 1.6);
    crates(-26, 31, 2.4, 1.6, 1.2); crates(26, -31, 2.4, 1.6, 1.2);

    // Lamp posts.
    for (const [x, z, f] of [[-28, -36, .8], [28, -36, -.8], [-28, 36, 2.4], [28, 36, -2.4], [-28, 0, 1.57], [28, 0, -1.57]]) lampPost(x, z, f);

    // Floor clutter: cables and debris.
    pipe([-6, .04, 9], [-2.5, .04, 14.5], .035, COL.rubber, .8, 0);
    pipe([9, .04, -6], [14, .04, -9], .035, COL.rubber, .8, 0);
    pipe([-18, .04, -30], [-12, .04, -33], .04, COL.rubber, .8, 0);
    let seed = 91;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 60; i++) {
      const x = -30 + rnd() * 60, z = -38 + rnd() * 76, s = .06 + rnd() * .18;
      if (!freeAt(x, z, .3)) continue;
      box(x, s / 2, z, s * 1.4, s, s, rnd() > .5 ? COL.concrete : COL.steel, .9, 0, 0, 0, rnd() * 3);
    }

    // City skyline beyond the walls.
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2 + rnd() * .05, dist = 78 + rnd() * 55;
      const x = Math.sin(a) * dist * 1.05, z = Math.cos(a) * dist * 1.25;
      const w = 9 + rnd() * 16, d = 9 + rnd() * 14, h = 16 + rnd() * rnd() * 70;
      box(x, h / 2 - .5, z, w, h, d, rnd() > .5 ? COL.tower : COL.towerLight, .8, .2, 0, 6, a);
      if (h > 50) {
        box(x, h + 2, z, .3, 4, .3, COL.steelDark, .5, .5, 0, 0);
        light(x, h + 4.2, z, .5, .5, .5, COL.red, 3);
      }
    }
    // Distant mega-tower landmark.
    box(-30, 55, -150, 26, 112, 22, COL.tower, .7, .3, 0, 6);
    box(-30, 118, -150, 10, 14, 10, COL.towerLight, .6, .4, 0, 6);
    light(-30, 126.5, -150, 1.2, 1.2, 1.2, COL.red, 4);
  }

  build();
  const aoBoxes = obstacles.concat(WALLS);
  R.setStatic([batch], aoBoxes, [-32, -40, 64, 80]);

  /** Fills spare light slots with the static lamps closest to the camera. */
  function nearestLamps(x, z, count, out) {
    const sorted = lamps.map(l => [Math.hypot(l.x - x, l.z - z), l]).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < count && i < sorted.length; i++) out.push(sorted[i][1]);
    return out;
  }

  return { batch, obstacles, WALLS, lamps, freeAt, freeAtHeight, groundAt, move, rayBox, wallDistance, nearestLamps, colors: COL, bounds: { width: 64, depth: 80 } };
})();
