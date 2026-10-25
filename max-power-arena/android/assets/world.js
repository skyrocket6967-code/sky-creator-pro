'use strict';
// Max Power Arena maps: collision boxes, ray tests and the static scene for each battlefield.
window.StrikeWorld = (() => {
  const R = window.StrikeRenderer, M = R.MESH;
  const hex = R.rgb;
  const COL = {
    floor: hex('86827a'), asphalt: hex('34353a'), concrete: hex('7c8183'), concreteLight: hex('a3a7a4'), barrier: hex('9a9c97'),
    steelDark: hex('262c33'), steel: hex('56616a'), steelLight: hex('9ca7ab'), rubber: hex('1b1d20'),
    amber: hex('ffae45'), sodium: hex('ffb860'), red: hex('ff3d2e'), white: hex('fff1dc'), coolWhite: hex('dff4ff'), green: hex('7dff6a'),
    yellow: hex('d9a21b'), crate: hex('8a6a45'), crateDark: hex('5e4630'), olive: hex('4f5638'), oliveDark: hex('343a24'), tarp: hex('5c6142'),
    sand: hex('c4a57a'), sandbag: hex('a8916a'), plaster: hex('c9ae86'), plasterDark: hex('a88e6a'), wood: hex('6e4a2e'), woodLight: hex('9a7048'),
    glass: hex('1d2a33'), tower: hex('2c3440'), towerLight: hex('46505c'), grass: hex('4d7a2c'), road: hex('2f3033'), sidewalk: hex('a9a59c'),
    mountain: hex('8c6a4a'), leaf: hex('3f6b26'), palm: hex('5a7a2a'), bark: hex('5a4330'), cloth1: hex('8c2a2a'), cloth2: hex('2a5a8c'), cloth3: hex('c79a2a')
  };
  const CONTAINER_COLORS = [hex('8c3426'), hex('2b4f73'), hex('3e5f36'), hex('b0602a'), hex('6d6f73'), hex('7a2f4c'), hex('2f6b6b'), hex('a48a2a')];

  const obstacles = [];
  const WALLS = [{ x: -32, z: 0, w: .8, d: 80, h: 9 }, { x: 32, z: 0, w: .8, d: 80, h: 9 }, { x: 0, z: -40, w: 64, d: .8, h: 9 }, { x: 0, z: 40, w: 64, d: .8, h: 9 }];
  const lamps = [], emitters = [];
  const batch = new R.Batch(true);
  let seed = 91;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

  const box = (x, y, z, sx, sy, sz, c, rough = .6, metal = 0, glow = 0, mode = 0, ry = 0, rx = 0, rz = 0) => batch.add(M.CUBE, x, y, z, sx, sy, sz, c, rough, metal, glow, mode, rx, ry, rz);
  const cylY = (x, y, z, d, h, c, rough = .5, metal = 0, glow = 0, mode = 0) => batch.add(M.CYL, x, y, z, d, h, d, c, rough, metal, glow, mode);
  const ball = (x, y, z, sx, sy, sz, c, rough = .8, mode = 0) => batch.add(M.BALL, x, y, z, sx, sy, sz, c, rough, 0, 0, mode);
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

  // ------------------------------------------------------------------ shared props
  function barrier(x, z, w, d, h) {
    addObstacle(x, z, w, d, h);
    box(x, h / 2, z, w, h, d, COL.barrier, .85, 0, 0, 1);
    box(x, h - .06, z, w + .06, .12, d + .06, COL.steel, .35, .75);
    box(x, .14, z, w + .08, .28, d + .08, COL.concrete, .9, 0, 0, 8);
    for (const s of [-1, 1]) {
      for (const e of [-1, 1]) box(x + e * (w / 2 - .06), h / 2, z + s * (d / 2 + .015), .1, h - .2, .03, COL.steelLight, .3, .8);
      box(x + s * (w / 2 + .015), h * .45, z, .03, h * .5, d * .5, COL.steelDark, .5, .5);
      box(x - w * .2, h * .62, z + s * (d / 2 + .012), w * .22, h * .18, .01, COL.yellow, .6, 0, .1);
    }
  }
  function sandbags(x, z, w, d, h) {
    addObstacle(x, z, w, d, h);
    const along = w >= d, len = along ? w : d, rows = Math.max(2, Math.round(h / .22));
    for (let r = 0; r < rows; r++) {
      const n = Math.max(2, Math.round(len / .62)), off = r % 2 ? .31 : 0;
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + (i + .5) * len / n + off * (i === n - 1 ? 0 : 1);
        if (Math.abs(t) > len / 2 - .2) continue;
        const sx = along ? .6 : Math.min(d, 1) * .95, sz = along ? Math.min(d, 1) * .95 : .6;
        box(along ? x + t : x, .11 + r * .21, along ? z : z + t, sx, .22, sz, R.mix(COL.sandbag, COL.crateDark, rnd() * .25), .95, 0, 0, 11, (rnd() - .5) * .1);
      }
    }
  }
  function crates(x, z, w, d, h) {
    addObstacle(x, z, w, d, h);
    const lower = h * .52;
    box(x, lower / 2, z, w, lower, d, COL.crate, .8, 0, 0, 13);
    box(x - w * .18, lower + (h - lower) / 2, z + d * .1, w * .62, h - lower, d * .7, COL.olive, .8, 0, 0, 0);
    box(x + w * .26, lower + .2, z - d * .22, w * .4, .4, d * .45, COL.crateDark, .7, 0, 0, 13);
    for (const s of [-1, 1]) {
      box(x, lower / 2, z + s * (d / 2 + .01), w + .02, .08, .02, COL.steelDark, .5, .6);
      box(x + s * (w / 2 + .01), lower / 2, z, .02, .08, d + .02, COL.steelDark, .5, .6);
    }
    box(x - w * .18, lower + (h - lower) * .55, z + d * .1 + d * .35 + .01, w * .3, .12, .01, COL.yellow, .6, 0, .15);
  }
  function container(x, z, w, d, h, color) {
    addObstacle(x, z, w, d, h);
    box(x, h / 2, z, w - .08, h - .06, d - .08, color, .55, .35, 0, 7);
    box(x, h - .03, z, w, .06, d, R.mix(color, COL.steelDark, .4), .6, .4);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(x + sx * (w / 2 - .09), h / 2, z + sz * (d / 2 - .09), .18, h, .18, COL.steelDark, .5, .7);
      box(x + sx * (w / 2 - .09), .09, z + sz * (d / 2 - .09), .22, .18, .22, COL.steel, .4, .8);
    }
    const dz = z + d / 2 + .005;
    box(x, h / 2, dz, .04, h - .3, .03, COL.steelDark, .5, .6);
    for (const i of [-3, -1, 1, 3]) cylY(x + i * w / 9, h / 2, dz + .04, .045, h - .4, COL.steelLight, .3, .9);
  }
  function generator(x, z, w, d, h) {
    addObstacle(x, z, w, d, h);
    box(x, h / 2 + .1, z, w - .1, h - .2, d - .1, COL.olive, .6, .3, 0, 0);
    box(x, .1, z, w + .1, .2, d + .1, COL.steelDark, .6, .4, 0, 8);
    box(x, h - .02, z, w, .06, d, COL.oliveDark, .6, .3);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) box(x - w * .3 + i * w * .12, h * .5, z + s * (d / 2 - .03), w * .08, h * .45, .05, COL.oliveDark, .7, .3);
      box(x + w * .36, h * .58, z + s * (d / 2 - .02), .08, .08, .03, COL.amber, .2, 0, 2.2, 3);
      box(x + w * .3, h * .58, z + s * (d / 2 - .02), .06, .06, .03, COL.green, .2, 0, 1.6, 3);
    }
    for (const s of [-1, 1]) {
      cylY(x + s * w * .3, h + .35, z - d * .2, .22, .7, COL.steelDark, .4, .7);
      cylY(x + s * w * .3, h + .72, z - d * .2, .28, .06, COL.steel, .4, .7);
    }
    pipe([x - w / 2 + .05, h * .3, z + d * .3], [x - w / 2 - .4, .05, z + d * .3], .07, COL.rubber, .8, 0);
  }
  function ammoDepot(x, z, w, d, h) {
    addObstacle(x, z, w, d, h);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const bw = w / 3 - .06, bd = d / 2 - .06;
      box(x - w / 3 + i * w / 3, h * .25, z - d / 4 + j * d / 2, bw, h * .5, bd, i % 2 ? COL.olive : COL.oliveDark, .75, .1, 0, 0);
      box(x - w / 3 + i * w / 3, h * .25, z - d / 4 + j * d / 2 + bd / 2 + .005, bw * .5, .08, .01, COL.yellow, .6, 0, .1);
    }
    box(x, h * .75, z, w * .9, h * .5, d * .8, COL.tarp, .95, 0, 0, 0);
    box(x, h - .02, z, w * .95, .05, d * .85, COL.tarp, .95);
  }
  function barrels(x, z, w, d, h) {
    addObstacle(x, z, w, d, h);
    [[-.4, -.4], [.4, -.35], [-.35, .4], [.38, .42]].forEach(([a, b], i) => {
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
  function floodlight(x, z, facing) {
    addObstacle(x, z, .3, .3, 6.4);
    cylY(x, 3.2, z, .16, 6.4, COL.steelDark, .4, .7);
    cylY(x, .2, z, .34, .4, COL.concrete, .9, 0);
    const hx = x + Math.sin(facing) * .9, hz = z + Math.cos(facing) * .9;
    pipe([x, 6.3, z], [hx, 6.25, hz], .05, COL.steelDark);
    box(hx, 6.12, hz, .55, .16, .32, COL.steel, .4, .6, 0, 0, facing);
    light(hx, 6.03, hz, .44, .03, .24, COL.white, 2.4);
    lamp(hx, 5.6, hz, [1, .78, .52], 12, 2.4);
  }
  function car(x, z, w, d, color, burnt) {
    const along = d > w, len = along ? d : w, wid = along ? w : d;
    addObstacle(x, z, w, d, 1.5);
    const ry = along ? 0 : Math.PI / 2;
    const body = burnt ? hex('2a2522') : color;
    const at = (a, b) => along ? [x + a, z + b] : [x + b, z + a];
    let p = at(0, 0);
    box(p[0], .62, p[1], wid, .62, len, body, burnt ? .95 : .35, burnt ? 0 : .5, 0, 0, ry);
    p = at(0, -len * .05);
    box(p[0], 1.18, p[1], wid * .9, .52, len * .5, body, burnt ? .95 : .35, burnt ? 0 : .5, 0, 0, ry);
    box(p[0], 1.18, p[1], wid * .92, .36, len * .44, burnt ? hex('101010') : COL.glass, .1, 0, 0, burnt ? 0 : 5, ry);
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const q = at(a * wid / 2, b * len * .32);
      batch.add(M.CYL, q[0], .34, q[1], .66, .24, .66, COL.rubber, .9, 0, 0, 0, 0, along ? 0 : Math.PI / 2, Math.PI / 2);
    }
    for (const a of [-1, 1]) {
      const f = at(a * wid * .32, len / 2 + .01), r2 = at(a * wid * .32, -len / 2 - .01);
      box(f[0], .7, f[1], .22, .12, .04, burnt ? hex('202020') : COL.white, .3, 0, burnt ? 0 : .5, burnt ? 0 : 3, ry);
      box(r2[0], .7, r2[1], .22, .12, .04, burnt ? hex('202020') : hex('aa1a10'), .3, 0, burnt ? 0 : .6, burnt ? 0 : 3, ry);
    }
    if (burnt) emitters.push({ x, y: 1.3, z, kind: 'smoke', rate: 1.5 });
  }
  function tree(x, z, h = 6) {
    addObstacle(x, z, .7, .7, h);
    cylY(x, h * .35, z, .42, h * .7, COL.bark, .9);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3, r = i ? 1.1 : 0;
      ball(x + Math.cos(a) * r, h * .62 + (i ? 0 : .9) + rnd() * .5, z + Math.sin(a) * r, 2.6, 2.2, 2.6, R.mix(COL.leaf, COL.grass, rnd() * .5), .9, 12);
    }
  }
  function palm(x, z, h = 7) {
    addObstacle(x, z, .6, .6, h);
    for (let i = 0; i < 6; i++) cylY(x + Math.sin(i * .5) * .12, h / 12 + i * h / 6, z, .34 - i * .02, h / 6 + .05, COL.bark, .9);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      box(x + Math.cos(a) * 1.4, h - .2, z + Math.sin(a) * 1.4, 3, .05, .5, COL.palm, .8, 0, 0, 12, -a, 0, -.35);
    }
  }

  // ------------------------------------------------------------------ map: DOCKYARD (container port at dusk)
  function dockyard() {
    box(0, -.15, 0, 64, .3, 80, COL.floor, .72, 0, 0, 2);
    box(0, -.32, 0, 420, .3, 420, COL.asphalt, .85, 0, 0, 11);
    for (const x of [-11, 11, -23, 23]) {
      box(x, .006, 0, .09, .012, 72, COL.yellow, .5, 0, .1);
      for (let z = -34; z < 36; z += 6) box(x + .55, .007, z, 1, .012, .08, COL.yellow, .5, 0, .1);
    }
    box(0, .006, 12, 5, .012, 3.7, COL.steelDark, .35, .3);
    for (const s of [-1, 1]) {
      box(s * 2.5, .012, 12, .08, .02, 3.7, COL.yellow, .5, 0, .1);
      box(0, .012, 12 + s * 1.85, 5, .02, .08, COL.yellow, .5, 0, .1);
    }
    // Perimeter: port walls with razor wire and sodium lights.
    for (const wall of WALLS) box(wall.x, wall.h / 2, wall.z, wall.w, wall.h, wall.d, COL.concrete, .85, 0, 0, 1);
    for (const s of [-1, 1]) {
      box(s * 31.58, .36, 0, .06, .72, 79, COL.concrete, .8, 0, 0, 8);
      box(0, .36, s * 39.58, 63, .72, .06, COL.concrete, .8, 0, 0, 8);
      for (let i = 0; i < 2; i++) {
        pipe([s * 32, 9.2 + i * .25, -40], [s * 32, 9.2 + i * .25, 40], .025, COL.steelLight, .3, .9);
        pipe([-32, 9.2 + i * .25, s * 40], [32, 9.2 + i * .25, s * 40], .025, COL.steelLight, .3, .9);
      }
      for (let z = -36; z <= 36; z += 8) {
        box(s * 31.68, 4.5, z, .45, 9, .6, COL.steelDark, .4, .7);
        box(s * 31.3, 8.2, z, .5, .2, .3, COL.steel, .4, .6);
        light(s * 31.3, 8.08, z, .4, .03, .2, COL.sodium, 2.2);
        box(s * 31.62, 2.9, z + 4, .1, 3.6, 4.6, COL.concreteLight, .7, 0, 0, 1);
      }
      for (let x = -28; x <= 28; x += 8) {
        box(x, 4.5, s * 39.68, .6, 9, .45, COL.steelDark, .4, .7);
        light(x, 7.2, s * 39.42, 1.2, .1, .05, COL.sodium, 1.6);
      }
      pipe([s * 31.45, 6.3, -39], [s * 31.45, 6.3, 39], .14, COL.steel);
      pipe([s * 31.42, 6.75, -39], [s * 31.42, 6.75, 39], .09, hex('8c3a2a'), .5, .5);
    }
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
    // Cover (collision layout matches the original arena).
    barrier(-7, 5, 3.2, 2.1, 1.8); barrier(7, 5, 3.2, 2.1, 1.8);
    barrier(-5, -4, 3, 2.3, 1.55); barrier(5, -4, 3, 2.3, 1.55);
    generator(0, -11, 3.4, 2.1, 1.35);
    crates(-11, -13, 2.8, 3, 2.5); crates(11, -13, 2.8, 3, 2.5);
    barrier(0, 18, 4, 2, 2.2);
    let ci = 0;
    for (const x of [-22, 22]) for (const z of [-26, -9, 9, 26]) container(x, z, 4.5, 6, 2.6, CONTAINER_COLORS[ci++ % CONTAINER_COLORS.length]);
    for (const x of [-10, 10]) for (const z of [-29, 30]) generator(x, z, 4, 2.8, 1.9);
    for (const z of [-35, 35]) ammoDepot(0, z, 5, 2.8, 2.1);
    barrels(-16, 6, 1.6, 1.6, 1.05); barrels(16, -6, 1.6, 1.6, 1.05);
    barrels(-27, -18, 1.6, 1.6, 1.05); barrels(27, 18, 1.6, 1.6, 1.05);
    crates(14, 22, 2, 2, 1.6); crates(-14, -22, 2, 2, 1.6);
    crates(-26, 31, 2.4, 1.6, 1.2); crates(26, -31, 2.4, 1.6, 1.2);
    for (const [x, z, f] of [[-28, -36, .8], [28, -36, -.8], [-28, 36, 2.4], [28, 36, -2.4], [-28, 0, 1.57], [28, 0, -1.57]]) floodlight(x, z, f);
    pipe([-6, .04, 9], [-2.5, .04, 14.5], .035, COL.rubber, .8, 0);
    pipe([9, .04, -6], [14, .04, -9], .035, COL.rubber, .8, 0);
    debris(COL.concrete, COL.steel);
    // Port skyline: container stacks, gantry cranes, a distant city.
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1, x = side * (40 + rnd() * 30), z = -70 + rnd() * 140, levels = 1 + Math.floor(rnd() * 4);
      for (let l = 0; l < levels; l++) box(x, 1.3 + l * 2.6, z, 6.1, 2.55, 2.45, CONTAINER_COLORS[(i + l) % CONTAINER_COLORS.length], .6, .3, 0, 7);
    }
    for (const x of [-26, 4, 30]) crane(x, -66);
    for (let i = 0; i < 30; i++) {
      const a = rnd() * Math.PI * 2, dist = 120 + rnd() * 60;
      const h = 16 + rnd() * rnd() * 70;
      box(Math.sin(a) * dist, h / 2 - .5, Math.cos(a) * dist, 10 + rnd() * 14, h, 10 + rnd() * 12, rnd() > .5 ? COL.tower : COL.towerLight, .8, .2, 0, 6, a);
    }
  }
  function crane(x, z) {
    for (const s of [-1, 1]) for (const t of [-1, 1]) box(x + s * 6, 14, z + t * 5, .8, 28, .8, hex('b8502a'), .6, .4);
    box(x, 28.5, z, 13, 1.4, 11, hex('b8502a'), .6, .4);
    box(x, 30, z + 18, 2.2, 1.8, 46, hex('c8602a'), .6, .4);
    box(x, 26, z, 5, 3, 4, hex('d9d4c8'), .6, .2);
    light(x, 31.2, z + 40, .6, .6, .6, COL.red, 3);
  }
  function debris(c1, c2) {
    for (let i = 0; i < 60; i++) {
      const x = -30 + rnd() * 60, z = -38 + rnd() * 76, s = .06 + rnd() * .18;
      if (!freeAt(x, z, .3)) continue;
      box(x, s / 2, z, s * 1.4, s, s, rnd() > .5 ? c1 : c2, .9, 0, 0, 0, rnd() * 3);
    }
  }

  // ------------------------------------------------------------------ map: DUST TOWN (desert town, crash site)
  function adobe(x, z, w, d, h, tint) {
    addObstacle(x, z, w, d, h);
    const c = tint || COL.plaster;
    box(x, h / 2, z, w, h, d, c, .95, 0, 0, 10);
    box(x, h + .25, z, w + .1, .5, d + .1, R.mix(c, COL.plasterDark, .5), .95, 0, 0, 10);
    box(x, h + .02, z, w - .4, .06, d - .4, COL.plasterDark, .95, 0, 0, 10);
    const floors = Math.max(1, Math.floor(h / 3));
    for (const s of [-1, 1]) {
      for (let f = 0; f < floors; f++) {
        const y = 1.7 + f * 3;
        for (let i = -1; i <= 1; i++) {
          if (w > 6) {
            box(x + i * w / 3.2, y, z + s * (d / 2 + .01), .9, 1.1, .03, hex('1a1612'), .9, 0, 0, 0);
            box(x + i * w / 3.2 - .55, y, z + s * (d / 2 + .05), .2, 1.1, .05, COL.wood, .9, 0, 0, 13);
          }
          if (d > 6) {
            box(x + s * (w / 2 + .01), y, z + i * d / 3.2, .03, 1.1, .9, hex('1a1612'), .9, 0, 0, 0);
            box(x + s * (w / 2 + .05), y, z + i * d / 3.2 - .55, .05, 1.1, .2, COL.wood, .9, 0, 0, 13);
          }
        }
      }
      box(x + w * .18, 1.1, z + s * (d / 2 + .02), 1.1, 2.2, .04, COL.wood, .9, 0, 0, 13);
    }
    // Awning, rooftop clutter.
    const awn = [COL.cloth1, COL.cloth2, COL.cloth3][Math.floor(rnd() * 3)];
    box(x - w * .2, 2.7, z + d / 2 + .7, 2.6, .05, 1.4, awn, .9, 0, 0, 0, 0, .25);
    pipe([x - w * .2 - 1.25, 2.4, z + d / 2 + 1.35], [x - w * .2 - 1.25, 0, z + d / 2 + 1.35], .03, COL.wood, .9, 0);
    pipe([x - w * .2 + 1.25, 2.4, z + d / 2 + 1.35], [x - w * .2 + 1.25, 0, z + d / 2 + 1.35], .03, COL.wood, .9, 0);
    box(x + w * .25, h + .4, z - d * .2, .9, .6, .7, COL.steelLight, .5, .5);
    cylY(x - w * .25, h + .6, z - d * .25, 1, 1.1, COL.steel, .4, .6);
    if (rnd() > .4) batch.add(M.BALL, x + w * .3, h + .9, z + d * .25, .9, .9, .25, COL.white, .4, .3, 0, 0, -.6, 0, 0);
  }
  function stall(x, z, w, d) {
    addObstacle(x, z, w, d, 2.4);
    box(x, .45, z, w, .9, d, COL.wood, .9, 0, 0, 13);
    for (const s of [-1, 1]) for (const t of [-1, 1]) cylY(x + s * (w / 2 - .08), 1.2, z + t * (d / 2 - .08), .08, 2.4, COL.wood, .9);
    box(x, 2.4, z, w + .5, .06, d + .5, rnd() > .5 ? COL.cloth1 : COL.cloth3, .95, 0, 0, 0, 0, .12);
    for (let i = 0; i < 9; i++) ball(x - w / 2 + .35 + (i % 3) * (w - .7) / 2, .98, z - d / 4 + Math.floor(i / 3) * d / 4, .26, .26, .26, [hex('d84a1a'), hex('e8c02a'), hex('6aa22a')][i % 3], .6);
  }
  function heliWreck(x, z) {
    addObstacle(x, z, 6, 3, 2.4);
    addObstacle(x + 4.4, z - 2.6, 3.4, 1.2, 1.2);
    const body = hex('3c4430');
    box(x, 1.2, z, 5.6, 2.2, 2.6, body, .8, .3, 0, 0, 0, 0, .35);
    box(x - 2.4, 1.3, z, 1.6, 1.6, 2.2, hex('101418'), .2, .1, 0, 5, 0, 0, .35);
    box(x + 4.3, .7, z - 2.6, 3.6, .7, .7, body, .8, .3, 0, 0, -.5, 0, .2);
    box(x + 5.8, 1.3, z - 3.4, .2, 1.4, .9, body, .8, .3);
    for (const a of [.3, 1.9, 3.5]) box(x + Math.cos(a) * 2.2, .25 + rnd() * .2, z + Math.sin(a) * 2.6, 4.2, .06, .3, hex('202020'), .7, .5, 0, 0, a, 0, (rnd() - .5) * .3);
    box(x - .5, .05, z + 2.4, 4, .1, 2.5, hex('15110e'), .95, 0, 0, 0);
    emitters.push({ x: x + .5, y: 2.2, z, kind: 'smoke', rate: 5 }, { x: x - .4, y: 1.4, z: z + .5, kind: 'fire', rate: 9 });
    lamp(x, 1.8, z + 1, [1, .5, .2], 8, 3);
  }
  function dustTown() {
    box(0, -.15, 0, 64, .3, 80, COL.sand, .95, 0, 0, 11);
    box(0, -.32, 0, 420, .3, 420, hex('b8976a'), .95, 0, 0, 11);
    box(0, .005, 0, 7, .01, 80, hex('8d7552'), .95, 0, 0, 11);
    box(0, .006, -18, 64, .01, 6, hex('8d7552'), .95, 0, 0, 11);
    // Perimeter facades.
    for (const wall of WALLS) box(wall.x, wall.h / 2, wall.z, wall.w, wall.h, wall.d, COL.plasterDark, .95, 0, 0, 10);
    for (const s of [-1, 1]) {
      for (let z = -36; z <= 36; z += 6) {
        const h = 6 + rnd() * 3;
        box(s * 31.2, h / 2, z, 1.2, h, 5.8, R.mix(COL.plaster, COL.plasterDark, rnd()), .95, 0, 0, 10);
        box(s * 30.58, h * .6, z, .03, 1.1, .9, hex('1a1612'), .9);
        box(s * 30.58, 1.1, z + 1.6, .03, 2.2, 1, COL.wood, .9, 0, 0, 13);
      }
      for (let x = -28; x <= 28; x += 6) {
        const h = 6 + rnd() * 3;
        box(x, h / 2, s * 39.2, 5.8, h, 1.2, R.mix(COL.plaster, COL.plasterDark, rnd()), .95, 0, 0, 10);
        box(x, h * .6, s * 38.58, .9, 1.1, .03, hex('1a1612'), .9);
      }
    }
    // Buildings.
    adobe(-21, -25, 12, 12, 7); adobe(21, -25, 12, 12, 8, hex('d1b893'));
    adobe(-22, 4, 10, 12, 6, hex('bfa27a')); adobe(22, 6, 10, 14, 9);
    adobe(-10, -35, 10, 6, 5, hex('d1b893')); adobe(12, 33, 14, 8, 6, hex('bfa27a'));
    adobe(-16, 30, 8, 8, 4.5); adobe(2, -27, 6, 5, 3.5, hex('d1b893'));
    heliWreck(0, -6);
    sandbags(0, 22, 5, 1, 1.1); sandbags(-6, -16, 4, 1, 1.1); sandbags(6, -15, 4, 1, 1.1);
    sandbags(-27, -8, 1, 5, 1.1); sandbags(27, -10, 1, 5, 1.1); sandbags(-4, 30, 1, 4, 1.1);
    car(11, -1, 2, 4.4, hex('9a2a1a'), true); car(-12, 15, 4.4, 2, hex('d9d4c8'), false); car(14, 18, 2, 4.4, hex('2a4a6a'), false);
    stall(-9, -3, 3.5, 2); stall(10, 13, 3.5, 2);
    crates(-2, 32, 2, 2, 1.6); barrels(15, -14, 1.6, 1.6, 1.05); crates(-27, 20, 2.4, 1.6, 1.2);
    for (const [x, z] of [[-28, -36], [28, 36], [-6, 36], [26, -36], [-29, 14]]) palm(x, z, 6 + rnd() * 2);
    // Washing lines and wires across streets.
    pipe([-16, 5.5, -25], [-2, 5, -25], .01, hex('202020'), .9, 0);
    pipe([17, 5.5, 6], [4, 4.5, 2], .01, hex('202020'), .9, 0);
    for (let i = 0; i < 5; i++) box(-14 + i * 2.4, 4.9, -25, .7, .8, .03, [COL.cloth1, COL.white, COL.cloth2, COL.cloth3, COL.white][i], .95);
    debris(COL.plasterDark, hex('6a5a48'));
    // Town beyond the walls, a minaret and mountains.
    for (let i = 0; i < 46; i++) {
      const a = i / 46 * Math.PI * 2, dist = 46 + rnd() * 30;
      const x = Math.sin(a) * dist * 1.05, z = Math.cos(a) * dist * 1.2, h = 5 + rnd() * 9;
      box(x, h / 2, z, 6 + rnd() * 8, h, 6 + rnd() * 8, R.mix(COL.plaster, COL.plasterDark, rnd()), .95, 0, 0, 10, a);
    }
    cylY(-34, 14, -58, 3, 28, COL.plaster, .9, 0, 0, 10);
    ball(-34, 29, -58, 4, 4, 4, hex('3a7a6a'), .5);
    cylY(-34, 31.6, -58, .2, 2, COL.yellow, .4, .6);
    for (let i = 0; i < 9; i++) ball(-180 + i * 45, -4, -170 + (i % 2) * 30, 90, 40 + rnd() * 30, 50, COL.mountain, .95, 11);
    for (let i = 0; i < 6; i++) ball(-150 + i * 60, -4, 170, 90, 30 + rnd() * 20, 40, COL.mountain, .95, 11);
  }

  // ------------------------------------------------------------------ map: ATOMIC SUBURB (test-site cul-de-sac)
  function house(x, z, w, d, h, color, facing) {
    addObstacle(x, z, w, d, h + 1.4);
    box(x, h / 2, z, w, h, d, color, .8, 0, 0, 13);
    box(x, .3, z, w + .1, .6, d + .1, COL.concreteLight, .9, 0, 0, 1);
    // Low hip roof with a flat deck you can stand on.
    const roof = hex('3a3634');
    box(x, h + .7, z, w + .8, 1.4, d + .8, roof, .9, 0, 0, 0);
    box(x, h + 1.42, z, w - 1, .06, d - 1, hex('2a2826'), .9);
    box(x + w * .3, h + 2.1, z - d * .25, .8, 1.6, .8, hex('8a4a3a'), .9, 0, 0, 1);
    const fx = facing;
    for (let f = 0; f < 2; f++) {
      const y = 1.6 + f * 2.6;
      for (const t of [-1, 1]) {
        const wz = z + t * d * .27;
        box(x + fx * (w / 2 + .02), y, wz, .05, 1.2, 1.6, COL.glass, .1, 0, 0, 5);
        box(x + fx * (w / 2 + .04), y, wz, .06, 1.34, .1, COL.white, .6);
        box(x + fx * (w / 2 + .04), y, wz, .06, .1, 1.74, COL.white, .6);
      }
      for (const t of [-1, 0, 1]) {
        box(x + t * w * .3, y, z + d / 2 + .02, 1.3, 1.1, .05, COL.glass, .1, 0, 0, 5);
        box(x + t * w * .3, y, z - d / 2 - .02, 1.3, 1.1, .05, COL.glass, .1, 0, 0, 5);
      }
    }
    box(x + fx * (w / 2 + .03), 1.1, z, .06, 2.2, 1.1, hex('7a2a22'), .6, 0, 0, 13);
    box(x + fx * (w / 2 + 1.2), .12, z, 2.4, .24, 3, COL.concreteLight, .9, 0, 0, 1);
    for (const t of [-1, 1]) cylY(x + fx * (w / 2 + 2.2), 1.4, z + t * 1.3, .16, 2.8, COL.white, .6);
    box(x + fx * (w / 2 + 1.2), 2.85, z, 2.6, .12, 3.2, roof, .9);
    for (const t of [-1, 1]) ball(x + fx * (w / 2 + .6), .5, z + t * (d / 2 - 1.2), 1.4, 1, 1.4, COL.leaf, .9, 12);
  }
  function bus(x, z, w, d) {
    addObstacle(x, z, w, d, 3.2);
    const yel = hex('e8b21a');
    box(x, 1.75, z, w, 2.4, d, yel, .45, .2, 0, 0);
    box(x, 3.0, z, w * .96, .1, d * .98, hex('d8a010'), .5, .2);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) box(x + s * (w / 2 + .01), 2.3, z - d / 2 + 1.4 + i * 1.5, .03, .8, 1.2, COL.glass, .1, 0, 0, 5);
    for (const s of [-1, 1]) box(x + s * (w / 2 + .02), 1.3, z, .03, .12, d * .95, hex('111111'), .6);
    box(x, 2.3, z - d / 2 - .01, w * .85, .9, .03, COL.glass, .1, 0, 0, 5);
    for (const s of [-1, 1]) for (const t of [-1, 1]) batch.add(M.CYL, x + s * (w / 2 - .1), .45, z + t * d * .32, .9, .3, .9, COL.rubber, .9, 0, 0, 0, 0, 0, Math.PI / 2);
    box(x, .55, z, w * .9, .5, d * .9, hex('202020'), .8);
  }
  function fence(x, z, w, d) {
    addObstacle(x, z, w, d, 1.1);
    const along = w > d, len = along ? w : d;
    for (const y of [.35, .85]) box(x, y, z, along ? len : .06, .08, along ? .06 : len, COL.white, .7, 0, 0, 13);
    const n = Math.round(len / .22);
    for (let i = 0; i <= n; i++) {
      const t = -len / 2 + i * len / n;
      box(along ? x + t : x, .55, along ? z : z + t, .09, 1.1, .03 + (along ? 0 : .06), COL.white, .7, 0, 0, 13, along ? 0 : Math.PI / 2);
    }
  }
  function mannequin(x, z, ry, color) {
    const st = new R.Stack();
    st.reset().translate(x, 0, z).rotY(ry);
    const c = color, skin = hex('e0cdb8');
    const p = (lx, ly, lz, sx, sy, sz, col, mesh = M.CUBE) => batch.part(mesh, st, lx, ly, lz, sx, sy, sz, col, .5, .1, 0, 0);
    for (const s of [-1, 1]) { p(s * .1, .45, 0, .14, .9, .16, c); p(s * .26, 1.15, 0, .1, .6, .12, skin); }
    p(0, 1.15, 0, .38, .6, .22, c);
    p(0, 1.6, 0, .22, .26, .22, skin, M.BALL);
    p(0, .02, 0, .5, .04, .5, hex('202020'), M.CYL);
  }
  function suburb() {
    box(0, -.15, 0, 64, .3, 80, COL.grass, .95, 0, 0, 12);
    box(0, -.32, 0, 420, .3, 420, hex('b8976a'), .95, 0, 0, 11);
    box(0, .004, 0, 12, .01, 80, COL.road, .9, 0, 0, 11);
    for (let z = -36; z < 38; z += 5) box(0, .012, z, .14, .01, 2.4, COL.yellow, .6, 0, .05);
    for (const s of [-1, 1]) box(s * 7, .03, 0, 2, .06, 80, COL.sidewalk, .9, 0, 0, 1);
    for (const s of [-1, 1]) box(s * 11, .02, s * -28, 4, .04, 8, COL.road, .9, 0, 0, 11);
    // Perimeter: low block wall and chain-link fence; the desert beyond.
    for (const wall of WALLS) {
      const lowH = 1.4;
      box(wall.x, lowH / 2, wall.z, wall.w, lowH, wall.d, COL.concreteLight, .9, 0, 0, 1);
    }
    for (const s of [-1, 1]) {
      for (let z = -38; z <= 38; z += 4) cylY(s * 31.8, 2.6, z, .08, 2.4, COL.steelLight, .4, .8);
      for (let x = -30; x <= 30; x += 4) cylY(x, 2.6, s * 39.8, .08, 2.4, COL.steelLight, .4, .8);
      box(s * 31.8, 2.6, 0, .02, 2.2, 80, hex('6a7076'), .5, .6, 0, 0);
      box(0, 2.6, s * 39.8, 64, 2.2, .02, hex('6a7076'), .5, .6, 0, 0);
    }
    house(-20, 0, 12, 16, 5.2, hex('7fa6b8'), 1);
    house(20, 0, 12, 16, 5.2, hex('c9b07a'), -1);
    adobe(-21, -24, 9, 8, 4.2, hex('b8b0a0'));
    adobe(21, 24, 9, 8, 4.2, hex('b8b0a0'));
    bus(0, -8, 3, 11);
    car(-8, 22, 2, 4.4, hex('3a6a9a'), false); car(8, -24, 2, 4.4, hex('9a3a2a'), false);
    car(9, 22, 2.4, 5.6, hex('5a6a3a'), false); car(-9, -27, 4.4, 2, hex('d9d4c8'), true);
    fence(-11.5, -14, .2, 8); fence(11.5, 14, .2, 8); fence(-20, 11.5, 8, .2); fence(20, -11.5, 8, .2);
    for (const [x, z] of [[-28, 16], [28, -16], [-27, -34], [27, 34], [-3, 33], [4, -34]]) tree(x, z, 5.5 + rnd() * 1.5);
    sandbags(-4, 26, 3, 1, 1.1); sandbags(4, -26, 3, 1, 1.1);
    crates(26, -4, 2, 2, 1.6); crates(-26, 4, 2, 2, 1.6);
    mannequin(-12.6, -4, 1.4, hex('c84a3a')); mannequin(-12.8, 4, 1.9, hex('3a6ac8'));
    mannequin(12.6, 3, -1.6, hex('e0c040')); mannequin(13, -5, -1.2, hex('3aa860'));
    for (const s of [-1, 1]) {
      cylY(s * 8.4, .6, s * 9, .1, 1.2, COL.woodLight, .8);
      box(s * 8.4, 1.25, s * 9, .5, .3, .25, s > 0 ? COL.cloth1 : COL.cloth2, .5, .3);
    }
    lamp(-14, 4, 0, [1, .9, .75], 9, 1.2);
    lamp(14, 4, 0, [1, .9, .75], 9, 1.2);
    debris(hex('6a6058'), COL.steel);
    // Desert test site beyond: mountains, water tower, observation tower.
    for (let i = 0; i < 10; i++) ball(-200 + i * 45, -6, -180 + (i % 3) * 20, 100, 45 + rnd() * 35, 60, COL.mountain, .95, 11);
    for (let i = 0; i < 8; i++) ball(-170 + i * 50, -6, 185, 100, 35 + rnd() * 25, 50, COL.mountain, .95, 11);
    for (let i = 0; i < 6; i++) ball(190, -6, -150 + i * 60, 60, 30 + rnd() * 25, 100, COL.mountain, .95, 11);
    for (const s of [-1, 1]) for (const t of [-1, 1]) cylY(48 + s * 2.5, 9, -60 + t * 2.5, .3, 18, COL.steelLight, .5, .7);
    cylY(48, 20, -60, 7, 5, COL.white, .5, .3);
    ball(48, 22.6, -60, 7, 2, 7, COL.white, .5);
    for (const s of [-1, 1]) cylY(-55 + s * 1.5, 14, 52, .25, 28, COL.steel, .5, .7);
    box(-55, 28.5, 52, 5, 3, 5, COL.steelDark, .6, .4);
    light(-55, 30.3, 52, .5, .5, .5, COL.red, 3);
  }

  // ------------------------------------------------------------------ registry
  const MAPS = {
    dockyard: {
      name: 'DOCKYARD', time: 'DUSK', blurb: 'Container port at dusk. Tight lanes and stacked cover.', build: dockyard,
      env: { sunDir: [-0.55, 0.40, 0.45], sunCol: [2.5, 1.6, 0.92], skyCol: [0.15, 0.21, 0.33], groundCol: [0.085, 0.07, 0.06], fogCol: [0.16, 0.155, 0.195],
        zenith: [0.05, 0.11, 0.27], horizon: [0.78, 0.44, 0.27], fogDensity: 0.0085, exposure: 1.0 },
      grade: { saturation: 1.0, contrast: 1.08 },
      menu: { eye: [11, 2.4, 19.5], target: [4.6, 1.5, 9], squad: [[4.2, 8.4], [6.2, 9.6], [2.6, 9.9], [7.9, 11.2]] }
    },
    town: {
      name: 'DUST TOWN', time: 'NOON', blurb: 'Desert town at noon. Fight around the helicopter crash site.', build: dustTown,
      env: { sunDir: [0.35, 0.78, 0.3], sunCol: [2.45, 2.0, 1.45], skyCol: [0.24, 0.29, 0.38], groundCol: [0.16, 0.12, 0.08], fogCol: [0.4, 0.35, 0.28],
        zenith: [0.14, 0.3, 0.55], horizon: [0.76, 0.66, 0.52], fogDensity: 0.0075, exposure: 0.76 },
      grade: { saturation: 0.92, contrast: 1.1 },
      menu: { eye: [9, 2.5, 8], target: [2, 1.5, -3], squad: [[3.4, -.4], [5.4, .9], [1.6, 1.4], [6.6, -1.8]] }
    },
    suburb: {
      name: 'ATOMIC SUBURB', time: 'MORNING', blurb: 'Test-site cul-de-sac. Two houses, one bus, no mercy.', build: suburb,
      env: { sunDir: [0.6, 0.55, -0.32], sunCol: [2.6, 2.2, 1.75], skyCol: [0.3, 0.4, 0.56], groundCol: [0.12, 0.14, 0.08], fogCol: [0.5, 0.55, 0.62],
        zenith: [0.1, 0.27, 0.6], horizon: [0.68, 0.74, 0.8], fogDensity: 0.0055, exposure: 0.86 },
      grade: { saturation: 1.12, contrast: 1.05 },
      menu: { eye: [9, 2.5, 9], target: [2, 1.5, -3], squad: [[3.4, -.6], [5.4, .8], [1.6, 1.4], [6.6, -2]] }
    }
  };
  let currentId = '';
  const current = { id: '', name: '', grade: MAPS.dockyard.grade };
  function load(id) {
    if (!MAPS[id]) id = 'dockyard';
    if (id === currentId) return false;
    currentId = id;
    obstacles.length = 0; lamps.length = 0; emitters.length = 0;
    batch.clear();
    seed = 91;
    const m = MAPS[id];
    m.build();
    R.setEnv(m.env);
    R.setStatic([batch], obstacles.concat(WALLS), [-32, -40, 64, 80]);
    Object.assign(current, { id, name: m.name, grade: m.grade });
    return true;
  }
  load('dockyard');

  /** Fills spare light slots with the static lamps closest to the camera. */
  function nearestLamps(x, z, count, out) {
    const sorted = lamps.map(l => [Math.hypot(l.x - x, l.z - z), l]).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < count && i < sorted.length; i++) out.push(sorted[i][1]);
    return out;
  }

  return { batch, obstacles, WALLS, lamps, emitters, MAPS, current, load, freeAt, freeAtHeight, groundAt, move, rayBox, wallDistance, nearestLamps, colors: COL, bounds: { width: 64, depth: 80 } };
})();
