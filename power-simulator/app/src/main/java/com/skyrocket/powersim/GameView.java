package com.skyrocket.powersim;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;

import java.util.Random;

/** Draws the whole play area (background, character, effects and HUD) and turns taps into power. */
public final class GameView extends View {

    interface Host {
        void onSettingsRequested();

        void onFormUp(int form);

        void onRageStarted();
    }

    static final int[] FORM_COLOR = {
            0xFF9FB4D8, 0xFF4DD8FF, 0xFF3DFFA2, 0xFFFFB13D, 0xFFFFE14D, 0xFFFF4D5E,
            0xFFFF5CE1, 0xFFB06BFF, 0xFF6F8BFF, 0xFFE8F6FF, 0, 0
    };
    static final int[] FORM_COLOR2 = {
            0xFF5D7AA8, 0xFF2A7FFF, 0xFF00B87A, 0xFFFF6B1A, 0xFFFFB300, 0xFFB3001B,
            0xFFA0109A, 0xFF5B1FD6, 0xFF1B2BB3, 0xFF9EE7FF, 0, 0
    };
    static final int RAGE_RED = 0xFFFF2E4D;
    static final int GOLD = 0xFFFFD54A;

    private GameState game;
    private Sfx sfx;
    private Host host;
    boolean haptics = true;

    private final float dp, sp;
    private final Random rng = new Random();
    private float topInset;
    private float panelTop = -1;
    private long lastNanos;
    private boolean running;
    private float time;
    private double shownPower;

    // Scene layout (pixels), recomputed each frame.
    private float cx, groundY, unit, hudBottom, charTop;

    // Particles: kind 0 = rising ember dot, 1 = burst streak.
    private static final int MAXP = 480;
    private final float[] pX = new float[MAXP], pY = new float[MAXP], pVX = new float[MAXP], pVY = new float[MAXP];
    private final float[] pLife = new float[MAXP], pMax = new float[MAXP], pSize = new float[MAXP];
    private final int[] pColor = new int[MAXP];
    private final byte[] pKind = new byte[MAXP];
    private int pCount;
    private float emberAcc;

    // Floating numbers.
    private static final int MAXF = 40;
    private final float[] fX = new float[MAXF], fY = new float[MAXF], fLife = new float[MAXF], fMax = new float[MAXF];
    private final String[] fText = new String[MAXF];
    private final boolean[] fCrit = new boolean[MAXF];
    private int fCount;

    // Shockwave rings.
    private static final int MAXR = 24;
    private final float[] rX = new float[MAXR], rY = new float[MAXR], rMaxR = new float[MAXR], rLife = new float[MAXR], rMax = new float[MAXR], rW = new float[MAXR];
    private final int[] rColor = new int[MAXR];
    private int rCount;

    // Lightning bolts in character units.
    private static final int MAXB = 4, BSEG = 7;
    private final float[][] bPts = new float[MAXB][(BSEG + 1) * 2];
    private final float[] bLife = new float[MAXB];
    private float boltTimer;

    // Background stars (normalized coordinates).
    private static final int STARS = 90;
    private final float[] sX = new float[STARS], sY = new float[STARS], sS = new float[STARS], sP = new float[STARS], sV = new float[STARS];

    // Animation state.
    private float punchT = 1, squash, shake, flash, comboPulse, rageFlashT;
    private int punchSide = 1;
    private int flashColor = Color.WHITE;
    private String bannerTitle, bannerText;
    private int bannerColor;
    private float bannerLife, bannerMax = 1;
    private String toastText;
    private float toastLife;
    private int toastColor;

    // Hit areas.
    private final RectF gearRect = new RectF(), rageRect = new RectF();

    // Paints & paths.
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint add = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint addStroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bodyFill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bigText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint floatText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final Path torso = new Path();
    private final Path hair = new Path();
    private final RectF rect = new RectF();
    private final Typeface black = Typeface.create("sans-serif-black", Typeface.NORMAL);
    private final Typeface bold = Typeface.create("sans-serif", Typeface.BOLD);
    private final Typeface medium = Typeface.create("sans-serif-medium", Typeface.NORMAL);

    private LinearGradient bgShader;
    private int bgShaderKey = -1;
    private RadialGradient vignette;
    private int vignetteH;

