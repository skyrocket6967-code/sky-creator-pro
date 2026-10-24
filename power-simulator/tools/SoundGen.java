import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Random;

/**
 * Synthesizes the game's sound effects as small 16-bit mono WAV files.
 * Usage: java tools/SoundGen.java app/src/main/res/raw
 */
public class SoundGen {
    static final int RATE = 22050;
    static final Random RNG = new Random(42);

    public static void main(String[] args) throws IOException {
        File dir = new File(args[0]);
        dir.mkdirs();
        write(new File(dir, "sfx_tap.wav"), tap());
        write(new File(dir, "sfx_crit.wav"), crit());
        write(new File(dir, "sfx_buy.wav"), buy());
        write(new File(dir, "sfx_form.wav"), formUp());
        write(new File(dir, "sfx_rage.wav"), rage());
        write(new File(dir, "sfx_ascend.wav"), ascend());
        write(new File(dir, "sfx_click.wav"), click());
    }

    static float[] buf(double seconds) {
        return new float[(int) (seconds * RATE)];
    }

    /** Low punchy thump with a short transient click. */
    static float[] tap() {
        float[] s = buf(0.13);
        double phase = 0;
        float lp = 0;
        for (int i = 0; i < s.length; i++) {
            double t = i / (double) RATE;
            double f = 55 + 150 * Math.exp(-t * 45);
            phase += 2 * Math.PI * f / RATE;
            double env = Math.min(1, t / 0.002) * Math.exp(-t * 32);
            float n = RNG.nextFloat() * 2 - 1;
            lp += 0.35f * (n - lp);
            double click = (n - lp) * Math.exp(-t * 300) * 0.5;
            s[i] = (float) (Math.sin(phase) * env * 0.95 + click);
        }
        return finish(s, 0.8);
    }

    /** Heavier hit with a metallic ring. */
    static float[] crit() {
        float[] s = buf(0.42);
        double phase = 0;
        float lp = 0;
        double[] bells = {1180, 1790, 2630, 3410};
        for (int i = 0; i < s.length; i++) {
            double t = i / (double) RATE;
            double f = 45 + 170 * Math.exp(-t * 30);
            phase += 2 * Math.PI * f / RATE;
            double thump = Math.sin(phase) * Math.min(1, t / 0.002) * Math.exp(-t * 16);
            double ring = 0;
            for (int b = 0; b < bells.length; b++) ring += Math.sin(2 * Math.PI * bells[b] * t + b) * Math.exp(-t * (9 + b * 4)) / (b + 1.5);
            float n = RNG.nextFloat() * 2 - 1;
            lp += 0.25f * (n - lp);
            double noise = lp * Math.exp(-t * 22) * 0.8;
            s[i] = (float) (thump + ring * 0.45 + noise);
        }
        return finish(s, 0.9);
    }

