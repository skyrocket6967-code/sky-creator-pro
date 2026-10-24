import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RadialGradientPaint;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.Point2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.awt.image.ConvolveOp;
import java.awt.image.Kernel;
import java.io.File;
import java.util.Random;
import javax.imageio.ImageIO;

/**
 * Renders the launcher icons (adaptive layers + legacy PNGs) for every density.
 * Usage: java tools/IconGen.java app/src/main/res [art/icon-512.png]
 */
public class IconGen {
    static final String[] DENSITY = {"mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"};
    static final float[] SCALE = {1f, 1.5f, 2f, 3f, 4f};

    public static void main(String[] args) throws Exception {
        File res = new File(args[0]);
        for (int i = 0; i < DENSITY.length; i++) {
            File dir = new File(res, "mipmap-" + DENSITY[i]);
            dir.mkdirs();
            int layer = Math.round(108 * SCALE[i]);
            ImageIO.write(background(layer), "png", new File(dir, "ic_launcher_background.png"));
            ImageIO.write(foreground(layer), "png", new File(dir, "ic_launcher_foreground.png"));
            ImageIO.write(legacy(Math.round(48 * SCALE[i])), "png", new File(dir, "ic_launcher.png"));
        }
        if (args.length > 1) {
            File out = new File(args[1]);
            out.getParentFile().mkdirs();
            ImageIO.write(legacy(512), "png", out);
        }
    }

    static Graphics2D g(BufferedImage img, float scale) {
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        g.scale(scale, scale);
        return g;
    }

    /** Background layer drawn in a 108x108 unit space. */
    static BufferedImage background(int px) {
        BufferedImage img = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = g(img, px / 108f);
        g.setPaint(new RadialGradientPaint(new Point2D.Float(54, 46), 78,
                new float[]{0f, 0.45f, 1f},
                new Color[]{new Color(0x5A2BB0), new Color(0x1E1450), new Color(0x070A16)}));
        g.fillRect(0, 0, 108, 108);
        // Soft rays behind the bolt.
        for (int i = 0; i < 12; i++) {
            double a = Math.PI * 2 * i / 12 + 0.13;
            Path2D ray = new Path2D.Float();
            ray.moveTo(54, 54);
            ray.lineTo(54 + Math.cos(a - 0.09) * 80, 54 + Math.sin(a - 0.09) * 80);
            ray.lineTo(54 + Math.cos(a + 0.09) * 80, 54 + Math.sin(a + 0.09) * 80);
            ray.closePath();
            g.setColor(new Color(255, 255, 255, 9));
            g.fill(ray);
        }
        g.setStroke(new BasicStroke(0.8f));
        g.setColor(new Color(0x4D, 0xD8, 0xFF, 50));
        g.draw(new Ellipse2D.Float(54 - 38, 54 - 38, 76, 76));
        g.setColor(new Color(0x4D, 0xD8, 0xFF, 25));
        g.draw(new Ellipse2D.Float(54 - 45, 54 - 45, 90, 90));
        Random r = new Random(7);
        for (int i = 0; i < 26; i++) {
            float x = 10 + r.nextFloat() * 88, y = 10 + r.nextFloat() * 88, s = 0.4f + r.nextFloat() * 0.9f;
            g.setColor(new Color(255, 255, 255, 40 + r.nextInt(110)));
            g.fill(new Ellipse2D.Float(x - s / 2, y - s / 2, s, s));
        }
        g.dispose();
        return img;
    }

    static Path2D bolt() {
        float[][] pts = {{58, 20}, {72, 20}, {60, 46}, {74, 46}, {46, 90}, {54, 58}, {38, 58}};
        Path2D p = new Path2D.Float();
        for (int i = 0; i < pts.length; i++) {
            float x = 56 + (pts[i][0] - 56) * 0.86f - 1.5f;
            float y = 55 + (pts[i][1] - 55) * 0.86f;
            if (i == 0) p.moveTo(x, y);
            else p.lineTo(x, y);
        }
        p.closePath();
        return p;
    }

    /** Foreground layer: a glowing golden lightning bolt inside the 66-unit safe zone. */
    static BufferedImage foreground(int px) {
        float s = px / 108f;
        BufferedImage glow = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB_PRE);
        Graphics2D gg = g(glow, s);
        gg.setColor(new Color(0xFF, 0xB1, 0x3D, 235));
        gg.setStroke(new BasicStroke(5f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        gg.fill(bolt());
        gg.draw(bolt());
        gg.dispose();
        glow = blur(blur(glow, Math.max(2, Math.round(7 * s))), Math.max(1, Math.round(3 * s)));

        BufferedImage img = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB_PRE);
        Graphics2D g = img.createGraphics();
        g.drawImage(glow, 0, 0, null);
        g.dispose();
        g = g(img, s);
        Path2D b = bolt();
        g.setPaint(new GradientPaint(50, 22, new Color(0xFFF6C2), 52, 86, new Color(0xFF8A1C)));
        g.fill(b);
        // Inner highlight on the upper half.
        g.setClip(b);
        g.setPaint(new GradientPaint(40, 20, new Color(255, 255, 255, 170), 62, 52, new Color(255, 255, 255, 0)));
        g.fillRect(0, 0, 108, 56);
        g.setClip(null);
        g.setStroke(new BasicStroke(1.1f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(new Color(0xFF, 0xF4, 0xD0, 220));
        g.draw(b);
        g.dispose();
        return unpremultiply(img);
    }

    /** Pre-composited icon for launchers without adaptive icon support. */
    static BufferedImage legacy(int px) {
        int big = Math.round(px * 108f / 72f);
        BufferedImage bg = background(big), fg = foreground(big);
        BufferedImage img = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        float inset = px * 0.04f;
        RoundRectangle2D shape = new RoundRectangle2D.Float(inset, inset, px - 2 * inset, px - 2 * inset, px * 0.44f, px * 0.44f);
        g.setClip(shape);
        int off = (big - px) / 2;
        g.drawImage(bg, -off, -off, null);
        g.drawImage(fg, -off, -off, null);
        g.setClip(null);
        g.setComposite(AlphaComposite.SrcOver);
        g.setStroke(new BasicStroke(Math.max(1f, px / 96f)));
        g.setColor(new Color(255, 255, 255, 40));
        g.draw(shape);
        g.dispose();
        return img;
    }

    static BufferedImage blur(BufferedImage src, int radius) {
        int size = radius * 2 + 1;
        float[] k = new float[size];
        float sigma = radius / 2.5f, sum = 0;
        for (int i = 0; i < size; i++) {
            float x = i - radius;
            k[i] = (float) Math.exp(-x * x / (2 * sigma * sigma));
            sum += k[i];
        }
        for (int i = 0; i < size; i++) k[i] /= sum;
        ConvolveOp h = new ConvolveOp(new Kernel(size, 1, k), ConvolveOp.EDGE_ZERO_FILL, null);
        ConvolveOp v = new ConvolveOp(new Kernel(1, size, k), ConvolveOp.EDGE_ZERO_FILL, null);
        BufferedImage tmp = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_ARGB_PRE);
        BufferedImage out = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_ARGB_PRE);
        h.filter(src, tmp);
        v.filter(tmp, out);
        return out;
    }

    static BufferedImage unpremultiply(BufferedImage pre) {
        BufferedImage out = new BufferedImage(pre.getWidth(), pre.getHeight(), BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = out.createGraphics();
        g.drawImage(pre, 0, 0, null);
        g.dispose();
        return out;
    }
}
