package com.skyrocket.powersim;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.SoundPool;

/** Short procedurally generated sound effects (see tools/SoundGen.java) played through a SoundPool. */
final class Sfx {
    static final int TAP = 0, CRIT = 1, BUY = 2, FORM = 3, RAGE = 4, ASCEND = 5, CLICK = 6;
    private static final int[] RES = {
            R.raw.sfx_tap, R.raw.sfx_crit, R.raw.sfx_buy, R.raw.sfx_form, R.raw.sfx_rage, R.raw.sfx_ascend, R.raw.sfx_click
    };

    private SoundPool pool;
    private final int[] ids = new int[RES.length];
    private final boolean[] ready = new boolean[RES.length];
    private long lastTapNanos;
    boolean enabled = true;

    Sfx(Context context) {
        try {
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            pool = new SoundPool.Builder().setMaxStreams(8).setAudioAttributes(attrs).build();
            pool.setOnLoadCompleteListener(new SoundPool.OnLoadCompleteListener() {
                @Override
                public void onLoadComplete(SoundPool soundPool, int sampleId, int status) {
                    for (int i = 0; i < ids.length; i++) if (ids[i] == sampleId) ready[i] = status == 0;
                }
            });
            for (int i = 0; i < RES.length; i++) ids[i] = pool.load(context, RES[i], 1);
        } catch (RuntimeException e) {
            pool = null;
        }
    }

    void play(int which, float volume, float rate) {
        if (!enabled || pool == null || !ready[which]) return;
        if (which == TAP) {
            // Multi-finger tapping can fire many sounds per frame; keep it from turning into noise.
            long now = System.nanoTime();
            if (now - lastTapNanos < 35_000_000L) return;
            lastTapNanos = now;
        }
        pool.play(ids[which], volume, volume, which == TAP ? 0 : 1, 0, Math.max(0.5f, Math.min(2f, rate)));
    }

    void release() {
        if (pool != null) pool.release();
        pool = null;
    }
}
