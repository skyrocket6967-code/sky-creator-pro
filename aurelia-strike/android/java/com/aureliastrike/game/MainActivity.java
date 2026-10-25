package com.aureliastrike.game;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.hardware.input.InputManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.Display;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Hosts the WebGL game full screen. Adds what a plain WebView lacks: immersive mode, the display's
 * highest refresh rate, controller input in the standard Gamepad layout, haptics and back handling.
 */
public class MainActivity extends Activity implements InputManager.InputDeviceListener {

    private WebView web;
    private Vibrator vibrator;
    private InputManager inputManager;
    private final Handler handler = new Handler(Looper.getMainLooper());

    // Controller state in the W3C "standard" layout (17 buttons, 4 axes), read by the page every frame.
    private final Object padLock = new Object();
    private final float[] axes = new float[4];
    private final float[] buttons = new float[17];
    private int padDevice = -1;
    private String padName = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window win = getWindow();
        win.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = win.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            win.setAttributes(lp);
        }
        requestHighestRefreshRate();
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        inputManager = (InputManager) getSystemService(Context.INPUT_SERVICE);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100); // System font scaling would break the HUD layout.
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        if (Build.VERSION.SDK_INT >= 26) web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
        web.addJavascriptInterface(new Bridge(), "AndroidHost");
        web.setWebViewClient(new GameClient());
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
        web.requestFocus();
        hideSystemBars();
        detectConnectedPad();
    }

    /** Keeps navigation inside the game and recovers if the renderer process dies. */
    private final class GameClient extends WebViewClient {
        @Override
        public void onPageFinished(WebView view, String url) {
            boolean connected;
            synchronized (padLock) {
                connected = padDevice >= 0;
            }
            notifyPage(connected);
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return !url.startsWith("file:///android_asset/");
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (web == view) {
                web = null;
                recreate();
            }
            return true;
        }
    }

    private void requestHighestRefreshRate() {
        try {
            Display display = getWindowManager().getDefaultDisplay();
            Display.Mode current = display.getMode();
            Display.Mode best = current;
            for (Display.Mode m : display.getSupportedModes()) {
                if (m.getPhysicalWidth() == current.getPhysicalWidth() && m.getPhysicalHeight() == current.getPhysicalHeight()
                        && m.getRefreshRate() > best.getRefreshRate()) best = m;
            }
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.preferredDisplayModeId = best.getModeId();
            getWindow().setAttributes(lp);
        } catch (RuntimeException ignored) {
            // Older firmware may not expose display modes; the default rate is fine.
        }
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        Window win = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            Api30.hideBars(win);
        } else {
            win.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    /** API 30+ calls kept separate so older devices never load these classes. */
    private static final class Api30 {
        static void hideBars(Window win) {
            win.setDecorFitsSystemWindows(false);
            WindowInsetsController c = win.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.resumeTimers();
        }
        inputManager.registerInputDeviceListener(this, handler);
        detectConnectedPad();
        hideSystemBars();
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.onAndroidPause&&window.onAndroidPause()", null);
            web.onPause();
            web.pauseTimers();
        }
        inputManager.unregisterInputDeviceListener(this);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("window.onAndroidBack?window.onAndroidBack():false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) moveTaskToBack(true);
            }
        });
    }

    // ------------------------------------------------------------------ controller input

    private static boolean isGamepad(InputDevice d) {
        if (d == null) return false;
        int src = d.getSources();
        return (src & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
                || (src & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    private void detectConnectedPad() {
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice d = InputDevice.getDevice(id);
            if (isGamepad(d) && !d.isVirtual()) {
                usePad(d);
                return;
            }
        }
        clearPad();
    }

    private void usePad(InputDevice d) {
        synchronized (padLock) {
            if (padDevice != d.getId()) {
                padDevice = d.getId();
                padName = d.getName() == null ? "Controller" : d.getName().replace('|', ' ');
                java.util.Arrays.fill(axes, 0);
                java.util.Arrays.fill(buttons, 0);
                notifyPage(true);
            }
        }
    }

    private void clearPad() {
        synchronized (padLock) {
            boolean had = padDevice >= 0;
            padDevice = -1;
            padName = "";
            java.util.Arrays.fill(axes, 0);
            java.util.Arrays.fill(buttons, 0);
            if (had) notifyPage(false);
        }
    }

    /** Tells the page whether to poll the controller bridge, so it skips the call when nothing is attached. */
    private void notifyPage(final boolean connected) {
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript("window.__nativePad=" + (connected ? "1" : "0"), null);
            }
        });
    }

    private static int buttonIndex(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A: return 0;
            case KeyEvent.KEYCODE_BUTTON_B: return 1;
            case KeyEvent.KEYCODE_BUTTON_X: return 2;
            case KeyEvent.KEYCODE_BUTTON_Y: return 3;
            case KeyEvent.KEYCODE_BUTTON_L1: return 4;
            case KeyEvent.KEYCODE_BUTTON_R1: return 5;
            case KeyEvent.KEYCODE_BUTTON_L2: return 6;
            case KeyEvent.KEYCODE_BUTTON_R2: return 7;
            case KeyEvent.KEYCODE_BUTTON_SELECT: return 8;
            case KeyEvent.KEYCODE_BUTTON_START: return 9;
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return 10;
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return 11;
            case KeyEvent.KEYCODE_DPAD_UP: return 12;
            case KeyEvent.KEYCODE_DPAD_DOWN: return 13;
            case KeyEvent.KEYCODE_DPAD_LEFT: return 14;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return 15;
            case KeyEvent.KEYCODE_BUTTON_MODE: return 16;
            default: return -1;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        InputDevice d = e.getDevice();
        if (isGamepad(d) && !d.isVirtual()) {
            int code = e.getKeyCode();
            // Some controllers report their B button as Back.
            int index = code == KeyEvent.KEYCODE_BACK ? 1 : buttonIndex(code);
            if (index >= 0) {
                usePad(d);
                boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
                synchronized (padLock) {
                    buttons[index] = down ? 1 : 0;
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(e);
    }

    private static float axis(MotionEvent e, InputDevice d, int primary, int fallback) {
        if (d.getMotionRange(primary, e.getSource()) != null) return e.getAxisValue(primary);
        if (fallback >= 0 && d.getMotionRange(fallback, e.getSource()) != null) return e.getAxisValue(fallback);
        return 0;
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent e) {
        InputDevice d = e.getDevice();
        if ((e.getSource() & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
                && e.getAction() == MotionEvent.ACTION_MOVE && d != null) {
            usePad(d);
            float lx = axis(e, d, MotionEvent.AXIS_X, -1), ly = axis(e, d, MotionEvent.AXIS_Y, -1);
            boolean zRight = d.getMotionRange(MotionEvent.AXIS_Z, e.getSource()) != null && d.getMotionRange(MotionEvent.AXIS_RZ, e.getSource()) != null;
            float rx = zRight ? e.getAxisValue(MotionEvent.AXIS_Z) : axis(e, d, MotionEvent.AXIS_RX, -1);
            float ry = zRight ? e.getAxisValue(MotionEvent.AXIS_RZ) : axis(e, d, MotionEvent.AXIS_RY, -1);
            float lt = Math.max(axis(e, d, MotionEvent.AXIS_LTRIGGER, -1), axis(e, d, MotionEvent.AXIS_BRAKE, -1));
            float rt = Math.max(axis(e, d, MotionEvent.AXIS_RTRIGGER, -1), axis(e, d, MotionEvent.AXIS_GAS, -1));
            float hx = axis(e, d, MotionEvent.AXIS_HAT_X, -1), hy = axis(e, d, MotionEvent.AXIS_HAT_Y, -1);
            synchronized (padLock) {
                axes[0] = lx; axes[1] = ly; axes[2] = rx; axes[3] = ry;
                if (d.getMotionRange(MotionEvent.AXIS_LTRIGGER, e.getSource()) != null || d.getMotionRange(MotionEvent.AXIS_BRAKE, e.getSource()) != null) buttons[6] = lt;
                if (d.getMotionRange(MotionEvent.AXIS_RTRIGGER, e.getSource()) != null || d.getMotionRange(MotionEvent.AXIS_GAS, e.getSource()) != null) buttons[7] = rt;
                if (d.getMotionRange(MotionEvent.AXIS_HAT_X, e.getSource()) != null) {
                    buttons[14] = hx < -.5f ? 1 : 0;
                    buttons[15] = hx > .5f ? 1 : 0;
                    buttons[12] = hy < -.5f ? 1 : 0;
                    buttons[13] = hy > .5f ? 1 : 0;
                }
            }
            return true;
        }
        return super.dispatchGenericMotionEvent(e);
    }

    @Override
    public void onInputDeviceAdded(int deviceId) {
        InputDevice d = InputDevice.getDevice(deviceId);
        if (isGamepad(d) && !d.isVirtual() && padDevice < 0) usePad(d);
    }

    @Override
    public void onInputDeviceRemoved(int deviceId) {
        if (deviceId == padDevice) detectConnectedPad();
    }

    @Override
    public void onInputDeviceChanged(int deviceId) {
        // Nothing to do; state refreshes on the next event.
    }

    // ------------------------------------------------------------------ JavaScript bridge

    /** Methods callable from the page as window.AndroidHost.*. Called on a WebView background thread. */
    private final class Bridge {
        @JavascriptInterface
        public String padState() {
            synchronized (padLock) {
                if (padDevice < 0) return "0";
                StringBuilder sb = new StringBuilder(128);
                sb.append("1|").append(padName).append('|');
                for (int i = 0; i < axes.length; i++) {
                    if (i > 0) sb.append(',');
                    sb.append(Math.round(axes[i] * 1000) / 1000f);
                }
                sb.append('|');
                for (int i = 0; i < buttons.length; i++) {
                    if (i > 0) sb.append(',');
                    sb.append(Math.round(buttons[i] * 100) / 100f);
                }
                return sb.toString();
            }
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void vibrate(int ms, int amplitude) {
            if (vibrator == null || !vibrator.hasVibrator() || ms <= 0) return;
            int duration = Math.min(ms, 400);
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createOneShot(duration, Math.max(1, Math.min(255, amplitude))));
            } else {
                vibrator.vibrate(duration);
            }
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void rumble(int ms, int amplitude) {
            int id;
            synchronized (padLock) {
                id = padDevice;
            }
            if (id < 0) return;
            InputDevice d = InputDevice.getDevice(id);
            if (d == null) return;
            Vibrator v = d.getVibrator();
            if (v == null || !v.hasVibrator()) return;
            int duration = Math.min(Math.max(ms, 1), 500);
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(duration, Math.max(1, Math.min(255, amplitude))));
            else v.vibrate(duration);
        }

        @JavascriptInterface
        public float refreshRate() {
            return getWindowManager().getDefaultDisplay().getRefreshRate();
        }

        @JavascriptInterface
        public void exitApp() {
            handler.post(new Runnable() {
                @Override
                public void run() {
                    moveTaskToBack(true);
                }
            });
        }
    }
}
