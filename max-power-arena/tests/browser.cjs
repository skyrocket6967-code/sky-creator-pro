'use strict';
// Runs the real game in headless Chromium (WebGL2 via SwiftShader), checks for errors and saves screenshots.
// Usage: node tests/browser.cjs [outDir]
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const out = path.resolve(process.argv[2] || path.join(__dirname, '../build/screens'));
fs.mkdirSync(out, { recursive: true });
const url = 'file://' + path.join(__dirname, '../android/assets/index.html');

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForTimeout(2500);
  const shot = async name => { await page.screenshot({ path: path.join(out, name + '.png') }); console.log('saved', name); };
  const frames = n => page.evaluate(n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const info = await page.evaluate(() => window.StrikeRenderer.stats());
  console.log('renderer', JSON.stringify(info));
  await shot('01-menu');
  for (const id of ['town', 'suburb', 'dockyard']) {
    await page.evaluate(() => window.strikeTest.selectMap(1));
    await frames(40);
    if (id !== 'dockyard') await shot('01-menu-' + id);
  }

  // Start a run and set up a readable combat scene.
  await page.evaluate(() => {
    const g = window.strikeTest;
    g.config.sound = false;
    g.start();
    g.player.x = 0; g.player.z = 14; g.setAim(-.05, -.05);
    const mk = (id, x, z, type, extra = {}) => Object.assign({ id, x, z, hp: 200, maxHP: 200, type, boss: false, size: 1, dead: 0, phase: id, shot: 1e9, heal: 1e9, grenade: 1e9, flash: 0, strafe: 1, hit: 0, angle: 0 }, extra);
    g.setEnemies([mk(1, -2.5, 4.5, 'grunt'), mk(2, 2.6, 2.4, 'heavy'), mk(3, -6, -6, 'sniper'), mk(4, 5.5, -7, 'medic'), mk(5, 0.2, -3, 'bomber'), mk(6, -12, -16, 'grunt', { boss: true, size: 1.45 })]);
  });
  await frames(30);
  await shot('02-combat');
  // Fire a burst for effects.
  await page.evaluate(() => { const g = window.strikeTest; g.setAim(-.18, -.06); g.shoot(); });
  await frames(2);
  await page.evaluate(() => window.strikeTest.state().enemies.forEach(e => { e.flash = 1e9; }));
  await frames(2);
  await shot('03-firing');
  await page.evaluate(() => { const g = window.strikeTest; g.explosion([2, .3, -2], 10, 6, false); g.hurt(25, 6, 2); });
  await frames(8);
  await shot('04-explosion');
  // Weapons gallery.
  for (const i of [2, 3, 5, 9]) {
    await page.evaluate(i => { const g = window.strikeTest; g.switchGun(i); g.step(60); g.setAim(.6, -.08); }, i);
    await frames(20);
    await shot('05-gun-' + i);
  }
  await page.evaluate(() => { const g = window.strikeTest; g.switchGun(3); g.setAds(true); g.step(60); g.setAim(-.05, -.02); });
  await frames(20);
  await shot('06-scope');
  await page.evaluate(() => { const g = window.strikeTest; g.setAds(false); g.switchGun(0); g.setEnemies([{ id: 9, x: 0, z: 0, hp: 0, dead: 0, phase: 0, shot: 1e9, flash: 0, strafe: 1, hit: 0, angle: 0 }]); g.step(4); });
  await frames(10);
  await shot('07-perks');
  await page.evaluate(() => { window.strikeTest.choosePerk(0); window.strikeTest.openSettings(); });
  await frames(10);
  await shot('08-settings');
  await page.evaluate(() => { window.strikeTest.closeSettings(); });
  // Jetpack up onto a container and look over the arena.
  await page.evaluate(() => {
    const g = window.strikeTest;
    if (g.state().mode !== 'running') g.resume();
    g.player.x = -22; g.player.z = 13.4; g.player.feet = 0; g.player.yaw = 0;
    g.jump(); g.input.jumpHeld = true; g.step(70); g.input.my = -1; g.step(50); g.input.jumpHeld = false; g.input.my = 0; g.step(200);
    g.setAim(.9, -.18);
    const mk = (id, x, z, type) => ({ id, x, z, hp: 200, maxHP: 200, type, boss: false, size: 1, dead: 0, phase: id, shot: 1e9, heal: 1e9, grenade: 1e9, flash: 0, strafe: 1, hit: 0, angle: 0 });
    g.setEnemies([mk(1, -12, 4, 'grunt'), mk(2, -8, 6, 'rusher'), mk(3, -4, -2, 'heavy'), mk(4, -14, -4, 'bomber')]);
  });
  await frames(20);
  console.log('on container, feet =', await page.evaluate(() => window.strikeTest.player.feet.toFixed(2)));
  await shot('10-jetpack-rooftop');
  await page.evaluate(() => { window.strikeTest.pause(); document.getElementById('help').classList.remove('hidden'); });
  await frames(5);
  await shot('11-help');
  await page.evaluate(() => { document.getElementById('help').classList.add('hidden'); window.strikeTest.resume(); });
  // Dev mode: open from the logo, then wall hacks through cover.
  await page.evaluate(() => { const g = window.strikeTest; g.toMenu(); g.openDev(); });
  await frames(6);
  await shot('12-dev-tab');
  await page.evaluate(() => {
    const g = window.strikeTest; g.closeSettings(); g.start();
    Object.assign(g.config, { devWallhack: true, devGod: true, devAmmo: true, devDamage: 'kill' });
    g.adjustSetting('devGod', 1); g.adjustSetting('devGod', 1);
    g.player.x = 0; g.player.z = 14; g.setAim(0, -.04);
    const mk = (id, x, z, type) => ({ id, x, z, hp: 200, maxHP: 200, type, boss: false, size: 1, dead: 0, phase: id, shot: 1e9, heal: 1e9, grenade: 1e9, flash: 0, strafe: 1, hit: 0, angle: 0 });
    g.setEnemies([mk(1, 0, 15.6 - 18, 'grunt'), mk(2, -7, 3.2, 'heavy'), mk(3, 7, 3.4, 'sniper'), mk(4, 0, -13.5, 'bomber'), mk(5, -11, -15.5, 'medic')]);
  });
  await frames(20);
  await shot('13-wallhack');
  await page.evaluate(() => { const g = window.strikeTest; g.adjustSetting('devReset', 1, true); });
  // Each map in combat, then killstreaks.
  const mkAll = `(id, x, z, type) => ({ id, x, z, hp: 200, maxHP: 200, type, boss: false, size: 1, dead: 0, phase: id, shot: 1e9, heal: 1e9, grenade: 1e9, flash: 0, strafe: 1, hit: 0, angle: 0 })`;
  for (const id of ['dockyard', 'town', 'suburb']) {
    await page.evaluate(([id, mk]) => {
      const g = window.strikeTest, make = eval(mk);
      g.toMenu(); g.config.map = id; g.start(); g.config.devFreeze = true;
      g.player.x = 0; g.player.z = 14; g.setAim(0, -.03);
      g.setEnemies([make(1, -3, 3, 'grunt'), make(2, 3.5, 1, 'heavy'), make(3, -7, -9, 'sniper'), make(4, 6, -8, 'medic'), make(5, 1, -4, 'rusher'), make(6, -1.5, -14, 'bomber')]);
    }, [id, mkAll]);
    await frames(30);
    await shot('14-map-' + id);
  }
  await page.evaluate(() => { const g = window.strikeTest; g.adjustSetting('devStreaks', 1, true); g.useStreak('uav'); g.useStreak('heli'); g.step(120 * 7); });
  await page.evaluate(() => { const g = window.strikeTest, h = g.state().heli, P = g.player; const dx = h.x - P.x, dz = h.z - P.z; g.setAim(Math.atan2(dx, -dz), Math.atan2(h.y - P.y, Math.hypot(dx, dz))); });
  await frames(10);
  await shot('15-heli');
  await page.evaluate(() => { const g = window.strikeTest, mk = (id, x, z) => ({ id, x, z, hp: 1e6, maxHP: 1e6, type: 'grunt', boss: false, size: 1, dead: 0, phase: id, shot: 1e9, heal: 1e9, grenade: 1e9, flash: 0, strafe: 1, hit: 0, angle: 0 });
    g.setEnemies([mk(1, 0, -16), mk(2, 2, -17), mk(3, -2, -18)]); g.useStreak('air'); g.step(120 * 2.1);
    const j = g.state().jets[0], P = g.player, dx = j.x - P.x, dz = j.z - P.z; g.setAim(Math.atan2(dx, -dz), Math.atan2(j.y - P.y, Math.hypot(dx, dz)) - .12); });
  await frames(4);
  await shot('16-airstrike-jets');
  await page.evaluate(() => { const g = window.strikeTest; g.setAim(0, -.1); g.step(120 * .3); });
  await frames(3);
  await shot('17-airstrike-bombs');
  await page.evaluate(() => { window.strikeTest.config.devFreeze = false; window.strikeTest.toMenu(); window.strikeTest.config.map = 'dockyard'; window.strikeTest.start(); });
  // Every quality preset must compile and render.
  for (const q of ['performance', 'balanced', 'high', 'ultra']) {
    await page.evaluate(q => { window.strikeTest.adjustSetting('quality', 0); window.strikeTest.config.quality = q; }, q);
    await page.evaluate(q => window.StrikeRenderer.quality(q), q);
    await page.evaluate(() => { const g = window.strikeTest; g.player.x = -18; g.player.z = 30; g.setAim(2.4, .02); });
    await frames(10);
    const s = await page.evaluate(() => window.StrikeRenderer.stats());
    console.log('quality', q, JSON.stringify(s));
    await shot('09-quality-' + q);
  }
  // Rough frame time with SwiftShader (CPU rendering, not representative of a phone GPU).
  const ms = await page.evaluate(() => new Promise(r => { const t0 = performance.now(); let n = 0; const f = () => { if (++n >= 60) r((performance.now() - t0) / 60); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  console.log('avg frame ms (software GL):', ms.toFixed(1));
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exitCode = 1;
})();