    /** Two quick rising blips. */
    static float[] buy() {
        float[] s = buf(0.17);
        for (int i = 0; i < s.length; i++) {
            double t = i / (double) RATE;
            double f = t < 0.065 ? 988 : 1480;
            double lt = t < 0.065 ? t : t - 0.065;
            double env = Math.min(1, lt / 0.003) * Math.exp(-lt * 28);
            double w = Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2 * t) + 0.12 * Math.sin(2 * Math.PI * f * 3 * t);
            s[i] = (float) (w * env);
        }
        return finish(s, 0.55);
    }

    /** Rising arpeggio, shimmer and a whoosh. */
    static float[] formUp() {
        float[] s = buf(1.4);
        double[] notes = {523.25, 659.25, 783.99, 1046.5, 1318.5};
        float lp = 0;
        for (int i = 0; i < s.length; i++) {
            double t = i / (double) RATE;
            double v = 0;
            for (int n = 0; n < notes.length; n++) {
                double st = n * 0.085;
                if (t < st) continue;
                double lt = t - st;
                double env = Math.min(1, lt / 0.006) * Math.exp(-lt * (n == notes.length - 1 ? 2.4 : 4.5));
                double f = notes[n];
                v += (Math.sin(2 * Math.PI * f * lt) + 0.3 * Math.sin(2 * Math.PI * f * 2.005 * lt) + 0.15 * Math.sin(2 * Math.PI * f * 3 * lt)) * env * 0.5;
            }
            double shimmer = Math.sin(2 * Math.PI * 2093 * t) * Math.sin(2 * Math.PI * 9 * t) * Math.exp(-Math.pow((t - 0.5) / 0.3, 2)) * 0.18;
            float n = RNG.nextFloat() * 2 - 1;
            float k = (float) Math.min(0.9, 0.02 + t * 0.5);
            lp += k * (n - lp);
            double whoosh = lp * Math.sin(Math.PI * Math.min(1, t / 0.7)) * 0.22 * (t < 0.7 ? 1 : 0);
            s[i] = (float) (v + shimmer + whoosh);
        }
        return finish(s, 0.85);
    }

    /** Boom followed by a growling roar. */
    static float[] rage() {
        float[] s = buf(1.0);
        double phase = 0, sawPhase = 0;
        float lp = 0, lp2 = 0;
        for (int i = 0; i < s.length; i++) {
            double t = i / (double) RATE;
            double f = 32 + 90 * Math.exp(-t * 12);
            phase += 2 * Math.PI * f / RATE;
            double boom = Math.sin(phase) * Math.exp(-t * 5) * Math.min(1, t / 0.003);
            double gf = 70 + 25 * Math.sin(2 * Math.PI * 7 * t) + 40 * t;
            sawPhase += gf / RATE;
            double saw = 2 * (sawPhase - Math.floor(sawPhase + 0.5));
            lp += 0.08f * ((float) saw - lp);
            float n = RNG.nextFloat() * 2 - 1;
            lp2 += 0.12f * (n - lp2);
            double growlEnv = Math.min(1, t / 0.12) * Math.exp(-Math.max(0, t - 0.3) * 4);
            s[i] = (float) (boom * 0.9 + (lp * 1.4 + lp2 * 0.9) * growlEnv * 0.7);
        }
        return finish(s, 0.9);
    }

    /** Ethereal rising chord. */
    static float[] ascend() {
        float[] s = buf(2.0);
        double[] chord = {220, 277.18, 329.63, 440, 554.37, 659.25};
        for (int i = 0; i < s.length; i++) {
            double t = i / (double) RATE;
            double glide = 1 + 0.5 * (1 - Math.exp(-t * 1.6));
            double env = Math.min(1, t / 0.35) * Math.exp(-Math.max(0, t - 0.9) * 2.6);
            double v = 0;
            for (int c = 0; c < chord.length; c++) {
                double f = chord[c] * glide;
                v += Math.sin(2 * Math.PI * f * t + c) * (1.0 / (c + 1.2)) * (1 + 0.3 * Math.sin(2 * Math.PI * (4 + c) * t));
            }
            double bell = Math.sin(2 * Math.PI * 1760 * t) * Math.exp(-Math.max(0, t - 0.15) * 3) * (t > 0.15 ? 0.25 : 0);
            s[i] = (float) (v * env * 0.45 + bell);
        }
        return finish(s, 0.8);
    }

    static float[] click() {
        float[] s = buf(0.045);
        for (int i = 0; i < s.length; i++) {
            double t = i / (double) RATE;
            s[i] = (float) (Math.sin(2 * Math.PI * 1900 * t) * Math.exp(-t * 140) + (RNG.nextFloat() * 2 - 1) * Math.exp(-t * 600) * 0.3);
        }
        return finish(s, 0.45);
    }

    /** Soft clip, normalize to the given peak and add tiny fades so nothing clicks. */
    static float[] finish(float[] s, double peak) {
        double max = 1e-9;
        for (int i = 0; i < s.length; i++) {
            s[i] = (float) Math.tanh(s[i] * 1.4);
            max = Math.max(max, Math.abs(s[i]));
        }
        int fade = Math.min(s.length / 4, RATE / 200);
        for (int i = 0; i < s.length; i++) {
            double g = peak / max;
            if (i < 8) g *= i / 8.0;
            if (i > s.length - fade) g *= (s.length - i) / (double) fade;
            s[i] *= g;
        }
        return s;
    }

    static void write(File f, float[] s) throws IOException {
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        for (float v : s) {
            int x = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
            data.write(x & 0xFF);
            data.write((x >> 8) & 0xFF);
        }
        byte[] pcm = data.toByteArray();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write("RIFF".getBytes("US-ASCII"));
        le32(out, 36 + pcm.length);
        out.write("WAVEfmt ".getBytes("US-ASCII"));
        le32(out, 16);
        le16(out, 1);
        le16(out, 1);
        le32(out, RATE);
        le32(out, RATE * 2);
        le16(out, 2);
        le16(out, 16);
        out.write("data".getBytes("US-ASCII"));
        le32(out, pcm.length);
        out.write(pcm);
        try (FileOutputStream fo = new FileOutputStream(f)) {
            out.writeTo(fo);
        }
    }

    static void le32(ByteArrayOutputStream o, int v) {
        o.write(v & 0xFF);
        o.write((v >> 8) & 0xFF);
        o.write((v >> 16) & 0xFF);
        o.write((v >> 24) & 0xFF);
    }

    static void le16(ByteArrayOutputStream o, int v) {
        o.write(v & 0xFF);
        o.write((v >> 8) & 0xFF);
    }
}
