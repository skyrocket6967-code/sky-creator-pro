package com.skyrocket.powersim;

import java.util.Random;

/** All game rules and numbers. Pure Java (no Android imports) so it can be simulated on a desktop JVM. */
final class GameState {

    static final String[] FORM_NAMES = {
            "Mortal", "Trainee", "Fighter", "Warrior", "Super Warrior", "Titan",
            "Demigod", "God", "Cosmic Entity", "Universal", "Multiversal", "Omnipotent"
    };
    static final double[] FORM_AT = {
            0, 500, 1.5e4, 5e5, 2e7, 1e9, 1e11, 1e14, 1e17, 1e20, 1e23, 1e27
    };

    static final int K_TAP = 0, K_GEN = 1, K_CRIT = 2, K_CRIT_DMG = 3, K_COMBO = 4, K_RAGE = 5, K_SYNERGY = 6;

    static final int[] MILESTONES = {25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000};

    static final float COMBO_WINDOW = 1.1f;
    static final int COMBO_CAP = 100;
    static final float RAGE_PER_TAP = 0.0125f;
    static final double ASCEND_MIN = 1e9;
    static final double SHARD_BONUS = 0.10;
    static final double OFFLINE_RATE = 0.5;
    static final double OFFLINE_CAP_SECONDS = 4 * 3600;

    static final class Upgrade {
        final String id, name, icon;
        final int kind;
        final double baseCost, growth, value, revealAt;
        final int maxLevel;
        int level;

        Upgrade(String id, String name, String icon, int kind, double baseCost, double growth,
                double value, int maxLevel, double revealAt) {
            this.id = id;
            this.name = name;
            this.icon = icon;
            this.kind = kind;
            this.baseCost = baseCost;
            this.growth = growth;
            this.value = value;
            this.maxLevel = maxLevel;
            this.revealAt = revealAt;
        }

        boolean maxed() {
            return maxLevel > 0 && level >= maxLevel;
        }

        int clampBuy(int n) {
            return maxLevel > 0 ? Math.min(n, maxLevel - level) : n;
        }

        /** Total cost of the next n levels. */
        double costOf(int n) {
            if (n <= 0) return 0;
            double first = baseCost * Math.pow(growth, level);
            return first * (Math.pow(growth, n) - 1) / (growth - 1);
        }

        int maxAffordable(double money) {
            double first = baseCost * Math.pow(growth, level);
            if (money < first || maxed()) return 0;
            int n = (int) Math.floor(Math.log(money * (growth - 1) / first + 1) / Math.log(growth));
            n = clampBuy(Math.max(n, 1));
            while (n > 0 && costOf(n) > money) n--;
            return n;
        }
    }

    final Upgrade[] strength = {
            new Upgrade("fists", "Iron Fists", "👊", K_TAP, 15, 1.17, 1, 0, 0),
            new Upgrade("crit", "Critical Hit", "🎯", K_CRIT, 500, 1.9, 0.01, 23, 200),
            new Upgrade("combo", "Combo Mastery", "🔥", K_COMBO, 2000, 2.0, 0.1, 25, 800),
            new Upgrade("thunder", "Thunder Strike", "⚡", K_TAP, 1500, 1.17, 8, 0, 600),
            new Upgrade("dev", "Devastation", "💥", K_CRIT_DMG, 4000, 1.75, 1, 45, 1500),
            new Upgrade("rage", "Berserker", "😤", K_RAGE, 10000, 2.2, 0.5, 20, 4000),
            new Upgrade("synergy", "Synergy", "✨", K_SYNERGY, 50000, 1.8, 0.01, 50, 20000),
            new Upgrade("dragon", "Dragon Fist", "🐉", K_TAP, 1e5, 1.17, 100, 0, 40000),
            new Upgrade("titan", "Titan Smash", "🌋", K_TAP, 1.5e7, 1.17, 3000, 0, 5e6),
            new Upgrade("void", "Void Breaker", "🌀", K_TAP, 3e9, 1.17, 1e5, 0, 1e9),
            new Upgrade("cosmic", "Big Bang Punch", "💫", K_TAP, 8e11, 1.17, 5e6, 0, 2.5e11),
            new Upgrade("galaxyfist", "Galaxy Crusher", "🌠", K_TAP, 2e14, 1.17, 2.5e8, 0, 7e13),
            new Upgrade("rend", "Reality Rend", "☄️", K_TAP, 6e16, 1.17, 1.2e10, 0, 2e16),
            new Upgrade("omni", "Omni Strike", "👁️", K_TAP, 2e19, 1.17, 6e11, 0, 7e18),
            new Upgrade("eternal", "Eternity Fist", "🌟", K_TAP, 8e21, 1.17, 3e13, 0, 3e21),
    };

