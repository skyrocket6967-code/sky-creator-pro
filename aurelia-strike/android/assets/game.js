'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const R = window.StrikeRenderer, W = window.StrikeWorld, MDL = window.StrikeModels, A = window.StrikeAudio;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), TAU = Math.PI * 2;
  const host = window.AndroidHost || null;

  // ------------------------------------------------------------------ configuration
  const DEFAULTS = {
    quality: 'balanced', renderScale: .78, fpsCap: 120, shadows: true, bloom: true, fxaa: true, particles: 'high', dynamicRes: true, fov: 74, showFps: true,
    sensitivity: 1, adsSensitivity: .65, invertY: false, gyro: 'off', gyroSensitivity: 1, assist: true, autoFire: false, buttonScale: 1, hudOpacity: .9, leftFire: true,
    padSensitivity: 1, padDeadzone: .16, padInvertY: false, rumble: true, hideTouchWithPad: true,
    sound: true, masterVolume: .85, sfxVolume: 1, musicVolume: .4,
    difficulty: 'normal', haptics: true, damageNumbers: true, radar: true, crosshair: 'cross', crosshairColor: 'cyan',
    best: 0, bestScore: 0, loadout: 0
  };
  const cfg = Object.assign({}, DEFAULTS);
  try {
    const old = JSON.parse(localStorage.getItem('strike-v2') || '{}');
    const saved = JSON.parse(localStorage.getItem('strike-v5') || 'null') || old;
    for (const k in cfg) if (k in saved && typeof saved[k] === typeof cfg[k]) cfg[k] = saved[k];
  } catch (e) { /* fresh settings */ }
  const ENUMS = { quality: ['performance', 'balanced', 'high', 'ultra'], particles: ['low', 'high'], gyro: ['off', 'ads', 'always'], crosshair: ['cross', 'dot', 'circle'], crosshairColor: ['cyan', 'white', 'green', 'yellow', 'red'] };
  for (const k in ENUMS) if (!ENUMS[k].includes(cfg[k])) cfg[k] = DEFAULTS[k];
  cfg.sensitivity = clamp(cfg.sensitivity, .3, 3);
  cfg.renderScale = clamp(cfg.renderScale, .45, 1);
  if (![0, 30, 60, 90, 120].includes(cfg.fpsCap)) cfg.fpsCap = 120;
  const bodyClass = (name, on) => { if (document.body && document.body.classList) document.body.classList.toggle(name, !!on); };
  const persist = () => { try { localStorage.setItem('strike-v5', JSON.stringify(cfg)); } catch (e) { /* storage full */ } };

  const MODES = {
    normal: { name: 'ASSAULT', count: 6, cap: 24, hp: 1, damage: 1, rate: 1, waves: 10, blurb: 'Ten waves. Learn the sector.' },
    hard: { name: 'NIGHTMARE', count: 10, cap: 32, hp: 1.25, damage: 1.35, rate: .8, waves: 15, blurb: 'Fifteen waves. Faster, deadlier squads.' },
    insane: { name: 'INSANE', count: 14, cap: 40, hp: 1.55, damage: 1.65, rate: .65, waves: 20, blurb: 'Twenty waves. Forty hostiles at once.' },
    endless: { name: 'ENDLESS', count: 8, cap: 40, hp: 1.15, damage: 1.2, rate: .85, waves: Infinity, blurb: 'No limit. Chase your best wave.' }
  };
  if (!MODES[cfg.difficulty]) cfg.difficulty = 'normal';
  const GUNS = [
    { name: 'VXR-7', kind: 'ASSAULT RIFLE', mag: 30, reserve: 240, damage: 34, head: 100, interval: .095, reload: 1.45, recoil: .013, pellets: 1, spread: 0, color: '66ead7', range: .75, zoom: 1.35 },
    { name: 'WASP-9', kind: 'SUBMACHINE GUN', mag: 40, reserve: 360, damage: 21, head: 52, interval: .055, reload: 1.2, recoil: .008, pellets: 1, spread: .007, color: '9cef85', range: .5, zoom: 1.25 },
    { name: 'BREACH-12', kind: 'SHOTGUN', mag: 8, reserve: 64, damage: 20, head: 32, interval: .65, reload: 2, recoil: .045, pellets: 9, spread: .065, color: 'f4b972', range: .25, zoom: 1.2 },
    { name: 'LONGSHOT', kind: 'MARKSMAN RIFLE', mag: 10, reserve: 80, damage: 95, head: 250, interval: .48, reload: 1.8, recoil: .033, pellets: 1, spread: 0, color: 'bd9dff', range: 1, zoom: 3.4 },
    { name: 'TITAN-60', kind: 'LIGHT MACHINE GUN', mag: 80, reserve: 400, damage: 31, head: 80, interval: .085, reload: 3, recoil: .018, pellets: 1, spread: .011, color: 'ef8e7c', range: .7, zoom: 1.3 },
    { name: 'HELLFIRE', kind: 'ROCKET LAUNCHER', mag: 3, reserve: 24, damage: 220, head: 220, interval: .8, reload: 2.4, recoil: .055, pellets: 1, spread: 0, color: 'ffb54f', range: .8, zoom: 1.3 },
    { name: 'VIPER-45', kind: 'HEAVY PISTOL', mag: 14, reserve: 140, damage: 49, head: 130, interval: .23, reload: 1, recoil: .022, pellets: 1, spread: 0, color: 'cddcdf', range: .6, zoom: 1.3 },
    { name: 'STORM-24', kind: 'AUTO SHOTGUN', mag: 12, reserve: 96, damage: 14, head: 24, interval: .24, reload: 2.2, recoil: .03, pellets: 7, spread: .07, color: '98d5ef', range: .3, zoom: 1.2 },
    { name: 'ARC-LANCE', kind: 'PRECISION CARBINE', mag: 18, reserve: 180, damage: 62, head: 170, interval: .19, reload: 1.6, recoil: .015, pellets: 1, spread: 0, color: '8c9bff', range: .9, zoom: 1.8 },
    { name: 'RAVAGER', kind: 'HEAVY AUTOCANNON', mag: 50, reserve: 300, damage: 50, head: 110, interval: .13, reload: 2.8, recoil: .025, pellets: 1, spread: .009, color: 'e69a5f', range: .7, zoom: 1.3 }
  ];
  const PERKS = [
    { id: 'damage', icon: '🔥', name: 'Hollow Points', text: '+15% weapon damage', apply: () => { mods.damage *= 1.15; } },
    { id: 'rate', icon: '⚡', name: 'Hair Trigger', text: '+12% fire rate', apply: () => { mods.fireRate *= 1.12; } },
    { id: 'reload', icon: '✋', name: 'Quick Hands', text: 'Reload 30% faster', apply: () => { mods.reload *= .7; } },
    { id: 'vital', icon: '❤️', name: 'Reinforced Frame', text: '+25 max health and heal 25', apply: () => { mods.maxHp += 25; P.hp = Math.min(mods.maxHp, P.hp + 25); } },
    { id: 'shield', icon: '🛡️', name: 'Capacitor', text: '+25 max shield, faster recharge', apply: () => { mods.maxShield += 25; mods.shieldRegen *= 1.3; P.shield = mods.maxShield; } },
    { id: 'head', icon: '🎯', name: 'Deadeye', text: '+35% headshot damage', apply: () => { mods.headshot *= 1.35; } },
    { id: 'leech', icon: '💉', name: 'Nanite Leech', text: 'Each kill restores 6 health', apply: () => { mods.lifesteal += 6; } },
    { id: 'speed', icon: '🏃', name: 'Overclock', text: '+10% move speed, faster dash recharge', apply: () => { mods.speed *= 1.1; } },
    { id: 'blast', icon: '💣', name: 'Demolitions', text: '+2 grenades, +25% blast radius', apply: () => { P.grenades = Math.min(14, P.grenades + 2); mods.blast *= 1.25; } },
    { id: 'fuel', icon: '🚀', name: 'Efficient Thrusters', text: 'Jetpack and dash use 30% less fuel', apply: () => { mods.fuel *= .7; } },
    { id: 'ammo', icon: '🎒', name: 'Deep Pockets', text: '+50% reserve ammo for every gun', apply: () => { mods.reserve *= 1.5; P.reserve = Math.round(P.reserve * 1.5); for (const inv of inventory) inv.reserve = Math.round(inv.reserve * 1.5); } },
    { id: 'regen', icon: '✚', name: 'Field Medic', text: 'Health ticks every 6s instead of 10s', apply: () => { mods.regenInterval = Math.max(4, mods.regenInterval - 4); } }
  ];

  // ------------------------------------------------------------------ state
  let gunIndex = clamp(cfg.loadout | 0, 0, GUNS.length - 1), inventory = [], projectiles = [], pickups = [], grenadeReady = 0, muzzleUntil = 0, nextHealth = 10;
  let runDifficulty = cfg.difficulty;
  const gunSpec = () => GUNS[gunIndex], rules = () => MODES[mode === 'menu' ? cfg.difficulty : runDifficulty];
  let mode = 'menu', time = 0, last = 0, lastRender = 0, lastHud = 0, raf = 0, frameCount = 0, wave = 0, kills = 0, shots = 0, hits = 0, headshots = 0;
  let transition = 0, spawnLock = false, menuTime = 0, ads = false, adsBlend = 0, fireHeld = false, nextFire = 0, reloadEnd = 0, reloadStart = 0, recoil = 0, kick = 0;
  let lastDamage = -99, hitUntil = 0, announceUntil = 0, damageFlash = 0, dashEnd = 0, dashReady = 0, accumulator = 0, switchAnim = 0;
  let score = 0, streak = 0, lastKillTime = -9, multi = 0, medals = 0, perkOffer = null, perkDeadline = 0, ownedPerks = [], runTime = 0;
  let shake = 0, landDip = 0, stepClock = 0, pumpAnim = 0, slideAnim = 0, spin = 0, spinSpeed = 0, lastYaw = 0, lastPitch = 0, swayX = 0, swayY = 0, lowHpBeat = 0;
  const mods = {};
  function resetMods() { Object.assign(mods, { damage: 1, fireRate: 1, reload: 1, maxHp: 100, maxShield: 50, shieldRegen: 1, headshot: 1, lifesteal: 0, speed: 1, blast: 1, fuel: 1, reserve: 1, regenInterval: 10 }); }
  resetMods();
  const P = { x: 0, z: 12, y: 1.65, feet: 0, vy: 0, yaw: 0, pitch: 0, hp: 100, shield: 50, ammo: 30, reserve: 210, vx: 0, vz: 0, fuel: 100, grenades: 5, grounded: true };
  let enemies = [], traces = [];
  const input = { mx: 0, my: 0, keys: new Set(), moveId: null, lookId: null, fireId: null, fire2Id: null, moveCX: 0, moveCY: 0, lastX: 0, lastY: 0, fireX: 0, fireY: 0, jumpHeld: false, padX: 0, padY: 0 };

  // ------------------------------------------------------------------ world helpers (collision lives in world.js)
  const freeAt = W.freeAt, rayBox = W.rayBox, wallDistance = W.wallDistance;
  const move = (body, dx, dz, r) => W.move(body, dx, dz, r);
  function sphereHit(origin, dir, center, r) {
    const dx = origin[0] - center[0], dy = origin[1] - center[1], dz = origin[2] - center[2];
    const b = dx * dir[0] + dy * dir[1] + dz * dir[2], c = dx * dx + dy * dy + dz * dz - r * r, d = b * b - c;
    if (d < 0) return Infinity;
    const t = -b - Math.sqrt(d);
    return t >= 0 ? t : Infinity;
  }
  const direction = (yaw = P.yaw, pitch = P.pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

  // ------------------------------------------------------------------ feedback: audio, haptics
  function sound(name, volume = 1, rate = 1) { if (cfg.sound) A.play(name, volume, rate); }
  function vibrate(ms, strength = 1) {
    if (!cfg.haptics) return;
    try {
      if (host && host.vibrate) host.vibrate(ms, Math.round(clamp(strength, .05, 1) * 255));
      else if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* haptics are optional */ }
  }
  function rumble(ms, strength) { if (cfg.rumble && padConnected && host && host.rumble) { try { host.rumble(ms, Math.round(strength * 255)); } catch (e) { /* ignore */ } } }
  function initAudio() {
    if (!cfg.sound) return;
    A.setEnabled(true);
    A.init();
    A.setLevels({ master: cfg.masterVolume, sfx: cfg.sfxVolume, music: cfg.musicVolume });
    A.music(mode === 'running' || mode === 'paused' ? 'combat' : 'menu');
  }

  // ------------------------------------------------------------------ particles, lights, shells
  const parts = [];
  const MAX_PARTS = 700;
  const disp = h => [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  const FX = { orange: disp('ffa040'), yellow: disp('ffd27a'), white: disp('ffffff'), red: disp('ff4a3a'), cyan: disp('5ff6ff'), smoke: disp('5a5e62'), dark: disp('202224'), blue: disp('7ab8ff'), green: disp('7dff8a'), purple: disp('b88cff') };
  function particle(x, y, z, vx, vy, vz, life, size, col, alpha, kind, additive, grow = 0, drag = 0, grav = 0, stretch = 0) {
    const density = cfg.particles === 'low' ? .5 : 1;
    if (parts.length >= MAX_PARTS * density) return;
    parts.push({ x, y, z, vx, vy, vz, life, max: life, size, col, alpha, kind, additive, grow, drag, grav, stretch });
  }
  const flashes = [];
  function flashLight(x, y, z, radius, col, intensity, life) { flashes.push({ x, y, z, radius, r: col[0], g: col[1], b: col[2], intensity, life, max: life }); }
  const shells = [];
  function sparks(point, c, count = 6) {
    const col = Array.isArray(c) ? c : FX.yellow;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU, up = Math.random() * 3, s = 2 + Math.random() * 4;
      particle(point[0], point[1], point[2], Math.cos(a) * s, up, Math.sin(a) * s, .15 + Math.random() * .25, .018, col, 1, 1, true, 0, 2, 9, .045);
    }
  }
  function impactFx(p, onEnemy, color) {
    if (onEnemy) {
      sparks(p, color || FX.cyan, 7);
      particle(p[0], p[1], p[2], 0, 0, 0, .09, .22, FX.white, .9, 0, true);
      for (let i = 0; i < 2; i++) particle(p[0], p[1], p[2], (Math.random() - .5), Math.random() * .4, (Math.random() - .5), .7, .12, FX.dark, .55, 2, false, .5, 1, -0.2);
    } else {
      sparks(p, FX.yellow, 5);
      particle(p[0], p[1], p[2], 0, 0, 0, .06, .16, FX.yellow, .9, 0, true);
      particle(p[0], p[1], p[2], (Math.random() - .5) * .6, .3 + Math.random() * .3, (Math.random() - .5) * .6, .9, .14, FX.smoke, .5, 2, false, .6, 1.5, -.1);
    }
  }
  function explosionFx(at, radius) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU, s = Math.random() * radius * .9;
      particle(at[0], at[1] + .2, at[2], Math.cos(a) * s, Math.random() * 3 + 1, Math.sin(a) * s, .35 + Math.random() * .3, .7 + Math.random() * .6, i % 3 ? FX.orange : FX.yellow, 1, 0, true, 1.5, 4, -1);
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * TAU, s = Math.random() * 2.5;
      particle(at[0] + Math.cos(a) * .5, at[1] + .3, at[2] + Math.sin(a) * .5, Math.cos(a) * s, 1 + Math.random() * 2, Math.sin(a) * s, 1.8 + Math.random() * 1.4, .8 + Math.random() * .6, FX.smoke, .55, 2, false, .9, 1.4, -.6);
    }
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * TAU, up = Math.random() * 9, s = 4 + Math.random() * 12;
      particle(at[0], at[1] + .3, at[2], Math.cos(a) * s, up, Math.sin(a) * s, .4 + Math.random() * .6, .03, FX.yellow, 1, 1, true, 0, 1.2, 14, .08);
    }
    particle(at[0], at[1] + .4, at[2], 0, 0, 0, .25, radius * .9, FX.white, 1, 3, true, 2);
    particle(at[0], .05, at[2], 0, 0, 0, .45, radius * .3, FX.orange, .9, 5, true, radius * 2.2);
    particle(at[0], .03, at[2], 0, 0, 0, 9, radius * .32, FX.dark, .65, 4, false);
    flashLight(at[0], at[1] + 1, at[2], radius * 3, [1, .55, .2], 7, .45);
    const d = Math.hypot(at[0] - P.x, at[2] - P.z);
    shake = Math.max(shake, clamp(1.2 - d / 18, 0, 1) * .9);
    if (d < 20) { vibrate(Math.round(40 - d), .9); rumble(220, clamp(1 - d / 20, .2, 1)); }
  }

  // ------------------------------------------------------------------ HUD helpers
  let announceText = '';
  function announce(text, duration = 2) { announceText = text; $('announcement').textContent = text; $('announcement').classList.add('show'); announceUntil = time + duration; }
  const feed = [];
  function feedPush(text, cls) {
    feed.unshift({ text, cls, until: time + 3.2 });
    if (feed.length > 4) feed.length = 4;
    renderFeed();
  }
  function renderFeed() {
    let html = '';
    for (const f of feed) if (f.until > time) html += '<div class="feed-item ' + (f.cls || '') + '">' + f.text + '</div>';
    $('killfeed').innerHTML = html;
  }
  let medalUntil = 0;
  function medal(title, points) {
    medals++;
    score += points;
    $('medal').innerHTML = '<b>' + title + '</b><span>+' + points + '</span>';
    $('medal').classList.remove('pop');
    void $('medal').offsetWidth;
    $('medal').classList.add('pop');
    medalUntil = time + 1.6;
    sound('medal', .8);
  }
  const DMG_POOL = 12, dmgNums = [];
  for (let i = 0; i < DMG_POOL; i++) dmgNums.push({ el: $('dn' + i), life: 0, x: 0, y: 0, z: 0 });
  let dmgCursor = 0;
  function damageNumber(x, y, z, value, head, kill) {
    if (!cfg.damageNumbers) return;
    const d = dmgNums[dmgCursor++ % DMG_POOL];
    d.x = x + (Math.random() - .5) * .3; d.y = y; d.z = z + (Math.random() - .5) * .3; d.life = .8;
    d.el.textContent = Math.round(value);
    d.el.className = 'dmg-num' + (head ? ' head' : '') + (kill ? ' kill' : '');
  }
  const IND_POOL = 6, indicators = [];
  for (let i = 0; i < IND_POOL; i++) indicators.push({ el: $('di' + i), life: 0, x: 0, z: 0 });
  let indCursor = 0;
  function damageIndicator(fx, fz) {
    const d = indicators[indCursor++ % IND_POOL];
    d.x = fx; d.z = fz; d.life = 1.1;
  }

  // ------------------------------------------------------------------ waves & enemies
  function spawnWave() {
    wave++;
    cfg.best = Math.max(cfg.best, wave);
    persist();
    const rule = rules(), count = Math.min(rule.cap, rule.count + (wave - 1) * 2);
    enemies = [];
    for (let i = 0; i < count; i++) {
      let found = false, x = 0, z = 0;
      for (let tries = 0; tries < 600; tries++) {
        x = -29 + ((i * 7 + tries * 11 + wave * 3) % 59);
        z = -37 + ((i * 11 + tries * 7) % 75);
        if (freeAt(x, z, .65) && Math.hypot(x - P.x, z - P.z) > 8 && !enemies.some(e => Math.hypot(x - e.x, z - e.z) < 1.4)) { found = true; break; }
      }
      if (!found) continue;
      const type = ['grunt', 'rusher', 'heavy', 'sniper', 'medic', 'bomber'][i % 6], boss = wave % 5 === 0 && i === 0, size = boss ? 1.45 : 1;
      const hp = (72 + wave * 8) * rule.hp * (type === 'heavy' ? 2.4 : type === 'rusher' ? .7 : type === 'medic' ? 1.1 : 1) * (boss ? 3 : 1);
      enemies.push({ id: i, x, z, hp, maxHP: hp, type, boss, size, dead: 0, phase: i * 2, shot: time + 2 + (i % 6) * .25, heal: time + 4, grenade: time + 4 + i * .2, flash: 0, strafe: i % 2 ? 1 : -1, hit: 0, angle: 0, move: 0, aim: 0 });
    }
    announce(rule.name + ' · WAVE ' + String(wave).padStart(2, '0') + (wave % 5 === 0 ? '\nJUGGERNAUT INBOUND' : ''), 2.2);
    sound('waveStart', .9);
    transition = 0;
    spawnLock = false;
    perkOffer = null;
    hidePerks();
    lastHud = -99;
    updateHUD();
  }
  function start() {
    runDifficulty = cfg.difficulty;
    resetMods();
    ownedPerks = [];
    muzzleUntil = 0; nextHealth = mods.regenInterval;
    clearInput();
    mode = 'running';
    time = 0; runTime = 0; lastHud = -99; damageFlash = 0; hitUntil = 0;
    wave = kills = shots = hits = headshots = 0; score = 0; streak = 0; multi = 0; medals = 0; lastKillTime = -9;
    transition = 0; spawnLock = false; perkOffer = null;
    nextFire = reloadEnd = recoil = kick = 0; lastDamage = -99; dashReady = dashEnd = 0; ads = false; adsBlend = 0; switchAnim = 0; shake = 0;
    projectiles = []; pickups = []; traces = []; parts.length = 0; flashes.length = 0; shells.length = 0; feed.length = 0; grenadeReady = 0;
    inventory = GUNS.map(g => ({ ammo: g.mag, reserve: g.reserve }));
    Object.assign(P, { x: 0, z: 12, y: 1.65, feet: 0, vy: 0, yaw: 0, pitch: 0, hp: 100, shield: 50, ammo: 30, reserve: 210, vx: 0, vz: 0, fuel: 100, grenades: 5, grounded: true });
    P.ammo = gunSpec().mag; P.reserve = gunSpec().reserve;
    for (const k of ['menu', 'result', 'pause-panel', 'settings', 'help', 'perks']) $(k).classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('controls').classList.remove('hidden');
    $('ads').classList.remove('active');
    $('tutorial').style.opacity = '1';
    $('hitmarker').className = '';
    renderFeed();
    initAudio();
    A.music('combat');
    spawnWave();
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* not supported */ }
    setNav(null);
    updateHUD();
  }
  function pause() {
    if (mode !== 'running') return;
    padArmed = false;
    mode = 'paused';
    clearInput();
    A.jet(0);
    $('pause-panel').classList.remove('hidden');
    $('controls').classList.add('hidden');
    $('pause-perks').textContent = ownedPerks.length ? 'PERKS · ' + ownedPerks.map(p => p.icon + ' ' + p.name).join('  ·  ') : 'No perks yet. Clear a wave to choose one.';
    setNav('pause');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function resume() {
    if (mode !== 'paused') return;
    mode = 'running';
    $('pause-panel').classList.add('hidden');
    $('settings').classList.add('hidden');
    $('controls').classList.remove('hidden');
    last = performance.now();
    accumulator = 0;
    initAudio();
    setNav(perkOffer ? 'perks' : null);
  }
  function toMenu() {
    mode = 'menu';
    clearInput();
    A.jet(0);
    A.music('menu');
    $('menu').classList.remove('hidden');
    for (const k of ['hud', 'controls', 'pause-panel', 'result', 'settings', 'help', 'perks']) $(k).classList.add('hidden');
    refreshMenu();
    persist();
    setNav('menu');
  }
  function finish(win) {
    mode = win ? 'won' : 'lost';
    clearInput();
    A.jet(0);
    cfg.bestScore = Math.max(cfg.bestScore, score);
    $('controls').classList.add('hidden');
    $('perks').classList.add('hidden');
    $('result').classList.remove('hidden');
    $('result-tag').textContent = win ? 'OPERATION COMPLETE' : 'SIGNAL LOST';
    $('result-title').textContent = win ? 'SECTOR SECURED.' : 'BACK IN THE FIGHT.';
    const acc = shots ? Math.round(hits / shots * 100) : 0;
    $('result-stats').innerHTML =
      stat('SCORE', score.toLocaleString ? score.toLocaleString('en-US') : score) + stat('WAVE', wave) + stat('ELIMINATIONS', kills) +
      stat('HEADSHOTS', headshots) + stat('ACCURACY', acc + '%') + stat('MEDALS', medals);
    $('result-note').textContent = (win ? 'All operation waves cleared. ' : 'Reached wave ' + wave + '. Use cover while your shield recharges. ') + 'Best score ' + cfg.bestScore + ' · best wave ' + cfg.best + '.';
    persist();
    vibrate(win ? 60 : 120, .8);
    setNav('result');
  }
  const stat = (k, v) => '<div class="stat"><b>' + v + '</b><span>' + k + '</span></div>';

  function aimAssist(dir) {
    if (!cfg.assist) return dir;
    let best = null, scoreDot = ads ? .9988 : .9993;
    const origin = [P.x, P.y, P.z];
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      let d = [e.x - P.x, 1.4 * (e.size || 1) - P.y, e.z - P.z];
      const len = Math.hypot(d[0], d[1], d[2]);
      d = [d[0] / len, d[1] / len, d[2] / len];
      const dt = R.math.dot(dir, d);
      if (dt > scoreDot && wallDistance(origin, d) > len - .6) { best = d; scoreDot = dt; }
    }
    return best ? R.math.unit(dir.map((v, i) => v * .72 + best[i] * .28)) : dir;
  }
  function killEnemy(e, head = false, via = 'gun') {
    if (e.counted) return;
    e.counted = true;
    e.dead = time;
    kills++;
    if (head) headshots++;
    streak++;
    multi = time - lastKillTime < 1.6 ? multi + 1 : 1;
    lastKillTime = time;
    const base = (e.boss ? 1000 : 100) + (head ? 50 : 0);
    score += Math.round(base * (1 + Math.min(streak, 20) * .05));
    feedPush((head ? '<i>⌖</i> ' : '') + (e.boss ? 'JUGGERNAUT' : (e.type || 'hostile').toUpperCase()) + ' ELIMINATED', head ? 'head' : '');
    if (multi === 2) medal('DOUBLE KILL', 100);
    else if (multi === 3) medal('TRIPLE KILL', 250);
    else if (multi >= 4) medal('MULTI KILL ×' + multi, 150 * multi);
    else if (e.boss) medal('GIANT SLAYER', 500);
    else if (streak === 5) medal('RAMPAGE', 300);
    else if (streak === 10) medal('UNSTOPPABLE', 600);
    else if (streak === 20) medal('GODLIKE', 1200);
    else if (via === 'gun' && Math.hypot(e.x - P.x, e.z - P.z) > 30) medal('LONG SHOT', 150);
    else if (head && (gunIndex === 3)) medal('MARKSMAN', 80);
    if (mods.lifesteal) P.hp = Math.min(mods.maxHp, P.hp + mods.lifesteal);
    sound('kill', .7);
    A.playAt && cfg.sound && A.playAt('robotDie', e.x, e.z, P, .8);
    vibrate(14, .5);
    const s = e.size || 1;
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * TAU, sp = 1 + Math.random() * 4;
      particle(e.x, 1.3 * s, e.z, Math.cos(a) * sp, Math.random() * 4, Math.sin(a) * sp, .3 + Math.random() * .4, .025, i % 2 ? FX.cyan : FX.white, 1, 1, true, 0, 1, 9, .06);
    }
    particle(e.x, 1.2 * s, e.z, 0, 0, 0, .2, .9 * s, FX.cyan, .8, 0, true, 2);
    for (let i = 0; i < 4; i++) particle(e.x, 1 * s, e.z, (Math.random() - .5), .6 + Math.random(), (Math.random() - .5), 2 + Math.random(), .4, FX.dark, .5, 2, false, .7, 1, -.3);
    flashLight(e.x, 1.4 * s, e.z, 6, [.4, .9, 1], 3, .25);
    if (kills % 2 === 0) pickups.push({ x: e.x, z: e.z, kind: ['ammo', 'fuel', 'grenade', 'health', 'shield'][Math.floor(kills / 2) % 5], life: 35 });
  }
  function hitEnemy(e, damage, head = false, via = 'gun') {
    if (e.hp <= 0) return;
    e.hp -= damage;
    e.hit = time + .1;
    if (e.hp <= 0) killEnemy(e, head, via);
  }
  function explosion(at, damage, radius, hostile = false) {
    explosionFx(at, radius);
    if (cfg.sound) A.playAt('explosion', at[0], at[2], P, 1.3, 1);
    const targets = hostile ? [P] : enemies;
    let killed = 0;
    for (const e of targets) {
      if (!hostile && e.hp <= 0) continue;
      const distance = Math.hypot(e.x - at[0], e.z - at[2]);
      if (distance >= radius) continue;
      const dy = (hostile ? P.y : 1.1) - at[1], dir = R.math.unit([e.x - at[0], dy, e.z - at[2]]), range = Math.hypot(distance, dy);
      if (wallDistance(at, dir) < range - .3) continue;
      const amount = damage * (1 - distance / radius);
      if (hostile) hurt(amount, at[0], at[2]);
      else {
        const before = e.hp;
        hitEnemy(e, amount, false, 'blast');
        if (before > 0 && e.hp <= 0) killed++;
        damageNumber(e.x, 2.1 * (e.size || 1), e.z, amount, false, e.hp <= 0);
      }
    }
    if (killed >= 2) medal('DEMOLITION', 120 * killed);
    kick = Math.max(kick, .035);
  }
  function throwGrenade() {
    if (mode !== 'running' || time < grenadeReady || P.grenades <= 0) return false;
    P.grenades--;
    grenadeReady = time + .65;
    const d = direction();
    projectiles.push({ x: P.x, y: P.y, z: P.z, vx: d[0] * 13, vy: d[1] * 13 + 4, vz: d[2] * 13, fuse: 1.8, rocket: false, hostile: false, damage: 190, radius: 6 * mods.blast });
    sound('grenadeThrow', .8);
    vibrate(8, .4);
    return true;
  }
  function switchGun(index) {
    if (!Number.isInteger(index) || index < 0 || index >= GUNS.length) return false;
    if (inventory.length) {
      inventory[gunIndex] = { ammo: P.ammo, reserve: P.reserve };
      gunIndex = index;
      Object.assign(P, inventory[index]);
    } else gunIndex = index;
    reloadEnd = 0;
    nextFire = Math.max(nextFire, time + .18);
    fireHeld = false;
    ads = false; adsBlend = 0;
    switchAnim = 1;
    $('ads').classList.remove('active');
    $('fire').classList.remove('firing');
    lastHud = -99;
    if (mode === 'running') sound('bolt', .5, 1.1);
    updateHUD();
    return true;
  }
  const muzzleWorld = [0, 0, 0];
  function muzzlePoint() {
    const f = direction(), right = [Math.cos(P.yaw), 0, Math.sin(P.yaw)];
    const side = .14 * (1 - adsBlend), down = .12 * (1 - adsBlend) + .03;
    muzzleWorld[0] = P.x + f[0] * .75 + right[0] * side;
    muzzleWorld[1] = P.y + f[1] * .75 - down;
    muzzleWorld[2] = P.z + f[2] * .75 + right[2] * side;
    return muzzleWorld;
  }
  function shoot() {
    if (mode !== 'running' || time < nextFire || reloadEnd) return false;
    if (P.ammo <= 0) { sound('empty', .6); reload(); return false; }
    const g = gunSpec();
    P.ammo--;
    shots++;
    muzzleUntil = time + .05;
    nextFire = time + g.interval / mods.fireRate;
    const origin = [P.x, P.y, P.z];
    let hit = false, headHit = false, killedAny = false;
    const mz = muzzlePoint();
    if (gunIndex === 5) {
      const d = direction(P.yaw, P.pitch + recoil);
      projectiles.push({ x: P.x + d[0] * .6, y: P.y - .06, z: P.z + d[2] * .6, vx: d[0] * 32, vy: d[1] * 32, vz: d[2] * 32, fuse: 2.2, rocket: true, hostile: false, damage: g.damage * mods.damage, radius: 5.5 * mods.blast });
      for (let i = 0; i < 6; i++) particle(mz[0], mz[1], mz[2], (Math.random() - .5) * 2, Math.random(), (Math.random() - .5) * 2, 1.2, .35, FX.smoke, .5, 2, false, .8, 1.5, -.2);
    } else for (let pellet = 0; pellet < g.pellets; pellet++) {
      const spread = g.spread * (ads ? .45 : 1), angle = pellet * 2.39996, radius = g.pellets > 1 ? Math.sqrt(pellet / (g.pellets - 1)) : Math.min(.8, recoil * 9);
      const dir = aimAssist(direction(P.yaw + Math.cos(angle) * spread * radius, P.pitch + recoil + Math.sin(angle) * spread * radius));
      let d = wallDistance(origin, dir), target = null, head = false;
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        const size = e.size || 1;
        const hd = sphereHit(origin, dir, [e.x, 1.91 * size, e.z], .28 * size), bd = sphereHit(origin, dir, [e.x, 1.13 * size, e.z], .5 * size);
        if (hd < d || bd < d) { head = hd < bd; d = Math.min(hd, bd); target = e; }
      }
      const end = [origin[0] + dir[0] * Math.min(65, d), origin[1] + dir[1] * Math.min(65, d), origin[2] + dir[2] * Math.min(65, d)];
      if (pellet < 3) traces.push({ a: [mz[0], mz[1], mz[2]], b: end, life: .05, enemy: false });
      if (d < 65 || target) impactFx(end, !!target, target ? (head ? FX.yellow : FX.cyan) : null);
      if (target) {
        hit = true;
        const falloff = (gunIndex === 2 || gunIndex === 7) ? clamp(1 - d / 38, .22, 1) : gunIndex === 1 ? clamp(1 - d / 80, .55, 1) : 1;
        const amount = (head ? g.head * mods.headshot : g.damage) * falloff * mods.damage;
        const alive = target.hp > 0;
        hitEnemy(target, amount, head);
        if (alive && target.hp <= 0) killedAny = true;
        if (head) headHit = true;
        damageNumber(end[0], end[1] + .25, end[2], amount, head, target.hp <= 0);
        hitUntil = time + .11;
      }
    }
    if (hit) {
      hits++;
      $('hitmarker').className = 'show' + (killedAny ? ' kill' : headHit ? ' head' : '');
      if (headHit) sound('headshot', .55); else sound('hit', .45);
    }
    // Muzzle flash, light, shell casing, recoil.
    flashLight(mz[0], mz[1], mz[2], 7, [1, .7, .35], gunIndex === 9 || gunIndex === 2 || gunIndex === 7 ? 4 : 2.6, .06);
    if (gunIndex !== 5) {
      const right = [Math.cos(P.yaw), 0, Math.sin(P.yaw)];
      shells.push({ x: P.x + right[0] * .2, y: P.y - .12, z: P.z + right[2] * .2, vx: right[0] * (1.5 + Math.random()) + P.vx, vy: 1.8 + Math.random(), vz: right[2] * (1.5 + Math.random()) + P.vz, rx: 0, ry: Math.random() * 3, life: 2.2, big: gunIndex === 2 || gunIndex === 7 || gunIndex === 9 });
      if (shells.length > 40) shells.shift();
    }
    recoil = Math.min(.13, recoil + g.recoil * (ads ? .65 : 1));
    kick = Math.min(.14, kick + g.recoil * 4);
    P.yaw += (Math.random() - .5) * g.recoil * .35;
    if (gunIndex === 2) pumpAnim = 1;
    if (gunIndex === 6) slideAnim = 1;
    if (gunIndex === 9) spinSpeed = 40;
    sound('gun' + gunIndex, gunIndex === 1 ? .55 : .75, 1);
    vibrate(gunIndex === 2 || gunIndex === 3 || gunIndex === 5 || gunIndex === 7 ? 18 : 7, gunIndex === 1 ? .25 : .45);
    rumble(gunIndex === 2 || gunIndex === 5 ? 90 : 35, gunIndex === 1 ? .25 : .5);
    if (P.ammo === 0) reload();
    lastHud = -99;
    updateHUD();
    return true;
  }
  let reloadSounds = 0;
  function reload() {
    if (mode !== 'running' || reloadEnd || P.ammo === gunSpec().mag || P.reserve <= 0) return false;
    reloadStart = time;
    reloadEnd = time + gunSpec().reload * mods.reload;
    reloadSounds = 0;
    fireHeld = false;
    $('fire').classList.remove('firing');
    return true;
  }
  function dash() {
    const cost = 20 * mods.fuel;
    if (mode !== 'running' || time < dashReady || P.fuel < cost) return false;
    P.fuel -= cost;
    dashReady = time + .75 / mods.speed;
    dashEnd = time + .22;
    sound('dash', .7);
    vibrate(8, .4);
    return true;
  }
  function jump() {
    if (mode !== 'running') return false;
    if (P.grounded) {
      P.vy = 5.6;
      P.grounded = false;
      sound('step', .6, .8);
      return true;
    }
    return false;
  }
  function updateProjectiles(dt) {
    for (const p of projectiles) {
      p.fuse -= dt;
      const delta = [p.vx * dt, p.vy * dt, p.vz * dt], length = Math.hypot(delta[0], delta[1], delta[2]), origin = [p.x, p.y, p.z];
      const blocked = length > 0 && wallDistance(origin, [delta[0] / length, delta[1] / length, delta[2] / length]) <= length + .08;
      let impact = blocked;
      if (blocked) {
        if (!p.rocket) { p.vx *= -.45; p.vz *= -.45; p.vy *= .5; }
      } else { p.x += delta[0]; p.y += delta[1]; p.z += delta[2]; }
      if (!p.rocket) p.vy -= 11 * dt;
      if (p.y < .12) { p.y = .12; p.vy = Math.abs(p.vy) * .4; p.vx *= .7; p.vz *= .7; impact = true; }
      if (p.rocket && !p.hostile) for (const e of enemies) if (e.hp > 0 && Math.hypot(e.x - p.x, e.z - p.z) < .65 && p.y < 2.4 * (e.size || 1)) { impact = true; break; }
      if (p.rocket && Math.random() < .8) particle(p.x, p.y, p.z, (Math.random() - .5) * .4, (Math.random() - .5) * .4, (Math.random() - .5) * .4, .8, .2, FX.smoke, .45, 2, false, .7, 1, -.1);
      if (p.fuse <= 0 || (p.rocket && impact)) { explosion([p.x, Math.max(.2, p.y), p.z], p.damage, p.radius, p.hostile); p.done = true; }
    }
    projectiles = projectiles.filter(p => !p.done);
    for (const p of pickups) {
      p.life -= dt;
      if (Math.hypot(p.x - P.x, p.z - P.z) < 1.4 && P.feet < 1.2) {
        if (p.kind === 'ammo') P.reserve = Math.min(999, P.reserve + gunSpec().mag * 3);
        if (p.kind === 'fuel') P.fuel = 100;
        if (p.kind === 'grenade') P.grenades = Math.min(14, P.grenades + 2);
        if (p.kind === 'health') P.hp = Math.min(mods.maxHp, P.hp + 35);
        if (p.kind === 'shield') P.shield = Math.min(mods.maxShield, P.shield + 35);
        feedPush('+ ' + p.kind.toUpperCase(), 'pickup');
        p.life = 0;
        sound('pickup', .7);
        vibrate(10, .3);
      }
    }
    pickups = pickups.filter(p => p.life > 0);
  }
  function hurt(amount, fromX, fromZ) {
    if (mode !== 'running') return;
    if (!Number.isFinite(amount) || amount <= 0) return;
    amount *= rules().damage;
    lastDamage = time;
    nextHealth = time + mods.regenInterval;
    const hadShield = P.shield > 0;
    const block = Math.min(P.shield, amount);
    P.shield -= block;
    P.hp = Math.max(0, P.hp - (amount - block));
    damageFlash = Math.min(.8, damageFlash + (amount - block > 0 ? .5 : .25));
    kick += .02;
    shake = Math.max(shake, .25);
    streak = 0;
    if (Number.isFinite(fromX)) damageIndicator(fromX, fromZ);
    if (hadShield && P.shield <= 0) sound('shieldBreak', .8); else if (block > 0 && amount - block <= 0) sound('shieldHit', .6); else sound('hurt', .8);
    vibrate(18, .7);
    rumble(120, .7);
    if (P.hp <= 0) finish(false);
  }

  // ------------------------------------------------------------------ simulation
  function update(dt) {
    if (mode !== 'running') return;
    time += dt;
    runTime += dt;
    // Movement input.
    let mx = input.mx + (input.padX || 0), my = input.my + (input.padY || 0);
    if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) mx -= 1;
    if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) mx += 1;
    if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) my -= 1;
    if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) my += 1;
    if (time < dashEnd && Math.abs(mx) + Math.abs(my) < .1) my = -1;
    let magnitude = Math.hypot(mx, my);
    if (magnitude > 1) { mx /= magnitude; my /= magnitude; }
    const sprint = (magnitude > .92 || input.keys.has('ShiftLeft')) && !ads && !fireHeld && P.fuel > 1 && !reloadEnd;
    const speed = (time < dashEnd ? 14 : ads ? 3.3 : sprint ? 6.5 : 4.8) * mods.speed * (P.grounded ? 1 : .85);
    const vx = (Math.cos(P.yaw) * mx - Math.sin(P.yaw) * my) * speed, vz = (Math.sin(P.yaw) * mx + Math.cos(P.yaw) * my) * speed;
    const rate = (magnitude > .01 ? 25 : 35) * (P.grounded ? 1 : .35);
    P.vx += (vx - P.vx) * (1 - Math.exp(-dt * rate));
    P.vz += (vz - P.vz) * (1 - Math.exp(-dt * rate));
    const r = .35;
    if (W.freeAtHeight(P.x + P.vx * dt, P.z, r, P.feet)) P.x += P.vx * dt;
    if (W.freeAtHeight(P.x, P.z + P.vz * dt, r, P.feet)) P.z += P.vz * dt;
    // Vertical: jumping, jetpack, standing on cover.
    const ground = W.groundAt(P.x, P.z, r, P.feet);
    const jetting = input.jumpHeld && !P.grounded && P.fuel > 2 && P.vy < 4.5;
    if (jetting) { P.vy += 24 * dt; P.fuel = Math.max(0, P.fuel - 30 * mods.fuel * dt); }
    if (!P.grounded || P.feet > ground + .001) {
      P.grounded = false;
      P.vy -= 16 * dt;
      P.feet += P.vy * dt;
      if (P.feet <= ground) {
        if (P.vy < -3) { landDip = Math.min(.18, -P.vy * .02); sound('land', clamp(-P.vy / 10, .2, .8)); vibrate(10, .3); }
        P.feet = ground; P.vy = 0; P.grounded = true;
      }
      if (P.feet > 9) { P.feet = 9; P.vy = Math.min(0, P.vy); }
    }
    if (cfg.sound) A.jet(jetting ? 1 : 0);
    if (jetting && Math.random() < .5) particle(P.x, P.feet, P.z, (Math.random() - .5), -3, (Math.random() - .5), .3, .25, FX.orange, .8, 0, true, -.5);
    P.y = P.feet + 1.65 - landDip;
    landDip *= Math.exp(-dt * 10);
    // Footsteps.
    const groundSpeed = Math.hypot(P.vx, P.vz);
    if (P.grounded && groundSpeed > 1.5) {
      stepClock += dt * groundSpeed * .42;
      if (stepClock > 1) { stepClock = 0; sound('step', .25 + groundSpeed * .03, .9 + Math.random() * .2); }
    }
    recoil *= Math.exp(-dt * 12);
    kick *= Math.exp(-dt * 17);
    adsBlend += ((ads ? 1 : 0) - adsBlend) * (1 - Math.exp(-dt * 18));
    pumpAnim = Math.max(0, pumpAnim - dt * 2.4);
    slideAnim = Math.max(0, slideAnim - dt * 9);
    switchAnim = Math.max(0, switchAnim - dt * 4.5);
    spinSpeed *= Math.exp(-dt * 2.5);
    spin += spinSpeed * dt;
    shake *= Math.exp(-dt * 5);
    if (sprint && magnitude > .1) P.fuel = Math.max(0, P.fuel - dt * 4 * mods.fuel);
    else if (time > dashEnd && !jetting) P.fuel = Math.min(100, P.fuel + dt * 8);
    updateProjectiles(dt);
    if (mode !== 'running') return;
    if (fireHeld) shoot();
    else if (cfg.autoFire && autoFireTarget()) shoot();
    if (reloadEnd) {
      const k = 1 - (reloadEnd - time) / (reloadEnd - reloadStart);
      if (reloadSounds === 0 && k > .2) { reloadSounds = 1; sound('magOut', .6); }
      if (reloadSounds === 1 && k > .6) { reloadSounds = 2; sound('magIn', .7); }
      if (reloadSounds === 2 && k > .85) { reloadSounds = 3; sound('bolt', .6); }
    }
    if (reloadEnd && time >= reloadEnd) {
      const amount = Math.min(gunSpec().mag - P.ammo, P.reserve);
      P.ammo += amount; P.reserve -= amount;
      reloadEnd = 0;
      if (P.ammo > 0 && (input.fireId !== null || input.fire2Id !== null)) fireHeld = true;
    }
    // Health rule: +5 every interval without damage, capped.
    if (time + 1e-7 >= nextHealth) { P.hp = Math.min(mods.maxHp, P.hp + 5); nextHealth += mods.regenInterval; }
    if (time - lastDamage > 4.5) P.shield = Math.min(mods.maxShield, P.shield + dt * 18 * mods.shieldRegen);
    updateEnemies(dt);
    if (mode !== 'running') return;
    for (const p of parts) {
      p.life -= dt;
      if (p.drag) { const k = Math.exp(-dt * p.drag); p.vx *= k; p.vy *= k; p.vz *= k; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < .02 && p.kind === 1) { p.y = .02; p.vy = Math.abs(p.vy) * .3; }
      p.size += p.grow * dt;
    }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); }
    for (const s of shells) {
      s.life -= dt;
      s.vy -= 12 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      s.rx += dt * 18; s.ry += dt * 7;
      if (s.y < .01) { s.y = .01; s.vy = Math.abs(s.vy) * .35; s.vx *= .6; s.vz *= .6; if (s.vy > .4 && s.life > 1.5) sound('ui', .08, 2.2); }
    }
    for (let i = shells.length - 1; i >= 0; i--) if (shells[i].life <= 0) shells.splice(i, 1);
    for (const f of flashes) f.life -= dt;
    for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].life <= 0) flashes.splice(i, 1);
    for (const tr of traces) tr.life -= dt;
    traces = traces.filter(tr => tr.life > 0);
    damageFlash = Math.max(0, damageFlash - dt * 1.7);
    // Wave flow: clear -> resupply -> perk choice -> next wave.
    if (enemies.length && enemies.every(e => e.hp <= 0) && !spawnLock) {
      spawnLock = true;
      const final = wave >= rules().waves;
      sound('waveClear', .8);
      P.hp = Math.min(mods.maxHp, P.hp + 20);
      P.shield = mods.maxShield;
      P.reserve = Math.max(180, P.reserve);
      const need = gunSpec().mag - P.ammo;
      P.ammo = gunSpec().mag;
      P.reserve = Math.max(0, P.reserve - need);
      P.grenades = Math.min(12, P.grenades + 2);
      P.fuel = 100;
      for (let i = 0; i < inventory.length; i++) if (i !== gunIndex) inventory[i] = { ammo: GUNS[i].mag, reserve: Math.max(inventory[i].reserve, Math.round(GUNS[i].reserve / 2 * mods.reserve)) };
      reloadEnd = 0;
      score += 250 * wave;
      if (final) { transition = time + 3; announce('SECTOR CLEAR', 2.5); }
      else offerPerks();
    }
    if (perkOffer && time >= perkDeadline) choosePerk(0);
    if (transition && time >= transition) {
      if (wave >= rules().waves) finish(true);
      else spawnWave();
    }
  }
  function autoFireTarget() {
    if (reloadEnd || time < nextFire) return false;
    const dir = direction(P.yaw, P.pitch), origin = [P.x, P.y, P.z];
    const wall = wallDistance(origin, dir);
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const s = e.size || 1;
      const d = Math.min(sphereHit(origin, dir, [e.x, 1.13 * s, e.z], .55 * s), sphereHit(origin, dir, [e.x, 1.91 * s, e.z], .3 * s));
      if (d < wall && d < 60) return true;
    }
    return false;
  }
  function updateEnemies(dt) {
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const dx = P.x - e.x, dz = P.z - e.z, dist = Math.hypot(dx, dz);
      e.angle = Math.atan2(-dx, -dz);
      e.aim = Math.atan2(P.y - 1.5, dist || 1);
      if (time >= (e.nextSight || 0)) {
        e.canSee = wallDistance([e.x, 1.55, e.z], R.math.unit([dx, P.y - 1.55, dz])) > dist - .4;
        e.nextSight = time + .12;
      }
      const canSee = e.canSee;
      const desired = e.type === 'sniper' ? 18 : e.type === 'rusher' ? 1 : 9;
      const toward = dist > desired ? 1 : dist < desired - 3 ? -1 : 0;
      const sx = dx / (dist || 1), sz = dz / (dist || 1), sidestep = Math.sin(time * .8 + e.phase) > .2 ? e.strafe : -e.strafe;
      const speed = (1.25 + wave * .08) * (e.type === 'rusher' ? 2.8 : e.type === 'heavy' ? .65 : 1);
      const oldX = e.x, oldZ = e.z;
      move(e, (sx * toward + sz * sidestep * .65) * speed * dt, (sz * toward - sx * sidestep * .65) * speed * dt, .4);
      if (Math.abs(oldX - e.x) + Math.abs(oldZ - e.z) < .001) { move(e, sz * e.strafe * speed * dt, -sx * e.strafe * speed * dt, .4); e.phase += dt * 2; }
      const moved = Math.hypot(e.x - oldX, e.z - oldZ) / Math.max(dt, 1e-4);
      e.move = (e.move || 0) + (clamp(moved / 3, 0, 1) - (e.move || 0)) * Math.min(1, dt * 8);
      e.phase += dt * (1.5 + moved * 1.4);
      if (time >= (e.nextSeparate || 0)) {
        e.nextSeparate = time + .1;
        for (const other of enemies) if (other !== e && other.hp > 0) {
          const ox = e.x - other.x, oz = e.z - other.z, d = Math.hypot(ox, oz);
          if (d > .01 && d < .85) move(e, ox / d * .1, oz / d * .1, .4);
        }
      }
      if (e.type === 'medic' && time >= e.heal) {
        e.heal = time + 4;
        for (const other of enemies) if (other.hp > 0 && Math.hypot(e.x - other.x, e.z - other.z) < 6) other.hp = Math.min(other.maxHP, other.hp + 18);
        particle(e.x, 1.2, e.z, 0, 0, 0, .5, 1.2, FX.cyan, .5, 5, true, 10);
      }
      if (e.type === 'bomber' && canSee && time >= e.grenade) {
        e.grenade = time + 6;
        const flight = 1.5;
        projectiles.push({ x: e.x, y: 1.5, z: e.z, vx: dx / flight, vy: (P.y - 1.5 + 5.5 * flight * flight) / flight, vz: dz / flight, fuse: flight, damage: 42, radius: 4.5, hostile: true, rocket: false });
      }
      if (e.type === 'sniper' && time > e.shot - .4 && canSee) traces.push({ a: [e.x, 1.6, e.z], b: [P.x, P.y, P.z], life: .025, enemy: true, laser: true });
      if (time >= e.shot && dist < (e.type === 'rusher' ? 1.9 : 35) && canSee && wallDistance([e.x, 1.55, e.z], R.math.unit([dx, P.y - 1.55, dz])) > dist - .4) {
        e.shot = time + Math.max(.45, (1.35 + Math.random() * .6 - Math.min(.4, wave * .06)) * rules().rate) * (e.type === 'sniper' ? 1.8 : 1);
        e.flash = time + .065;
        const from = e.muzzle && e.muzzle[1] > .5 ? [e.muzzle[0], e.muzzle[1], e.muzzle[2]] : [e.x, 1.48, e.z];
        traces.push({ a: from, b: [P.x, P.y - .1, P.z], life: .075, enemy: true });
        flashLight(from[0], from[1], from[2], 5, [1, .4, .25], 2.2, .06);
        if (cfg.sound) A.playAt(e.type === 'rusher' ? 'hit' : 'enemyShot', e.x, e.z, P, e.type === 'heavy' || e.boss ? .9 : .6, e.type === 'sniper' ? .7 : 1);
        if (Math.random() < (.67 - (Math.hypot(P.vx, P.vz) > 5 ? .22 : 0) - (P.grounded ? 0 : .12))) hurt((7 + wave) * (e.type === 'heavy' ? 1.4 : e.type === 'sniper' ? 2 : e.type === 'rusher' ? 1.2 : 1), e.x, e.z);
        if (mode !== 'running') break;
      }
    }
  }

  // ------------------------------------------------------------------ perks
  function offerPerks() {
    const pool = PERKS.slice();
    const pick = [];
    let seed = (wave * 7919 + kills * 31 + shots) >>> 0;
    while (pick.length < 3 && pool.length) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      pick.push(pool.splice(seed % pool.length, 1)[0]);
    }
    perkOffer = pick;
    perkDeadline = time + 20;
    for (let i = 0; i < 3; i++) {
      const p = pick[i];
      $('perk' + i).innerHTML = '<span class="perk-icon">' + p.icon + '</span><b>' + p.name + '</b><small>' + p.text + '</small><kbd>' + (i + 1) + '</kbd>';
    }
    $('perks').classList.remove('hidden');
    setNav('perks');
  }
  function hidePerks() { $('perks').classList.add('hidden'); if (navScreen === 'perks') setNav(null); }
  function choosePerk(i) {
    if (!perkOffer) return false;
    const p = perkOffer[clamp(i | 0, 0, perkOffer.length - 1)];
    p.apply();
    ownedPerks.push(p);
    perkOffer = null;
    hidePerks();
    feedPush(p.icon + ' ' + p.name.toUpperCase(), 'perk');
    sound('pickup', .8, .8);
    transition = time + 2.5;
    announce('NEXT WAVE INBOUND', 2);
    lastHud = -99;
    return true;
  }

  // ------------------------------------------------------------------ rendering
  const actors = new R.Batch(false), weaponBatch = new R.Batch(false);
  const addList = new R.Particles(2048), alphaList = new R.Particles(1024), viewAdd = new R.Particles(64);
  const lightList = [], lampList = [];
  let lampClock = -1;
  const weaponState = { kick: 0, swayX: 0, swayY: 0, swayYaw: 0, roll: 0, bob: 0, ads: 0, reload: 0, switching: 0, sprint: 0, accent: [0, 0, 0], pump: 0, slide: 0, spin: 0, charge: 0, loaded: true, muzzleOut: [0, 0, 0] };
  const accentCache = GUNS.map(g => R.rgb(g.color));
  function gatherLights(x, z) {
    lightList.length = 0;
    for (const f of flashes) lightList.push({ x: f.x, y: f.y, z: f.z, radius: f.radius, r: f.r, g: f.g, b: f.b, intensity: f.intensity * clamp(f.life / f.max * 1.5, 0, 1) });
    if (lightList.length > 1) lightList.sort((a, b) => b.intensity / (1 + Math.hypot(b.x - x, b.z - z)) - a.intensity / (1 + Math.hypot(a.x - x, a.z - z)));
    if (time - lampClock > .3 || time < lampClock) { lampClock = time; lampList.length = 0; W.nearestLamps(x, z, 3, lampList); }
    const slots = R.options().lights || 4;
    for (const l of lampList) if (lightList.length < slots) lightList.push(l);
    R.setLights(lightList);
  }
  function pushParticles() {
    addList.clear(); alphaList.clear();
    for (const p of parts) {
      const k = clamp(p.life / p.max, 0, 1);
      const a = p.alpha * (p.kind === 2 ? Math.min(1, k * 2.5) * Math.min(1, (1 - k) * 6 + .3) : k);
      const list = p.additive ? addList : alphaList;
      if (p.stretch) list.add(p.x, p.y, p.z, Math.max(.004, p.size), p.col[0], p.col[1], p.col[2], a, p.kind, p.vx * p.stretch, p.vy * p.stretch, p.vz * p.stretch);
      else list.add(p.x, p.y, p.z, Math.max(.01, p.size), p.col[0], p.col[1], p.col[2], a, p.kind);
    }
    for (const tr of traces) {
      const c = tr.enemy ? (tr.laser ? FX.purple : FX.red) : FX.yellow;
      const dx = tr.b[0] - tr.a[0], dy = tr.b[1] - tr.a[1], dz = tr.b[2] - tr.a[2];
      addList.add((tr.a[0] + tr.b[0]) / 2, (tr.a[1] + tr.b[1]) / 2, (tr.a[2] + tr.b[2]) / 2, tr.laser ? .006 : .014, c[0], c[1], c[2], tr.laser ? .8 : .9, 1, dx, dy, dz);
    }
    for (const e of enemies) {
      const s = e.size || 1;
      if (e.hp > 0 || time - e.dead < 1.5) alphaList.add(e.x, .02, e.z, .55 * s, 0, 0, 0, .55, 4);
      if (e.hp > 0 && time < (e.flash || 0) && e.muzzle) {
        addList.add(e.muzzle[0], e.muzzle[1], e.muzzle[2], .28, 1, .55, .3, 1, 3);
        addList.add(e.muzzle[0], e.muzzle[1], e.muzzle[2], .5, 1, .4, .2, .5, 0);
      }
    }
    for (const p of pickups) {
      const c = { ammo: FX.orange, fuel: FX.cyan, grenade: FX.red, health: FX.green, shield: FX.blue }[p.kind] || FX.white;
      addList.add(p.x, 1.4, p.z, .05, c[0], c[1], c[2], .5, 1, 0, 2.6, 0);
      addList.add(p.x, .45, p.z, .55, c[0], c[1], c[2], .35, 0);
    }
    for (const p of projectiles) {
      const c = p.hostile ? FX.red : p.rocket ? FX.yellow : FX.orange;
      addList.add(p.x, p.y, p.z, p.rocket ? .4 : .22, c[0], c[1], c[2], .8, 0);
    }
  }
  function drawWorldAndActors(eye, yaw, pitch, fov, roll, forward, viewTime) {
    R.begin(eye, yaw, pitch, fov, roll, viewTime);
    R.draw(W.batch);
    actors.clear();
    for (const e of enemies) {
      const dx = e.x - eye[0], dz = e.z - eye[2], d2 = dx * dx + dz * dz;
      if (d2 < 16 || dx * forward[0] + dz * forward[2] > -3) MDL.robot(actors, e, mode === 'menu' ? menuTime : time, d2 > 576);
    }
    return actors;
  }
  function draw(dt) {
    if (mode === 'menu') { drawMenu(dt); return; }
    const moving = Math.hypot(P.vx, P.vz);
    const bob = P.grounded ? Math.sin(time * 11) * Math.min(.028, moving * .005) : 0;
    const sh = shake * shake;
    const sYaw = (Math.sin(time * 47) + Math.sin(time * 29)) * .012 * sh, sPitch = (Math.sin(time * 41 + 1) + Math.sin(time * 23)) * .012 * sh, sRoll = Math.sin(time * 37) * .02 * sh;
    const g = gunSpec();
    const scoped = gunIndex === 3 && adsBlend > .85;
    const sprinting = Math.hypot(P.vx, P.vz) > 5.6 && !ads;
    const fov = cfg.fov / (1 + (g.zoom - 1) * adsBlend) + (sprinting ? 5 : 0);
    const eye = [P.x, P.y + bob, P.z];
    gatherLights(P.x, P.z);
    drawWorldAndActors(eye, P.yaw + sYaw, P.pitch + recoil + sPitch, fov, sRoll, direction(P.yaw, 0), time);
    for (const p of pickups) MDL.pickup(actors, p, time);
    for (const p of projectiles) MDL.grenade(actors, p, time);
    for (const s of shells) MDL.shell(actors, s);
    R.draw(actors);
    R.drawSky();
    pushParticles();
    R.drawParticles(alphaList, false);
    R.drawParticles(addList, true);
    // Weapon.
    const dyaw = P.yaw - lastYaw, dpitch = P.pitch - lastPitch;
    lastYaw = P.yaw; lastPitch = P.pitch;
    swayX += (clamp(-dyaw * .6, -.04, .04) - swayX) * Math.min(1, dt * 10);
    swayY += (clamp(-dpitch * .6, -.04, .04) - swayY) * Math.min(1, dt * 10);
    if (!scoped) {
      weaponBatch.clear();
      const ws = weaponState;
      ws.kick = kick; ws.swayX = swayX; ws.swayY = swayY + Math.sin(time * 1.6) * .003; ws.swayYaw = swayX * 1.5; ws.roll = swayX * 2;
      ws.bob = P.grounded ? Math.sin(time * 11) * Math.min(.012, moving * .0022) : -.01;
      ws.ads = adsBlend;
      ws.reload = reloadEnd ? clamp(1 - (reloadEnd - time) / Math.max(.01, reloadEnd - reloadStart), 0, 1) : 0;
      ws.switching = switchAnim;
      ws.sprint += ((sprinting ? 1 : 0) - ws.sprint) * Math.min(1, dt * 8);
      ws.accent = accentCache[gunIndex];
      ws.pump = Math.sin(pumpAnim * Math.PI);
      ws.slide = slideAnim;
      ws.spin = spin;
      ws.charge = Math.min(1, (time - (nextFire - g.interval)) / Math.max(.05, g.interval));
      ws.loaded = P.ammo > 0;
      const m = MDL.weapon(weaponBatch, gunIndex, ws);
      const flashing = time < muzzleUntil && !reloadEnd;
      R.setWeaponFlash(flashing ? .9 : 0, flashing ? .55 : 0, flashing ? .25 : 0);
      R.weaponView(66 - adsBlend * 10);
      R.draw(weaponBatch);
      viewAdd.clear();
      if (flashing && gunIndex !== 5) {
        const s = gunIndex === 9 || gunIndex === 2 || gunIndex === 7 ? 1.4 : gunIndex === 1 ? .8 : 1;
        viewAdd.add(m[0], m[1], m[2] - .03, .09 * s, 1, .8, .45, 1, 3);
        viewAdd.add(m[0], m[1], m[2] - .03, .16 * s, 1, .55, .25, .7, 0);
        viewAdd.add(m[0], m[1], m[2] - .1 * s, .03 * s, 1, .85, .6, .8, 1, 0, 0, -.22 * s);
      }
      R.drawParticles(viewAdd, true, true);
    }
    const hpLow = P.hp < 35 ? (1 - P.hp / 35) * (.5 + .5 * Math.sin(time * 6)) * .35 : 0;
    R.end({ damage: Math.min(.55, damageFlash * .55 + hpLow), aberration: damageFlash * 1.5 + (time < dashEnd ? .8 : 0), vignette: scoped ? 2.4 : .8 });
    updateScreenFx(dt, scoped);
  }
  // Menu backdrop: slow orbit over the arena with a squad posing.
  const menuSquad = [
    { id: 1, x: 4.6, z: 2.2, hp: 1, type: 'heavy', phase: 0, angle: 0, move: 0 },
    { id: 2, x: 6.4, z: 3.4, hp: 1, type: 'grunt', phase: 1, angle: 0, move: 0 },
    { id: 3, x: 2.9, z: 3.6, hp: 1, type: 'sniper', phase: 2, angle: 0, move: 0 },
    { id: 4, x: 8.2, z: 5, hp: 1, type: 'medic', phase: 3, angle: 0, move: 0 }
  ];
  function drawMenu(dt) {
    menuTime += dt;
    const a = menuTime * .045;
    const eye = [10 + Math.sin(a) * 3.2, 2.6 + Math.sin(menuTime * .11) * .3, 13 + Math.cos(a) * 1.5];
    const target = [5.2, 1.4, 3];
    const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
    const yaw = Math.atan2(dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    for (const e of menuSquad) e.angle = Math.atan2(-(eye[0] - e.x), -(eye[2] - e.z)) + Math.sin(menuTime * .4 + e.id) * .15;
    lightList.length = 0;
    W.nearestLamps(eye[0], eye[2], 4, lightList);
    R.setLights(lightList);
    R.begin(eye, yaw, pitch, 62, 0, menuTime);
    R.draw(W.batch);
    actors.clear();
    for (const e of menuSquad) MDL.robot(actors, e, menuTime, false);
    R.draw(actors);
    R.drawSky();
    alphaList.clear(); addList.clear();
    for (const e of menuSquad) alphaList.add(e.x, .02, e.z, .55, 0, 0, 0, .55, 4);
    R.drawParticles(alphaList, false);
    R.end({ vignette: 1.1, bloom: .9 });
  }
  function updateScreenFx(dt, scoped) {
    $('scope').classList.toggle('on', scoped);
    // Floating damage numbers follow their world position.
    for (const d of dmgNums) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.y += dt * .8;
      const p = R.project(d.x, d.y, d.z);
      if (!p || d.life <= 0) { d.el.style.opacity = '0'; d.life = 0; continue; }
      const t = 1 - d.life / .8;
      d.el.style.opacity = String(Math.min(1, d.life * 3));
      d.el.style.transform = 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px) translate(-50%,-50%) scale(' + (t < .15 ? 1.4 - t * 2.6 : 1).toFixed(2) + ')';
    }
    for (const d of indicators) {
      if (d.life <= 0) continue;
      d.life -= dt;
      const ang = Math.atan2(d.x - P.x, -(d.z - P.z)) - P.yaw;
      d.el.style.opacity = String(clamp(d.life, 0, 1));
      d.el.style.transform = 'translate(-50%,-50%) rotate(' + (ang * 180 / Math.PI).toFixed(1) + 'deg)';
      if (d.life <= 0) d.el.style.opacity = '0';
    }
  }

  // ------------------------------------------------------------------ HUD
  let radarClock = 0, radarCtx = null, radarMap = null;
  const radarEl = $('radar');
  try { radarCtx = radarEl.getContext ? radarEl.getContext('2d') : null; } catch (e) { radarCtx = null; }
  function buildRadarMap() {
    if (!radarCtx || typeof document.createElement !== 'function') return;
    radarMap = document.createElement('canvas');
    radarMap.width = 64 * 4; radarMap.height = 80 * 4;
    const c = radarMap.getContext('2d');
    c.fillStyle = 'rgba(120,200,210,.10)';
    c.fillRect(0, 0, radarMap.width, radarMap.height);
    c.fillStyle = 'rgba(160,230,235,.42)';
    for (const o of W.obstacles) c.fillRect((o.x - o.w / 2 + 32) * 4, (o.z - o.d / 2 + 40) * 4, o.w * 4, o.d * 4);
    c.strokeStyle = 'rgba(160,230,235,.7)'; c.lineWidth = 3;
    c.strokeRect(1.5, 1.5, radarMap.width - 3, radarMap.height - 3);
  }
  buildRadarMap();
  function drawRadar() {
    if (!radarCtx || !cfg.radar) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), size = 116;
    if (radarEl.width !== size * dpr) { radarEl.width = radarEl.height = size * dpr; }
    const c = radarCtx, r = size / 2, scale = r / 30;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size, size);
    c.save();
    c.beginPath(); c.arc(r, r, r - 1, 0, TAU); c.clip();
    c.fillStyle = 'rgba(6,14,18,.62)'; c.fillRect(0, 0, size, size);
    c.translate(r, r);
    c.rotate(-P.yaw);
    if (radarMap) c.drawImage(radarMap, (-32 - P.x) * scale, (-40 - P.z) * scale, 64 * scale, 80 * scale);
    for (const p of pickups) { c.fillStyle = '#ffd27a'; c.fillRect((p.x - P.x) * scale - 2, (p.z - P.z) * scale - 2, 4, 4); }
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const x = (e.x - P.x) * scale, y = (e.z - P.z) * scale;
      c.fillStyle = e.boss ? '#ffb040' : e.type === 'sniper' ? '#c49cff' : '#ff4a3a';
      c.beginPath(); c.arc(x, y, e.boss ? 4.5 : 3, 0, TAU); c.fill();
    }
    for (const p of projectiles) if (p.hostile) { c.fillStyle = (time * 8 | 0) % 2 ? '#ff8a3a' : '#fff'; c.fillRect((p.x - P.x) * scale - 2, (p.z - P.z) * scale - 2, 4, 4); }
    c.restore();
    c.strokeStyle = 'rgba(102,234,215,.55)'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(r, r, r - 1.5, 0, TAU); c.stroke();
    c.strokeStyle = 'rgba(102,234,215,.18)';
    c.beginPath(); c.arc(r, r, r * .5, 0, TAU); c.stroke();
    c.fillStyle = '#eaffff';
    c.beginPath(); c.moveTo(r, r - 6); c.lineTo(r - 4.5, r + 5); c.lineTo(r, r + 2.5); c.lineTo(r + 4.5, r + 5); c.closePath(); c.fill();
  }
  function setText(id, v) { const el = $(id); const s = String(v); if (el.textContent !== s) el.textContent = s; }
  function updateHUD() {
    if (time - lastHud < .066 && mode === 'running') return;
    lastHud = time;
    const g = gunSpec(), rule = rules();
    setText('wave', 'WAVE ' + String(wave).padStart(2, '0') + (Number.isFinite(rule.waves) ? ' / ' + rule.waves : ' / ∞'));
    setText('remaining', enemies.filter(e => e.hp > 0).length + ' HOSTILES');
    setText('score', score);
    setText('hp', Math.ceil(P.hp));
    setText('sp', Math.ceil(P.shield));
    $('health').style.width = clamp(P.hp / mods.maxHp * 100, 0, 100) + '%';
    $('shield').style.width = clamp(P.shield / mods.maxShield * 100, 0, 100) + '%';
    setText('ammo', P.ammo);
    setText('reserve', P.reserve);
    setText('reload-label', reloadEnd ? 'RELOADING' : g.kind);
    $('ammo').classList.toggle('low', P.ammo < Math.max(3, g.mag * .25));
    $('reload-ring').style.setProperty('--p', reloadEnd ? String(clamp(1 - (reloadEnd - time) / Math.max(.01, reloadEnd - reloadStart), 0, 1)) : '0');
    $('weapon-info').classList.toggle('reloading', !!reloadEnd);
    setText('gun-name', g.name);
    setText('gun-kind', (gunIndex + 1) + ' / ' + GUNS.length);
    setText('next-gun', GUNS[(gunIndex + 1) % GUNS.length].name);
    setText('grenade-count', P.grenades);
    $('fuel-bar').style.width = P.fuel + '%';
    $('fuel-bar').classList.toggle('low', P.fuel < 20);
    $('dash').classList.toggle('cooldown', time < dashReady || P.fuel < 20 * mods.fuel);
    $('grenade').classList.toggle('cooldown', P.grenades <= 0);
    $('crosshair').style.setProperty('--spread', ((ads ? 3 : 9) + kick * 100 + (g.pellets > 1 ? 14 : 0)) + 'px');
    $('crosshair').style.opacity = ads ? (gunIndex === 3 ? '0' : '.4') : '.95';
    if (time > hitUntil) $('hitmarker').className = '';
    if (time > announceUntil) $('announcement').classList.remove('show');
    if (time > medalUntil) $('medal').classList.remove('pop');
    let feedChanged = false;
    for (const f of feed) if (f.until <= time && !f.gone) { f.gone = true; feedChanged = true; }
    if (feedChanged) renderFeed();
    if (time > 9) $('tutorial').style.opacity = '0';
    const stats = R.stats();
    setText('fps', Math.min(240, Math.round(stats.fps)) + ' FPS');
    setText('frame-time', (1000 / Math.max(1, stats.fps)).toFixed(1) + ' ms · ' + Math.round(stats.resolution * 100) + '%');
    setText('regen', P.hp >= mods.maxHp ? 'HEALTH FULL' : '+5 HP IN ' + Math.max(0, Math.ceil(nextHealth - time)) + 's');
    $('streak').style.opacity = streak >= 3 ? '1' : '0';
    if (streak >= 3) setText('streak', streak + ' STREAK');
    if (perkOffer) setText('perk-timer', 'AUTO-PICK IN ' + Math.max(0, Math.ceil(perkDeadline - time)) + 's');
    if (P.hp < 30 && time - lowHpBeat > 1.1) { lowHpBeat = time; sound('heartbeat', .6); }
    radarClock += 1;
    if (radarClock % 2 === 0) drawRadar();
  }

  // ------------------------------------------------------------------ controller
  let padIndex = null, padButtons = [], padFire = false, padAim = false, padArmed = false, padConnected = false, padJump = false, padRepeat = 0, padNavDir = '';
  function stickPair(x, y) {
    x = Number.isFinite(x) ? x : 0; y = Number.isFinite(y) ? y : 0;
    const length = Math.hypot(x, y), dead = clamp(cfg.padDeadzone, .05, .35);
    if (length <= dead) return [0, 0];
    const mag = Math.min(1, (length - dead) / (1 - dead));
    const curved = mag * mag * (3 - 2 * mag) * .35 + mag * .65;
    return [x / length * curved, y / length * curved];
  }
  function releasePad(disconnected = false) {
    input.padX = input.padY = 0;
    if (padFire && input.fireId === null) fireHeld = false;
    if (padAim) { ads = false; $('ads').classList.remove('active'); }
    if (padJump) input.jumpHeld = false;
    padFire = padAim = padJump = false;
    padArmed = false;
    padButtons = [];
    padIndex = null;
    if (disconnected && padConnected) {
      padConnected = false;
      bodyClass('pad', false);
      $('controller-status').textContent = 'CONTROLLER DISCONNECTED';
      if (mode === 'running') pause();
    }
  }
  /** Reads the native Android controller bridge, which reports buttons in the standard Gamepad layout. */
  let nativeCheck = -9;
  function nativePad() {
    if (!host || !host.padState) return null;
    // The shell sets __nativePad when a controller connects; otherwise check about once a second.
    if (!window.__nativePad) {
      const now = performance.now() / 1000;
      if (now - nativeCheck < 1) return null;
      nativeCheck = now;
    }
    let s = '';
    try { s = host.padState(); } catch (e) { return null; }
    if (!s || s[0] !== '1') return null;
    const parts2 = s.split('|');
    const axes = parts2[2].split(',').map(Number), vals = parts2[3].split(',').map(Number);
    return { index: 0, connected: true, mapping: 'standard', id: parts2[1], axes, buttons: vals.map(v => ({ pressed: v > .5, value: v })) };
  }
  function pollController(dt) {
    let pads = [];
    const np = nativePad();
    if (np) pads = [np];
    else { try { pads = Array.from((navigator.getGamepads && navigator.getGamepads()) || []); } catch (e) { pads = []; } }
    const pad = pads.find(p => p && p.connected !== false && p.index === padIndex) || pads.find(p => p && p.connected !== false && p.mapping === 'standard');
    if (!pad || pad.mapping !== 'standard') { releasePad(true); return; }
    const fresh = padIndex !== pad.index;
    padIndex = pad.index;
    if (!padConnected) {
      padConnected = true;
      if (cfg.hideTouchWithPad) bodyClass('pad', true);
      $('controller-status').textContent = 'CONTROLLER CONNECTED';
    }
    const buttons = Array.from({ length: 17 }, (_, i) => !!(pad.buttons && pad.buttons[i] && pad.buttons[i].pressed) || Number((pad.buttons && pad.buttons[i] && pad.buttons[i].value) || 0) > .55);
    const pressed = i => buttons[i] && !padButtons[i];
    if (fresh) { padButtons = buttons.slice(); padArmed = !buttons[6] && !buttons[7]; input.padX = input.padY = 0; return; }
    if (!buttons[6] && !buttons[7]) padArmed = true;
    if (pressed(9)) {
      if (mode === 'running') pause();
      else if (mode === 'paused' && $('settings').classList.contains('hidden')) resume();
      padButtons = buttons.slice();
      return;
    }
    const left = stickPair(pad.axes && pad.axes[0], pad.axes && pad.axes[1]);
    // Menus and overlays: D-pad / left stick move focus, A activates, B goes back.
    if (navScreen) {
      input.padX = input.padY = 0;
      let dir = pressed(12) ? 'up' : pressed(13) ? 'down' : pressed(14) ? 'left' : pressed(15) ? 'right' : '';
      const stickDir = Math.abs(left[0]) > .6 ? (left[0] > 0 ? 'right' : 'left') : Math.abs(left[1]) > .6 ? (left[1] > 0 ? 'down' : 'up') : '';
      if (!dir && stickDir) {
        if (stickDir !== padNavDir || (padRepeat -= dt) <= 0) { dir = stickDir; padRepeat = stickDir === padNavDir ? .12 : .35; }
      }
      padNavDir = stickDir;
      if (dir) navMove(dir);
      if (pressed(0)) navActivate();
      if (pressed(1)) navBack();
      if (pressed(4)) navTab(-1);
      if (pressed(5)) navTab(1);
      if (navScreen === 'menu' && pressed(2)) openSettings();
      padButtons = buttons.slice();
      return;
    }
    if (mode !== 'running') { input.padX = input.padY = 0; padButtons = buttons.slice(); return; }
    const right = stickPair(pad.axes && pad.axes[2], pad.axes && pad.axes[3]);
    input.padX = left[0]; input.padY = left[1];
    const sensitivity = clamp(cfg.padSensitivity, .4, 2.5) * (ads ? .52 : 1);
    P.yaw += right[0] * 3.1 * sensitivity * dt;
    P.pitch = clamp(P.pitch - right[1] * (cfg.padInvertY ? -1 : 1) * 2.35 * sensitivity * dt, -1.25, 1.25);
    if (padArmed) {
      const aim = buttons[6];
      if (aim !== padAim) { ads = aim; padAim = aim; $('ads').classList.toggle('active', ads); }
      const trigger = buttons[7];
      if (trigger) { fireHeld = true; padFire = true; if (time >= nextFire) shoot(); }
      else if (padFire) { padFire = false; if (input.fireId === null) fireHeld = false; }
    }
    if (buttons[0] !== padJump) { padJump = buttons[0]; input.jumpHeld = padJump; if (padJump) jump(); }
    if (pressed(2)) reload();
    if (pressed(4)) throwGrenade();
    if (pressed(3) || pressed(5) || pressed(15)) switchGun((gunIndex + 1) % GUNS.length);
    if (pressed(14)) switchGun((gunIndex + GUNS.length - 1) % GUNS.length);
    if (pressed(1) || pressed(10)) dash();
    if (pressed(11)) { ads = !ads; $('ads').classList.toggle('active', ads); }
    padButtons = buttons.slice();
  }
  addEventListener('gamepaddisconnected', () => releasePad(true));

  // ------------------------------------------------------------------ menu / overlay navigation (controller + keyboard)
  let navScreen = null, navIndex = 0;
  const NAV = {
    menu: () => ['play', 'mode-normal', 'mode-hard', 'mode-insane', 'mode-endless', 'gun-prev', 'gun-next', 'settings-open', 'help-open'],
    pause: () => ['resume', 'pause-settings', 'quit'],
    result: () => ['again', 'result-menu'],
    perks: () => ['perk0', 'perk1', 'perk2'],
    help: () => ['help-close'],
    settings: () => settingsNavIds()
  };
  function setNav(screen) {
    for (const id of navIds()) { const el = $(id); if (el && el.classList) el.classList.remove('focus'); }
    navScreen = screen;
    navIndex = 0;
    highlightNav();
  }
  function navIds() { return navScreen && NAV[navScreen] ? NAV[navScreen]() : []; }
  function highlightNav() {
    const ids = navIds();
    ids.forEach((id, i) => { const el = $(id); if (el && el.classList) el.classList.toggle('focus', i === navIndex && padConnected); });
  }
  function rectOf(id) { const el = $(id); try { return el.getBoundingClientRect(); } catch (e) { return null; } }
  function navMove(dir) {
    const ids = navIds();
    if (!ids.length) return;
    if (navScreen === 'settings' && (dir === 'left' || dir === 'right')) {
      const id = ids[navIndex];
      if (id && id.indexOf('set-') === 0) { adjustSetting(id.slice(4), dir === 'right' ? 1 : -1); return; }
    }
    // Spatial navigation using element rectangles; falls back to list order.
    const cur = rectOf(ids[navIndex]);
    let best = -1, bestScore = Infinity;
    if (cur && cur.width) {
      const cx = cur.left + cur.width / 2, cy = cur.top + cur.height / 2;
      ids.forEach((id, i) => {
        if (i === navIndex) return;
        const r = rectOf(id);
        if (!r || !r.width) return;
        const x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - cx, dy = y - cy;
        const ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 : dx > 4;
        if (!ok) return;
        const primary = dir === 'up' || dir === 'down' ? Math.abs(dy) : Math.abs(dx), secondary = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
        const s = primary + secondary * 2.2;
        if (s < bestScore) { bestScore = s; best = i; }
      });
    }
    if (best < 0) best = (navIndex + (dir === 'up' || dir === 'left' ? ids.length - 1 : 1)) % ids.length;
    navIndex = best;
    sound('uiMove', .5);
    highlightNav();
    const el = $(ids[navIndex]);
    if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
  }
  function navActivate() {
    const id = navIds()[navIndex];
    if (!id) return;
    if (navScreen === 'settings' && id.indexOf('set-') === 0) { adjustSetting(id.slice(4), 1, true); return; }
    const el = $(id);
    if (el && typeof el.onclick === 'function') el.onclick({ preventDefault() {} });
    else if (el && el.click) el.click();
  }
  function navBack() {
    if (navScreen === 'settings') closeSettings();
    else if (navScreen === 'help') closeHelp();
    else if (navScreen === 'pause') resume();
    else if (navScreen === 'result') toMenu();
  }
  function navTab(step) {
    if (navScreen === 'settings') { settingsTab = (settingsTab + step + TABS.length) % TABS.length; renderSettings(); setNav('settings'); }
    else if (navScreen === 'menu') { gunIndex = (gunIndex + step + GUNS.length) % GUNS.length; cfg.loadout = gunIndex; refreshMenu(); }
  }

  // ------------------------------------------------------------------ settings
  const TABS = ['graphics', 'controls', 'controller', 'audio', 'gameplay'];
  let settingsTab = 0;
  const SETTINGS = [
    { tab: 'graphics', key: 'quality', label: 'Quality preset', type: 'choice', options: [['performance', 'Performance'], ['balanced', 'Balanced'], ['high', 'High'], ['ultra', 'Ultra']] },
    { tab: 'graphics', key: 'renderScale', label: 'Render resolution', type: 'range', min: .45, max: 1, step: .05, fmt: v => Math.round(v * 100) + '%' },
    { tab: 'graphics', key: 'dynamicRes', label: 'Dynamic resolution', type: 'toggle', note: 'Lowers resolution during heavy fights to hold the frame rate.' },
    { tab: 'graphics', key: 'fpsCap', label: 'Frame rate limit', type: 'choice', options: [[30, '30'], [60, '60'], [90, '90'], [120, '120'], [0, 'MAX']] },
    { tab: 'graphics', key: 'shadows', label: 'Sun shadows', type: 'toggle' },
    { tab: 'graphics', key: 'bloom', label: 'Bloom glow', type: 'toggle' },
    { tab: 'graphics', key: 'fxaa', label: 'Anti-aliasing (FXAA)', type: 'toggle' },
    { tab: 'graphics', key: 'particles', label: 'Effects density', type: 'choice', options: [['low', 'Low'], ['high', 'High']] },
    { tab: 'graphics', key: 'fov', label: 'Field of view', type: 'range', min: 60, max: 100, step: 2, fmt: v => v + '°' },
    { tab: 'graphics', key: 'showFps', label: 'Show FPS counter', type: 'toggle' },
    { tab: 'controls', key: 'sensitivity', label: 'Look sensitivity', type: 'range', min: .3, max: 3, step: .05, fmt: v => v.toFixed(2) },
    { tab: 'controls', key: 'adsSensitivity', label: 'Aiming sensitivity', type: 'range', min: .25, max: 1.5, step: .05, fmt: v => Math.round(v * 100) + '%' },
    { tab: 'controls', key: 'invertY', label: 'Invert look', type: 'toggle' },
    { tab: 'controls', key: 'gyro', label: 'Gyro aiming', type: 'choice', options: [['off', 'Off'], ['ads', 'While aiming'], ['always', 'Always']] },
    { tab: 'controls', key: 'gyroSensitivity', label: 'Gyro sensitivity', type: 'range', min: .3, max: 3, step: .1, fmt: v => v.toFixed(1) },
    { tab: 'controls', key: 'assist', label: 'Aim assist', type: 'toggle' },
    { tab: 'controls', key: 'autoFire', label: 'Auto-fire on target', type: 'toggle', note: 'Fires automatically when the crosshair is over an enemy.' },
    { tab: 'controls', key: 'leftFire', label: 'Left fire button', type: 'toggle' },
    { tab: 'controls', key: 'buttonScale', label: 'Button size', type: 'range', min: .75, max: 1.35, step: .05, fmt: v => Math.round(v * 100) + '%' },
    { tab: 'controls', key: 'hudOpacity', label: 'Button opacity', type: 'range', min: .3, max: 1, step: .05, fmt: v => Math.round(v * 100) + '%' },
    { tab: 'controller', key: 'padSensitivity', label: 'Stick sensitivity', type: 'range', min: .4, max: 2.5, step: .1, fmt: v => v.toFixed(1) },
    { tab: 'controller', key: 'padDeadzone', label: 'Stick deadzone', type: 'range', min: .05, max: .35, step: .01, fmt: v => Math.round(v * 100) + '%' },
    { tab: 'controller', key: 'padInvertY', label: 'Invert look', type: 'toggle' },
    { tab: 'controller', key: 'rumble', label: 'Controller rumble', type: 'toggle' },
    { tab: 'controller', key: 'hideTouchWithPad', label: 'Hide touch buttons', type: 'toggle', note: 'Layout: left stick move · right stick look · RT fire · LT aim · A jump (hold for jetpack) · B dash · X reload · Y / RB swap · LB grenade · R3 toggle aim · Start pause.' },
    { tab: 'audio', key: 'sound', label: 'Sound', type: 'toggle' },
    { tab: 'audio', key: 'masterVolume', label: 'Master volume', type: 'range', min: 0, max: 1, step: .05, fmt: v => Math.round(v * 100) + '%' },
    { tab: 'audio', key: 'sfxVolume', label: 'Effects volume', type: 'range', min: 0, max: 1, step: .05, fmt: v => Math.round(v * 100) + '%' },
    { tab: 'audio', key: 'musicVolume', label: 'Music volume', type: 'range', min: 0, max: 1, step: .05, fmt: v => Math.round(v * 100) + '%' },
    { tab: 'gameplay', key: 'difficulty', label: 'Operation (next deploy)', type: 'choice', options: [['normal', 'Assault'], ['hard', 'Nightmare'], ['insane', 'Insane'], ['endless', 'Endless']] },
    { tab: 'gameplay', key: 'haptics', label: 'Phone vibration', type: 'toggle' },
    { tab: 'gameplay', key: 'damageNumbers', label: 'Damage numbers', type: 'toggle' },
    { tab: 'gameplay', key: 'radar', label: 'Radar', type: 'toggle' },
    { tab: 'gameplay', key: 'crosshair', label: 'Crosshair', type: 'choice', options: [['cross', 'Cross'], ['dot', 'Dot'], ['circle', 'Circle']] },
    { tab: 'gameplay', key: 'crosshairColor', label: 'Crosshair color', type: 'choice', options: [['cyan', 'Cyan'], ['white', 'White'], ['green', 'Green'], ['yellow', 'Yellow'], ['red', 'Red']] }
  ];
  const settingByKey = {};
  for (const s of SETTINGS) settingByKey[s.key] = s;
  function settingsNavIds() {
    const ids = TABS.map(t => 'tab-' + t);
    for (const s of SETTINGS) if (s.tab === TABS[settingsTab]) ids.push('set-' + s.key);
    ids.push('settings-close');
    return ids;
  }
  function controlHtml(s) {
    const v = cfg[s.key];
    if (s.type === 'toggle') return '<span class="toggle ' + (v ? 'on' : '') + '"><i></i></span>';
    if (s.type === 'choice') return '<span class="seg">' + s.options.map(([val, label]) => '<b class="' + (val === v ? 'on' : '') + '" data-v="' + val + '">' + label + '</b>').join('') + '</span>';
    const t = (v - s.min) / (s.max - s.min);
    return '<span class="slider"><span class="track"><i style="width:' + (t * 100).toFixed(1) + '%"></i><em style="left:' + (t * 100).toFixed(1) + '%"></em></span><output>' + s.fmt(v) + '</output></span>';
  }
  function renderSettings() {
    $('settings-tabs').innerHTML = TABS.map((t, i) => '<button id="tab-' + t + '" class="tab ' + (i === settingsTab ? 'on' : '') + '" data-tab="' + i + '">' + t.toUpperCase() + '</button>').join('');
    let html = '';
    for (const s of SETTINGS) {
      if (s.tab !== TABS[settingsTab]) continue;
      html += '<div class="setting" id="set-' + s.key + '" data-key="' + s.key + '"><label>' + s.label + (s.note ? '<small>' + s.note + '</small>' : '') + '</label>' + controlHtml(s) + '</div>';
    }
    $('settings-body').innerHTML = html;
    for (let i = 0; i < TABS.length; i++) {
      const el = $('tab-' + TABS[i]);
      if (el) el.onclick = () => { settingsTab = i; renderSettings(); setNav('settings'); navIndex = i; highlightNav(); sound('ui', .5); };
    }
    if (navScreen === 'settings') highlightNav();
  }
  function setSetting(key, value) {
    const s = settingByKey[key];
    if (!s) return;
    if (s.type === 'range') value = clamp(Math.round(value / s.step) * s.step, s.min, s.max);
    cfg[key] = value;
    if (key === 'quality') {
      const pr = R.PRESETS[value];
      cfg.renderScale = pr.renderScale; cfg.shadows = pr.shadows; cfg.bloom = pr.bloom; cfg.fxaa = pr.fxaa; cfg.particles = pr.particles < 1 ? 'low' : 'high';
    }
    applySettings();
    persist();
    const row = $('set-' + key);
    if (row && key !== 'quality') {
      row.innerHTML = '<label>' + s.label + (s.note ? '<small>' + s.note + '</small>' : '') + '</label>' + controlHtml(s);
    } else renderSettings();
  }
  function adjustSetting(key, step, activate) {
    const s = settingByKey[key];
    if (!s) return;
    if (s.type === 'toggle') setSetting(key, !cfg[key]);
    else if (s.type === 'choice') {
      const vals = s.options.map(o => o[0]);
      const i = vals.indexOf(cfg[key]);
      setSetting(key, vals[(i + step + vals.length) % vals.length]);
    } else if (!activate) setSetting(key, cfg[key] + s.step * step);
    sound('uiMove', .6);
    highlightNav();
  }
  function applySettings() {
    const preset = R.PRESETS[cfg.quality] || R.PRESETS.balanced;
    R.configure({ preset: cfg.quality, lights: preset.lights, softShadows: preset.softShadows, shadowSize: preset.shadowSize, renderScale: cfg.renderScale, shadows: cfg.shadows, bloom: cfg.bloom, fxaa: cfg.fxaa, dynamicRes: cfg.dynamicRes, fpsCap: cfg.fpsCap });
    A.setEnabled(cfg.sound);
    A.setLevels({ master: cfg.masterVolume, sfx: cfg.sfxVolume, music: cfg.musicVolume });
    const root = document.documentElement;
    if (root && root.style) {
      root.style.setProperty('--btn-scale', String(cfg.buttonScale));
      root.style.setProperty('--btn-opacity', String(cfg.hudOpacity));
    }
    const body = document.body;
    if (body && body.classList) {
      body.classList.toggle('no-fps', !cfg.showFps);
      body.classList.toggle('no-radar', !cfg.radar);
      body.classList.toggle('no-left-fire', !cfg.leftFire);
      for (const c of ENUMS.crosshair) body.classList.toggle('xh-' + c, cfg.crosshair === c);
      for (const c of ENUMS.crosshairColor) body.classList.toggle('xc-' + c, cfg.crosshairColor === c);
      if (!cfg.hideTouchWithPad) body.classList.remove('pad'); else if (padConnected) body.classList.add('pad');
    }
    setText('quality-info', cfg.quality.toUpperCase());
  }
  let settingsFrom = 'menu';
  function openSettings() {
    settingsFrom = mode;
    if (mode === 'running') pause();
    $('pause-panel').classList.add('hidden');
    $('settings').classList.remove('hidden');
    renderSettings();
    setNav('settings');
    sound('ui', .6);
  }
  function closeSettings() {
    $('settings').classList.add('hidden');
    persist();
    sound('ui', .6);
    if (mode === 'menu') { refreshMenu(); setNav('menu'); }
    else if (settingsFrom === 'running' && mode === 'paused') resume();
    else if (mode === 'paused') { $('pause-panel').classList.remove('hidden'); setNav('pause'); }
    else setNav(null);
  }
  function openHelp() { $('help').classList.remove('hidden'); setNav('help'); sound('ui', .6); }
  function closeHelp() { $('help').classList.add('hidden'); setNav(mode === 'menu' ? 'menu' : mode === 'paused' ? 'pause' : null); }
  $('settings-body').addEventListener('pointerdown', e => {
    const row = e.target && e.target.closest ? e.target.closest('.setting') : null;
    if (!row) return;
    const key = row.dataset.key, s = settingByKey[key];
    if (!s) return;
    if (s.type === 'toggle') { setSetting(key, !cfg[key]); sound('ui', .5); }
    else if (s.type === 'choice') {
      const b = e.target.closest('b[data-v]');
      if (b) { const raw = b.dataset.v; const val = typeof s.options[0][0] === 'number' ? Number(raw) : raw; setSetting(key, val); sound('ui', .5); }
    } else {
      const track = row.querySelector('.track');
      if (!track) return;
      const setFrom = ev => { const r = track.getBoundingClientRect(); const t = clamp((ev.clientX - r.left) / r.width, 0, 1); setSetting(key, s.min + t * (s.max - s.min)); };
      setFrom(e);
      const moveFn = ev => setFrom(ev), up = () => { removeEventListener('pointermove', moveFn); removeEventListener('pointerup', up); };
      addEventListener('pointermove', moveFn);
      addEventListener('pointerup', up);
    }
  });

  // ------------------------------------------------------------------ menu
  function refreshMenu() {
    for (const k of Object.keys(MODES)) $('mode-' + k).classList.toggle('on', cfg.difficulty === k);
    const g = GUNS[gunIndex];
    setText('menu-gun-name', g.name);
    setText('menu-gun-kind', g.kind);
    const bars = { dmg: Math.min(1, g.damage * g.pellets / 160), rate: Math.min(1, .12 / g.interval * .5 + .05), range: g.range, mag: Math.min(1, g.mag / 80) };
    for (const k in bars) $('bar-' + k).style.width = Math.round(bars[k] * 100) + '%';
    $('menu-gun').style.setProperty('--accent', '#' + g.color);
    setText('best', 'BEST WAVE ' + cfg.best + ' · BEST SCORE ' + cfg.bestScore);
    setText('mode-blurb', MODES[cfg.difficulty].blurb);
  }
  for (const k of Object.keys(MODES)) $('mode-' + k).onclick = () => { cfg.difficulty = k; persist(); refreshMenu(); sound('ui', .6); };
  $('gun-prev').onclick = () => { switchGun((gunIndex + GUNS.length - 1) % GUNS.length); cfg.loadout = gunIndex; persist(); refreshMenu(); sound('uiMove', .7); };
  $('gun-next').onclick = () => { switchGun((gunIndex + 1) % GUNS.length); cfg.loadout = gunIndex; persist(); refreshMenu(); sound('uiMove', .7); };

  // ------------------------------------------------------------------ main loop
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const cap = cfg.fpsCap;
    if (cap > 0 && lastRender && now - lastRender < 1000 / cap - 2) return;
    lastRender = now;
    const measuredDt = last ? Math.max(.0005, (now - last) / 1000) : 1 / 60, realDt = Math.min(.15, measuredDt);
    last = now;
    R.adapt(measuredDt);
    pollController(Math.min(realDt, .05));
    if (mode === 'running') {
      accumulator += Math.min(realDt, .05);
      let steps = 0;
      while (accumulator >= 1 / 120 && steps++ < 7) { update(1 / 120); accumulator -= 1 / 120; }
      updateHUD();
    } else accumulator = 0;
    if (mode === 'paused' || mode === 'won' || mode === 'lost') { if (!document.hidden) draw(0); }
    else draw(Math.min(.05, realDt));
    frameCount++;
  }

  // ------------------------------------------------------------------ touch controls
  function capture(el, e) { if (e.preventDefault) e.preventDefault(); if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } } }
  function clearInput() {
    input.mx = input.my = input.padX = input.padY = 0;
    input.moveId = input.lookId = input.fireId = input.fire2Id = null;
    input.keys.clear();
    input.jumpHeld = false;
    fireHeld = false;
    $('stick').style.transform = 'translate(0px,0px)';
    $('joystick').classList.remove('active');
    $('fire').classList.remove('firing');
    $('fire2').classList.remove('firing');
  }
  const STICK_RANGE = 52;
  $('move').addEventListener('pointerdown', e => {
    if (mode !== 'running' || input.moveId !== null) return;
    capture($('move'), e);
    input.moveId = e.pointerId;
    input.moveCX = e.clientX; input.moveCY = e.clientY;
    const js = $('joystick');
    js.style.transform = 'translate(' + (e.clientX - 60) + 'px,' + (e.clientY - 60) + 'px)';
    js.classList.add('active');
    moveTouch(e);
  });
  function moveTouch(e) {
    if (e.pointerId !== input.moveId) return;
    let dx = e.clientX - input.moveCX, dy = e.clientY - input.moveCY;
    const len = Math.hypot(dx, dy);
    // The base follows a thumb that slides too far, so direction changes stay quick.
    if (len > STICK_RANGE * 1.6) { input.moveCX += dx / len * (len - STICK_RANGE * 1.6); input.moveCY += dy / len * (len - STICK_RANGE * 1.6); dx = e.clientX - input.moveCX; dy = e.clientY - input.moveCY; $('joystick').style.transform = 'translate(' + (input.moveCX - 60) + 'px,' + (input.moveCY - 60) + 'px)'; }
    const l2 = Math.hypot(dx, dy), mag = Math.min(1, l2 / STICK_RANGE);
    input.mx = l2 > 4 ? dx / (l2 || 1) * mag : 0;
    input.my = l2 > 4 ? dy / (l2 || 1) * mag : 0;
    $('stick').style.transform = 'translate(' + (input.mx * 40).toFixed(1) + 'px,' + (input.my * 40).toFixed(1) + 'px)';
  }
  $('move').addEventListener('pointermove', moveTouch);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('move').addEventListener(type, e => {
    if (e.pointerId === input.moveId) { input.moveId = null; input.mx = input.my = 0; $('stick').style.transform = 'translate(0px,0px)'; $('joystick').classList.remove('active'); }
  });
  function lookDelta(dx, dy) {
    const s = .0042 * cfg.sensitivity * (ads ? cfg.adsSensitivity / (1 + (gunSpec().zoom - 1) * .5) : 1);
    // Mild acceleration: quick flicks turn further, slow drags stay precise.
    const accel = 1 + Math.min(1.2, Math.hypot(dx, dy) * .012);
    P.yaw += dx * s * accel;
    P.pitch = clamp(P.pitch - dy * s * accel * (cfg.invertY ? -1 : 1), -1.25, 1.25);
  }
  $('look').addEventListener('pointerdown', e => {
    if (mode !== 'running' || input.lookId !== null) return;
    capture($('look'), e);
    input.lookId = e.pointerId; input.lastX = e.clientX; input.lastY = e.clientY;
  });
  $('look').addEventListener('pointermove', e => {
    if (e.pointerId !== input.lookId || mode !== 'running') return;
    lookDelta(e.clientX - input.lastX, e.clientY - input.lastY);
    input.lastX = e.clientX; input.lastY = e.clientY;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('look').addEventListener(type, e => { if (input.lookId === e.pointerId) input.lookId = null; });
  function bindFire(id, key) {
    const el = $(id);
    el.addEventListener('pointerdown', e => {
      if (mode !== 'running') return;
      capture(el, e);
      input[key] = e.pointerId; input.fireX = e.clientX; input.fireY = e.clientY;
      fireHeld = true;
      el.classList.add('firing');
      initAudio();
      shoot();
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerId !== input[key] || mode !== 'running') return;
      lookDelta(e.clientX - input.fireX, e.clientY - input.fireY);
      input.fireX = e.clientX; input.fireY = e.clientY;
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(type, e => {
      if (e.pointerId === input[key]) { input[key] = null; if (input.fireId === null && input.fire2Id === null) fireHeld = false; el.classList.remove('firing'); }
    });
  }
  bindFire('fire', 'fireId');
  bindFire('fire2', 'fire2Id');
  const tap = (id, fn) => $(id).addEventListener('pointerdown', e => { if (e.preventDefault) e.preventDefault(); if (mode === 'running') fn(); });
  tap('ads', () => { ads = !ads; $('ads').classList.toggle('active', ads); });
  tap('reload', reload);
  tap('dash', dash);
  tap('grenade', throwGrenade);
  tap('swap', () => switchGun((gunIndex + 1) % GUNS.length));
  $('jump').addEventListener('pointerdown', e => { if (e.preventDefault) e.preventDefault(); if (mode !== 'running') return; input.jumpHeld = true; jump(); $('jump').classList.add('firing'); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) $('jump').addEventListener(type, () => { input.jumpHeld = false; $('jump').classList.remove('firing'); });

  // Gyro aiming (device rotation rate, deg/s).
  addEventListener('devicemotion', e => {
    if (mode !== 'running' || cfg.gyro === 'off' || (cfg.gyro === 'ads' && !ads)) return;
    const rr = e.rotationRate;
    if (!rr) return;
    const dt = Math.min(.05, (e.interval > 1 ? e.interval / 1000 : e.interval) || .016);
    let angle = 90;
    try { angle = screen.orientation ? screen.orientation.angle : (window.orientation || 90); } catch (err) { /* default */ }
    const s = angle === 270 || angle === -90 ? -1 : 1;
    const k = Math.PI / 180 * cfg.gyroSensitivity * dt * (ads ? .8 : 1);
    P.yaw += -(rr.beta || 0) * s * k;
    P.pitch = clamp(P.pitch + -(rr.gamma || 0) * s * k * (cfg.invertY ? -1 : 1), -1.25, 1.25);
  });

  // Keyboard and mouse (desktop testing).
  addEventListener('keydown', e => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && e.preventDefault) e.preventDefault();
    if (navScreen && mode !== 'running') {
      const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (map[e.code]) { padConnectedForNav(); navMove(map[e.code]); return; }
      if (e.code === 'Enter') { navActivate(); return; }
      if (e.code === 'Escape' || e.code === 'Backspace') { navBack(); return; }
    }
    if (perkOffer && /^Digit[1-3]$/.test(e.code)) { choosePerk(Number(e.code.slice(-1)) - 1); return; }
    input.keys.add(e.code);
    if (e.code === 'KeyR') reload();
    if (e.code === 'KeyG') throwGrenade();
    if (e.code === 'KeyE') switchGun((gunIndex + 1) % GUNS.length);
    if (e.code === 'KeyC' || e.code === 'ControlLeft') dash();
    if (e.code === 'Space') { input.jumpHeld = true; jump(); }
    if (/^Digit[0-9]$/.test(e.code) && !perkOffer) switchGun((Number(e.code.slice(-1)) + 9) % 10);
    if (e.code === 'Escape') { if (mode === 'running') pause(); else if (mode === 'paused') resume(); }
    if (e.code === 'KeyQ' && mode === 'running') { ads = !ads; $('ads').classList.toggle('active', ads); }
  });
  addEventListener('keyup', e => { input.keys.delete(e.code); if (e.code === 'Space') input.jumpHeld = false; });
  function padConnectedForNav() { /* keyboard navigation shows the focus ring too */ if (!padConnected) { const ids = navIds(); ids.forEach((id, i) => { const el = $(id); if (el && el.classList) el.classList.toggle('focus', i === navIndex); }); } }
  $('look').addEventListener('dblclick', () => { if (mode === 'running' && matchMedia('(pointer:fine)').matches && $('look').requestPointerLock) $('look').requestPointerLock(); });
  document.addEventListener('mousemove', e => { if (document.pointerLockElement && mode === 'running') lookDelta(e.movementX, e.movementY); });
  document.addEventListener('mousedown', e => {
    if (!document.pointerLockElement || mode !== 'running') return;
    if (e.button === 0) { fireHeld = true; shoot(); }
    if (e.button === 2) { ads = true; }
  });
  document.addEventListener('mouseup', e => { if (!document.pointerLockElement) return; if (e.button === 0) fireHeld = false; if (e.button === 2) ads = false; });

  // Buttons.
  $('play').onclick = start;
  $('again').onclick = start;
  $('pause').onclick = pause;
  $('resume').onclick = resume;
  $('quit').onclick = toMenu;
  $('result-menu').onclick = toMenu;
  $('settings-open').onclick = openSettings;
  $('pause-settings').onclick = openSettings;
  $('settings-close').onclick = closeSettings;
  $('help-open').onclick = openHelp;
  $('help-close').onclick = closeHelp;
  for (let i = 0; i < 3; i++) $('perk' + i).onclick = () => choosePerk(i);

  // Lifecycle.
  document.addEventListener('visibilitychange', () => { if (document.hidden) { releasePad(false); pause(); A.suspend(); } else A.resume(); });
  addEventListener('blur', () => { releasePad(false); pause(); });
  addEventListener('resize', () => { if (innerHeight > innerWidth * 1.05 && mode === 'running') pause(); });
  R.canvas.addEventListener('webglcontextlost', e => {
    if (e.preventDefault) e.preventDefault();
    pause();
    $('error-text').textContent = 'Android paused the graphics context. Close and reopen the app to recover.';
    $('error').classList.remove('hidden');
  });
  // Android back button (called by the native shell). Returns true when handled.
  window.onAndroidBack = () => {
    if (navScreen === 'settings' || navScreen === 'help') { navBack(); return true; }
    if (mode === 'running') { pause(); return true; }
    if (mode === 'paused') { resume(); return true; }
    if (mode === 'won' || mode === 'lost') { toMenu(); return true; }
    return false;
  };
  window.onAndroidPause = () => { releasePad(false); pause(); A.suspend(); };
  // Audio needs a user gesture first.
  addEventListener('pointerdown', () => initAudio(), { once: true });

  applySettings();
  refreshMenu();
  setNav('menu');
  raf = requestAnimationFrame(frame);

  window.strikeTest = {
    nextHealthAt: () => nextHealth, mapBounds: W.bounds, pollController, releasePad, stickPair, GUNS, MODES, PERKS, spawnWave, switchGun, throwGrenade, explosion, updateProjectiles,
    start, pause, resume, shoot, reload, dash, jump, update, draw, toMenu, freeAt, rayBox, wallDistance, sphereHit, player: P, input, config: cfg, choosePerk, openSettings, closeSettings, adjustSetting,
    state: () => ({ mode, time, wave, kills, shots, hits, headshots, reloadEnd, nextFire, dashReady, enemies, transition, ads, gunIndex, projectiles, pickups, score, perkOffer, ownedPerks, mods, navScreen }),
    setEnemies: v => { enemies = v; }, setTime: v => { time = v; }, setWave: v => { wave = v; }, setAim: (yaw, pitch) => { P.yaw = yaw; P.pitch = pitch; }, setAds: v => { ads = v; },
    hurt, stop: () => cancelAnimationFrame(raf), step: n => { for (let i = 0; i < n; i++) update(1 / 120); lastHud = -99; updateHUD(); }, frame
  };
})();