    public GameView(Context context) {
        super(context);
        dp = getResources().getDisplayMetrics().density;
        sp = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 1, getResources().getDisplayMetrics());
        PorterDuffXfermode addMode = new PorterDuffXfermode(PorterDuff.Mode.ADD);
        add.setXfermode(addMode);
        addStroke.setXfermode(addMode);
        addStroke.setStyle(Paint.Style.STROKE);
        addStroke.setStrokeCap(Paint.Cap.ROUND);
        addStroke.setStrokeJoin(Paint.Join.ROUND);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setStrokeJoin(Paint.Join.ROUND);
        bodyFill.setShader(new LinearGradient(0, -112, 0, 0, 0xFF222B48, 0xFF0B0F1D, Shader.TileMode.CLAMP));
        bodyFill.setStrokeCap(Paint.Cap.ROUND);
        bodyFill.setStrokeJoin(Paint.Join.ROUND);
        bigText.setTypeface(black);
        bigText.setTextAlign(Paint.Align.CENTER);
        floatText.setTypeface(black);
        floatText.setTextAlign(Paint.Align.CENTER);
        for (int i = 0; i < STARS; i++) {
            sX[i] = rng.nextFloat();
            sY[i] = rng.nextFloat();
            sS[i] = 0.5f + rng.nextFloat() * 1.3f;
            sP[i] = rng.nextFloat() * 6.28f;
            sV[i] = 0.004f + rng.nextFloat() * 0.012f;
        }
        setHapticFeedbackEnabled(true);
    }

    void bind(GameState game, Sfx sfx, Host host) {
        this.game = game;
        this.sfx = sfx;
        this.host = host;
        shownPower = game.power;
    }

    void setTopInset(float px) {
        topInset = px;
    }

    void setPanelTop(float y) {
        panelTop = y;
    }

    void setRunning(boolean run) {
        if (run == running) return;
        running = run;
        lastNanos = 0;
        if (run) postInvalidateOnAnimation();
    }

    // ---------------------------------------------------------------- public effects

    void toast(String message, int color) {
        toastText = message;
        toastColor = color;
        toastLife = 2.4f;
    }

    void celebrate(String title, String subtitle, int color) {
        bannerTitle = title;
        bannerText = subtitle;
        bannerColor = color;
        bannerMax = bannerLife = 2.8f;
        flash = 1f;
        flashColor = Color.WHITE;
        shake = Math.max(shake, 16 * dp);
        float cy = groundY - 55 * unit;
        for (int i = 0; i < 3; i++) ring(cx, cy, (180 + i * 90) * dp, color, 0.6f + i * 0.2f, (10 - i * 3) * dp);
        explode(cx, cy, 110, color);
        haptic(HapticFeedbackConstants.LONG_PRESS);
    }

    // ---------------------------------------------------------------- input

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        if (game == null) return false;
        int action = e.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_POINTER_DOWN) {
            int idx = e.getActionIndex();
            float x = e.getX(idx), y = e.getY(idx);
            if (gearRect.contains(x, y)) {
                if (host != null) host.onSettingsRequested();
            } else if (game.rageReady() && rageRect.contains(x, y)) {
                startRage();
            } else if (panelTop < 0 || y < panelTop) {
                tapAt(x, y);
            }
        }
        return true;
    }

    private void tapAt(float x, float y) {
        double gain = game.tap();
        boolean crit = game.lastCrit;
        int color = crit ? GOLD : lighten(currentColor(), 0.35f);
        addFloat(x + rnd(-16, 16) * dp, y - 34 * dp, (crit ? "CRIT! +" : "+") + Fmt.num(gain), crit);
        burst(x, y, crit ? 26 : 11, color, crit);
        ring(x, y, (crit ? 120 : 64) * dp, color, crit ? 0.45f : 0.32f, (crit ? 5 : 3) * dp);
        punchSide = -punchSide;
        punchT = 0;
        squash = 1;
        comboPulse = 1;
        if (crit) {
            shake = Math.max(shake, 9 * dp);
            flash = Math.max(flash, 0.22f);
            flashColor = GOLD;
        }
        if (sfx != null) {
            if (crit) sfx.play(Sfx.CRIT, 0.9f, 0.95f + rng.nextFloat() * 0.1f);
            else sfx.play(Sfx.TAP, 0.55f, 0.92f + rng.nextFloat() * 0.12f + Math.min(game.combo, 100) / 300f);
        }
        haptic(crit ? HapticFeedbackConstants.VIRTUAL_KEY : HapticFeedbackConstants.KEYBOARD_TAP);
    }

    private void startRage() {
        if (!game.activateRage()) return;
        rageFlashT = 1;
        flash = 0.55f;
        flashColor = RAGE_RED;
        shake = Math.max(shake, 14 * dp);
        float cy = groundY - 55 * unit;
        ring(cx, cy, 260 * dp, RAGE_RED, 0.7f, 10 * dp);
        explode(cx, cy, 70, RAGE_RED);
        haptic(HapticFeedbackConstants.LONG_PRESS);
        if (host != null) host.onRageStarted();
    }

    private void haptic(int type) {
        if (haptics) performHapticFeedback(type);
    }

    // ---------------------------------------------------------------- simulation

    private void step(float dt) {
        time += dt;
        game.update(dt);
        if (game.consumeFormUp()) {
            int f = game.form;
            celebrate("FORM UP!", GameState.FORM_NAMES[f].toUpperCase(), formColor(f));
            if (sfx != null) sfx.play(Sfx.FORM, 1f, 1f);
            if (host != null) host.onFormUp(f);
        }
        if (game.power < shownPower) shownPower = game.power;
        else shownPower += (game.power - shownPower) * Math.min(1, dt * 14);

        if (punchT < 1) punchT += dt;
        squash *= (float) Math.exp(-dt * 10);
        shake *= (float) Math.exp(-dt * 9);
        flash = Math.max(0, flash - dt * 2.6f);
        comboPulse *= (float) Math.exp(-dt * 8);
        rageFlashT = Math.max(0, rageFlashT - dt);
        if (bannerLife > 0) bannerLife -= dt;
        if (toastLife > 0) toastLife -= dt;
        if (game.raging()) shake = Math.max(shake, 1.6f * dp);

        // Embers rising from the character.
        float rate = 5 + game.form * 7 + (game.raging() ? 40 : 0);
        emberAcc += rate * dt;
        int c = currentColor();
        while (emberAcc >= 1) {
            emberAcc -= 1;
            spawn(cx + rnd(-34, 34) * unit, groundY - rnd(0, 85) * unit,
                    rnd(-14, 14) * dp, -rnd(45, 150) * dp * (game.raging() ? 1.7f : 1),
                    rnd(0.7f, 1.7f), rnd(1.1f, 2.8f) * dp, rng.nextFloat() < 0.3f ? Color.WHITE : lighten(c, 0.2f), (byte) 0);
        }

        // Particles.
        for (int i = 0; i < pCount; ) {
            pLife[i] -= dt;
            if (pLife[i] <= 0) {
                removeParticle(i);
                continue;
            }
            if (pKind[i] == 1) {
                float drag = (float) Math.exp(-dt * 4.5f);
                pVX[i] *= drag;
                pVY[i] = pVY[i] * drag + 380 * dp * dt;
            }
            pX[i] += pVX[i] * dt;
            pY[i] += pVY[i] * dt;
            i++;
        }
        for (int i = 0; i < fCount; ) {
            fLife[i] -= dt;
            if (fLife[i] <= 0) {
                removeFloat(i);
                continue;
            }
            float age = fMax[i] - fLife[i];
            fY[i] -= (120 * dp) * (float) Math.exp(-age * 2.2f) * dt;
            i++;
        }
        for (int i = 0; i < rCount; ) {
            rLife[i] -= dt;
            if (rLife[i] <= 0) {
                removeRing(i);
                continue;
            }
            i++;
        }

        // Lightning.
        for (int i = 0; i < MAXB; i++) if (bLife[i] > 0) bLife[i] -= dt;
        boltTimer -= dt;
        if (boltTimer <= 0) {
            boltTimer = 0.09f;
            float chance = Math.max(0, game.form - 3) * 0.1f + (game.raging() ? 0.7f : 0);
            if (rng.nextFloat() < chance) makeBolt();
        }

        for (int i = 0; i < STARS; i++) {
            sY[i] += sV[i] * dt * (game.raging() ? 6 : 1);
            if (sY[i] > 1) {
                sY[i] -= 1;
                sX[i] = rng.nextFloat();
            }
        }
    }

    private void makeBolt() {
        for (int b = 0; b < MAXB; b++) {
            if (bLife[b] > 0) continue;
            float a = rnd(0, 6.283f);
            float rx = 30 + game.form * 2.2f, ry = 56 + game.form * 2.8f;
            float x = (float) Math.cos(a) * rx * 0.75f, y = -52 + (float) Math.sin(a) * ry * 0.75f;
            float dirX = (float) Math.cos(a), dirY = (float) Math.sin(a);
            float[] pts = bPts[b];
            for (int s = 0; s <= BSEG; s++) {
                pts[s * 2] = x;
                pts[s * 2 + 1] = y;
                x += dirX * 6 + rnd(-6, 6);
                y += dirY * 6 + rnd(-6, 6);
            }
            bLife[b] = 0.13f;
            return;
        }
    }

    // ---------------------------------------------------------------- drawing

    @Override
    protected void onDraw(Canvas canvas) {
        if (game == null) return;
        long now = System.nanoTime();
        float dt = lastNanos == 0 ? 0.016f : Math.min(0.05f, (now - lastNanos) / 1e9f);
        lastNanos = now;
        layoutScene();
        step(dt);

        int w = getWidth(), h = getHeight();
        drawBackground(canvas, w, h);

        canvas.save();
        if (shake > 0.3f) canvas.translate(rnd(-1, 1) * shake, rnd(-1, 1) * shake);
        drawPlatform(canvas);
        drawCharacter(canvas);
        drawParticles(canvas);
        drawRings(canvas);
        drawFloats(canvas);
        canvas.restore();

        if (game.raging() || rageFlashT > 0) drawVignette(canvas, w, h);
        drawHud(canvas, w);
        drawCombo(canvas, w);
        drawRageBar(canvas, w);
        drawBanner(canvas, w);
        if (flash > 0) {
            fill.setShader(null);
            fill.setColor(withAlpha(flashColor, (int) (Math.min(1, flash) * 170)));
            canvas.drawRect(0, 0, w, h, fill);
        }
        if (running) postInvalidateOnAnimation();
    }

    private void layoutScene() {
        int w = getWidth(), h = getHeight();
        float bottom = panelTop > 0 ? panelTop : h;
        boolean compact = h / dp < 700;
        hudBottom = topInset + (compact ? 158 : 190) * dp;
        float areaTop = hudBottom - 6 * dp;
        float areaBottom = bottom - 64 * dp;
        float areaH = Math.max(80 * dp, areaBottom - areaTop);
        float charH = Math.min(areaH * 0.86f, w * 0.62f);
        unit = charH / 112f;
        cx = w / 2f;
        groundY = areaBottom - 6 * dp;
        charTop = groundY - charH;
    }

    private void drawBackground(Canvas canvas, int w, int h) {
        int f = game.form;
        int key = f * 100000 + h;
        if (bgShader == null || key != bgShaderKey || f >= 10) {
            int tint = f >= 10 ? currentColor() : FORM_COLOR2[f];
            bgShader = new LinearGradient(0, 0, 0, h,
                    new int[]{mix(0xFF0B1024, tint, 0.18f), 0xFF0A0E1E, 0xFF04060D}, new float[]{0, 0.55f, 1}, Shader.TileMode.CLAMP);
            bgShaderKey = key;
        }
        shade(fill, bgShader);
        canvas.drawRect(0, 0, w, h, fill);
        fill.setShader(null);

        // Glow behind the character.
        float gy = groundY - 55 * unit;
        float pulse = 0.85f + 0.15f * (float) Math.sin(time * 2.4f);
        int c = currentColor();
        float r = Math.max(w * 0.75f, 140 * unit);
        shade(add, new RadialGradient(cx, gy, r, new int[]{withAlpha(c, (int) ((40 + game.form * 4) * pulse)), withAlpha(c, 12), 0},
                new float[]{0, 0.5f, 1}, Shader.TileMode.CLAMP));
        canvas.drawCircle(cx, gy, r, add);
        add.setShader(null);

        // Stars.
        for (int i = 0; i < STARS; i++) {
            float tw = 0.5f + 0.5f * (float) Math.sin(time * 1.7f + sP[i]);
            fill.setColor(withAlpha(i % 7 == 0 ? c : 0xFFFFFFFF, (int) (40 + 120 * tw * Math.min(1, 0.4f + game.form * 0.08f))));
            canvas.drawCircle(sX[i] * w, sY[i] * h, sS[i] * dp, fill);
        }
    }

    private void drawPlatform(Canvas canvas) {
        int c = currentColor();
        float rx = 46 * unit, ry = 8 * unit;
        shade(fill, new RadialGradient(cx, groundY, rx, new int[]{0xAA000000, 0x00000000}, null, Shader.TileMode.CLAMP));
        rect.set(cx - rx, groundY - ry, cx + rx, groundY + ry);
        canvas.drawOval(rect, fill);
        fill.setShader(null);
        float pulse = 0.6f + 0.4f * (float) Math.sin(time * 3f);
        addStroke.setColor(withAlpha(c, (int) (40 * pulse)));
        addStroke.setStrokeWidth(7 * dp);
        canvas.drawOval(rect, addStroke);
        addStroke.setColor(withAlpha(c, (int) (150 * pulse)));
        addStroke.setStrokeWidth(1.6f * dp);
        canvas.drawOval(rect, addStroke);
    }

    private void drawCharacter(Canvas canvas) {
        int f = game.form;
        int c = currentColor();
        int c2 = currentColor2();
        boolean rage = game.raging();
        float m = 1 + 0.04f * f + (rage ? 0.05f : 0);
        float bob = (float) Math.sin(time * 2.2f) * 0.9f;

        canvas.save();
        canvas.translate(cx, groundY);
        float sq = squash * 0.07f;
        canvas.scale(unit * (1 + sq), unit * (1 - sq));

        drawOrbits(canvas, c, f, false);
        drawAura(canvas, c, c2, f, rage);

        // Pose.
        float hipY = -44 + bob, shY = -79 + bob, neckY = -85 + bob, headY = -95 + bob;
        float ext = punchExtension();
        float lx = 1, rx = 1; // punch amount per side
        if (punchSide < 0) {
            lx = ext;
            rx = 0;
        } else {
            rx = ext;
            lx = 0;
        }

        // Glow pass (all parts, additive, wide).
        for (int pass = 0; pass < 2; pass++) {
            addStroke.setColor(withAlpha(c, pass == 0 ? 34 : 70));
            float extra = pass == 0 ? 9f : 4f;
            drawLimbs(canvas, addStroke, m, hipY, shY, lx, rx, extra);
            addStroke.setStrokeWidth(extra * 2);
            buildTorso(m, hipY, shY, neckY);
            canvas.drawPath(torso, addStroke);
            canvas.drawCircle(0, headY, 10.5f, addStroke);
        }

        // Legs.
        stroke.setColor(c);
        drawLegs(canvas, stroke, m, hipY, 2.0f);
        bodyFill.setStyle(Paint.Style.STROKE);
        drawLegs(canvas, bodyFill, m, hipY, 0);

        // Torso.
        buildTorso(m, hipY, shY, neckY);
        stroke.setStrokeWidth(2.0f);
        canvas.drawPath(torso, stroke);
        bodyFill.setStyle(Paint.Style.FILL);
        canvas.drawPath(torso, bodyFill);
        // Muscle definition.
        stroke.setColor(withAlpha(c, 70));
        stroke.setStrokeWidth(0.9f);
        path.reset();
        path.moveTo(-14 * m, shY + 6);
        path.quadTo(-6 * m, shY + 15, 0, shY + 12);
        path.quadTo(6 * m, shY + 15, 14 * m, shY + 6);
        canvas.drawPath(path, stroke);
        canvas.drawLine(0, shY + 16, 0, hipY - 5, stroke);
        if (f >= 2) {
            for (int i = 0; i < 2; i++) {
                float y = shY + 21 + i * 7;
                canvas.drawLine(-5 * m, y, -1.5f, y + 0.6f, stroke);
                canvas.drawLine(5 * m, y, 1.5f, y + 0.6f, stroke);
            }
        }
        // Chest core for divine forms.
        if (f >= 6) {
            float pr = 3.2f + 0.8f * (float) Math.sin(time * 5);
            shade(add, new RadialGradient(0, shY + 12, pr * 3, new int[]{0xFFFFFFFF, withAlpha(c, 200), 0}, new float[]{0, 0.3f, 1}, Shader.TileMode.CLAMP));
            canvas.drawCircle(0, shY + 12, pr * 3, add);
            add.setShader(null);
        }

        // Head.
        stroke.setColor(c);
        stroke.setStrokeWidth(2.0f);
        canvas.drawRect(-3.6f, neckY - 4, 3.6f, neckY + 2, bodyFill);
        canvas.drawCircle(0, headY, 10.5f, stroke);
        canvas.drawCircle(0, headY, 10.5f, bodyFill);
        drawHair(canvas, c, c2, f, headY, rage);
        drawEyes(canvas, c, f, headY, rage);

        // Arms.
        stroke.setColor(c);
        drawArms(canvas, stroke, m, shY, lx, rx, 2.0f);
        bodyFill.setStyle(Paint.Style.STROKE);
        drawArms(canvas, bodyFill, m, shY, lx, rx, 0);
        bodyFill.setStyle(Paint.Style.FILL);

        drawBolts(canvas, c);
        drawOrbits(canvas, c, f, true);
        canvas.restore();

        // Impact flash at the punching fist.
        if (ext > 0.6f) {
            float side = punchSide;
            float fx = cx + side * 58 * m * unit, fy = groundY + (shY - 1) * unit;
            float r = 14 * unit * ext;
            shade(add, new RadialGradient(fx, fy, r, new int[]{0xCCFFFFFF, withAlpha(c, 120), 0}, new float[]{0, 0.35f, 1}, Shader.TileMode.CLAMP));
            canvas.drawCircle(fx, fy, r, add);
            add.setShader(null);
        }
    }

    private float punchExtension() {
        if (punchT >= 0.24f) return 0;
        float x = punchT < 0.05f ? punchT / 0.05f : 1 - (punchT - 0.05f) / 0.19f;
        x = Math.max(0, Math.min(1, x));
        return 1 - (1 - x) * (1 - x) * (1 - x);
    }

    private void buildTorso(float m, float hipY, float shY, float neckY) {
        torso.reset();
        torso.moveTo(-12 * m, hipY);
        torso.cubicTo(-14 * m, hipY - 12, -25 * m, shY + 9, -23 * m, shY);
        torso.quadTo(-17 * m, shY - 5.5f, -6, neckY);
        torso.lineTo(6, neckY);
        torso.quadTo(17 * m, shY - 5.5f, 23 * m, shY);
        torso.cubicTo(25 * m, shY + 9, 14 * m, hipY - 12, 12 * m, hipY);
        torso.quadTo(0, hipY + 3, -12 * m, hipY);
        torso.close();
    }

    private void drawLimbs(Canvas canvas, Paint p, float m, float hipY, float shY, float lx, float rx, float extra) {
        drawLegs(canvas, p, m, hipY, extra);
        drawArms(canvas, p, m, shY, lx, rx, extra);
    }

    private void drawLegs(Canvas canvas, Paint p, float m, float hipY, float extra) {
        for (int s = -1; s <= 1; s += 2) {
            float hx = s * 8 * m, kx = s * 15 * m, fx = s * 19 * m;
            p.setStrokeWidth(13 * m + extra * 2);
            canvas.drawLine(hx, hipY, kx, -22, p);
            p.setStrokeWidth(11.5f * m + extra * 2);
            canvas.drawLine(kx, -22, fx, -3, p);
            p.setStrokeWidth(8 * m + extra * 2);
            canvas.drawLine(fx, -2.5f, fx + s * 5, -2, p);
        }
    }

    private void drawArms(Canvas canvas, Paint p, float m, float shY, float lx, float rx, float extra) {
        for (int s = -1; s <= 1; s += 2) {
            float e = s < 0 ? lx : rx;
            float sx = s * 21 * m, sy = shY + 3;
            // Guard pose -> punch pose.
            float ex = lerp(s * 27 * m, s * 40 * m, e), ey = lerp(shY + 21, shY + 1, e);
            float hx = lerp(s * 13 * m, s * 58 * m, e), hy = lerp(shY + 5, shY - 1, e);
            p.setStrokeWidth(11 * m + extra * 2);
            canvas.drawLine(sx, sy, ex, ey, p);
            p.setStrokeWidth(9.5f * m + extra * 2);
            canvas.drawLine(ex, ey, hx, hy, p);
            Paint.Style old = p.getStyle();
            p.setStyle(Paint.Style.FILL);
            canvas.drawCircle(hx, hy, 6.4f * m + extra, p);
            p.setStyle(old);
        }
    }

    private void drawHair(Canvas canvas, int c, int c2, int f, float headY, boolean rage) {
        hair.reset();
        if (f < 3) {
            // Short neat hair.
            rect.set(-11, headY - 11.5f, 11, headY + 6);
            hair.arcTo(rect, 180, 180, true);
            hair.quadTo(4, headY - 6, -11, headY - 2);
            hair.close();
            stroke.setColor(c);
            stroke.setStrokeWidth(1.6f);
            canvas.drawPath(hair, stroke);
            fill.setShader(null);
            fill.setColor(0xFF161C30);
            canvas.drawPath(hair, fill);
            return;
        }
        int spikes = 5 + Math.min(4, (f - 3) / 2);
        float len = 7 + (f - 3) * 1.7f + (rage ? 4 : 0);
        float start = (float) Math.toRadians(195), end = (float) Math.toRadians(345);
        float r = 10.2f;
        hair.moveTo((float) Math.cos(start) * r, headY + (float) Math.sin(start) * r + 2);
        for (int i = 0; i < spikes; i++) {
            float a0 = start + (end - start) * i / spikes;
            float a1 = start + (end - start) * (i + 1) / spikes;
            float am = (a0 + a1) / 2;
            float flick = (float) Math.sin(time * 11 + i * 1.7f) * (rage ? 1.6f : 0.7f);
            float l = len * (0.75f + 0.25f * (float) Math.sin(i * 2.3f + 1)) + flick;
            float dx = (float) Math.cos(am), dy = (float) Math.sin(am);
            // Tips lean upward.
            float tx = dx * 0.6f, ty = dy * 0.6f - 0.55f;
            float tl = (float) Math.sqrt(tx * tx + ty * ty);
            hair.lineTo(dx * r + tx / tl * l, headY + dy * r + ty / tl * l);
            hair.lineTo((float) Math.cos(a1) * r * 0.98f, headY + (float) Math.sin(a1) * r * 0.98f);
        }
        hair.lineTo((float) Math.cos(end) * r, headY + (float) Math.sin(end) * r + 2);
        hair.quadTo(0, headY - 5, (float) Math.cos(start) * r, headY + (float) Math.sin(start) * r + 2);
        hair.close();

        addStroke.setColor(withAlpha(c, 70));
        addStroke.setStrokeWidth(6);
        canvas.drawPath(hair, addStroke);
        shade(fill, new LinearGradient(0, headY - r - len, 0, headY, lighten(c, 0.45f), c2, Shader.TileMode.CLAMP));
        canvas.drawPath(hair, fill);
        fill.setShader(null);
        stroke.setColor(lighten(c, 0.6f));
        stroke.setStrokeWidth(0.8f);
        canvas.drawPath(hair, stroke);
    }

    private void drawEyes(Canvas canvas, int c, int f, float headY, boolean rage) {
        int ec = rage ? RAGE_RED : (f >= 2 ? c : 0xFFE8EEFF);
        if (f >= 2 || rage) {
            add.setShader(null);
            add.setColor(withAlpha(ec, 90));
            canvas.drawCircle(-3.9f, headY, 3.4f, add);
            canvas.drawCircle(3.9f, headY, 3.4f, add);
        }
        stroke.setColor(f >= 4 || rage ? 0xFFFFFFFF : ec);
        stroke.setStrokeWidth(1.7f);
        canvas.drawLine(-6.2f, headY - 1.4f, -2f, headY + 0.1f, stroke);
        canvas.drawLine(6.2f, headY - 1.4f, 2f, headY + 0.1f, stroke);
    }

    private void drawAura(Canvas canvas, int c, int c2, int f, boolean rage) {
        float strength = f == 0 ? 0.35f : Math.min(1, 0.55f + f * 0.06f);
        if (rage) strength = 1;
        float rx = 30 + f * 2.2f + (rage ? 8 : 0);
        float ry = 56 + f * 2.8f + (rage ? 10 : 0);
        float amp = 0.10f + f * 0.012f + (rage ? 0.10f : 0);
        float flameH = 8 + f * 2.2f + (rage ? 12 : 0);
        float speed = rage ? 1.8f : 1;
        float centerY = -52;
        int n = 64;
        for (int layer = 0; layer < 3; layer++) {
            float scale = layer == 0 ? 1.14f : layer == 1 ? 1f : 0.82f;
            float alpha = (layer == 0 ? 0.32f : layer == 1 ? 0.5f : 0.7f) * strength;
            float t = time * speed + layer * 1.7f;
            path.reset();
            for (int i = 0; i <= n; i++) {
                float th = (float) (Math.PI * 2 * i / n);
                float cs = (float) Math.cos(th), sn = (float) Math.sin(th);
                float noise = 0.55f * (float) Math.sin(7 * th + t * 7.5f) + 0.3f * (float) Math.sin(13 * th - t * 11) + 0.15f * (float) Math.sin(3 * th + t * 3.1f);
                float top = Math.max(0, -sn);
                float k = scale * (1 + amp * (0.5f + 0.5f * noise) * (0.3f + 0.7f * top));
                float x = cs * rx * k;
                float y = centerY + sn * ry * k - top * top * flameH * scale * (0.6f + 0.4f * noise);
                if (i == 0) path.moveTo(x, y);
                else path.lineTo(x, y);
            }
            path.close();
            int col = layer == 2 ? lighten(c, 0.35f) : (layer == 0 ? c2 : c);
            shade(add, new RadialGradient(0, centerY - 6, ry * 1.3f * scale,
                    new int[]{withAlpha(col, (int) (255 * alpha)), withAlpha(col, (int) (150 * alpha)), withAlpha(col, 0)},
                    new float[]{0, 0.62f, 1}, Shader.TileMode.CLAMP));
            canvas.drawPath(path, add);
        }
        add.setShader(null);
    }

    private void drawOrbits(Canvas canvas, int c, int f, boolean front) {
        if (f < 5) return;
        int rings = Math.min(4, 1 + (f - 5) / 2);
        for (int i = 0; i < rings; i++) {
            float rx = 50 + i * 8, ry = 12 + i * 3;
            float rot = i * 38 + (float) Math.sin(time * 0.4f + i) * 22;
            canvas.save();
            canvas.translate(0, -55);
            canvas.rotate(rot);
            if (!front) {
                rect.set(-rx, -ry, rx, ry);
                addStroke.setColor(withAlpha(c, 40));
                addStroke.setStrokeWidth(3.2f);
                canvas.drawOval(rect, addStroke);
                addStroke.setColor(withAlpha(c, 130));
                addStroke.setStrokeWidth(0.8f);
                canvas.drawOval(rect, addStroke);
            } else {
                float a = time * (1.5f + i * 0.45f) + i * 2;
                float ox = (float) Math.cos(a) * rx, oy = (float) Math.sin(a) * ry;
                shade(add, new RadialGradient(ox, oy, 5, new int[]{0xFFFFFFFF, withAlpha(c, 160), 0}, new float[]{0, 0.35f, 1}, Shader.TileMode.CLAMP));
                canvas.drawCircle(ox, oy, 5, add);
                add.setShader(null);
            }
            canvas.restore();
        }
    }

    private void drawBolts(Canvas canvas, int c) {
        int bc = game.raging() ? 0xFFFF7A8A : lighten(c, 0.4f);
        for (int b = 0; b < MAXB; b++) {
            if (bLife[b] <= 0) continue;
            float[] pts = bPts[b];
            path.reset();
            path.moveTo(pts[0], pts[1]);
            for (int s = 1; s <= BSEG; s++) path.lineTo(pts[s * 2], pts[s * 2 + 1]);
            float a = Math.min(1, bLife[b] / 0.13f);
            addStroke.setColor(withAlpha(bc, (int) (90 * a)));
            addStroke.setStrokeWidth(3.5f);
            canvas.drawPath(path, addStroke);
            addStroke.setColor(withAlpha(0xFFFFFFFF, (int) (230 * a)));
            addStroke.setStrokeWidth(0.9f);
            canvas.drawPath(path, addStroke);
        }
    }

    private void drawParticles(Canvas canvas) {
        add.setShader(null);
        for (int i = 0; i < pCount; i++) {
            float lifeK = pLife[i] / pMax[i];
            float a = Math.min(1, lifeK * 2.2f) * Math.min(1, (1 - lifeK) * 8 + 0.2f);
            if (pKind[i] == 1) {
                addStroke.setColor(withAlpha(pColor[i], (int) (255 * a)));
                addStroke.setStrokeWidth(pSize[i]);
                canvas.drawLine(pX[i], pY[i], pX[i] - pVX[i] * 0.03f, pY[i] - pVY[i] * 0.03f, addStroke);
            } else {
                add.setColor(withAlpha(pColor[i], (int) (220 * a)));
                canvas.drawCircle(pX[i], pY[i], pSize[i], add);
            }
        }
    }

    private void drawRings(Canvas canvas) {
        for (int i = 0; i < rCount; i++) {
            float k = 1 - rLife[i] / rMax[i];
            float e = 1 - (1 - k) * (1 - k);
            float r = rMaxR[i] * (0.12f + 0.88f * e);
            addStroke.setColor(withAlpha(rColor[i], (int) (220 * (1 - k))));
            addStroke.setStrokeWidth(Math.max(0.5f, rW[i] * (1 - k)));
            canvas.drawCircle(rX[i], rY[i], r, addStroke);
        }
    }

    private void drawFloats(Canvas canvas) {
        int c = lighten(currentColor(), 0.55f);
        for (int i = 0; i < fCount; i++) {
            float age = fMax[i] - fLife[i];
            float pop = age < 0.08f ? 0.6f + age / 0.08f * 0.6f : age < 0.18f ? 1.2f - (age - 0.08f) / 0.1f * 0.2f : 1f;
            float a = Math.min(1, fLife[i] / (fMax[i] * 0.45f));
            boolean crit = fCrit[i];
            floatText.setTextSize((crit ? 30 : 21) * sp * pop);
            floatText.setShadowLayer(10 * dp, 0, 0, withAlpha(crit ? 0xFFFF8A00 : currentColor(), (int) (200 * a)));
            floatText.setColor(withAlpha(crit ? GOLD : c, (int) (255 * a)));
            canvas.drawText(fText[i], fX[i], fY[i], floatText);
        }
        floatText.clearShadowLayer();
    }

    private void drawVignette(Canvas canvas, int w, int h) {
        if (vignette == null || vignetteH != h) {
            vignette = new RadialGradient(w / 2f, h * 0.42f, Math.max(w, h) * 0.72f,
                    new int[]{0x00000000, 0x00000000, 0xFFFF1E3C}, new float[]{0, 0.55f, 1}, Shader.TileMode.CLAMP);
            vignetteH = h;
        }
        float a = game.raging() ? 0.38f + 0.12f * (float) Math.sin(time * 9) : 0;
        a = Math.max(a, rageFlashT * 0.8f);
        shade(fill, vignette);
        fill.setAlpha((int) (255 * a));
        canvas.drawRect(0, 0, w, h, fill);
        fill.setShader(null);
        fill.setAlpha(255);
    }

    private void drawHud(Canvas canvas, int w) {
        float top = topInset + 10 * dp;
        float pad = 16 * dp;
        int f = game.form;
        int c = currentColor();
        boolean compact = getHeight() / dp < 700;

        // Form chip.
        text.setTypeface(bold);
        text.setTextSize(11.5f * sp);
        text.setLetterSpacing(0.08f);
        text.setTextAlign(Paint.Align.LEFT);
        String chip = "FORM " + (f + 1) + "  ·  " + GameState.FORM_NAMES[f].toUpperCase();
        float chipW = text.measureText(chip) + 30 * dp;
        rect.set(pad, top, pad + chipW, top + 30 * dp);
        fill.setShader(null);
        fill.setColor(withAlpha(c, 34));
        canvas.drawRoundRect(rect, 15 * dp, 15 * dp, fill);
        stroke.setColor(withAlpha(c, 140));
        stroke.setStrokeWidth(1 * dp);
        canvas.drawRoundRect(rect, 15 * dp, 15 * dp, stroke);
        fill.setColor(c);
        canvas.drawCircle(pad + 13 * dp, top + 15 * dp, 3.2f * dp, fill);
        text.setColor(0xFFF2F5FF);
        canvas.drawText(chip, pad + 22 * dp, top + 19.5f * dp, text);

        // Settings gear.
        float gx = w - pad - 17 * dp, gy = top + 15 * dp;
        gearRect.set(gx - 26 * dp, gy - 26 * dp, gx + 26 * dp, gy + 26 * dp);
        fill.setColor(0x1AFFFFFF);
        canvas.drawCircle(gx, gy, 17 * dp, fill);
        stroke.setColor(0xFFC9D2EE);
        stroke.setStrokeWidth(1.8f * dp);
        canvas.drawCircle(gx, gy, 4.2f * dp, stroke);
        stroke.setStrokeWidth(2.6f * dp);
        for (int i = 0; i < 8; i++) {
            double a = Math.PI / 4 * i;
            float ca = (float) Math.cos(a), sa = (float) Math.sin(a);
            canvas.drawLine(gx + ca * 6.6f * dp, gy + sa * 6.6f * dp, gx + ca * 8.6f * dp, gy + sa * 8.6f * dp, stroke);
        }

        // Power label and number.
        float y = top + 30 * dp;
        if (!compact) {
            text.setTextAlign(Paint.Align.CENTER);
            text.setTypeface(bold);
            text.setTextSize(11 * sp);
            text.setLetterSpacing(0.32f);
            text.setColor(0xFF8C97B8);
            canvas.drawText("POWER", w / 2f, y + 26 * dp, text);
            y += 26 * dp;
        }
        String num = Fmt.num(shownPower);
        float size = (compact ? 44 : 54) * sp;
        bigText.setTextSize(size);
        float maxW = w - 2 * pad;
        float tw = bigText.measureText(num);
        if (tw > maxW) bigText.setTextSize(size * maxW / tw);
        bigText.setShadowLayer(18 * dp, 0, 0, withAlpha(c, 200));
        bigText.setColor(0xFFFFFFFF);
        float numBase = y + (compact ? 54 : 60) * dp;
        canvas.drawText(num, w / 2f, numBase, bigText);
        bigText.clearShadowLayer();

        // Rate pills.
        y = numBase + 14 * dp;
        String p1 = "⚡ " + Fmt.num(game.pps()) + "/s";
        String p2 = "👊 " + Fmt.num(game.tapValue()) + "/tap";
        String p3 = game.shards > 0 ? "💠 +" + Fmt.num(game.shards * GameState.SHARD_BONUS * 100) + "%" : null;
        text.setTypeface(medium);
        text.setTextSize(13 * sp);
        text.setLetterSpacing(0f);
        text.setTextAlign(Paint.Align.LEFT);
        float gap = 8 * dp, ph = 28 * dp, pp = 12 * dp;
        float w1 = text.measureText(p1) + pp * 2, w2 = text.measureText(p2) + pp * 2, w3 = p3 != null ? text.measureText(p3) + pp * 2 : 0;
        float total = w1 + gap + w2 + (p3 != null ? gap + w3 : 0);
        float x = (w - total) / 2;
        x = pill(canvas, x, y, w1, ph, p1, game.raging() ? 0xFFFF7A8A : 0xFFEAF0FF) + gap;
        x = pill(canvas, x, y, w2, ph, p2, game.raging() ? 0xFFFF7A8A : 0xFFEAF0FF) + gap;
        if (p3 != null) pill(canvas, x, y, w3, ph, p3, 0xFF9EE7FF);

        // Progress to next form.
        y += ph + 14 * dp;
        float bx = pad + 8 * dp, bw = w - 2 * bx;
        text.setTypeface(bold);
        text.setTextSize(10.5f * sp);
        text.setLetterSpacing(0.12f);
        text.setColor(0xFF8C97B8);
        boolean maxForm = f + 1 >= GameState.FORM_NAMES.length;
        double prog = game.nextFormProgress();
        canvas.drawText(maxForm ? "MAX FORM REACHED" : "NEXT  ·  " + GameState.FORM_NAMES[f + 1].toUpperCase(), bx, y, text);
        text.setTextAlign(Paint.Align.RIGHT);
        text.setColor(c);
        canvas.drawText(maxForm ? "∞" : (int) (prog * 100) + "%", bx + bw, y, text);
        y += 7 * dp;
        rect.set(bx, y, bx + bw, y + 6 * dp);
        fill.setColor(0x1FFFFFFF);
        canvas.drawRoundRect(rect, 3 * dp, 3 * dp, fill);
        float fw = Math.max(6 * dp, (float) (bw * prog));
        rect.set(bx, y, bx + fw, y + 6 * dp);
        int next = maxForm ? c : formColor(f + 1);
        shade(fill, new LinearGradient(bx, 0, bx + fw, 0, c, next, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(rect, 3 * dp, 3 * dp, fill);
        fill.setShader(null);
        add.setColor(withAlpha(next, 120));
        canvas.drawCircle(bx + fw - 3 * dp, y + 3 * dp, 6 * dp, add);
    }

    private float pill(Canvas canvas, float x, float y, float w, float h, String label, int color) {
        rect.set(x, y, x + w, y + h);
        fill.setShader(null);
        fill.setColor(0x14FFFFFF);
        canvas.drawRoundRect(rect, h / 2, h / 2, fill);
        stroke.setColor(0x1FFFFFFF);
        stroke.setStrokeWidth(1 * dp);
        canvas.drawRoundRect(rect, h / 2, h / 2, stroke);
        text.setColor(color);
        canvas.drawText(label, x + 12 * dp, y + h / 2 + 4.6f * dp, text);
        return x + w;
    }

    private void drawCombo(Canvas canvas, int w) {
        if (game.combo < 3) return;
        float k = Math.min(1, game.combo / (float) GameState.COMBO_CAP);
        int col = k < 0.5f ? mix(0xFFFFFFFF, 0xFFFFB13D, k * 2) : mix(0xFFFFB13D, 0xFFFF3D5A, (k - 0.5f) * 2);
        float right = w - 18 * dp;
        float y = hudBottom + 34 * dp;
        float s = 1 + comboPulse * 0.18f;
        canvas.save();
        canvas.scale(s, s, right - 30 * dp, y - 12 * dp);
        bigText.setTextAlign(Paint.Align.RIGHT);
        bigText.setTextSize(30 * sp);
        bigText.setTextSkewX(-0.18f);
        bigText.setShadowLayer(12 * dp, 0, 0, withAlpha(col, 180));
        bigText.setColor(col);
        canvas.drawText("×" + game.combo, right, y, bigText);
        bigText.clearShadowLayer();
        bigText.setTextSkewX(0);
        bigText.setTextAlign(Paint.Align.CENTER);
        canvas.restore();
        text.setTypeface(bold);
        text.setTextAlign(Paint.Align.RIGHT);
        text.setTextSize(10 * sp);
        text.setLetterSpacing(0.16f);
        text.setColor(0xFFB8C2E0);
        canvas.drawText("COMBO " + Fmt.mult(Math.floor(game.comboMult() * 100) / 100), right, y + 15 * dp, text);
        float bw = 74 * dp;
        rect.set(right - bw, y + 21 * dp, right, y + 24 * dp);
        fill.setShader(null);
        fill.setColor(0x22FFFFFF);
        canvas.drawRoundRect(rect, 2 * dp, 2 * dp, fill);
        rect.set(right - bw * (game.comboTimer / GameState.COMBO_WINDOW), y + 21 * dp, right, y + 24 * dp);
        fill.setColor(col);
        canvas.drawRoundRect(rect, 2 * dp, 2 * dp, fill);
    }

    private void drawRageBar(Canvas canvas, int w) {
        float bottom = panelTop > 0 ? panelTop : getHeight();
        float x0 = 20 * dp, x1 = w - 20 * dp;
        rageRect.setEmpty();
        text.setTypeface(bold);
        text.setLetterSpacing(0.14f);
        if (game.rageReady()) {
            float pulse = 0.5f + 0.5f * (float) Math.sin(time * 6);
            float h = 46 * dp;
            float y = bottom - 14 * dp - h;
            rect.set(x0, y, x1, y + h);
            rageRect.set(rect);
            rageRect.inset(-6 * dp, -10 * dp);
            add.setShader(null);
            add.setColor(withAlpha(RAGE_RED, (int) (40 + 50 * pulse)));
            RectF glow = new RectF(rect);
            glow.inset(-6 * dp * pulse, -6 * dp * pulse);
            canvas.drawRoundRect(glow, h, h, add);
            shade(fill, new LinearGradient(x0, 0, x1, 0, 0xFFFF2E4D, 0xFFFF9F1C, Shader.TileMode.CLAMP));
            canvas.drawRoundRect(rect, h / 2, h / 2, fill);
            fill.setShader(null);
            text.setTextAlign(Paint.Align.CENTER);
            text.setTextSize(15 * sp);
            text.setColor(0xFFFFFFFF);
            canvas.drawText("😤  UNLEASH RAGE  " + Fmt.mult(game.rageTapMult()), w / 2f, y + h / 2 + 5.5f * dp, text);
            return;
        }
        boolean raging = game.raging();
        float y = bottom - 20 * dp;
        text.setTextSize(10 * sp);
        text.setTextAlign(Paint.Align.LEFT);
        text.setColor(raging ? 0xFFFF7A8A : 0xFF8C97B8);
        canvas.drawText(raging ? "RAGE " + Fmt.mult(game.rageTapMult()) + " ACTIVE" : "RAGE", x0, y - 9 * dp, text);
        text.setTextAlign(Paint.Align.RIGHT);
        canvas.drawText(raging ? String.format(java.util.Locale.US, "%.1fs", game.rageTime) : (int) (game.rage * 100) + "%", x1, y - 9 * dp, text);
        rect.set(x0, y, x1, y + 7 * dp);
        fill.setShader(null);
        fill.setColor(0x1FFFFFFF);
        canvas.drawRoundRect(rect, 3.5f * dp, 3.5f * dp, fill);
        float fw = (x1 - x0) * game.rage;
        if (fw > 1) {
            rect.set(x0, y, x0 + fw, y + 7 * dp);
            shade(fill, new LinearGradient(x0, 0, x0 + Math.max(fw, 1), 0, 0xFFFF2E4D, 0xFFFF9F1C, Shader.TileMode.CLAMP));
            canvas.drawRoundRect(rect, 3.5f * dp, 3.5f * dp, fill);
            fill.setShader(null);
        }
    }

    private void drawBanner(Canvas canvas, int w) {
        if (toastLife > 0 && toastText != null) {
            float a = Math.min(1, toastLife / 0.4f) * Math.min(1, (2.4f - toastLife) / 0.15f);
            text.setTypeface(bold);
            text.setTextSize(13 * sp);
            text.setLetterSpacing(0.04f);
            text.setTextAlign(Paint.Align.CENTER);
            float tw = text.measureText(toastText) + 32 * dp;
            float y = hudBottom + 6 * dp;
            rect.set(w / 2f - tw / 2, y, w / 2f + tw / 2, y + 32 * dp);
            fill.setShader(null);
            fill.setColor(withAlpha(0xFF151C33, (int) (235 * a)));
            canvas.drawRoundRect(rect, 16 * dp, 16 * dp, fill);
            stroke.setColor(withAlpha(toastColor, (int) (200 * a)));
            stroke.setStrokeWidth(1.2f * dp);
            canvas.drawRoundRect(rect, 16 * dp, 16 * dp, stroke);
            text.setColor(withAlpha(0xFFFFFFFF, (int) (255 * a)));
            canvas.drawText(toastText, w / 2f, y + 21 * dp, text);
        }
        if (bannerLife <= 0 || bannerTitle == null) return;
        float age = bannerMax - bannerLife;
        float a = Math.min(1, bannerLife / 0.6f) * Math.min(1, age / 0.12f);
        float pop = age < 0.18f ? 0.5f + age / 0.18f * 0.65f : age < 0.3f ? 1.15f - (age - 0.18f) / 0.12f * 0.15f : 1f;
        float y = charTop + 40 * dp;
        canvas.save();
        canvas.scale(pop, pop, w / 2f, y);
        text.setTypeface(bold);
        text.setTextAlign(Paint.Align.CENTER);
        text.setTextSize(13 * sp);
        text.setLetterSpacing(0.4f);
        text.setColor(withAlpha(0xFFFFFFFF, (int) (230 * a)));
        canvas.drawText(bannerTitle, w / 2f, y - 26 * dp, text);
        bigText.setTextSize(36 * sp);
        float tw = bigText.measureText(bannerText);
        if (tw > w - 32 * dp) bigText.setTextSize(36 * sp * (w - 32 * dp) / tw);
        bigText.setShadowLayer(22 * dp, 0, 0, withAlpha(bannerColor, (int) (255 * a)));
        bigText.setColor(withAlpha(lighten(bannerColor, 0.25f), (int) (255 * a)));
        canvas.drawText(bannerText, w / 2f, y + 12 * dp, bigText);
        bigText.clearShadowLayer();
        canvas.restore();
    }

    // ---------------------------------------------------------------- effect pools

    private void spawn(float x, float y, float vx, float vy, float life, float size, int color, byte kind) {
        if (pCount >= MAXP) return;
        int i = pCount++;
        pX[i] = x;
        pY[i] = y;
        pVX[i] = vx;
        pVY[i] = vy;
        pLife[i] = pMax[i] = life;
        pSize[i] = size;
        pColor[i] = color;
        pKind[i] = kind;
    }

    private void removeParticle(int i) {
        int last = --pCount;
        pX[i] = pX[last];
        pY[i] = pY[last];
        pVX[i] = pVX[last];
        pVY[i] = pVY[last];
        pLife[i] = pLife[last];
        pMax[i] = pMax[last];
        pSize[i] = pSize[last];
        pColor[i] = pColor[last];
        pKind[i] = pKind[last];
    }

    private void burst(float x, float y, int count, int color, boolean crit) {
        for (int i = 0; i < count; i++) {
            double a = rng.nextDouble() * Math.PI * 2;
            float speed = rnd(260, crit ? 900 : 620) * dp;
            spawn(x, y, (float) Math.cos(a) * speed, (float) Math.sin(a) * speed, rnd(0.25f, 0.6f),
                    rnd(1.6f, crit ? 4f : 3f) * dp, rng.nextFloat() < 0.35f ? Color.WHITE : color, (byte) 1);
        }
    }

    private void explode(float x, float y, int count, int color) {
        for (int i = 0; i < count; i++) {
            double a = rng.nextDouble() * Math.PI * 2;
            float speed = rnd(300, 1300) * dp;
            spawn(x, y, (float) Math.cos(a) * speed, (float) Math.sin(a) * speed, rnd(0.5f, 1.2f),
                    rnd(2f, 4.5f) * dp, rng.nextFloat() < 0.4f ? Color.WHITE : color, (byte) 1);
        }
    }

    private void ring(float x, float y, float radius, int color, float life, float width) {
        if (rCount >= MAXR) return;
        int i = rCount++;
        rX[i] = x;
        rY[i] = y;
        rMaxR[i] = radius;
        rLife[i] = rMax[i] = life;
        rW[i] = width;
        rColor[i] = color;
    }

    private void removeRing(int i) {
        int last = --rCount;
        rX[i] = rX[last];
        rY[i] = rY[last];
        rMaxR[i] = rMaxR[last];
        rLife[i] = rLife[last];
        rMax[i] = rMax[last];
        rW[i] = rW[last];
        rColor[i] = rColor[last];
    }

    private void addFloat(float x, float y, String s, boolean crit) {
        if (fCount >= MAXF) removeFloat(0);
        int i = fCount++;
        fX[i] = x;
        fY[i] = y;
        fText[i] = s;
        fCrit[i] = crit;
        fLife[i] = fMax[i] = crit ? 1.25f : 0.9f;
    }

    private void removeFloat(int i) {
        int last = --fCount;
        fX[i] = fX[last];
        fY[i] = fY[last];
        fText[i] = fText[last];
        fCrit[i] = fCrit[last];
        fLife[i] = fLife[last];
        fMax[i] = fMax[last];
        fText[last] = null;
    }

    // ---------------------------------------------------------------- colors & math

    int currentColor() {
        int c = formColor(game.form);
        return game.raging() ? mix(c, RAGE_RED, 0.65f) : c;
    }

    private int currentColor2() {
        int f = game.form;
        int c = f >= 10 ? formColorShift(f, 120) : FORM_COLOR2[f];
        return game.raging() ? mix(c, 0xFFB3001B, 0.65f) : c;
    }

    int formColor(int f) {
        if (f >= 10) return formColorShift(f, 0);
        return FORM_COLOR[f];
    }

    private int formColorShift(int f, float offset) {
        float hue = (time * (f == 11 ? 90 : 50) + offset) % 360;
        return Color.HSVToColor(new float[]{hue, f == 11 ? 0.45f : 0.7f, 1f});
    }

    /** Sets a shader on a shared paint; resets its color first so a leftover alpha doesn't dim the gradient. */
    private static void shade(Paint p, Shader s) {
        p.setColor(0xFF000000);
        p.setShader(s);
    }

    static int withAlpha(int color, int alpha) {
        return (Math.max(0, Math.min(255, alpha)) << 24) | (color & 0x00FFFFFF);
    }

    static int mix(int a, int b, float t) {
        t = Math.max(0, Math.min(1, t));
        int ar = (a >> 16) & 0xFF, ag = (a >> 8) & 0xFF, ab = a & 0xFF;
        int br = (b >> 16) & 0xFF, bg = (b >> 8) & 0xFF, bb = b & 0xFF;
        return 0xFF000000 | ((int) (ar + (br - ar) * t) << 16) | ((int) (ag + (bg - ag) * t) << 8) | (int) (ab + (bb - ab) * t);
    }

    static int lighten(int c, float t) {
        return mix(c, 0xFFFFFFFF, t);
    }

    private static float lerp(float a, float b, float t) {
        return a + (b - a) * t;
    }

    private float rnd(float a, float b) {
        return a + rng.nextFloat() * (b - a);
    }
}