    final Upgrade[] training = {
            new Upgrade("meditate", "Meditation", "🧘", K_GEN, 50, 1.15, 1, 0, 0),
            new Upgrade("pushups", "Push-Up Grind", "💪", K_GEN, 400, 1.15, 5, 0, 150),
            new Upgrade("crystal", "Spirit Crystal", "💎", K_GEN, 5000, 1.15, 40, 0, 2000),
            new Upgrade("cell", "Power Cell", "🔋", K_GEN, 70000, 1.15, 300, 0, 25000),
            new Upgrade("spirit", "Dragon Spirit", "🐲", K_GEN, 1.2e6, 1.15, 2500, 0, 4e5),
            new Upgrade("forge", "Star Forge", "⭐", K_GEN, 2e7, 1.15, 20000, 0, 7e6),
            new Upgrade("hole", "Black Hole", "🕳️", K_GEN, 4e8, 1.15, 1.8e5, 0, 1.3e8),
            new Upgrade("galaxy", "Galaxy Engine", "🌌", K_GEN, 8e9, 1.15, 1.6e6, 0, 2.5e9),
            new Upgrade("multi", "Multiverse Core", "🪐", K_GEN, 1.8e11, 1.15, 1.5e7, 0, 6e10),
            new Upgrade("reality", "Reality Breaker", "🔮", K_GEN, 4e12, 1.15, 1.4e8, 0, 1.3e12),
            new Upgrade("infinity", "Infinity Gauntlet", "🧤", K_GEN, 1e14, 1.15, 1.3e9, 0, 3e13),
            new Upgrade("time", "Time Machine", "⏳", K_GEN, 3e15, 1.15, 1.2e10, 0, 1e15),
            new Upgrade("worlds", "World Eater", "🌍", K_GEN, 1e17, 1.15, 1.1e11, 0, 3e16),
            new Upgrade("throne", "God Throne", "👑", K_GEN, 4e18, 1.15, 1e12, 0, 1.3e18),
            new Upgrade("omniverse", "The Omniverse", "♾️", K_GEN, 2e20, 1.15, 1e13, 0, 7e19),
            new Upgrade("beyond", "Beyond Existence", "🕉️", K_GEN, 1e22, 1.15, 1e14, 0, 3e21),
    };

    // Persistent
    double power, totalPower, lifetimePower, bestTotal, shards;
    int ascensions, bestCombo;
    long taps, crits;
    double playSeconds;

    // Session
    int form;
    int combo;
    float comboTimer;
    float rage;
    float rageTime;
    float rageDuration = 1;
    boolean lastCrit;
    private boolean formUpPending;
    private final Random rng = new Random();

    Upgrade find(String id) {
        for (Upgrade u : strength) if (u.id.equals(id)) return u;
        for (Upgrade u : training) if (u.id.equals(id)) return u;
        return null;
    }

    /** Every milestone level doubles that upgrade's output. Past the table, one every 100 levels. */
    static double milestoneMult(int level) {
        int count = 0;
        for (int t : MILESTONES) {
            if (level < t) break;
            count++;
        }
        int last = MILESTONES[MILESTONES.length - 1];
        if (level >= last + 100) count += (level - last) / 100;
        return Math.pow(2, count);
    }

    static int nextMilestone(int level) {
        for (int t : MILESTONES) if (level < t) return t;
        int last = MILESTONES[MILESTONES.length - 1];
        return last + ((level - last) / 100 + 1) * 100;
    }

    static int prevMilestone(int level) {
        int p = 0;
        for (int t : MILESTONES) {
            if (level < t) return p;
            p = t;
        }
        return p + ((level - p) / 100) * 100;
    }

    /** Sum of level * value over the special upgrades of one kind. */
    private double bonusOf(int kind) {
        double sum = 0;
        for (Upgrade u : strength) if (u.kind == kind) sum += u.level * u.value;
        return sum;
    }

    double shardMult() {
        return 1 + SHARD_BONUS * shards;
    }

    double formMult() {
        return 1 + 0.25 * form;
    }

    double globalMult() {
        return shardMult() * formMult();
    }

    boolean raging() {
        return rageTime > 0;
    }

    double rageTapMult() {
        return 3 + bonusOf(K_RAGE);
    }

    double ragePpsMult() {
        return 2;
    }

    float rageSeconds() {
        return (float) (6 + bonusOf(K_RAGE));
    }

    double critChance() {
        return 0.02 + bonusOf(K_CRIT);
    }

    double critMult() {
        return 5 + bonusOf(K_CRIT_DMG);
    }

    double comboMaxBonus() {
        return 0.5 + bonusOf(K_COMBO);
    }

    double comboMult() {
        return 1 + Math.min(combo, COMBO_CAP) / (double) COMBO_CAP * comboMaxBonus();
    }

    double synergyPct() {
        return bonusOf(K_SYNERGY);
    }

    /** Effective gain from one level of an upgrade's main effect (for display). */
    double perLevel(Upgrade u) {
        return u.value * milestoneMult(u.level) * globalMult();
    }

