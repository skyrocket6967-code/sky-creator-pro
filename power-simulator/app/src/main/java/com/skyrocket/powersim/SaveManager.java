package com.skyrocket.powersim;

import android.content.Context;
import android.content.SharedPreferences;

/** Persists GameState and settings in SharedPreferences. */
final class SaveManager {
    private final SharedPreferences prefs;

    SaveManager(Context context) {
        prefs = context.getSharedPreferences("power_sim_save", Context.MODE_PRIVATE);
    }

    void save(GameState g) {
        SharedPreferences.Editor e = prefs.edit();
        putDouble(e, "power", g.power);
        putDouble(e, "total", g.totalPower);
        putDouble(e, "lifetime", g.lifetimePower);
        putDouble(e, "best", g.bestTotal);
        putDouble(e, "shards", g.shards);
        putDouble(e, "play", g.playSeconds);
        e.putInt("ascensions", g.ascensions);
        e.putInt("bestCombo", g.bestCombo);
        e.putLong("taps", g.taps);
        e.putLong("crits", g.crits);
        for (GameState.Upgrade u : g.strength) e.putInt("lvl_" + u.id, u.level);
        for (GameState.Upgrade u : g.training) e.putInt("lvl_" + u.id, u.level);
        e.putLong("savedAt", System.currentTimeMillis());
        e.apply();
    }

    void load(GameState g) {
        g.power = getDouble("power");
        g.totalPower = getDouble("total");
        g.lifetimePower = getDouble("lifetime");
        g.bestTotal = getDouble("best");
        g.shards = getDouble("shards");
        g.playSeconds = getDouble("play");
        g.ascensions = prefs.getInt("ascensions", 0);
        g.bestCombo = prefs.getInt("bestCombo", 0);
        g.taps = prefs.getLong("taps", 0);
        g.crits = prefs.getLong("crits", 0);
        for (GameState.Upgrade u : g.strength) u.level = prefs.getInt("lvl_" + u.id, 0);
        for (GameState.Upgrade u : g.training) u.level = prefs.getInt("lvl_" + u.id, 0);
        g.syncForm();
    }

    long savedAt() {
        return prefs.getLong("savedAt", 0);
    }

    boolean getFlag(String key, boolean def) {
        return prefs.getBoolean(key, def);
    }

    void setFlag(String key, boolean value) {
        prefs.edit().putBoolean(key, value).apply();
    }

    private static void putDouble(SharedPreferences.Editor e, String key, double v) {
        e.putLong(key, Double.doubleToRawLongBits(v));
    }

    private double getDouble(String key) {
        double v = Double.longBitsToDouble(prefs.getLong(key, Double.doubleToRawLongBits(0)));
        return Double.isNaN(v) || Double.isInfinite(v) || v < 0 ? 0 : v;
    }
}
