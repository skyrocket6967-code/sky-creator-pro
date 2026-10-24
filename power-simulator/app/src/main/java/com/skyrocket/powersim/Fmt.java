package com.skyrocket.powersim;

import java.util.Locale;

/** Short number formatting: 999, 1.24K, 12.4M, 124B ... Values are truncated, never rounded up. */
final class Fmt {
    private static final String[] SUFFIX = {
            "", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc",
            "Ud", "Dd", "Td", "Qad", "Qid", "Sxd", "Spd", "Ocd", "Nod", "Vg"
    };

    private Fmt() {
    }

    static String num(double v) {
        if (Double.isNaN(v)) return "0";
        if (Double.isInfinite(v)) return "∞";
        if (v < 0) return "-" + num(-v);
        if (v < 1000) {
            if (v < 10 && v != Math.floor(v)) {
                return String.format(Locale.US, "%.1f", Math.floor(v * 10) / 10);
            }
            return String.valueOf((long) Math.floor(v));
        }
        int tier = (int) (Math.log10(v) / 3);
        if (tier >= SUFFIX.length) {
            int exp = (int) Math.floor(Math.log10(v));
            return String.format(Locale.US, "%.2fe%d", Math.floor(v / Math.pow(10, exp) * 100) / 100, exp);
        }
        double scaled = v / Math.pow(1000, tier);
        String s;
        if (scaled < 10) s = String.format(Locale.US, "%.2f", Math.floor(scaled * 100) / 100);
        else if (scaled < 100) s = String.format(Locale.US, "%.1f", Math.floor(scaled * 10) / 10);
        else s = String.valueOf((long) Math.floor(scaled));
        return s + SUFFIX[tier];
    }

    static String pct(double fraction) {
        double p = fraction * 100;
        if (p == Math.floor(p)) return (long) p + "%";
        return String.format(Locale.US, "%.1f%%", p);
    }

    static String mult(double m) {
        if (m == Math.floor(m) && m < 1e6) return "×" + (long) m;
        if (m < 100) return String.format(Locale.US, "×%.1f", m);
        return "×" + num(m);
    }

    static String duration(double seconds) {
        long s = (long) seconds;
        if (s < 60) return s + "s";
        long m = s / 60;
        if (m < 60) return m + "m " + (s % 60) + "s";
        long h = m / 60;
        if (h < 24) return h + "h " + (m % 60) + "m";
        return (h / 24) + "d " + (h % 24) + "h";
    }
}
