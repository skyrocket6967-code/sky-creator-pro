'use strict';
// Procedural soldiers, first-person weapons, vehicles and pickups built from instanced boxes, cylinders and spheres.
window.StrikeModels = (() => {
  const R = window.StrikeRenderer, M = R.MESH, hex = R.rgb;
  const HALF_PI = Math.PI / 2;
  const st = new R.Stack();
  const C = {
    boot: hex('2a2420'), glove: hex('1c1d1e'), black: hex('17191b'), dark: hex('22262a'), metal: hex('3a3f44'), steel: hex('7d878d'),
    wood: hex('7a4a28'), woodDark: hex('4e3018'), white: hex('f2f4f2'), brass: hex('c99a45'), red: hex('b81e1e'), strap: hex('2e2a22'),
    lens: hex('1a2430'), skin: [hex('c8977a'), hex('a2714f'), hex('6e4a32'), hex('e2b896'), hex('8a5c3e')]
  };
  // Faction kits: uniform camo, vest, helmet and accent.
  const TYPES = {
    grunt: { camo: hex('5d6640'), vest: hex('7d6e4f'), helmet: hex('4d553a'), cloth: hex('6b5a40'), label: 'RIFLEMAN' },
    rusher: { camo: hex('2b2d31'), vest: hex('1c1e21'), helmet: hex('202226'), cloth: hex('17181a'), label: 'BREACHER' },
    heavy: { camo: hex('4a4f3a'), vest: hex('3b4030'), helmet: hex('34392a'), cloth: hex('2e2f2a'), label: 'HEAVY GUNNER' },
    sniper: { camo: hex('59593a'), vest: hex('4a4630'), helmet: hex('4a4a30'), cloth: hex('6a6440'), label: 'GHILLIE SNIPER' },
    medic: { camo: hex('a8946c'), vest: hex('8c7a56'), helmet: hex('8a7a58'), cloth: hex('c8b48a'), label: 'MEDIC' },
    bomber: { camo: hex('9a8460'), vest: hex('6a5a3e'), helmet: hex('7a6a4a'), cloth: hex('8a3a2a'), label: 'GRENADIER' },
    boss: { camo: hex('2f3329'), vest: hex('3a3f31'), helmet: hex('2a2e24'), cloth: hex('202020'), label: 'JUGGERNAUT' }
  };

  function cube(b, x, y, z, sx, sy, sz, c, rough = .6, metal = 0, glow = 0, mode = 0) { b.part(M.CUBE, st, x, y, z, sx, sy, sz, c, rough, metal, glow, mode); }
  function cyl(b, x, y, z, d, h, c, rough = .6, metal = 0, glow = 0, mode = 0) { b.part(M.CYL, st, x, y, z, d, h, d, c, rough, metal, glow, mode); }
  function ball(b, x, y, z, sx, sy, sz, c, rough = .6, metal = 0, glow = 0, mode = 0) { b.part(M.BALL, st, x, y, z, sx, sy, sz, c, rough, metal, glow, mode); }
  /** Cylinder lying along the local z axis. */
  function tube(b, x, y, z, d, len, c, rough = .4, metal = .7, glow = 0, mode = 0) {
    st.push().translate(x, y, z).rotX(HALF_PI);
    b.part(M.CYL, st, 0, 0, 0, d, len, d, c, rough, metal, glow, mode);
    st.pop();
  }
  function point(x, y, z, out) {
    const m = st.top;
    out[0] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[2] = m[8] * x + m[9] * y + m[10] * z + m[11];
    return out;
  }

  // ------------------------------------------------------------------ soldiers
  /** Rifle held by a soldier, built along -z from the current stack position. */
  function heldGun(b, type, flash, e) {
    const long = type === 'sniper', lmg = type === 'heavy', shotgun = type === 'rusher', mini = type === 'boss';
    if (mini) {
      cube(b, 0, 0, 0, .16, .18, .36, C.black, .5, .5);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; tube(b, Math.cos(a) * .045, Math.sin(a) * .045, -.42, .03, .55, C.metal, .3, .8); }
      cube(b, -.12, -.06, .05, .1, .2, .16, hex('4a5236'), .7, .2);
    } else {
      cube(b, 0, 0, 0, .065, .1, long ? .5 : .4, C.black, .45, .6);
      tube(b, 0, .02, -(long ? .55 : shotgun ? .36 : .4), long ? .03 : shotgun ? .05 : .035, long ? .5 : .3, C.metal, .35, .8);
      cube(b, 0, -.01, -.22, .07, .075, .2, shotgun || lmg ? C.black : C.wood, .7, .1);
      cube(b, 0, -.02, .28, .055, .1, .2, shotgun || lmg ? C.black : C.wood, .7, .1);
      if (!shotgun) { st.push().translate(0, -.12, -.06).rotX(lmg ? 0 : .3); cube(b, 0, 0, 0, .05, lmg ? .14 : .16, lmg ? .14 : .07, lmg ? hex('4a5236') : C.black, .6, .3); st.pop(); }
      if (long) tube(b, 0, .1, -.04, .06, .3, C.black, .3, .7);
    }
    const tip = -(long ? .82 : mini ? .7 : shotgun ? .52 : .56);
    e.muzzle = point(0, .02, tip, e.muzzle || [0, 0, 0]);
    if (flash) cube(b, 0, .02, tip - .06, .1, .1, .14, hex('ffcc66'), .2, 0, 3, 3);
  }
  /**
   * Draws one soldier. `e` carries x, z, angle, phase, type, boss, size, hp, dead, hit, flash, move, aim, id.
   * Stores the muzzle position in e.muzzle for effects.
   */
  function soldier(b, e, time, far) {
    const alive = e.hp > 0;
    const dying = alive ? 0 : Math.min(1, (time - e.dead) / .5);
    const fade = alive ? 1 : Math.max(0, 1 - Math.max(0, time - e.dead - 2.2) * 1.5);
    if (fade <= 0) return;
    const type = e.boss ? 'boss' : (e.type || 'grunt');
    const kit = TYPES[type] || TYPES.grunt;
    const flash = time < (e.hit || 0);
    const tint = c => flash ? R.mix(c, hex('ffe0d0'), .55) : c;
    const camo = tint(kit.camo), vest = tint(kit.vest), helmet = tint(kit.helmet), cloth = kit.cloth;
    const id = e.id || 0, skin = C.skin[id % C.skin.length];
    const heavy = type === 'heavy' || type === 'boss', lean = type === 'rusher', ghillie = type === 'sniper';
    const bulk = type === 'boss' ? 1.35 : type === 'heavy' ? 1.18 : 1;
    const move = alive ? Math.min(1, e.move ?? .6) : 0;
    const ph = (e.phase || 0) * 2;
    const breathe = Math.sin(time * 2.1 + id) * .01;
    const sink = alive ? 0 : -Math.max(0, time - e.dead - 2) * .4;

    st.reset().translate(e.x, sink, e.z).rotY(e.angle || 0).scale(e.size || 1);
    if (!alive) st.rotX(dying * dying * 1.5).rotZ(dying * .2 * (id % 2 ? 1 : -1));
    if (alive && move > .1) st.translate(0, Math.abs(Math.sin(ph)) * .03 * move, 0);

    // Legs.
    for (const side of [-1, 1]) {
      const swing = alive ? Math.sin(ph + (side > 0 ? 0 : Math.PI)) * .5 * move : .3;
      const knee = alive ? -(Math.max(0, Math.sin(ph + (side > 0 ? 0 : Math.PI) + 1.3)) * .85 * move + .1) : -.5;
      st.push().translate(side * .12 * bulk, .94, 0).rotX(swing);
      cyl(b, 0, -.21, 0, .18 * bulk, .44, camo, .9, 0, 0, 9);
      if (!far) cube(b, side * .09 * bulk, -.2, 0, .06, .14, .12, kit.vest, .8);
      cube(b, 0, -.43, -.07, .14 * bulk, .12, .07, C.black, .6, .2);
      st.push().translate(0, -.43, 0).rotX(knee);
      cyl(b, 0, -.2, 0, .16 * bulk, .42, camo, .9, 0, 0, 9);
      if (heavy) cube(b, 0, -.18, -.07, .16 * bulk, .3, .07, vest, .5, .3, 0, 4);
      cube(b, 0, -.425, -.04, .15 * bulk, .14, .3, C.boot, .8, .1);
      st.pop().pop();
    }

    // Hips and belt.
    cube(b, 0, .98, 0, .36 * bulk, .2, .25, camo, .9, 0, 0, 9);
    cube(b, 0, 1.06, 0, .38 * bulk, .06, .27, C.strap, .7);
    if (!far) for (const s of [-1, 1]) cube(b, s * .18 * bulk, 1.0, -.02, .07, .12, .1, kit.vest, .8);

    // Torso with plate carrier.
    st.push().translate(0, 1.38 + breathe, 0).rotX(lean ? .25 : .06).rotY(alive ? Math.sin(time * .9 + id) * .05 : 0);
    cube(b, 0, 0, 0, .44 * bulk, .5, .27 * bulk, camo, .9, 0, 0, 9);
    cube(b, 0, .03, -.15 * bulk, .38 * bulk, .38, .06, vest, .7, .1, 0, 4);
    cube(b, 0, .05, .15 * bulk, .38 * bulk, .4, .06, vest, .7, .1, 0, 4);
    for (const s of [-1, 1]) {
      cube(b, s * .21 * bulk, -.04, 0, .05, .22, .28 * bulk, vest, .7, .1);
      cube(b, s * .13, .24, 0, .08, .05, .3 * bulk, vest, .7, .1);
    }
    if (!far) {
      for (let i = -1; i <= 1; i++) cube(b, i * .11 * bulk, -.06, -.19 * bulk, .08, .13, .05, R.mix(vest, C.black, .25), .8);
      cube(b, -.12, .14, -.19 * bulk, .07, .07, .04, C.black, .6, .3);
      cyl(b, .17, .32, .14, .015, .3, C.black, .5, .3);
    }
    if (heavy) for (const s of [-1, 1]) cube(b, s * .3 * bulk, .17, 0, .2, .16, .34, vest, .5, .3, 0, 4);
    if (type === 'medic') {
      cube(b, 0, .1, .19, .2, .2, .02, C.white, .6);
      cube(b, 0, .1, .2, .05, .15, .01, C.red, .6);
      cube(b, 0, .1, .2, .15, .05, .01, C.red, .6);
      cube(b, 0, .05, .3, .3, .32, .16, hex('6a5a3e'), .8);
    } else if (type === 'bomber') {
      st.push().translate(.12, .05, .24).rotX(-.25);
      cyl(b, 0, 0, 0, .09, .95, hex('4d5536'), .6, .2);
      st.push().translate(0, .55, 0); ball(b, 0, 0, 0, .15, .26, .15, hex('5a4a2a'), .5, .3); st.pop();
      st.pop();
      for (let i = -2; i <= 2; i++) cyl(b, i * .08, -.2, -.2, .06, .1, hex('556b2f'), .6, .2);
    } else if (type !== 'sniper') {
      cube(b, 0, .02, .28, .3, .34, .14, R.mix(vest, C.black, .3), .85);
    }
    if (ghillie && !far) {
      for (let i = 0; i < 14; i++) {
        const a = i * 2.39996, r = .2 + (i % 3) * .04, y = -.22 + (i % 5) * .11;
        st.push().translate(Math.cos(a) * r, y, Math.sin(a) * r * .8).rotY(a).rotZ(.6 + (i % 4) * .3);
        cube(b, 0, 0, 0, .04, .22, .12, R.mix(kit.camo, hex('6a5a32'), (i % 4) / 4), .95, 0, 0, 9);
        st.pop();
      }
    }

    // Head.
    const look = alive ? Math.max(-.4, Math.min(.4, e.aim || 0)) : .3;
    st.push().translate(0, .36, 0).rotX(-look * .6);
    cyl(b, 0, .02, 0, .1, .1, skin, .8);
    const covered = type === 'rusher' || type === 'boss';
    cube(b, 0, .13, -.01, .19, .23, .21, covered ? cloth : skin, .85);
    cube(b, 0, .15, -.115, .17, .045, .02, type === 'boss' ? hex('101418') : C.black, .2, .3, 0, type === 'boss' ? 5 : 0);
    if (!covered && (type === 'grunt' || type === 'bomber')) cube(b, 0, .06, -.1, .2, .09, .05, cloth, .95);
    if (type === 'boss') {
      ball(b, 0, .2, 0, .34, .34, .34, helmet, .5, .3, 0, 4);
      cube(b, 0, .16, -.17, .2, .06, .03, hex('101418'), .1, 0, 0, 5);
    } else if (ghillie) {
      ball(b, 0, .2, .02, .3, .26, .32, kit.camo, .95, 0, 0, 9);
      if (!far) for (let i = 0; i < 6; i++) { st.push().translate(Math.cos(i * 1.1) * .12, .3, Math.sin(i * 1.1) * .12).rotZ(i * .7); cube(b, 0, 0, 0, .03, .16, .1, kit.cloth, .95, 0, 0, 9); st.pop(); }
    } else {
      ball(b, 0, .24, 0, .27, .19, .29, helmet, .7, .1);
      cube(b, 0, .19, 0, .28, .03, .3, R.mix(helmet, C.black, .3), .7);
      if (!far) {
        for (const s of [-1, 1]) cube(b, s * .12, .13, .01, .05, .1, .09, C.black, .6, .2);
        cube(b, 0, .29, -.12, .06, .05, .05, C.black, .5, .5);
        if (type === 'heavy') cube(b, 0, .12, -.13, .2, .1, .03, hex('101418'), .1, 0, 0, 5);
      }
    }
    st.pop();

    // Arms and weapon.
    for (const side of [-1, 1]) {
      const upper = alive ? (side > 0 ? .55 : .95) : -.2;
      const elbow = alive ? (side > 0 ? 1.05 : .55) : .2;
      st.push().translate(side * .27 * bulk, .17, 0).rotX(upper).rotZ(side * .18);
      cyl(b, 0, -.15, 0, .14 * bulk, .3, camo, .9, 0, 0, 9);
      if (heavy) cube(b, 0, -.1, 0, .17 * bulk, .22, .18, vest, .5, .3, 0, 4);
      st.push().translate(0, -.3, 0).rotX(elbow).rotZ(side * -.35);
      cyl(b, 0, -.14, 0, .12 * bulk, .28, camo, .9, 0, 0, 9);
      cube(b, 0, -.3, 0, .09, .1, .1, C.glove, .8);
      st.pop().pop();
    }
    st.push().translate(.08, -.02, -.34).rotX(alive ? -look * .5 : .4);
    heldGun(b, type, alive && time < (e.flash || 0), e);
    st.pop();
    st.pop();
  }

  // ------------------------------------------------------------------ first-person weapons
  const black = hex('17191b'), gun = hex('26292d'), gunLight = hex('44494f'), wood = hex('7a4a28'), tan = hex('9a8460'), olive = hex('4d5440'), fde = hex('8a7556');
  const WEAPONS = [
    { // M4A1 assault rifle
      sight: .105, adsZ: -.27, muzzle: [0, .035, -.66], recoil: 1, build(b, a) {
        receiver(b, gun, .066, .09, .36);
        cube(b, 0, .035, -.32, .07, .075, .26, gun, .5, .4);
        rail(b, -.12, .3);
        tube(b, 0, .035, -.55, .024, .2, black, .3, .8);
        tube(b, 0, .035, -.645, .034, .05, black, .4, .7);
        cube(b, 0, .1, -.6, .01, .04, .015, black, .4, .6);
        mag(b, 0, -.1, -.05, .045, .17, .075, fde, -.2, a.mag);
        grip(b, black);
        stock(b, fde, .26);
        reflex(b, .1);
      }
    },
    { // Spectre-9 SMG
      sight: .1, adsZ: -.24, muzzle: [0, .03, -.6], recoil: .7, build(b, a) {
        receiver(b, black, .06, .085, .3);
        tube(b, 0, .03, -.42, .05, .3, black, .5, .4);
        mag(b, 0, -.14, -.08, .04, .24, .05, black, -.05, a.mag);
        grip(b, black);
        cube(b, 0, .02, .2, .03, .05, .16, black, .5, .5);
        cube(b, 0, -.02, .28, .05, .1, .03, black, .5, .5);
        reflex(b, .095);
      }
    },
    { // M870 pump shotgun
      sight: .085, adsZ: -.3, muzzle: [0, .045, -.74], recoil: 1.8, build(b, a) {
        receiver(b, black, .07, .1, .3);
        tube(b, 0, .045, -.47, .045, .55, gun, .3, .8);
        tube(b, 0, -.005, -.42, .04, .42, gunLight, .35, .7);
        cube(b, 0, -.005, -.36 + a.pump * .09, .075, .07, .2, wood, .7, 0);
        grip(b, wood);
        stock(b, wood, .28);
        cube(b, 0, .075, -.72, .012, .012, .012, hex('d0c0a0'), .3, .5);
        for (let i = 0; i < 4; i++) cube(b, .04, -.02, .02 - i * .03, .02, .03, .022, hex('b02a2a'), .5, 0);
      }
    },
    { // LR .50 sniper rifle
      sight: .13, adsZ: -.2, muzzle: [0, .035, -.9], recoil: 1.6, scope: true, build(b, a) {
        receiver(b, tan, .07, .1, .4);
        tube(b, 0, .035, -.6, .03, .55, black, .3, .8);
        cube(b, 0, .035, -.88, .06, .04, .07, black, .4, .7);
        cube(b, 0, .015, -.34, .075, .085, .26, tan, .6, .2);
        mag(b, 0, -.09, -.03, .05, .11, .08, black, 0, a.mag);
        grip(b, black);
        stock(b, tan, .32);
        tube(b, 0, .13, -.06, .055, .32, black, .3, .7);
        tube(b, 0, .13, -.24, .072, .06, black, .3, .7);
        tube(b, 0, .13, .11, .064, .05, black, .3, .7);
        cube(b, 0, .13, -.272, .056, .056, .004, C.lens, .05, 0, .3, 5);
        for (const z of [-.12, .02]) cube(b, 0, .095, z, .022, .04, .03, black, .4, .6);
      }
    },
    { // M60 SAW light machine gun
      sight: .115, adsZ: -.28, muzzle: [0, .04, -.8], recoil: 1.1, build(b, a) {
        receiver(b, gun, .08, .11, .44);
        tube(b, 0, .04, -.55, .045, .5, gunLight, .4, .7);
        for (let i = 0; i < 6; i++) tube(b, 0, .04, -.34 - i * .06, .056, .012, black, .4, .7);
        cube(b, 0, -.12, -.06, .14, .16, .14, olive, .7, .1);
        cube(b, .08, -.02, -.06, .03, .05, .12, C.brass, .3, .9);
        grip(b, black);
        stock(b, wood, .26);
        cube(b, 0, .12, -.14, .025, .06, .14, black, .5, .5);
        reflex(b, .11);
      }
    },
    { // RPG-7
      sight: .15, adsZ: -.3, muzzle: [0, .06, -.75], recoil: 2.2, build(b, a) {
        tube(b, 0, .06, -.12, .1, 1, olive, .6, .2);
        tube(b, 0, .06, -.2, .13, .18, wood, .7, 0);
        tube(b, 0, .06, .36, .16, .12, olive, .6, .2);
        if (a.loaded) {
          tube(b, 0, .06, -.66, .1, .1, olive, .6, .2);
          tube(b, 0, .06, -.78, .17, .16, olive, .5, .3);
          tube(b, 0, .06, -.88, .1, .08, olive, .5, .3);
          tube(b, 0, .06, -.94, .04, .06, C.metal, .4, .6);
        }
        cube(b, 0, -.06, -.02, .045, .14, .07, wood, .7, 0);
        cube(b, 0, -.06, -.3, .04, .12, .06, wood, .7, 0);
        cube(b, .07, .12, -.18, .03, .07, .06, black, .5, .5);
      }
    },
    { // M1911 pistol
      sight: .07, adsZ: -.3, muzzle: [0, .045, -.2], recoil: 1.2, pistol: true, build(b, a) {
        cube(b, 0, .045, -.04 + a.slide * .04, .042, .05, .23, gunLight, .35, .8);
        cube(b, 0, .005, -.03, .038, .035, .2, gun, .5, .5);
        st.push().translate(0, -.05, .05).rotX(-.25);
        cube(b, 0, 0, 0, .042, .12, .055, wood, .7, .1);
        st.pop();
        cube(b, 0, -.01, .0, .012, .035, .04, black, .5, .5);
        cube(b, 0, .076, -.14 + a.slide * .04, .008, .012, .01, black, .4, .5);
        cube(b, 0, .076, .06 + a.slide * .04, .03, .012, .01, black, .4, .5);
      }
    },
    { // AUTO-12 automatic shotgun
      sight: .1, adsZ: -.28, muzzle: [0, .04, -.66], recoil: 1.5, build(b, a) {
        receiver(b, black, .075, .11, .38);
        tube(b, 0, .04, -.48, .05, .36, gun, .3, .8);
        st.push().translate(0, -.12, -.08).rotZ(HALF_PI);
        cyl(b, 0, 0, 0, .18, .08, olive, .6, .3);
        st.pop();
        grip(b, black);
        stock(b, black, .24);
        reflex(b, .1);
      }
    },
    { // MK-14 EBR marksman rifle
      sight: .12, adsZ: -.26, muzzle: [0, .035, -.74], recoil: .9, build(b, a) {
        receiver(b, black, .065, .09, .36);
        cube(b, 0, .025, -.33, .07, .08, .3, fde, .6, .2);
        tube(b, 0, .035, -.6, .024, .28, black, .3, .8);
        tube(b, 0, .035, -.72, .036, .06, black, .4, .7);
        mag(b, 0, -.09, -.04, .045, .12, .07, black, 0, a.mag);
        grip(b, black);
        stock(b, fde, .26);
        tube(b, 0, .115, -.06, .045, .2, black, .3, .7);
        cube(b, 0, .115, -.161, .038, .038, .004, C.lens, .05, 0, .3, 5);
      }
    },
    { // M134 minigun
      sight: .14, adsZ: -.32, muzzle: [0, .03, -.82], recoil: 1.3, build(b, a) {
        receiver(b, black, .11, .14, .42);
        st.push().translate(0, .03, -.5).rotZ(a.spin);
        for (let i = 0; i < 6; i++) {
          const ang = i / 6 * Math.PI * 2;
          tube(b, Math.cos(ang) * .035, Math.sin(ang) * .035, 0, .022, .55, gunLight, .3, .8);
        }
        tube(b, 0, 0, -.12, .11, .025, black, .4, .7);
        tube(b, 0, 0, .1, .11, .025, black, .4, .7);
        st.pop();
        cube(b, 0, -.14, -.02, .16, .14, .2, olive, .6, .2);
        cube(b, .1, -.06, -.04, .03, .04, .16, C.brass, .3, .9);
        grip(b, black);
        cube(b, 0, .125, -.1, .03, .05, .2, black, .5, .5);
      }
    }
  ];
  function receiver(b, c, w, h, len) {
    cube(b, 0, 0, -.06, w, h, len, c, .45, .55);
    cube(b, 0, h / 2 + .006, -.06, w * .9, .012, len * .9, black, .45, .6);
  }
  function rail(b, z, len) { for (let i = 0; i < 6; i++) cube(b, 0, .078, z + i * len / 6 - len / 2 + .1, .05, .012, .02, black, .4, .7); }
  function grip(b, c) { st.push().translate(0, -.09, .07).rotX(-.3); cube(b, 0, 0, 0, .04, .12, .05, c, .7, .2); st.pop(); cube(b, 0, -.05, .015, .012, .03, .04, black, .5, .5); }
  function stock(b, c, len) {
    cube(b, 0, 0, .12 + len / 2, .04, .06, len, c, .6, .2);
    cube(b, 0, -.02, .12 + len, .05, .12, .03, black, .7, .2);
  }
  function mag(b, x, y, z, w, h, d, c, tilt, drop) {
    st.push().translate(x, y - drop * .35, z + drop * .05).rotX(tilt + drop * .5);
    cube(b, 0, 0, 0, w, h, d, c, .6, .3);
    cube(b, 0, -h / 2 + .01, 0, w + .006, .02, d + .006, black, .5, .5);
    st.pop();
  }
  function reflex(b, y) {
    cube(b, 0, y - .025, .03, .045, .02, .07, black, .4, .6);
    for (const s of [-1, 1]) cube(b, s * .022, y + .01, .05, .006, .05, .012, black, .4, .6);
    cube(b, 0, y + .036, .05, .05, .006, .012, black, .4, .6);
    cube(b, 0, y + .008, .052, .003, .003, .001, hex('ff3030'), .1, 0, 5, 3);
  }
  const sleeveCamo = hex('5d6640');
  function hands(b, a, def) {
    st.push().translate(.012, -.12, .1);
    cube(b, 0, 0, 0, .07, .08, .1, C.glove, .8, 0);
    st.push().rotX(-.6).translate(0, -.05, .15);
    cube(b, 0, 0, 0, .085, .085, .24, sleeveCamo, .9, 0, 0, 9);
    cube(b, 0, 0, -.13, .09, .09, .04, C.black, .8, 0);
    st.pop().pop();
    if (def.pistol) {
      st.push().translate(-.03, -.11, .07);
      cube(b, 0, 0, 0, .06, .07, .09, C.glove, .8, 0);
      st.push().rotX(-.5).rotY(.5).translate(0, -.04, .16);
      cube(b, 0, 0, 0, .08, .08, .24, sleeveCamo, .9, 0, 0, 9);
      st.pop().pop();
      return;
    }
    const lz = -.3 + (a.pump || 0) * .09, ly = -.025 - a.reloadHand * .12;
    st.push().translate(-.02 - a.reloadHand * .04, ly, lz + a.reloadHand * .18);
    cube(b, 0, 0, 0, .08, .06, .11, C.glove, .8, 0);
    st.push().rotX(-.25).rotY(.75).translate(0, -.04, .17);
    cube(b, 0, 0, 0, .085, .085, .3, sleeveCamo, .9, 0, 0, 9);
    st.pop().pop();
  }
  function weapon(b, index, a) {
    const def = WEAPONS[index] || WEAPONS[0];
    const ads = a.ads, hip = 1 - ads;
    const reload = a.reload, reloadArc = reload > 0 ? Math.sin(Math.min(1, reload) * Math.PI) : 0;
    const anim = {
      mag: reload > 0 ? Math.max(0, Math.sin(Math.min(1, reload * 1.25) * Math.PI)) : 0,
      pump: a.pump || 0, slide: a.slide || 0, spin: a.spin || 0, loaded: a.loaded !== false,
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

  // ------------------------------------------------------------------ killstreak vehicles
  const heliGreen = hex('3c4430'), heliDark = hex('23281d');
  /** Attack helicopter; `h` carries x, y, z, yaw, time. Returns the gun position. */
  function heli(b, h, time) {
    st.reset().translate(h.x, h.y, h.z).rotY(h.yaw).rotX(.12).rotZ(Math.sin(time * .7) * .06);
    cube(b, 0, 0, 0, 1.5, 1.5, 4.2, heliGreen, .6, .3);
    cube(b, 0, .1, -2.3, 1.2, 1.1, 1.2, hex('141a20'), .1, .2, 0, 5);
    cube(b, 0, -.2, -2.9, .9, .7, .6, heliGreen, .6, .3);
    cube(b, 0, .4, 3.8, .5, .5, 4, heliGreen, .6, .3);
    cube(b, 0, 1.1, 5.6, .15, 1.6, .9, heliGreen, .6, .3);
    for (const s of [-1, 1]) {
      cube(b, s * 1.05, -.95, 0, .12, .1, 3.4, heliDark, .6, .4);
      cube(b, s * 1.1, -.2, -.2, 1.6, .15, .7, heliDark, .6, .3);
      tube(b, s * 1.7, -.35, -.2, .3, 1.2, heliDark, .5, .4);
    }
    cube(b, 0, 1, 0, .5, .4, .8, heliDark, .5, .4);
    st.push().translate(0, 1.3, 0).rotY(time * 24);
    for (let i = 0; i < 4; i++) { st.push().rotY(i * HALF_PI); cube(b, 0, 0, 3.5, .35, .05, 7, heliDark, .6, .3); st.pop(); }
    st.pop();
    st.push().translate(.3, 1.2, 5.7).rotX(time * 30);
    for (let i = 0; i < 2; i++) { st.push().rotX(i * HALF_PI); cube(b, 0, 0, 0, .05, 1.6, .15, heliDark, .6, .3); st.pop(); }
    st.pop();
    return point(0, -.6, -2.9, h.gun || (h.gun = [0, 0, 0]));
  }
  /** Fighter jet for airstrikes. */
  function jet(b, j) {
    st.reset().translate(j.x, j.y, j.z).rotY(j.yaw).rotZ(j.roll || 0);
    const g = hex('6a7076'), d = hex('3a3f44');
    cube(b, 0, 0, 0, 1.2, 1.1, 9, g, .4, .5);
    cube(b, 0, .25, -3.4, .8, .7, 1.6, hex('141a20'), .1, .2, 0, 5);
    cube(b, 0, 0, -5, .6, .6, 1.4, d, .4, .5);
    cube(b, 0, -.1, .4, 9, .12, 3, g, .4, .5);
    cube(b, 0, .1, 4, 3.6, .1, 1.4, g, .4, .5);
    for (const s of [-1, 1]) cube(b, s * .5, 1, 3.8, .1, 1.6, 1.4, d, .4, .5);
    tube(b, 0, 0, 4.7, .7, .4, d, .4, .6);
    tube(b, 0, 0, 4.95, .5, .2, hex('ff9a4a'), .2, 0, 4, 3);
  }

  // ------------------------------------------------------------------ pickups, projectiles, shells
  const PICKUP_COLORS = { ammo: hex('ffb54f'), fuel: hex('3ff2e2'), grenade: hex('ff5a3a'), health: hex('7dff8a'), shield: hex('6ab8ff') };
  function pickup(b, p, time) {
    const c = PICKUP_COLORS[p.kind] || PICKUP_COLORS.ammo;
    const bob = Math.sin(time * 3 + p.x) * .06;
    st.reset().translate(p.x, .3 + bob, p.z).rotY(time * 1.2);
    cube(b, 0, 0, 0, .55, .32, .36, olive, .7, .1);
    cube(b, 0, .17, 0, .57, .04, .38, hex('343a24'), .7, .1);
    cube(b, 0, 0, -.185, .3, .12, .01, c, .3, 0, 1.4, 3);
    st.reset().translate(p.x, .02, p.z);
    cyl(b, 0, 0, 0, .9, .02, c, .3, 0, .5 + Math.sin(time * 4) * .3, 3);
  }
  function grenade(b, p, time) {
    if (p.rocket) {
      st.reset().translate(p.x, p.y, p.z).rotY(Math.atan2(p.vx, p.vz)).rotX(-Math.atan2(p.vy, Math.hypot(p.vx, p.vz)));
      tube(b, 0, 0, 0, .1, .45, olive, .5, .3);
      tube(b, 0, 0, .3, .16, .14, olive, .5, .3);
      tube(b, 0, 0, -.25, .06, .08, hex('ffd27a'), .2, 0, 4, 3);
      return;
    }
    st.reset().translate(p.x, p.y, p.z).rotX(time * 9).rotZ(time * 5);
    ball(b, 0, 0, 0, .14, .16, .14, p.hostile ? hex('5a4a2a') : hex('3a4a2a'), .5, .4);
    cube(b, 0, .08, 0, .05, .05, .05, C.metal, .4, .7);
    ball(b, 0, 0, 0, .04, .04, .04, p.hostile ? hex('ff3a2a') : hex('ffb040'), .2, 0, 3 + Math.sin(time * 20) * 2, 3);
  }
  function shell(b, s) {
    st.reset().translate(s.x, s.y, s.z).rotY(s.ry).rotX(s.rx);
    b.part(M.CYL, st, 0, 0, 0, .012, .04, .012, s.big ? hex('a8241e') : C.brass, .3, .9, 0, 0);
  }

  return { robot: soldier, soldier, weapon, heli, jet, pickup, grenade, shell, WEAPONS, TYPES, stack: st };
})();