    double genOutput(Upgrade u) {
        return u.value * u.level * milestoneMult(u.level) * globalMult();
    }

    double basePps() {
        double s = 0;
        for (Upgrade u : training) s += u.value * u.level * milestoneMult(u.level);
        return s * globalMult();
    }

    double pps() {
        return basePps() * (raging() ? ragePpsMult() : 1);
    }

    double tapBase() {
        double flat = 1;
        for (Upgrade u : strength) if (u.kind == K_TAP) flat += u.value * u.level * milestoneMult(u.level);
        return flat * globalMult() + basePps() * synergyPct();
    }

    /** Power per tap before crits, including current combo and rage. */
    double tapValue() {
        return tapBase() * comboMult() * (raging() ? rageTapMult() : 1);
    }

    double tap() {
        combo++;
        if (combo > bestCombo) bestCombo = combo;
        comboTimer = COMBO_WINDOW;
        if (!raging()) rage = Math.min(1f, rage + RAGE_PER_TAP);
        lastCrit = rng.nextDouble() < critChance();
        double gain = tapValue() * (lastCrit ? critMult() : 1);
        taps++;
        if (lastCrit) crits++;
        add(gain);
        return gain;
    }

    boolean rageReady() {
        return !raging() && rage >= 1f;
    }

    boolean activateRage() {
        if (!rageReady()) return false;
        rageDuration = rageSeconds();
        rageTime = rageDuration;
        return true;
    }

    void update(float dt) {
        playSeconds += dt;
        double p = pps();
        if (p > 0) add(p * dt);
        if (comboTimer > 0) {
            comboTimer -= dt;
            if (comboTimer <= 0) {
                comboTimer = 0;
                combo = 0;
            }
        }
        if (rageTime > 0) {
            rageTime -= dt;
            rage = Math.max(0f, rageTime / rageDuration);
            if (rageTime <= 0) {
                rageTime = 0;
                rage = 0;
            }
        }
    }

    void add(double amount) {
        power += amount;
        totalPower += amount;
        lifetimePower += amount;
        if (totalPower > bestTotal) bestTotal = totalPower;
        while (form + 1 < FORM_AT.length && totalPower >= FORM_AT[form + 1]) {
            form++;
            formUpPending = true;
        }
    }

    boolean consumeFormUp() {
        boolean f = formUpPending;
        formUpPending = false;
        return f;
    }

    /** Recomputes form from totalPower without triggering a form-up (used after loading). */
    void syncForm() {
        form = 0;
        while (form + 1 < FORM_AT.length && totalPower >= FORM_AT[form + 1]) form++;
        formUpPending = false;
    }

    double nextFormProgress() {
        if (form + 1 >= FORM_AT.length) return 1;
        double lo = FORM_AT[form], hi = FORM_AT[form + 1];
        // Log scale feels smoother across huge ranges.
        double a = Math.log10(Math.max(lo, 1)), b = Math.log10(hi), c = Math.log10(Math.max(totalPower, 1));
        return Math.max(0, Math.min(1, (c - a) / (b - a)));
    }

    boolean revealed(Upgrade u) {
        return u.level > 0 || Math.max(totalPower, bestTotal) >= u.revealAt;
    }

    /** Buys up to n levels; returns levels bought. */
    int buy(Upgrade u, int n) {
        n = u.clampBuy(n);
        if (n <= 0) return 0;
        double cost = u.costOf(n);
        if (cost > power) return 0;
        power -= cost;
        u.level += n;
        return n;
    }

    double shardsOnAscend() {
        if (totalPower < ASCEND_MIN) return 0;
        return Math.floor(5 * Math.pow(Math.log10(totalPower) - 8, 1.8));
    }

    boolean ascend() {
        double gain = shardsOnAscend();
        if (gain <= 0) return false;
        shards += gain;
        ascensions++;
        power = 0;
        totalPower = 0;
        for (Upgrade u : strength) u.level = 0;
        for (Upgrade u : training) u.level = 0;
        combo = 0;
        comboTimer = 0;
        rage = 0;
        rageTime = 0;
        form = 0;
        formUpPending = false;
        return true;
    }

    double offlineGain(double seconds) {
        if (seconds <= 0) return 0;
        return Math.min(seconds, OFFLINE_CAP_SECONDS) * basePps() * OFFLINE_RATE;
    }

    void resetAll() {
        power = totalPower = lifetimePower = bestTotal = shards = 0;
        ascensions = bestCombo = 0;
        taps = crits = 0;
        playSeconds = 0;
        for (Upgrade u : strength) u.level = 0;
        for (Upgrade u : training) u.level = 0;
        combo = 0;
        comboTimer = 0;
        rage = 0;
        rageTime = 0;
        form = 0;
        formUpPending = false;
    }
}
