import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RadialGradientPaint;
import java.awt.RenderingHints;
import java.awt.geom.Path2D;
import java.awt.geom.Point2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.awt.image.ConvolveOp;
import java.awt.image.Kernel;
import java.io.File;
import javax.imageio.ImageIO;

/**
 * Renders the Aurelia Strike launcher icons (adaptive layers + legacy PNGs).
 * Usage: java tools/IconGen.java android/res [icon-512.png]
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
        if (args.length > 1) ImageIO.write(legacy(512), "png", new File(args[1]));
    }

    static Graphics2D g(BufferedImage img, float scale) {
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        g.scale(scale, scale);
        return g;
    }

    static BufferedImage background(int px) {
        BufferedImage img = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = g(img, px / 108f);
        g.setPaint(new RadialGradientPaint(new Point2D.Float(54, 44), 80, new float[]{0f, .5f, 1f},
                new Color[]{new Color(0x1d3a40), new Color(0x0b171c), new Color(0x04080a)}));
        g.fillRect(0, 0, 108, 108);
        g.setStroke(new BasicStroke(.5f));
        g.setColor(new Color(79, 240, 224, 22));
        for (int i = -108; i < 216; i += 9) g.drawLine(i, 0, i + 108, 108);
        g.setPaint(new GradientPaint(0, 30, new Color(255, 181, 79, 0), 108, 78, new Color(255, 181, 79, 40)));
        g.fillRect(0, 0, 108, 108);
        g.setColor(new Color(79, 240, 224, 70));
        g.setStroke(new BasicStroke(1f));
        g.drawOval(54 - 40, 54 - 40, 80, 80);
        g.dispose();
        return img;
    }

    static Path2D chevron() {
        Path2D p = new Path2D.Float();
        p.moveTo(54, 26); p.lineTo(78, 80); p.lineTo(67, 80); p.lineTo(54, 49); p.lineTo(41, 80); p.lineTo(30, 80); p.closePath();
        return p;
    }

    static Path2D slash() {
        Path2D p = new Path2D.Float();
        p.moveTo(30, 66); p.lineTo(82, 56); p.lineTo(80, 62); p.lineTo(28, 72); p.closePath();
        return p;
    }

    static BufferedImage foreground(int px) {
        float s = px / 108f;
        BufferedImage glow = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB_PRE);
        Graphics2D gg = g(glow, s);
        gg.setColor(new Color(79, 240, 224, 200));
        gg.fill(chevron());
        gg.setColor(new Color(255, 170, 70, 220));
        gg.fill(slash());
        gg.dispose();
        glow = blur(glow, Math.max(2, Math.round(6 * s)));
        BufferedImage img = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB_PRE);
        Graphics2D g = img.createGraphics();
        g.drawImage(glow, 0, 0, null);
        g.dispose();
        g = g(img, s);
        g.setPaint(new GradientPaint(54, 26, new Color(0xc9fff8), 54, 80, new Color(0x1fb8aa)));
        g.fill(chevron());
        g.setPaint(new GradientPaint(28, 66, new Color(0xffd27a), 82, 58, new Color(0xff8a2a)));
        g.fill(slash());
        g.setColor(new Color(255, 255, 255, 120));
        g.setStroke(new BasicStroke(.8f));
        g.draw(chevron());
        g.dispose();
        BufferedImage out = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB);
        Graphics2D o = out.createGraphics();
        o.drawImage(img, 0, 0, null);
        o.dispose();
        return out;
    }

    static BufferedImage legacy(int px) {
        int big = Math.round(px * 108f / 72f);
        BufferedImage bg = background(big), fg = foreground(big);
        BufferedImage img = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        float inset = px * .04f;
        RoundRectangle2D shape = new RoundRectangle2D.Float(inset, inset, px - 2 * inset, px - 2 * inset, px * .44f, px * .44f);
        g.setClip(shape);
        int off = (big - px) / 2;
        g.drawImage(bg, -off, -off, null);
        g.drawImage(fg, -off, -off, null);
        g.setClip(null);
        g.setColor(new Color(79, 240, 224, 70));
        g.setStroke(new BasicStroke(Math.max(1f, px / 96f)));
        g.draw(shape);
        g.dispose();
        return img;
    }

    static BufferedImage blur(BufferedImage src, int radius) {
        int size = radius * 2 + 1;
        float[] k = new float[size];
        float sigma = radius / 2.5f, sum = 0;
        for (int i = 0; i < size; i++) { float x = i - radius; k[i] = (float) Math.exp(-x * x / (2 * sigma * sigma)); sum += k[i]; }
        for (int i = 0; i < size; i++) k[i] /= sum;
        BufferedImage tmp = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_ARGB_PRE);
        BufferedImage out = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_ARGB_PRE);
        new ConvolveOp(new Kernel(size, 1, k), ConvolveOp.EDGE_ZERO_FILL, null).filter(src, tmp);
        new ConvolveOp(new Kernel(1, size, k), ConvolveOp.EDGE_ZERO_FILL, null).filter(tmp, out);
        return out;
    }
}
