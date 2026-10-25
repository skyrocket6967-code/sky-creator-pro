'use strict';
// Procedural character, weapon and pickup models built from instanced boxes, cylinders and spheres.
window.StrikeModels = (() => {
  const R = window.StrikeRenderer, M = R.MESH, hex = R.rgb;
  const HALF_PI = Math.PI / 2;
  const st = new R.Stack();
  const C = {
    cloth: hex('1f262c'), joint: hex('14181c'), dark: hex('20262c'), metal: hex('3d454d'), steel: hex('7d878d'), silver: hex('b8c0c2'),
    white: hex('f2f4f2'), brass: hex('c99a45'), glove: hex('1c1f22'), sleeve: hex('252a2e'), skin: hex('8b6a52')
  };
  const TYPES = {
    grunt: { armor: hex('4d6a7d'), trim: hex('2c3d48'), accent: hex('ff4a3a') },
    rusher: { armor: hex('5b5f90'), trim: hex('34365a'), accent: hex('ff8a2a') },
    heavy: { armor: hex('5f6a4c'), trim: hex('393f2c'), accent: hex('ffb340') },
    sniper: { armor: hex('4e5d55'), trim: hex('2b332e'), accent: hex('b88cff') },
    medic: { armor: hex('ccd8d3'), trim: hex('7c8a86'), accent: hex('38f0e0') },
    bomber: { armor: hex('8d5236'), trim: hex('4e2c1c'), accent: hex('ffb040') },
    boss: { armor: hex('b38d4f'), trim: hex('5a4422'), accent: hex('ff3a2a') }
  };

  function cube(b, x, y, z, sx, sy, sz, c, rough = .5, metal = 0, glow = 0, mode = 0) { b.part(M.CUBE, st, x, y, z, sx, sy, sz, c, rough, metal, glow, mode); }
  function cyl(b, x, y, z, d, h, c, rough = .5, metal = 0, glow = 0, mode = 0) { b.part(M.CYL, st, x, y, z, d, h, d, c, rough, metal, glow, mode); }
  function ball(b, x, y, z, d, c, rough = .5, metal = 0, glow = 0, mode = 0) { b.part(M.BALL, st, x, y, z, d, d, d, c, rough, metal, glow, mode); }
  /** Cylinder lying along the local z axis. */
  function tube(b, x, y, z, d, len, c, rough = .4, metal = .7, glow = 0, mode = 0) {
    st.push().translate(x, y, z).rotX(HALF_PI);
    b.part(M.CYL, st, 0, 0, 0, d, len, d, c, rough, metal, glow, mode);
    st.pop();
  }
  /** World position of a local point under the current stack top. */
  function point(x, y, z, out) {
    const m = st.top;
    out[0] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[2] = m[8] * x + m[9] * y + m[10] * z + m[11];
    return out;
  }

  // ------------------------------------------------------------------ robots
  /**
   * Draws one enemy. `e` carries x, z, angle, phase, type, boss, size, hp, dead, hit, flash, move, aim.
   * Returns nothing; stores the muzzle position in e.muzzle for effects.
   */
  function robot(b, e, time, far) {
    const alive = e.hp > 0;
    const dying = alive ? 0 : Math.min(1, (time - e.dead) / .55);
    const fade = alive ? 1 : Math.max(0, 1 - Math.max(0, time - e.dead - 1.1) * 1.8);
    if (fade <= 0) return;
    const type = e.boss ? 'boss' : (e.type || 'grunt');
    const pal = TYPES[type] || TYPES.grunt;
    const flash = time < (e.hit || 0);
    const armor = flash ? C.white : pal.armor, trim = flash ? hex('d8e0e0') : pal.trim, accent = pal.accent;
    const heavy = type === 'heavy' || type === 'boss', lean = type === 'rusher';
    const wide = heavy ? 1.22 : lean ? .9 : 1;
    const size = (e.size || 1);
    const move = alive ? Math.min(1, e.move ?? .6) : 0;
    const ph = (e.phase || 0) * 2;
    const breathe = Math.sin(time * 2.1 + (e.id || 0)) * .012;
    const sink = alive ? 0 : -Math.max(0, time - e.dead - .9) * .5;

    st.reset().translate(e.x, sink, e.z).rotY(e.angle || 0).scale(size);
    if (!alive) st.rotX(dying * dying * 1.45).rotZ(dying * .25 * ((e.id || 0) % 2 ? 1 : -1));
    if (alive && move > .1) st.translate(0, Math.abs(Math.sin(ph)) * .035 * move, 0);

    // Legs.
    for (const side of [-1, 1]) {
      const swing = alive ? Math.sin(ph + (side > 0 ? 0 : Math.PI)) * .5 * move : .25;
      const knee = alive ? -(Math.max(0, Math.sin(ph + (side > 0 ? 0 : Math.PI) + 1.3)) * .85 * move + .12) : -.6;
      st.push().translate(side * .13 * wide, .95, 0).rotX(swing);
      cyl(b, 0, -.21, 0, .17, .42, C.cloth, .8);
      cube(b, 0, -.17, -.075, .16 * wide, .26, .06, armor, .45, .25, 0, 4);
      if (!far) cube(b, side * .085, -.2, 0, .03, .22, .12, trim, .5, .3);
      cube(b, 0, -.43, -.085, .14, .13, .08, trim, .45, .3, 0, 4);
      st.push().translate(0, -.43, 0).rotX(knee);
      cyl(b, 0, -.2, 0, .15, .4, C.cloth, .8);
      cube(b, 0, -.18, -.07, .14, .32, .06, armor, .45, .25, 0, 4);
      cube(b, 0, -.445, -.05, .15, .08, .3, C.dark, .7, .2);
      if (!far) cube(b, 0, -.4, .09, .1, .06, .06, C.metal, .5, .5);
      st.pop().pop();
    }

    // Pelvis and torso.
    cube(b, 0, .98, 0, .38 * wide, .18, .27, C.dark, .6, .3);
    if (!far) cube(b, 0, .98, -.15, .2, .1, .04, C.metal, .4, .6);
    cyl(b, 0, 1.13, 0, .26 * wide, .22, C.cloth, .8);
    st.push().translate(0, 1.42 + breathe, 0).rotX(lean ? .25 : .06).rotY(alive ? Math.sin(time * .9 + (e.id || 0)) * .05 : 0);
    cube(b, 0, 0, 0, .54 * wide, .42, .32, armor, .4, .3, 0, 4);
    cube(b, 0, .02, -.175, .42 * wide, .3, .05, trim, .4, .35, 0, 4);
    cube(b, 0, .04, -.205, .09, .09, .02, accent, .2, 0, 2.6, 3);
    cube(b, 0, -.24, -.11, .32 * wide, .12, .1, armor, .45, .25, 0, 4);
    if (!far) {
      cube(b, 0, .22, 0, .36 * wide, .06, .26, C.dark, .5, .4);
      for (const s of [-1, 1]) cube(b, s * .14 * wide, -.05, -.21, .1, .14, .03, C.metal, .4, .6);
    }
    cube(b, 0, .02, .22, .4 * wide, .36, .14, C.dark, .55, .35);
    // Shoulders.
    for (const side of [-1, 1]) {
      if (heavy) cube(b, side * .37 * wide, .16, 0, .3, .22, .4, armor, .4, .35, 0, 4);
      else ball(b, side * .33 * wide, .14, 0, .23, armor, .4, .3, 0, 4);
    }
    // Type details.
    if (type === 'medic') {
      cube(b, 0, .05, -.208, .05, .17, .015, hex('38f0e0'), .2, 0, 1.6, 3);
      cube(b, 0, .05, -.208, .17, .05, .015, hex('38f0e0'), .2, 0, 1.6, 3);
      st.push().translate(.42, .55 + Math.sin(time * 3 + (e.id || 0)) * .06, .12);
      ball(b, 0, 0, 0, .16, C.white, .3, .4);
      ball(b, 0, 0, -.06, .07, accent, .2, 0, 2.5, 3);
      st.pop();
    } else if (type === 'bomber') {
      for (const s of [-1, 1]) {
        cyl(b, s * .11, .02, .33, .16, .42, hex('c07a2a'), .45, .4);
        cyl(b, s * .11, .25, .33, .1, .06, C.metal, .4, .6);
      }
      for (let i = -2; i <= 2; i++) cyl(b, i * .09, -.26, -.17, .07, .1, hex('556b2f'), .6, .2);
    } else if (type === 'sniper' && !far) {
      cube(b, 0, -.05, .3, .46, .55, .04, C.cloth, .9, 0);
    } else if (type === 'boss') {
      for (const s of [-1, 1]) {
        tube(b, s * .4, .38, -.05, .14, .5, C.metal, .4, .7);
        cube(b, s * .4, .38, .16, .2, .16, .2, C.dark, .4, .5);
        cube(b, s * .4, .38, -.31, .06, .06, .02, accent, .2, 0, 2.4, 3);
      }
      cube(b, 0, .05, -.21, .22, .14, .02, accent, .2, 0, 3, 3);
    }

    // Head.
    const look = alive ? Math.max(-.4, Math.min(.4, e.aim || 0)) : .3;
    st.push().translate(0, .34, 0).rotX(-look * .6);
    cyl(b, 0, .03, 0, .12, .12, C.joint, .6, .3);
    cube(b, 0, .17, .01, .28, .26, .3, armor, .35, .3, 0, 4);
    cube(b, 0, .31, .02, .22, .05, .24, trim, .4, .3, 0, 4);
    cube(b, 0, .165, -.145, .235, .08, .03, accent, .1, 0, flash ? 3.5 : 1.8, 5);
    cube(b, 0, .075, -.125, .2, .08, .08, C.dark, .5, .4);
    if (!far) {
      for (const s of [-1, 1]) cube(b, s * .15, .16, .02, .04, .13, .15, C.dark, .5, .4);
      if (type === 'sniper') cube(b, 0, .2, .1, .32, .3, .22, C.cloth, .9);
      if (type === 'sniper' || type === 'boss') cyl(b, .1, .42, .08, .015, .22, C.steel, .4, .7);
      if (type === 'boss') for (const s of [-1, 1]) { st.push().translate(s * .12, .33, -.02).rotZ(-s * .5); cube(b, 0, .07, 0, .04, .16, .05, accent, .3, .2, 1.2, 0); st.pop(); }
      if (type === 'rusher') cube(b, 0, .33, .05, .04, .07, .26, accent, .3, 0, 1.2, 0);
    }
    st.pop();

    // Arms holding the weapon (or blades for rushers).
    for (const side of [-1, 1]) {
      const upper = alive ? (lean ? .35 + Math.sin(ph + (side > 0 ? Math.PI : 0)) * .5 * move : side > 0 ? .55 : .95) : -.2;
      const elbow = alive ? (lean ? .8 : side > 0 ? 1.05 : .55) : .2;
      st.push().translate(side * .35 * wide, .12, 0).rotX(upper).rotZ(side * (lean ? .1 : .18));
      cyl(b, 0, -.15, 0, .15, .3, C.cloth, .8);
      cube(b, 0, -.11, 0, .16, .22, .18, armor, .45, .25, 0, 4);
      ball(b, 0, -.31, 0, .12, C.joint, .6, .3);
      st.push().translate(0, -.31, 0).rotX(elbow).rotZ(side * (lean ? 0 : -.35));
      cyl(b, 0, -.14, 0, .13, .28, C.cloth, .8);
      cube(b, 0, -.12, 0, .14, .2, .15, trim, .45, .3, 0, 4);
      cube(b, 0, -.31, 0, .1, .1, .1, C.dark, .6, .3);
      if (lean && !far) cube(b, 0, -.33, -.25, .03, .06, .5, C.silver, .2, .9, 0, 0);
      st.pop().pop();
    }
    if (!lean) {
      const long = type === 'sniper', big = heavy;
      st.push().translate(.1, -.02, -.36).rotX(alive ? -look * .5 : .4);
      cube(b, 0, 0, 0, big ? .12 : .08, big ? .16 : .12, long ? .62 : .5, C.dark, .45, .6);
      cube(b, 0, .02, -(long ? .52 : .36), .045, .045, long ? .45 : .25, C.metal, .35, .8);
      cube(b, 0, -.1, .05, .05, .13, .07, C.metal, .5, .5);
      cube(b, .045, .01, -.05, .012, .025, .32, accent, .2, 0, 1.6, 3);
      if (long) tube(b, 0, .1, .02, .07, .22, C.metal, .3, .8);
      if (big) for (let i = 0; i < 3; i++) tube(b, (i - 1) * .035, .02, -.42, .035, .3, C.steel, .3, .8);
      const tip = -(long ? .76 : big ? .58 : .5);
      e.muzzle = point(0, .02, tip, e.muzzle || [0, 0, 0]);
      if (alive && time < (e.flash || 0)) {
        cube(b, 0, .02, tip - .06, .12, .12, .14, hex('ffcc66'), .2, 0, 3, 3);
      }
      st.pop();
    } else {
      e.muzzle = point(0, .2, -.6, e.muzzle || [0, 0, 0]);
    }
    st.pop();
  }

  // ------------------------------------------------------------------ first-person weapons
  // Each weapon: sight height (for ADS alignment), ADS distance, muzzle position and a builder.
  const black = hex('1a1d21'), gun = hex('2b3036'), gunLight = hex('4a535b'), tan = hex('8a7556'), olive = hex('4d5440');
  const WEAPONS = [
    { // VXR-7 assault rifle
      sight: .105, adsZ: -.27, muzzle: [0, .035, -.66], recoil: 1, build(b, a) {
        receiver(b, gun, .066, .09, .36);
        cube(b, 0, .035, -.32, .07, .07, .26, gunLight, .4, .6);
        rail(b, -.12, .3);
        tube(b, 0, .035, -.55, .024, .2, black, .3, .8);
        tube(b, 0, .035, -.645, .036, .05, black, .4, .7);
        mag(b, 0, -.1, -.05, .045, .17, .075, gun, -.2, a.mag);
        grip(b, gun);
        stock(b, gun, .26);
        reflex(b, .1, a.accent);
        cube(b, .036, .03, -.02, .008, .02, .16, a.accent, .3, 0, 1.4, 3);
      }
    },
    { // WASP-9 SMG
      sight: .1, adsZ: -.24, muzzle: [0, .03, -.55], recoil: .7, build(b, a) {
        receiver(b, gun, .06, .085, .3);
        tube(b, 0, .03, -.39, .055, .26, olive, .5, .4);
        mag(b, 0, -.14, -.08, .04, .24, .05, black, -.05, a.mag);
        grip(b, gun);
        cube(b, 0, .02, .2, .03, .05, .16, black, .5, .5);
        cube(b, 0, -.02, .28, .05, .1, .03, black, .5, .5);
        reflex(b, .095, a.accent);
        cube(b, .033, .03, -.08, .008, .02, .12, a.accent, .3, 0, 1.4, 3);
      }
    },
    { // BREACH-12 pump shotgun
      sight: .085, adsZ: -.3, muzzle: [0, .045, -.74], recoil: 1.8, build(b, a) {
        receiver(b, black, .07, .1, .3);
        tube(b, 0, .045, -.47, .045, .55, gun, .3, .8);
        tube(b, 0, -.005, -.42, .04, .42, gunLight, .35, .7);
        cube(b, 0, -.005, -.36 + a.pump * .09, .075, .07, .2, tan, .7, 0);
        grip(b, black);
        stock(b, tan, .28);
        cube(b, 0, .075, -.72, .012, .012, .012, hex('ffcf6a'), .2, 0, 2.4, 3);
        for (let i = 0; i < 4; i++) cube(b, .04, -.02, .02 - i * .03, .02, .03, .022, hex('b02a2a'), .5, 0);
      }
    },
    { // LONGSHOT marksman rifle
      sight: .13, adsZ: -.2, muzzle: [0, .035, -.86], recoil: 1.6, scope: true, build(b, a) {
        receiver(b, olive, .066, .09, .38);
        tube(b, 0, .035, -.56, .026, .5, black, .3, .8);
        cube(b, 0, .035, -.83, .045, .035, .06, black, .4, .7);
        cube(b, 0, .015, -.33, .07, .08, .24, olive, .5, .3);
        mag(b, 0, -.09, -.03, .045, .1, .07, black, 0, a.mag);
        grip(b, black);
        stock(b, olive, .3);
        tube(b, 0, .125, -.06, .055, .3, black, .3, .7);
        tube(b, 0, .125, -.22, .07, .05, black, .3, .7);
        tube(b, 0, .125, .1, .062, .04, black, .3, .7);
        cube(b, 0, .125, -.247, .05, .05, .004, hex('5a2a8a'), .05, 0, 1.2, 5);
        for (const z of [-.12, .02]) cube(b, 0, .09, z, .02, .04, .03, black, .4, .6);
        cube(b, .035, .03, -.15, .008, .02, .2, a.accent, .3, 0, 1.4, 3);
      }
    },
    { // TITAN-60 LMG
      sight: .115, adsZ: -.28, muzzle: [0, .04, -.78], recoil: 1.1, build(b, a) {
        receiver(b, gun, .08, .11, .42);
        tube(b, 0, .04, -.52, .045, .5, gunLight, .4, .7);
        for (let i = 0; i < 6; i++) tube(b, 0, .04, -.34 - i * .06, .058, .012, black, .4, .7);
        cube(b, 0, -.12, -.06, .14, .16, .14, a.accent, .6, .2);
        cube(b, -.08, -.07, -.06, .03, .09, .1, black, .5, .5);
        grip(b, gun);
        stock(b, gun, .26);
        cube(b, 0, .12, -.14, .025, .06, .14, black, .5, .5);
        reflex(b, .11, a.accent);
      }
    },
    { // HELLFIRE rocket launcher
      sight: .17, adsZ: -.3, muzzle: [0, .07, -.75], recoil: 2.2, build(b, a) {
        tube(b, 0, .07, -.15, .17, .95, olive, .55, .3);
        tube(b, 0, .07, -.63, .2, .06, black, .4, .6);
        tube(b, 0, .07, .33, .2, .06, black, .4, .6);
        if (a.loaded) {
          tube(b, 0, .07, -.585, .1, .05, hex('4a5236'), .5, .3);
          ball(b, 0, .07, -.61, .09, hex('8a3a26'), .45, .3);
          tube(b, 0, .07, -.565, .102, .012, hex('d0902a'), .4, .2, .3, 0);
        }
        cube(b, 0, -.06, -.02, .045, .14, .07, black, .5, .4);
        cube(b, 0, -.06, -.3, .04, .12, .06, black, .5, .4);
        cube(b, .1, .1, -.2, .06, .08, .12, black, .4, .6);
        cube(b, .1, .1, -.265, .045, .045, .005, hex('ff5030'), .1, 0, 2, 5);
        cube(b, -.092, .07, -.38, .008, .018, .16, a.accent, .3, 0, .8, 3);
      }
    },
    { // VIPER-45 pistol
      sight: .07, adsZ: -.3, muzzle: [0, .045, -.2], recoil: 1.2, pistol: true, build(b, a) {
        cube(b, 0, .045, -.04 + a.slide * .04, .042, .05, .23, gun, .35, .7);
        cube(b, 0, .005, -.03, .038, .035, .2, black, .5, .3);
        st.push().translate(0, -.05, .05).rotX(-.25);
        cube(b, 0, 0, 0, .04, .12, .055, black, .7, .1);
        st.pop();
        cube(b, 0, -.01, .0, .012, .035, .04, black, .5, .5);
        cube(b, 0, .076, -.14 + a.slide * .04, .008, .012, .01, a.accent, .2, 0, 2, 3);
        cube(b, 0, .076, .06 + a.slide * .04, .03, .012, .01, black, .4, .5);
      }
    },
    { // STORM-24 auto shotgun
      sight: .1, adsZ: -.28, muzzle: [0, .04, -.66], recoil: 1.5, build(b, a) {
        receiver(b, hex('2a3a48'), .075, .11, .38);
        tube(b, 0, .04, -.48, .05, .36, gun, .3, .8);
        st.push().translate(0, -.12, -.08).rotZ(HALF_PI);
        cyl(b, 0, 0, 0, .18, .08, black, .5, .5);
        st.pop();
        grip(b, gun);
        stock(b, hex('2a3a48'), .24);
        reflex(b, .1, a.accent);
        cube(b, .04, .03, -.1, .008, .02, .2, a.accent, .3, 0, 1.4, 3);
      }
    },
    { // ARC-LANCE energy carbine
      sight: .11, adsZ: -.26, muzzle: [0, .035, -.62], recoil: .9, build(b, a) {
        receiver(b, hex('d8dde0'), .062, .09, .34);
        cube(b, 0, .03, -.32, .06, .07, .24, gunLight, .3, .7);
        for (let i = 0; i < 4; i++) tube(b, 0, .035, -.25 - i * .07, .07, .018, hex('6a7cff'), .2, 0, 1.6 + a.charge * 2, 3);
        tube(b, 0, .035, -.52, .022, .2, black, .3, .8);
        mag(b, 0, -.09, -.04, .045, .12, .07, gun, 0, a.mag);
        grip(b, gun);
        stock(b, hex('d8dde0'), .24);
        tube(b, 0, .11, -.06, .045, .16, black, .3, .7);
        cube(b, 0, .11, -.141, .038, .038, .004, hex('3040a0'), .05, 0, 1.4, 5);
      }
    },
    { // RAVAGER rotary autocannon
      sight: .14, adsZ: -.32, muzzle: [0, .03, -.82], recoil: 1.3, build(b, a) {
        receiver(b, hex('6a4a2c'), .11, .14, .42);
        st.push().translate(0, .03, -.5).rotZ(a.spin);
        for (let i = 0; i < 6; i++) {
          const ang = i / 6 * Math.PI * 2;
          tube(b, Math.cos(ang) * .035, Math.sin(ang) * .035, 0, .022, .55, black, .3, .8);
        }
        tube(b, 0, 0, -.12, .11, .025, gunLight, .4, .7);
        tube(b, 0, 0, .1, .11, .025, gunLight, .4, .7);
        st.pop();
        cube(b, 0, -.14, -.02, .16, .14, .2, hex('3a3f2c'), .6, .2);
        grip(b, black);
        cube(b, 0, .125, -.1, .03, .05, .2, black, .5, .5);
        reflex(b, .135, a.accent);
      }
    }
  ];
  function receiver(b, c, w, h, len) {
    cube(b, 0, 0, -.06, w, h, len, c, .4, .55);
    cube(b, 0, h / 2 + .006, -.06, w * .9, .012, len * .9, black, .45, .6);
  }
  function rail(b, z, len) { for (let i = 0; i < 6; i++) cube(b, 0, .078, z + i * len / 6 - len / 2 + .1, .05, .012, .02, black, .4, .7); }
  function grip(b, c) { st.push().translate(0, -.09, .07).rotX(-.3); cube(b, 0, 0, 0, .04, .12, .05, c, .7, .2); st.pop(); cube(b, 0, -.05, .015, .012, .03, .04, black, .5, .5); }
  function stock(b, c, len) {
    cube(b, 0, 0, .12 + len / 2, .04, .06, len, c, .55, .3);
    cube(b, 0, -.02, .12 + len, .05, .12, .03, black, .7, .2);
  }
  function mag(b, x, y, z, w, h, d, c, tilt, drop) {
    st.push().translate(x, y - drop * .35, z + drop * .05).rotX(tilt + drop * .5);
    cube(b, 0, 0, 0, w, h, d, c, .55, .35);
    cube(b, 0, -h / 2 + .01, 0, w + .006, .02, d + .006, black, .5, .5);
    st.pop();
  }
  function reflex(b, y, accent) {
    cube(b, 0, y - .025, .03, .045, .02, .07, black, .4, .6);
    for (const s of [-1, 1]) cube(b, s * .022, y + .01, .05, .006, .05, .012, black, .4, .6);
    cube(b, 0, y + .036, .05, .05, .006, .012, black, .4, .6);
    cube(b, 0, y + .008, .052, .003, .003, .001, hex('ff3030'), .1, 0, 5, 3);
  }
  function hands(b, a, def) {
    const glove = C.glove, sleeve = C.sleeve;
    // Right hand on the grip.
    st.push().translate(.012, -.12, .1);
    cube(b, 0, 0, 0, .07, .08, .1, glove, .8, 0);
    st.push().rotX(-.6).translate(0, -.05, .15);
    cube(b, 0, 0, 0, .085, .085, .24, sleeve, .9, 0);
    cube(b, 0, 0, -.13, .09, .09, .04, black, .8, 0);
    st.pop().pop();
    if (def.pistol) {
      st.push().translate(-.03, -.11, .07);
      cube(b, 0, 0, 0, .06, .07, .09, glove, .8, 0);
      st.push().rotX(-.5).rotY(.5).translate(0, -.04, .16);
      cube(b, 0, 0, 0, .08, .08, .24, sleeve, .9, 0);
      st.pop().pop();
      return;
    }
    // Left hand on the handguard (moves for pump and reload).
    const lz = -.3 + (a.pump || 0) * .09, ly = -.025 - a.reloadHand * .12;
    st.push().translate(-.02 - a.reloadHand * .04, ly, lz + a.reloadHand * .18);
    cube(b, 0, 0, 0, .08, .06, .11, glove, .8, 0);
    st.push().rotX(-.25).rotY(.75).translate(0, -.04, .17);
    cube(b, 0, 0, 0, .085, .085, .3, sleeve, .9, 0);
    st.pop().pop();
  }

  /**
   * Builds the view-space weapon. `a` carries kick, sway, bob, ads, reload (0..1), switching (0..1), sprint, time, firing info.
   * Returns the view-space muzzle position.
   */
  function weapon(b, index, a) {
    const def = WEAPONS[index] || WEAPONS[0];
    const ads = a.ads, hip = 1 - ads;
    const reload = a.reload, reloadArc = reload > 0 ? Math.sin(Math.min(1, reload) * Math.PI) : 0;
    const anim = {
      accent: a.accent, mag: reload > 0 ? Math.max(0, Math.sin(Math.min(1, reload * 1.25) * Math.PI)) : 0,
      pump: a.pump || 0, slide: a.slide || 0, spin: a.spin || 0, charge: a.charge || 0, loaded: a.loaded !== false,
      reloadHand: reload > 0 ? Math.max(0, Math.sin(Math.min(1, reload * 1.2) * Math.PI)) : 0
    };
    const x = (def.pistol ? .15 : .19) * hip + a.swayX * hip;
    const y = -.165 * hip - def.sight * ads + a.bob * hip - reloadArc * .05 - a.switching * .35 - a.sprint * .05 + a.swayY * hip;
    const z = (-.34 * hip + def.adsZ * ads) + a.kick * .55 * def.recoil * (1 - ads * .45);
    st.reset().translate(x, y, z);
    st.rotY(a.swayYaw * hip + a.sprint * .5 - reloadArc * .15 * hip);
    st.rotX(a.kick * 2.2 * def.recoil * (1 - ads * .6) + reloadArc * .35 + a.sprint * -.25 - a.switching * .6);
    st.rotZ(a.roll * hip + reloadArc * .45 * hip + a.sprint * .35);
    st.scale(.84);
    def.build(b, anim);
    hands(b, anim, def);
    return point(def.muzzle[0], def.muzzle[1], def.muzzle[2], a.muzzleOut || [0, 0, 0]);
  }

  // ------------------------------------------------------------------ pickups, projectiles, shells
  const PICKUP_COLORS = { ammo: hex('ffb54f'), fuel: hex('3ff2e2'), grenade: hex('ff5a3a'), health: hex('7dff8a'), shield: hex('6ab8ff') };
  function pickup(b, p, time) {
    const c = PICKUP_COLORS[p.kind] || PICKUP_COLORS.ammo;
    const bob = Math.sin(time * 3 + p.x) * .08;
    st.reset().translate(p.x, .45 + bob, p.z).rotY(time * 1.8);
    cube(b, 0, 0, 0, .34, .34, .34, hex('22282e'), .4, .6);
    cube(b, 0, 0, 0, .38, .08, .38, c, .3, 0, 1.6, 3);
    cube(b, 0, 0, 0, .08, .38, .38, c, .3, 0, 1.6, 3);
    st.reset().translate(p.x, .02, p.z);
    cyl(b, 0, 0, 0, .9, .02, c, .3, 0, .6 + Math.sin(time * 4) * .3, 3);
  }
  function grenade(b, p, time) {
    if (p.rocket) {
      // Local +z follows the velocity; the exhaust glows at the back.
      st.reset().translate(p.x, p.y, p.z).rotY(Math.atan2(p.vx, p.vz)).rotX(-Math.atan2(p.vy, Math.hypot(p.vx, p.vz)));
      tube(b, 0, 0, 0, .1, .45, hex('6a705a'), .5, .3);
      tube(b, 0, 0, .2, .06, .08, hex('d04a2a'), .4, .2);
      tube(b, 0, 0, -.25, .06, .08, hex('ffd27a'), .2, 0, 4, 3);
      return;
    }
    st.reset().translate(p.x, p.y, p.z).rotX(time * 9).rotZ(time * 5);
    ball(b, 0, 0, 0, .16, p.hostile ? hex('8a3a20') : hex('3a4a2a'), .5, .4);
    cube(b, 0, .07, 0, .05, .06, .05, C.metal, .4, .7);
    ball(b, 0, 0, 0, .05, p.hostile ? hex('ff3a2a') : hex('ffb040'), .2, 0, 3 + Math.sin(time * 20) * 2, 3);
  }
  function shell(b, s) {
    st.reset().translate(s.x, s.y, s.z).rotY(s.ry).rotX(s.rx);
    b.part(M.CYL, st, 0, 0, 0, .012, .04, .012, s.big ? hex('9a8a7a') : C.brass, .3, .9, 0, 0);
  }

  return { robot, weapon, pickup, grenade, shell, WEAPONS, TYPES, stack: st };
})();
