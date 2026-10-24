package com.skyrocket.powersim;

import android.app.Activity;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity implements GameView.Host {

    private static final int BG_CARD = 0xFF151C33;
    private static final int BG_CARD_STROKE = 0xFF222B4A;
    private static final int TEXT = 0xFFF2F5FF;
    private static final int TEXT_2 = 0xFF8C97B8;
    private static final int TEXT_3 = 0xFF5F6A8E;
    private static final int PURPLE = 0xFFB06BFF;
    private static final int[] TRAINING_ACCENTS = {
            0xFF3DFFA2, 0xFF4DD8FF, 0xFFB06BFF, 0xFFFFD54A, 0xFFFF8A3D, 0xFFFFE14D, 0xFF6F8BFF, 0xFFFF5CE1
    };
    private static final String[] BUY_LABELS = {"×1", "×10", "×100", "MAX"};
    private static final int[] BUY_AMOUNTS = {1, 10, 100, -1};

    private final GameState game = new GameState();
    private SaveManager save;
    private Sfx sfx;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private FrameLayout root;
    private GameView gameView;
    private LinearLayout panel;
    private LinearLayout list;
    private ScrollView scroll;
    private final TextView[] tabs = new TextView[3];
    private TextView buyChip;
    private int tab;
    private int buyMode;
    private final List<UpgradeCard> strengthCards = new ArrayList<>();
    private final List<UpgradeCard> trainingCards = new ArrayList<>();
    private LinearLayout ascendPage;
    private TextView ascShards, ascGain, ascButton;
    private MiniBar ascBar;
    private final TextView[] statValues = new TextView[7];
    private FrameLayout dialog;
    private int bottomInset;
    private long awaySince;
    private long lastAutosave;
    private boolean resumed;

    private Typeface black, bold, medium;

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        black = Typeface.create("sans-serif-black", Typeface.NORMAL);
        bold = Typeface.create("sans-serif", Typeface.BOLD);
        medium = Typeface.create("sans-serif-medium", Typeface.NORMAL);
        setupWindow();

        save = new SaveManager(this);
        save.load(game);
        awaySince = save.savedAt();
        sfx = new Sfx(this);
        sfx.enabled = save.getFlag("sound", true);

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF070A14);
        gameView = new GameView(this);
        gameView.bind(game, sfx, this);
        gameView.haptics = save.getFlag("haptics", true);
        root.addView(gameView, new FrameLayout.LayoutParams(-1, -1));
        buildPanel();
        setContentView(root);

        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int[] tb = systemBarInsets(insets);
                gameView.setTopInset(tb[0]);
                bottomInset = tb[1];
                panel.setPadding(dp(14), dp(10), dp(14), bottomInset + dp(6));
                return insets;
            }
        });
        root.requestApplyInsets();
        if (game.lifetimePower <= 0 && game.taps == 0) {
            gameView.toast("Tap anywhere to power up!", 0xFF4DD8FF);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        gameView.setRunning(true);
        handler.removeCallbacks(refresher);
        handler.post(refresher);
        checkOffline();
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        gameView.setRunning(false);
        handler.removeCallbacks(refresher);
        save.save(game);
        awaySince = System.currentTimeMillis();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        handler.removeCallbacksAndMessages(null);
        sfx.release();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (dialog != null) {
            closeDialog();
            return;
        }
        super.onBackPressed();
    }

    @SuppressWarnings("deprecation")
    private void setupWindow() {
        Window win = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            Api30.edgeToEdge(win);
        } else {
            win.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        win.setStatusBarColor(Color.TRANSPARENT);
        win.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) win.setNavigationBarContrastEnforced(false);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = win.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            win.setAttributes(lp);
        }
    }

    @SuppressWarnings("deprecation")
    private static int[] systemBarInsets(WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= 30) return Api30.bars(insets);
        return new int[]{insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetBottom()};
    }

    /** API 30+ calls kept out of the main class so older devices never verify them. */
    private static final class Api30 {
        static void edgeToEdge(Window win) {
            win.setDecorFitsSystemWindows(false);
        }

        static int[] bars(WindowInsets insets) {
            android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            return new int[]{i.top, i.bottom};
        }
    }

    private final Runnable refresher = new Runnable() {
        @Override
        public void run() {
            if (!resumed) return;
            refreshPanel();
            long now = System.currentTimeMillis();
            if (now - lastAutosave > 15000) {
                lastAutosave = now;
                save.save(game);
            }
            handler.postDelayed(this, 120);
        }
    };

    private void checkOffline() {
        long since = awaySince;
        awaySince = 0;
        if (since <= 0) return;
        double seconds = (System.currentTimeMillis() - since) / 1000.0;
        if (seconds < 60) return;
        final double gain = game.offlineGain(seconds);
        if (gain < 1) return;
        String away = Fmt.duration(Math.min(seconds, GameState.OFFLINE_CAP_SECONDS));
        String body = "Your character kept training for " + away + " while you were gone"
                + (seconds > GameState.OFFLINE_CAP_SECONDS ? " (max " + Fmt.duration(GameState.OFFLINE_CAP_SECONDS) + ")." : ".");
        showDialog("WELCOME BACK", body, "+" + Fmt.num(gain) + " POWER", GameView.GOLD,
                "COLLECT", 0xFFFFD54A, 0xFFFF9F1C, null, false, new Runnable() {
                    @Override
                    public void run() {
                        game.add(gain);
                        sfx.play(Sfx.BUY, 0.9f, 1.2f);
                        gameView.toast("+" + Fmt.num(gain) + " power collected", GameView.GOLD);
                    }
                }, null);
    }

    // ------------------------------------------------------------------ GameView.Host

    @Override
    public void onSettingsRequested() {
        sfx.play(Sfx.CLICK, 0.7f, 1f);
        showSettings();
    }

    @Override
    public void onFormUp(int form) {
        save.save(game);
        refreshPanel();
    }

    @Override
    public void onRageStarted() {
        sfx.play(Sfx.RAGE, 1f, 1f);
    }

    // ------------------------------------------------------------------ panel

    private void buildPanel() {
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0xFF121A33, 0xFF0A0F1F});
        float r = dp(26);
        bg.setCornerRadii(new float[]{r, r, r, r, 0, 0, 0, 0});
        bg.setStroke(dp(1), 0xFF222C4E);
        panel.setBackground(bg);
        panel.setElevation(dp(16));
        panel.setPadding(dp(14), dp(10), dp(14), dp(6));
        panel.setClickable(true);

        View handle = new View(this);
        handle.setBackground(rounded(0xFF2A3456, dp(2)));
        LinearLayout.LayoutParams hlp = new LinearLayout.LayoutParams(dp(38), dp(4));
        hlp.gravity = Gravity.CENTER_HORIZONTAL;
        hlp.bottomMargin = dp(10);
        panel.addView(handle, hlp);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout seg = new LinearLayout(this);
        seg.setOrientation(LinearLayout.HORIZONTAL);
        seg.setBackground(rounded(0xFF0A0F1F, dp(14)));
        seg.setPadding(dp(4), dp(4), dp(4), dp(4));
        String[] names = {"STRENGTH", "TRAINING", "ASCEND"};
        for (int i = 0; i < 3; i++) {
            final int idx = i;
            TextView t = label(names[i], 11.5f, bold, TEXT_2);
            t.setLetterSpacing(0.06f);
            t.setGravity(Gravity.CENTER);
            t.setSingleLine(true);
            t.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (tab != idx) {
                        sfx.play(Sfx.CLICK, 0.6f, 1f);
                        selectTab(idx);
                    }
                }
            });
            tabs[i] = t;
            seg.addView(t, new LinearLayout.LayoutParams(0, dp(36), 1));
        }
        header.addView(seg, new LinearLayout.LayoutParams(0, -2, 1));
        buyChip = label(BUY_LABELS[0], 13, black, GameView.GOLD);
        buyChip.setGravity(Gravity.CENTER);
        buyChip.setBackground(roundedStroke(0xFF1A2242, dp(14), 0xFF2D3866));
        buyChip.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                buyMode = (buyMode + 1) % BUY_LABELS.length;
                buyChip.setText(BUY_LABELS[buyMode]);
                sfx.play(Sfx.CLICK, 0.6f, 1.1f);
                pop(buyChip);
                refreshPanel();
            }
        });
        LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(dp(60), dp(44));
        clp.leftMargin = dp(8);
        header.addView(buyChip, clp);
        panel.addView(header, new LinearLayout.LayoutParams(-1, -2));

        scroll = new ScrollView(this);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        scroll.setFadingEdgeLength(dp(18));
        scroll.setVerticalFadingEdgeEnabled(true);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(0, dp(10), 0, dp(6));
        scroll.addView(list, new FrameLayout.LayoutParams(-1, -2));
        panel.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        for (int i = 0; i < game.strength.length; i++) strengthCards.add(new UpgradeCard(game.strength[i], strengthAccent(game.strength[i])));
        for (int i = 0; i < game.training.length; i++) trainingCards.add(new UpgradeCard(game.training[i], TRAINING_ACCENTS[i % TRAINING_ACCENTS.length]));
        buildAscendPage();

        final FrameLayout.LayoutParams plp = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        root.addView(panel, plp);
        root.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(View v, int l, int t, int r, int b, int ol, int ot, int or, int ob) {
                int h = b - t;
                int want = (int) Math.max(dp(230), Math.min(dp(420), h * 0.40f)) + bottomInset;
                if (plp.height != want) {
                    plp.height = want;
                    panel.setLayoutParams(plp);
                }
            }
        });
        panel.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(View v, int l, int t, int r, int b, int ol, int ot, int or, int ob) {
                gameView.setPanelTop(t);
            }
        });
        selectTab(0);
    }

    private static int strengthAccent(GameState.Upgrade u) {
        switch (u.kind) {
            case GameState.K_CRIT:
                return 0xFFFF4D5E;
            case GameState.K_CRIT_DMG:
                return 0xFFFF5CE1;
            case GameState.K_COMBO:
                return 0xFFFFB13D;
            case GameState.K_RAGE:
                return 0xFFFF2E4D;
            case GameState.K_SYNERGY:
                return 0xFFB06BFF;
            default:
                return 0xFF4DD8FF;
        }
    }

    private void selectTab(int idx) {
        tab = idx;
        for (int i = 0; i < 3; i++) {
            boolean on = i == idx;
            tabs[i].setBackground(on ? roundedStroke(0xFF222D55, dp(11), 0xFF34407A) : null);
        }
        list.removeAllViews();
        if (idx == 2) {
            list.addView(ascendPage);
        } else {
            List<UpgradeCard> cards = idx == 0 ? strengthCards : trainingCards;
            for (UpgradeCard c : cards) list.addView(c.view);
        }
        buyChip.setVisibility(idx == 2 ? View.INVISIBLE : View.VISIBLE);
        scroll.scrollTo(0, 0);
        refreshPanel();
    }

    private void refreshPanel() {
        boolean canAscend = game.shardsOnAscend() > 0;
        for (int i = 0; i < 3; i++) {
            int color = i == tab ? TEXT : TEXT_2;
            if (i == 2 && canAscend) color = PURPLE;
            setTextColor(tabs[i], color);
        }
        setText(tabs[2], canAscend ? "ASCEND ✦" : "ASCEND");
        if (tab == 2) {
            refreshAscend();
            return;
        }
        List<UpgradeCard> cards = tab == 0 ? strengthCards : trainingCards;
        boolean teaserShown = false;
        for (UpgradeCard c : cards) {
            if (game.revealed(c.u)) {
                c.bind(false);
                c.view.setVisibility(View.VISIBLE);
            } else if (!teaserShown) {
                teaserShown = true;
                c.bind(true);
                c.view.setVisibility(View.VISIBLE);
            } else {
                c.view.setVisibility(View.GONE);
            }
        }
    }

    private int buyCount(GameState.Upgrade u) {
        int amount = BUY_AMOUNTS[buyMode];
        if (amount < 0) return Math.max(1, u.maxAffordable(game.power));
        return Math.max(1, u.clampBuy(amount));
    }

    private boolean buy(UpgradeCard card) {
        GameState.Upgrade u = card.u;
        if (u.maxed() || !game.revealed(u)) return false;
        int n = buyCount(u);
        int before = u.level;
        int got = game.buy(u, n);
        if (got <= 0) {
            card.shake();
            return false;
        }
        sfx.play(Sfx.BUY, 0.7f, 1f + Math.min(0.5f, (u.level % 25) / 50f));
        if (gameView.haptics) card.view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
        if (GameState.prevMilestone(u.level) > GameState.prevMilestone(before)) {
            gameView.toast(u.icon + "  " + u.name + " output ×2!", card.accent);
            sfx.play(Sfx.FORM, 0.5f, 1.5f);
        } else if (u.maxed()) {
            gameView.toast(u.icon + "  " + u.name + " maxed out!", card.accent);
        }
        card.bump();
        refreshPanel();
        return true;
    }

    private String describe(GameState.Upgrade u) {
        switch (u.kind) {
            case GameState.K_TAP:
                return "+" + Fmt.num(game.perLevel(u)) + " power per tap";
            case GameState.K_GEN:
                if (u.level == 0) return "+" + Fmt.num(game.perLevel(u)) + " power per second";
                return "+" + Fmt.num(game.perLevel(u)) + "/s each  ·  " + Fmt.num(game.genOutput(u)) + "/s total";
            case GameState.K_CRIT: {
                String cur = Fmt.pct(game.critChance());
                if (u.maxed()) return "Crit chance " + cur + " (max)  ·  crits hit " + Fmt.mult(game.critMult());
                u.level++;
                String next = Fmt.pct(game.critChance());
                u.level--;
                return "Crit chance " + cur + " → " + next;
            }
            case GameState.K_CRIT_DMG: {
                String cur = Fmt.mult(game.critMult());
                if (u.maxed()) return "Crits hit " + cur + " (max)";
                u.level++;
                String next = Fmt.mult(game.critMult());
                u.level--;
                return "Crits hit " + cur + " → " + next;
            }
            case GameState.K_COMBO: {
                String cur = Fmt.pct(game.comboMaxBonus());
                if (u.maxed()) return "Full combo bonus +" + cur + " (max)";
                u.level++;
                String next = Fmt.pct(game.comboMaxBonus());
                u.level--;
                return "Full combo bonus +" + cur + " → +" + next;
            }
            case GameState.K_RAGE: {
                String cur = Fmt.mult(game.rageTapMult()) + " for " + (int) game.rageSeconds() + "s";
                if (u.maxed()) return "Rage " + cur + " (max)";
                u.level++;
                String next = Fmt.mult(game.rageTapMult()) + " for " + (int) game.rageSeconds() + "s";
                u.level--;
                return "Rage " + cur + " → " + next;
            }
            case GameState.K_SYNERGY: {
                String cur = Fmt.pct(game.synergyPct());
                if (u.maxed()) return "Taps also gain " + cur + " of power/s (max)";
                u.level++;
                String next = Fmt.pct(game.synergyPct());
                u.level--;
                return "Taps also gain " + cur + " → " + next + " of power/s";
            }
            default:
                return "";
        }
    }

    private final class UpgradeCard {
        final GameState.Upgrade u;
        final int accent;
        final LinearLayout view;
        final TextView icon, name, level, desc, milestone, buyTop, buyCost;
        final LinearLayout buyBtn;
        final MiniBar bar;
        final GradientDrawable iconBg;
        int buttonState = -1;
        boolean lockedShown;
        int repeatCount;
        /** Hold-to-buy: keeps buying while pressed, speeding up after a few purchases. */
        final Runnable repeat = new Runnable() {
            @Override
            public void run() {
                repeatCount++;
                if (!buy(UpgradeCard.this)) return;
                handler.postDelayed(this, repeatCount > 8 ? 45 : 90);
            }
        };

        UpgradeCard(GameState.Upgrade upgrade, int accentColor) {
            u = upgrade;
            accent = accentColor;
            view = new LinearLayout(MainActivity.this);
            view.setOrientation(LinearLayout.HORIZONTAL);
            view.setGravity(Gravity.CENTER_VERTICAL);
            view.setBackground(roundedStroke(BG_CARD, dp(18), BG_CARD_STROKE));
            view.setPadding(dp(12), dp(11), dp(12), dp(11));
            view.setMinimumHeight(dp(78));
            LinearLayout.LayoutParams vlp = new LinearLayout.LayoutParams(-1, -2);
            vlp.bottomMargin = dp(9);
            view.setLayoutParams(vlp);

            icon = label(u.icon, 24, medium, TEXT);
            icon.setGravity(Gravity.CENTER);
            iconBg = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                    new int[]{GameView.withAlpha(accent, 0x55), GameView.withAlpha(accent, 0x18)});
            iconBg.setCornerRadius(dp(15));
            iconBg.setStroke(dp(1), GameView.withAlpha(accent, 0x66));
            icon.setBackground(iconBg);
            view.addView(icon, new LinearLayout.LayoutParams(dp(50), dp(50)));

            LinearLayout mid = new LinearLayout(MainActivity.this);
            mid.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams mlp = new LinearLayout.LayoutParams(0, -2, 1);
            mlp.leftMargin = dp(12);
            mlp.rightMargin = dp(10);
            view.addView(mid, mlp);

            LinearLayout row = new LinearLayout(MainActivity.this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            name = label(u.name, 15, bold, TEXT);
            name.setSingleLine(true);
            name.setEllipsize(TextUtils.TruncateAt.END);
            row.addView(name, new LinearLayout.LayoutParams(-2, -2, 0));
            level = label("", 10.5f, bold, accent);
            level.setBackground(rounded(GameView.withAlpha(accent, 0x22), dp(7)));
            level.setPadding(dp(6), dp(1), dp(6), dp(1));
            LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(-2, -2);
            llp.leftMargin = dp(7);
            row.addView(level, llp);
            mid.addView(row);

            desc = label("", 12.5f, medium, TEXT_2);
            desc.setMaxLines(2);
            LinearLayout.LayoutParams dlp = new LinearLayout.LayoutParams(-1, -2);
            dlp.topMargin = dp(2);
            mid.addView(desc, dlp);

            milestone = label("", 10.5f, bold, TEXT_3);
            milestone.setLetterSpacing(0.04f);
            LinearLayout.LayoutParams mslp = new LinearLayout.LayoutParams(-1, -2);
            mslp.topMargin = dp(5);
            mid.addView(milestone, mslp);
            bar = new MiniBar(MainActivity.this, accent);
            LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(-1, dp(4));
            blp.topMargin = dp(3);
            mid.addView(bar, blp);

            buyBtn = new LinearLayout(MainActivity.this);
            buyBtn.setOrientation(LinearLayout.VERTICAL);
            buyBtn.setGravity(Gravity.CENTER);
            buyTop = label("BUY", 9.5f, bold, 0xFF241500);
            buyTop.setLetterSpacing(0.12f);
            buyTop.setGravity(Gravity.CENTER);
            buyCost = label("", 14, black, 0xFF241500);
            buyCost.setGravity(Gravity.CENTER);
            buyCost.setSingleLine(true);
            buyBtn.addView(buyTop);
            buyBtn.addView(buyCost);
            view.addView(buyBtn, new LinearLayout.LayoutParams(dp(98), dp(54)));
            buyBtn.setOnTouchListener(new View.OnTouchListener() {
                @Override
                public boolean onTouch(View v, MotionEvent e) {
                    switch (e.getActionMasked()) {
                        case MotionEvent.ACTION_DOWN:
                            // Buy on release (or after a hold) so a scroll that starts here never buys.
                            v.animate().scaleX(0.94f).scaleY(0.94f).setDuration(70).start();
                            repeatCount = 0;
                            handler.removeCallbacks(repeat);
                            handler.postDelayed(repeat, 350);
                            return true;
                        case MotionEvent.ACTION_UP:
                        case MotionEvent.ACTION_CANCEL:
                            v.animate().scaleX(1f).scaleY(1f).setDuration(120).start();
                            handler.removeCallbacks(repeat);
                            if (e.getActionMasked() == MotionEvent.ACTION_UP) {
                                if (repeatCount == 0) buy(UpgradeCard.this);
                                v.performClick();
                            }
                            return true;
                        default:
                            return true;
                    }
                }
            });
        }

        void bind(boolean locked) {
            if (locked) {
                if (!lockedShown) {
                    lockedShown = true;
                    buttonState = -1;
                    view.setAlpha(0.55f);
                    icon.setText("🔒");
                    setText(name, "Locked");
                    level.setVisibility(View.GONE);
                    milestone.setVisibility(View.GONE);
                    bar.setVisibility(View.GONE);
                    buyBtn.setVisibility(View.INVISIBLE);
                }
                setText(desc, "Reach " + Fmt.num(u.revealAt) + " total power to reveal");
                return;
            }
            if (lockedShown) {
                lockedShown = false;
                view.setAlpha(1f);
                icon.setText(u.icon);
                setText(name, u.name);
                level.setVisibility(View.VISIBLE);
                buyBtn.setVisibility(View.VISIBLE);
            }
            setText(level, u.maxLevel > 0 ? "Lv " + u.level + "/" + u.maxLevel : "Lv " + u.level);
            setText(desc, describe(u));
            boolean hasMilestones = u.kind == GameState.K_TAP || u.kind == GameState.K_GEN;
            milestone.setVisibility(hasMilestones ? View.VISIBLE : View.GONE);
            bar.setVisibility(hasMilestones ? View.VISIBLE : View.GONE);
            if (hasMilestones) {
                int next = GameState.nextMilestone(u.level), prev = GameState.prevMilestone(u.level);
                setText(milestone, "OUTPUT ×2 AT LV " + next);
                bar.setProgress((u.level - prev) / (float) (next - prev));
            }

            int state;
            if (u.maxed()) {
                state = 2;
                setText(buyTop, "");
                setText(buyCost, "MAXED");
            } else {
                int n = buyCount(u);
                double cost = u.costOf(n);
                state = cost <= game.power ? 1 : 0;
                setText(buyTop, "BUY ×" + n);
                setText(buyCost, Fmt.num(cost));
            }
            if (state != buttonState) {
                buttonState = state;
                if (state == 1) {
                    GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{0xFFFFD54A, 0xFFFF9F1C});
                    g.setCornerRadius(dp(15));
                    buyBtn.setBackground(g);
                    buyTop.setTextColor(0xCC241500);
                    buyCost.setTextColor(0xFF241500);
                } else {
                    buyBtn.setBackground(roundedStroke(0xFF1B2340, dp(15), 0xFF263056));
                    buyTop.setTextColor(TEXT_3);
                    buyCost.setTextColor(state == 2 ? 0xFF3DFFA2 : 0xFF6E79A0);
                }
                buyTop.setVisibility(state == 2 ? View.GONE : View.VISIBLE);
            }
        }

        void bump() {
            icon.animate().cancel();
            icon.setScaleX(1.18f);
            icon.setScaleY(1.18f);
            icon.animate().scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(new OvershootInterpolator(3f)).start();
        }

        void shake() {
            buyBtn.animate().cancel();
            buyBtn.setTranslationX(dp(5));
            buyBtn.animate().translationX(0).setDuration(240).setInterpolator(new OvershootInterpolator(6f)).start();
        }
    }

    /** Thin rounded progress bar. */
    static final class MiniBar extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF r = new RectF();
        private final int color;
        private float progress;

        MiniBar(Context c, int color) {
            super(c);
            this.color = color;
        }

        void setProgress(float p) {
            p = Math.max(0, Math.min(1, p));
            if (Math.abs(p - progress) > 0.001f) {
                progress = p;
                invalidate();
            }
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float h = getHeight(), w = getWidth();
            r.set(0, 0, w, h);
            paint.setColor(0x1CFFFFFF);
            canvas.drawRoundRect(r, h / 2, h / 2, paint);
            if (progress <= 0) return;
            r.set(0, 0, Math.max(h, w * progress), h);
            paint.setColor(color);
            canvas.drawRoundRect(r, h / 2, h / 2, paint);
        }
    }

    // ------------------------------------------------------------------ ascend page

    private void buildAscendPage() {
        ascendPage = new LinearLayout(this);
        ascendPage.setOrientation(LinearLayout.VERTICAL);

        LinearLayout hero = card();
        GradientDrawable heroBg = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{0xFF2A1B52, 0xFF151C33});
        heroBg.setCornerRadius(dp(20));
        heroBg.setStroke(dp(1), 0xFF4A2F8A);
        hero.setBackground(heroBg);
        hero.setPadding(dp(18), dp(16), dp(18), dp(18));
        TextView title = label("💠  ASCENSION", 19, black, TEXT);
        title.setLetterSpacing(0.04f);
        hero.addView(title);
        TextView body = label("Reset your power, upgrades and form to earn Shards. Every shard permanently boosts ALL power by +"
                + (int) (GameState.SHARD_BONUS * 100) + "%. The more power you build, the more shards you get.", 13, medium, 0xFFB8C2E0);
        body.setLineSpacing(0, 1.15f);
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(-1, -2);
        bl.topMargin = dp(6);
        hero.addView(body, bl);
        ascShards = label("", 15, bold, 0xFF9EE7FF);
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(-1, -2);
        sl.topMargin = dp(14);
        hero.addView(ascShards, sl);
        ascGain = label("", 13, medium, TEXT_2);
        LinearLayout.LayoutParams gl = new LinearLayout.LayoutParams(-1, -2);
        gl.topMargin = dp(4);
        hero.addView(ascGain, gl);
        ascBar = new MiniBar(this, PURPLE);
        LinearLayout.LayoutParams abl = new LinearLayout.LayoutParams(-1, dp(6));
        abl.topMargin = dp(10);
        hero.addView(ascBar, abl);
        ascButton = label("ASCEND", 16, black, TEXT);
        ascButton.setLetterSpacing(0.12f);
        ascButton.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams btl = new LinearLayout.LayoutParams(-1, dp(52));
        btl.topMargin = dp(14);
        hero.addView(ascButton, btl);
        ascButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                confirmAscend();
            }
        });
        ascendPage.addView(hero);

        LinearLayout stats = card();
        stats.setPadding(dp(18), dp(14), dp(18), dp(10));
        TextView st = label("STATS", 11, bold, TEXT_2);
        st.setLetterSpacing(0.25f);
        stats.addView(st);
        String[] labels = {"Lifetime power", "Best single run", "Total taps", "Critical hits", "Best combo", "Ascensions", "Time played"};
        for (int i = 0; i < labels.length; i++) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setPadding(0, dp(8), 0, dp(8));
            row.addView(label(labels[i], 13.5f, medium, 0xFFB8C2E0), new LinearLayout.LayoutParams(0, -2, 1));
            statValues[i] = label("", 13.5f, bold, TEXT);
            row.addView(statValues[i]);
            stats.addView(row);
        }
        ascendPage.addView(stats);
    }

    private LinearLayout card() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setBackground(roundedStroke(BG_CARD, dp(20), BG_CARD_STROKE));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.bottomMargin = dp(10);
        c.setLayoutParams(lp);
        return c;
    }

    private int ascButtonState = -1;

    private void refreshAscend() {
        double gain = game.shardsOnAscend();
        setText(ascShards, Fmt.num(game.shards) + " shards  ·  +" + Fmt.num(game.shards * GameState.SHARD_BONUS * 100) + "% all power");
        if (gain > 0) {
            setText(ascGain, "Ascend now for +" + Fmt.num(gain) + " shards (+" + Fmt.num(gain * GameState.SHARD_BONUS * 100) + "% more power)");
            ascBar.setProgress(1);
        } else {
            setText(ascGain, "Reach " + Fmt.num(GameState.ASCEND_MIN) + " total power (Titan form) to unlock. Now: " + Fmt.num(game.totalPower));
            double p = Math.log10(Math.max(1, game.totalPower)) / Math.log10(GameState.ASCEND_MIN);
            ascBar.setProgress((float) p);
        }
        int state = gain > 0 ? 1 : 0;
        if (state != ascButtonState) {
            ascButtonState = state;
            if (state == 1) {
                GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, new int[]{0xFFB06BFF, 0xFF6A3DFF});
                g.setCornerRadius(dp(16));
                ascButton.setBackground(g);
                ascButton.setTextColor(0xFFFFFFFF);
                ascButton.setAlpha(1f);
            } else {
                ascButton.setBackground(roundedStroke(0xFF1B2340, dp(16), 0xFF263056));
                ascButton.setTextColor(TEXT_3);
            }
        }
        setText(ascButton, gain > 0 ? "ASCEND  ·  +" + Fmt.num(gain) + " 💠" : "🔒  LOCKED");
        setText(statValues[0], Fmt.num(game.lifetimePower));
        setText(statValues[1], Fmt.num(game.bestTotal));
        setText(statValues[2], Fmt.num(game.taps));
        setText(statValues[3], Fmt.num(game.crits));
        setText(statValues[4], "×" + game.bestCombo);
        setText(statValues[5], String.valueOf(game.ascensions));
        setText(statValues[6], Fmt.duration(game.playSeconds));
    }

    private void confirmAscend() {
        final double gain = game.shardsOnAscend();
        if (gain <= 0) {
            pop(ascButton);
            return;
        }
        sfx.play(Sfx.CLICK, 0.7f, 1f);
        showDialog("ASCEND?", "Your power, upgrades and form reset to zero. In return you keep your shards forever.",
                "+" + Fmt.num(gain) + " 💠  (+" + Fmt.num(gain * GameState.SHARD_BONUS * 100) + "%)", 0xFF9EE7FF,
                "ASCEND", 0xFFB06BFF, 0xFF6A3DFF, "NOT YET", true, new Runnable() {
                    @Override
                    public void run() {
                        if (!game.ascend()) return;
                        save.save(game);
                        sfx.play(Sfx.ASCEND, 1f, 1f);
                        gameView.celebrate("ASCENDED!", "+" + Fmt.num(gain) + " SHARDS", PURPLE);
                        selectTab(0);
                    }
                }, null);
    }

    // ------------------------------------------------------------------ settings & dialogs

    private void showSettings() {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.addView(toggleRow("🔊  Sound effects", "sound", sfx.enabled));
        content.addView(toggleRow("📳  Haptics", "haptics", gameView.haptics));
        final TextView reset = label("Reset all progress", 14, bold, 0xFFFF5C6E);
        reset.setGravity(Gravity.CENTER);
        reset.setBackground(roundedStroke(0x14FF3D5A, dp(14), 0x55FF3D5A));
        LinearLayout.LayoutParams rl = new LinearLayout.LayoutParams(-1, dp(46));
        rl.topMargin = dp(14);
        content.addView(reset, rl);
        reset.setOnClickListener(new View.OnClickListener() {
            boolean armed;

            @Override
            public void onClick(View v) {
                if (!armed) {
                    armed = true;
                    reset.setText("Tap again to erase everything");
                    pop(reset);
                    return;
                }
                game.resetAll();
                save.save(game);
                closeDialog();
                selectTab(0);
                gameView.toast("Progress reset. Fresh start!", 0xFF4DD8FF);
            }
        });
        TextView ver = label("Power Simulator  ·  v" + versionName(), 11, medium, TEXT_3);
        ver.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams vl = new LinearLayout.LayoutParams(-1, -2);
        vl.topMargin = dp(14);
        content.addView(ver, vl);
        showDialog("SETTINGS", null, null, 0, "DONE", 0xFF2E3A6E, 0xFF222D55, null, true, null, content);
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1.0";
        }
    }

    private View toggleRow(String title, final String key, boolean initial) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(8), 0, dp(8));
        row.addView(label(title, 15, medium, TEXT), new LinearLayout.LayoutParams(0, -2, 1));
        final TextView pill = label("", 12, black, TEXT);
        pill.setGravity(Gravity.CENTER);
        pill.setLetterSpacing(0.1f);
        final boolean[] on = {initial};
        stylePill(pill, on[0]);
        pill.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                on[0] = !on[0];
                save.setFlag(key, on[0]);
                if (key.equals("sound")) sfx.enabled = on[0];
                else gameView.haptics = on[0];
                stylePill(pill, on[0]);
                pop(pill);
                sfx.play(Sfx.CLICK, 0.7f, on[0] ? 1.2f : 0.9f);
            }
        });
        row.addView(pill, new LinearLayout.LayoutParams(dp(64), dp(34)));
        return row;
    }

    private void stylePill(TextView pill, boolean on) {
        pill.setText(on ? "ON" : "OFF");
        if (on) {
            GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, new int[]{0xFF3DFFA2, 0xFF00B87A});
            g.setCornerRadius(dp(17));
            pill.setBackground(g);
            pill.setTextColor(0xFF00241A);
        } else {
            pill.setBackground(roundedStroke(0xFF1B2340, dp(17), 0xFF2D3866));
            pill.setTextColor(TEXT_2);
        }
    }

    private void showDialog(String title, String body, String highlight, int highlightColor,
                            String primary, int primaryC1, int primaryC2, String secondary, boolean cancelable,
                            final Runnable onPrimary, View extra) {
        if (dialog != null) closeDialog();
        final FrameLayout scrim = new FrameLayout(this);
        scrim.setBackgroundColor(0xC0050710);
        scrim.setClickable(true);
        scrim.setElevation(dp(48));
        final boolean canCancel = cancelable;
        scrim.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (canCancel) closeDialog();
            }
        });

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setClickable(true);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0xFF1A2240, 0xFF121831});
        bg.setCornerRadius(dp(26));
        bg.setStroke(dp(1), 0xFF2D3866);
        box.setBackground(bg);
        box.setElevation(dp(24));
        box.setPadding(dp(22), dp(22), dp(22), dp(20));

        TextView t = label(title, 20, black, TEXT);
        t.setGravity(Gravity.CENTER);
        t.setLetterSpacing(0.14f);
        box.addView(t);
        if (body != null) {
            TextView b = label(body, 14, medium, 0xFFB8C2E0);
            b.setGravity(Gravity.CENTER);
            b.setLineSpacing(0, 1.15f);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
            lp.topMargin = dp(10);
            box.addView(b, lp);
        }
        if (highlight != null) {
            TextView h = label(highlight, 28, black, highlightColor);
            h.setGravity(Gravity.CENTER);
            h.setShadowLayer(dp(14), 0, 0, GameView.withAlpha(highlightColor, 160));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
            lp.topMargin = dp(16);
            box.addView(h, lp);
        }
        if (extra != null) {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
            lp.topMargin = dp(12);
            box.addView(extra, lp);
        }
        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(-1, dp(50));
        bl.topMargin = dp(20);
        box.addView(buttons, bl);
        if (secondary != null) {
            TextView s = label(secondary, 14, bold, TEXT_2);
            s.setGravity(Gravity.CENTER);
            s.setLetterSpacing(0.1f);
            s.setBackground(roundedStroke(0xFF1B2340, dp(16), 0xFF2D3866));
            s.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    sfx.play(Sfx.CLICK, 0.6f, 0.9f);
                    closeDialog();
                }
            });
            LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(0, -1, 1);
            slp.rightMargin = dp(10);
            buttons.addView(s, slp);
        }
        TextView p = label(primary, 15, black, primaryC1 == 0xFFFFD54A ? 0xFF241500 : TEXT);
        p.setGravity(Gravity.CENTER);
        p.setLetterSpacing(0.12f);
        GradientDrawable pg = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, new int[]{primaryC1, primaryC2});
        pg.setCornerRadius(dp(16));
        p.setBackground(pg);
        p.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                closeDialog();
                if (onPrimary != null) onPrimary.run();
                else sfx.play(Sfx.CLICK, 0.6f, 1f);
            }
        });
        buttons.addView(p, new LinearLayout.LayoutParams(0, -1, secondary != null ? 1.3f : 1));

        int width = Math.min(getResources().getDisplayMetrics().widthPixels - dp(40), dp(380));
        scrim.addView(box, new FrameLayout.LayoutParams(width, -2, Gravity.CENTER));
        root.addView(scrim, new FrameLayout.LayoutParams(-1, -1));
        dialog = scrim;
        scrim.setAlpha(0);
        scrim.animate().alpha(1).setDuration(180).start();
        box.setScaleX(0.88f);
        box.setScaleY(0.88f);
        box.animate().scaleX(1).scaleY(1).setDuration(320).setInterpolator(new OvershootInterpolator(2f)).start();
    }

    private void closeDialog() {
        final View d = dialog;
        if (d == null) return;
        dialog = null;
        d.setClickable(false);
        d.animate().alpha(0).setDuration(150).withEndAction(new Runnable() {
            @Override
            public void run() {
                root.removeView(d);
            }
        }).start();
    }

    // ------------------------------------------------------------------ view helpers

    private TextView label(String s, float sizeSp, Typeface tf, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        t.setTypeface(tf);
        t.setTextColor(color);
        t.setIncludeFontPadding(false);
        return t;
    }

    private static void setText(TextView t, String s) {
        if (!TextUtils.equals(t.getText(), s)) t.setText(s);
    }

    private static void setTextColor(TextView t, int c) {
        if (t.getCurrentTextColor() != c) t.setTextColor(c);
    }

    private static GradientDrawable rounded(int color, float radius) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(radius);
        return g;
    }

    private GradientDrawable roundedStroke(int color, float radius, int strokeColor) {
        GradientDrawable g = rounded(color, radius);
        g.setStroke(dp(1), strokeColor);
        return g;
    }

    private static void pop(View v) {
        v.animate().cancel();
        v.setScaleX(0.9f);
        v.setScaleY(0.9f);
        v.animate().scaleX(1).scaleY(1).setDuration(260).setInterpolator(new OvershootInterpolator(3f)).start();
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
