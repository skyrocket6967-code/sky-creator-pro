'use strict';
// Procedural audio: every effect is synthesized once into an AudioBuffer, then played cheaply.
window.StrikeAudio = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null, jetGain = null, jetSource = null;
  const buffers = {};
  const levels = { master: .85, sfx: 1, music: .4 };
  let enabled = true, musicTrack = null, musicName = '', musicPending = false;

  const lp = (hz, sr) => 1 - Math.exp(-2 * Math.PI * hz / sr);
  function rand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }

  function render(seconds, fn, peak = .9) {
    const sr = ctx.sampleRate, n = Math.max(1, Math.floor(seconds * sr));
    const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    fn(d, sr);
    let max = 1e-6;
    for (let i = 0; i < n; i++) { d[i] = Math.tanh(d[i] * 1.3); max = Math.max(max, Math.abs(d[i])); }
    const g = peak / max, fade = Math.min(n >> 2, Math.floor(sr * .004));
    for (let i = 0; i < n; i++) {
      let k = g;
      if (i < 32) k *= i / 32;
      if (i > n - fade) k *= (n - i) / fade;
      d[i] *= k;
    }
    return buf;
  }

  // Gun recipe: crack (bright transient), body (filtered noise), thump (pitched sub), tail (room), mech click.
  const GUN_SOUNDS = [
    { crack: .7, body: .9, bodyHz: 2600, decay: 16, thump: .8, f0: 150, tail: .35, tailDecay: 5.5, len: .55, click: .25 },   // rifle
    { crack: .55, body: .7, bodyHz: 3600, decay: 26, thump: .5, f0: 180, tail: .22, tailDecay: 8, len: .35, click: .3 },     // smg
    { crack: .9, body: 1.2, bodyHz: 1500, decay: 9, thump: 1.1, f0: 110, tail: .55, tailDecay: 3.6, len: .9, click: .2 },    // shotgun
    { crack: 1.2, body: 1, bodyHz: 2200, decay: 11, thump: 1, f0: 120, tail: .6, tailDecay: 2.8, len: 1.1, click: .15 },     // marksman
    { crack: .75, body: 1, bodyHz: 2000, decay: 14, thump: .95, f0: 130, tail: .4, tailDecay: 4.5, len: .6, click: .2 },     // lmg
    { crack: .2, body: 1.1, bodyHz: 900, decay: 5, thump: 1.2, f0: 70, tail: .5, tailDecay: 2.6, len: 1, click: .1 },        // rocket launch
    { crack: .85, body: .7, bodyHz: 3000, decay: 20, thump: .6, f0: 170, tail: .3, tailDecay: 6, len: .45, click: .35 },     // pistol
    { crack: .85, body: 1.1, bodyHz: 1700, decay: 11, thump: 1, f0: 115, tail: .45, tailDecay: 4.2, len: .75, click: .2 },   // auto shotgun
    { crack: .9, body: .8, bodyHz: 3200, decay: 18, thump: .7, f0: 160, tail: .4, tailDecay: 5, len: .55, click: .3, zap: .5 }, // carbine
    { crack: .8, body: 1.2, bodyHz: 1300, decay: 10, thump: 1.3, f0: 85, tail: .5, tailDecay: 3.5, len: .8, click: .15 }      // autocannon
  ];
  function gunBuffer(r, seed) {
    return render(r.len, (d, sr) => {
      const rnd = rand(seed);
      let body = 0, tail = 0, hp = 0, ph = 0;
      const aBody = lp(r.bodyHz, sr), aTail = lp(900, sr);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = rnd();
        hp = n - (hp + (n - hp) * lp(6000, sr));
        body += aBody * (n - body);
        tail += aTail * (n - tail);
        ph += 2 * Math.PI * (r.f0 * .35 + r.f0 * Math.exp(-t * 38)) / sr;
        let v = n * r.crack * Math.exp(-t * 220)
          + body * r.body * Math.exp(-t * r.decay) * 2.2
          + Math.sin(ph) * r.thump * Math.exp(-t * 26)
          + tail * r.tail * Math.exp(-t * r.tailDecay) * 2.5
          + Math.sin(t * 2 * Math.PI * 3400) * r.click * Math.exp(-t * 500);
        if (r.zap) v += Math.sin(2 * Math.PI * (2400 - t * 9000) * t) * r.zap * Math.exp(-t * 30);
        d[i] = v;
      }
    }, .95);
  }

  function buildBuffers() {
    GUN_SOUNDS.forEach((r, i) => { buffers['gun' + i] = gunBuffer(r, 101 + i * 17); });
    buffers.enemyShot = render(.35, (d, sr) => {
      const rnd = rand(7); let ph = 0, b = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr; b += lp(2500, sr) * (rnd() - b);
        ph += 2 * Math.PI * (1100 * Math.exp(-t * 14) + 180) / sr;
        d[i] = (Math.sign(Math.sin(ph)) * .35 + b * 1.4) * Math.exp(-t * 16) + rnd() * Math.exp(-t * 180) * .6;
      }
    }, .8);
    buffers.explosion = render(2.2, (d, sr) => {
      const rnd = rand(3); let lo = 0, mid = 0, ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, n = rnd();
        lo += lp(140 + 900 * Math.exp(-t * 3), sr) * (n - lo);
        mid += lp(2200, sr) * (n - mid);
        ph += 2 * Math.PI * (38 + 60 * Math.exp(-t * 6)) / sr;
        const crackle = rnd() > .985 ? rnd() * Math.exp(-t * 2.5) : 0;
        d[i] = lo * 3.2 * Math.exp(-t * 1.9) + mid * Math.exp(-t * 9) + Math.sin(ph) * 1.4 * Math.exp(-t * 3.5) + crackle * .8 + n * Math.exp(-t * 90);
      }
    }, 1);
    const click = (f, len, dec, seed, extra = 0) => render(len, (d, sr) => {
      const rnd = rand(seed);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.sin(2 * Math.PI * f * t) * .6 + Math.sin(2 * Math.PI * f * 1.73 * t) * .3 + rnd() * .5) * Math.exp(-t * dec)
          + (extra ? Math.sin(2 * Math.PI * extra * t) * Math.exp(-t * 40) * .8 : 0);
      }
    }, .7);
    buffers.magOut = click(1800, .12, 60, 11, 160);
    buffers.magIn = click(1300, .16, 45, 12, 120);
    buffers.bolt = render(.22, (d, sr) => {
      const rnd = rand(13);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, t2 = Math.max(0, t - .08);
        d[i] = rnd() * (Math.exp(-t * 120) + (t > .08 ? Math.exp(-t2 * 90) : 0)) + Math.sin(2 * Math.PI * 2600 * t) * Math.exp(-t * 70) * .5;
      }
    }, .7);
    buffers.empty = click(3200, .06, 140, 14);
    buffers.hit = render(.07, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(2 * Math.PI * 2900 * t) * Math.exp(-t * 70); } }, .5);
    buffers.headshot = render(.35, (d, sr) => {
      for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = (Math.sin(2 * Math.PI * 3150 * t) + Math.sin(2 * Math.PI * 4710 * t) * .6 + Math.sin(2 * Math.PI * 6900 * t) * .3) * Math.exp(-t * 14); }
    }, .55);
    buffers.kill = render(.32, (d, sr) => {
      for (let i = 0; i < d.length; i++) { const t = i / sr, f = t < .06 ? 1320 : 1980; d[i] = (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 2 * t) * .25) * Math.exp(-(t < .06 ? t : t - .06) * 16); }
    }, .5);
    buffers.robotDie = render(.9, (d, sr) => {
      const rnd = rand(21); let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr; ph += 2 * Math.PI * (900 * Math.exp(-t * 3.5) + 60) / sr;
        d[i] = Math.sign(Math.sin(ph)) * .3 * Math.exp(-t * 3) + (rnd() > .93 ? rnd() : 0) * Math.exp(-t * 4) + rnd() * .4 * Math.exp(-t * 20);
      }
    }, .7);
    buffers.hurt = render(.35, (d, sr) => {
      const rnd = rand(5); let ph = 0, b = 0;
      for (let i = 0; i < d.length; i++) { const t = i / sr; ph += 2 * Math.PI * (90 + 60 * Math.exp(-t * 20)) / sr; b += lp(700, sr) * (rnd() - b); d[i] = Math.sin(ph) * Math.exp(-t * 10) + b * 2 * Math.exp(-t * 14); }
    }, .8);
    buffers.shieldHit = render(.3, (d, sr) => {
      for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(2 * Math.PI * (700 + 500 * Math.sin(t * 60)) * t) * Math.exp(-t * 12) * .8; }
    }, .55);
    buffers.shieldBreak = render(.7, (d, sr) => {
      const rnd = rand(31);
      for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(2 * Math.PI * (1600 - t * 1800) * t) * Math.exp(-t * 5) * .6 + rnd() * Math.exp(-t * 12) * .5; }
    }, .7);
    buffers.pickup = render(.4, (d, sr) => {
      const notes = [880, 1108.7, 1318.5];
      for (let i = 0; i < d.length; i++) { const t = i / sr, k = Math.min(2, Math.floor(t / .07)), lt = t - k * .07; d[i] = Math.sin(2 * Math.PI * notes[k] * t) * Math.exp(-lt * 12); }
    }, .5);
    buffers.waveStart = render(2.2, (d, sr) => {
      const chord = [110, 164.8, 220, 277.2];
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, env = Math.min(1, t / .25) * Math.exp(-Math.max(0, t - .5) * 2);
        let v = 0;
        for (let c = 0; c < chord.length; c++) { const f = chord[c]; v += (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 2.01 * t) * .4 + Math.sin(2 * Math.PI * f * 3 * t) * .2) / (c + 1.5); }
        d[i] = v * env;
      }
    }, .7);
    buffers.waveClear = render(1.6, (d, sr) => {
      const notes = [523.3, 659.3, 784, 1046.5];
      for (let i = 0; i < d.length; i++) {
        const t = i / sr; let v = 0;
        for (let k = 0; k < 4; k++) { const st = k * .09; if (t >= st) v += Math.sin(2 * Math.PI * notes[k] * (t - st)) * Math.exp(-(t - st) * 3.2) * .5; }
        d[i] = v;
      }
    }, .6);
    buffers.medal = render(.6, (d, sr) => {
      for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = (Math.sin(2 * Math.PI * 1568 * t) + Math.sin(2 * Math.PI * 2349 * t) * .5) * Math.exp(-t * 6) * Math.min(1, t / .005); }
    }, .5);
    buffers.ui = render(.05, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t * 110); } }, .35);
    buffers.uiMove = render(.04, (d, sr) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 150); } }, .2);
    buffers.step = render(.12, (d, sr) => {
      const rnd = rand(41); let b = 0;
      for (let i = 0; i < d.length; i++) { const t = i / sr; b += lp(420, sr) * (rnd() - b); d[i] = b * 3 * Math.exp(-t * 35) + rnd() * .15 * Math.exp(-t * 90); }
    }, .5);
    buffers.land = render(.25, (d, sr) => {
      const rnd = rand(42); let b = 0, ph = 0;
      for (let i = 0; i < d.length; i++) { const t = i / sr; b += lp(300, sr) * (rnd() - b); ph += 2 * Math.PI * 60 / sr; d[i] = b * 3 * Math.exp(-t * 20) + Math.sin(ph) * Math.exp(-t * 22); }
    }, .7);
    buffers.dash = render(.4, (d, sr) => {
      const rnd = rand(43); let b = 0;
      for (let i = 0; i < d.length; i++) { const t = i / sr; b += lp(600 + 3000 * Math.sin(Math.PI * Math.min(1, t / .4)), sr) * (rnd() - b); d[i] = b * 2 * Math.sin(Math.PI * Math.min(1, t / .4)); }
    }, .6);
    buffers.grenadeThrow = render(.3, (d, sr) => {
      const rnd = rand(44); let b = 0;
      for (let i = 0; i < d.length; i++) { const t = i / sr; b += lp(1200, sr) * (rnd() - b); d[i] = b * 2 * Math.exp(-t * 9) * Math.min(1, t / .03) + Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 200) * .4; }
    }, .5);
    buffers.jet = render(1, (d, sr) => {
      const rnd = rand(45); let b = 0, c = 0;
      for (let i = 0; i < d.length; i++) { b += lp(900, sr) * (rnd() - b); c += lp(160, sr) * (rnd() - c); d[i] = b * 1.4 + c * 2.5; }
    }, .6);
    buffers.heartbeat = render(.9, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr; let v = 0;
        for (const s of [0, .22]) if (t >= s) v += Math.sin(2 * Math.PI * 55 * (t - s)) * Math.exp(-(t - s) * 18) * (s ? .7 : 1);
        d[i] = v;
      }
    }, .7);
  }

  function musicBuffer(name) {
    if (name === 'menu') {
      return render(16, (d, sr) => {
        const chords = [[110, 130.8, 164.8], [98, 123.5, 146.8], [87.3, 110, 130.8], [98, 116.5, 146.8]];
        const rnd = rand(77); let air = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr, k = Math.floor(t / 4) % 4, lt = t % 4;
          const env = Math.min(1, lt / 1.2) * Math.min(1, (4 - lt) / 1.2);
          let v = 0;
          for (const f of chords[k]) v += Math.sin(2 * Math.PI * f * t + Math.sin(t * .7) * .5) + Math.sin(2 * Math.PI * f * 2.003 * t) * .35;
          air += lp(500, sr) * (rnd() - air);
          d[i] = v * env * .25 + air * .35 + Math.sin(2 * Math.PI * 55 * t) * .25;
        }
      }, .5);
    }
    // Combat loop: 100 BPM, 4 bars.
    return render(9.6, (d, sr) => {
      const beat = .6, bass = [55, 55, 65.4, 49, 55, 55, 73.4, 65.4];
      const rnd = rand(88); let hatF = 0, bassPh = 0, padPh = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, b = t / beat, bt = (b % 1) * beat, half = ((b * 2) % 1) * beat / 2;
        let v = 0;
        const kick = bt; v += Math.sin(2 * Math.PI * (45 + 90 * Math.exp(-kick * 30)) * kick) * Math.exp(-kick * 9) * 1.1;
        if (Math.floor(b) % 2 === 1) { const s = bt; v += rnd() * Math.exp(-s * 18) * .45; }
        hatF += lp(7000, sr) * (rnd() - hatF);
        v += (rnd() - hatF) * Math.exp(-half * 45) * .25;
        const note = bass[Math.floor(b / 2) % 8];
        bassPh += 2 * Math.PI * note / sr;
        const saw = ((bassPh / (2 * Math.PI)) % 1) * 2 - 1;
        v += saw * .28 * (.6 + .4 * Math.exp(-(((b * 2) % 1) * beat / 2) * 6));
        padPh += 2 * Math.PI * note * 4 / sr;
        v += Math.sin(padPh) * .08 * (.5 + .5 * Math.sin(t * .8));
        d[i] = v;
      }
    }, .55);
  }

  function init() {
    if (!enabled) return false;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC({ latencyHint: 'interactive' });
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = .003; comp.release.value = .18;
        master = ctx.createGain(); sfxBus = ctx.createGain(); musicBus = ctx.createGain();
        sfxBus.connect(master); musicBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
        buildBuffers();
        applyLevels();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    } catch (e) { ctx = null; return false; }
  }
  function applyLevels() {
    if (!ctx) return;
    master.gain.value = enabled ? levels.master : 0;
    sfxBus.gain.value = levels.sfx;
    musicBus.gain.value = levels.music * .55;
  }
  function setLevels(o) { Object.assign(levels, o); applyLevels(); }
  function setEnabled(on) { enabled = !!on; if (on) init(); applyLevels(); if (!on) jet(0); }

  function play(name, volume = 1, rate = 1, pan = 0, jitter = .04) {
    if (!ctx || !enabled || !buffers[name]) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buffers[name];
      src.playbackRate.value = rate * (1 + (Math.random() - .5) * jitter * 2);
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g);
      if (pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p); p.connect(sfxBus);
      } else g.connect(sfxBus);
      src.start();
    } catch (e) { /* audio is best-effort */ }
  }
  /** Plays a sound at a world position relative to the listener. */
  function playAt(name, x, z, listener, volume = 1, rate = 1) {
    const dx = x - listener.x, dz = z - listener.z, dist = Math.hypot(dx, dz);
    const right = [Math.cos(listener.yaw), Math.sin(listener.yaw)];
    const pan = dist > .5 ? (dx * right[0] + dz * right[1]) / dist * .8 : 0;
    play(name, volume / (1 + dist * .08), rate, pan);
  }
  function jet(level) {
    if (!ctx || !enabled) return;
    try {
      if (!jetSource && level > 0) {
        jetSource = ctx.createBufferSource();
        jetSource.buffer = buffers.jet; jetSource.loop = true;
        jetGain = ctx.createGain(); jetGain.gain.value = 0;
        jetSource.connect(jetGain); jetGain.connect(sfxBus); jetSource.start();
      }
      if (jetGain) jetGain.gain.setTargetAtTime(level * .5, ctx.currentTime, .05);
    } catch (e) { /* ignore */ }
  }
  function music(name) {
    if (!ctx || name === musicName) return;
    musicName = name;
    const old = musicTrack;
    if (old) { try { old.gain.gain.setTargetAtTime(0, ctx.currentTime, .6); old.src.stop(ctx.currentTime + 3); } catch (e) { /* ignore */ } }
    musicTrack = null;
    if (!name) return;
    const start = () => {
      const current = musicName;
      if (!current || !ctx || musicTrack) return;
      const key = 'music_' + current;
      if (!buffers[key]) buffers[key] = musicBuffer(current);
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buffers[key]; src.loop = true;
      g.gain.value = 0; g.gain.setTargetAtTime(1, ctx.currentTime, .8);
      src.connect(g); g.connect(musicBus); src.start();
      musicTrack = { src, gain: g };
    };
    // Rendering a loop takes a moment; do it off the input event.
    if (!musicPending) { musicPending = true; setTimeout(() => { musicPending = false; start(); }, 30); }
  }
  function suspend() { if (ctx) { try { ctx.suspend(); } catch (e) { /* ignore */ } } }
  function resume() { if (ctx && enabled) { try { ctx.resume(); } catch (e) { /* ignore */ } } }

  return { init, play, playAt, jet, music, setLevels, setEnabled, suspend, resume, get ready() { return !!ctx; } };
})();
