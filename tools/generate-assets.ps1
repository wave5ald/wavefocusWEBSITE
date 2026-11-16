#requires -Version 5.1
<#
  Builds the PWA icon set and iOS launch images from the brand artwork in
  pwa/brand/icon.png (1024x1024, full-bleed).

  Usage:  powershell -ExecutionPolicy Bypass -File pwa/tools/generate-assets.ps1
#>
param(
    [string]$SourceIcon = (Join-Path $PSScriptRoot "..\brand\icon.png"),
    [string]$OutDir     = (Join-Path $PSScriptRoot "..")
)

Add-Type -AssemblyName System.Drawing

$source = [System.IO.Path]::GetFullPath($SourceIcon)
$out    = [System.IO.Path]::GetFullPath($OutDir)
$icons  = Join-Path $out "icons"
$splash = Join-Path $out "splash"
New-Item -ItemType Directory -Force -Path $icons, $splash | Out-Null
if (-not (Test-Path $source)) { throw "Missing brand artwork: $source" }

$code = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

public static class WaveAssets
{
    static readonly Color Night = Color.FromArgb(255, 8, 16, 30);
    const string BG_HEX = "#08101E";

    static void Load(string path, out Bitmap bmp)
    {
        // Clone so the source file is not locked while the set is written.
        using (var raw = new Bitmap(path))
        {
            bmp = new Bitmap(raw.Width, raw.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.CompositingMode = CompositingMode.SourceCopy;
                g.DrawImage(raw, new Rectangle(0, 0, raw.Width, raw.Height));
            }
        }
    }

    static Graphics Prepare(Bitmap target)
    {
        var g = Graphics.FromImage(target);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.CompositingQuality = CompositingQuality.HighQuality;
        return g;
    }

    static GraphicsPath RoundedRect(Rectangle r, int radius)
    {
        var path = new GraphicsPath();
        int d = Math.Max(2, radius * 2);
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    // Plain square icon: the artwork is already a full-bleed tile.
    public static void SaveIcon(string srcPath, string outPath, int size)
    {
        Bitmap src;
        Load(srcPath, out src);
        using (src)
        using (var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        using (var g = Prepare(bmp))
        {
            g.DrawImage(src, new Rectangle(0, 0, size, size));
            bmp.Save(outPath, ImageFormat.Png);
        }
    }

    // Maskable icons: keep the wave inside the 80% safe circle.
    public static void SaveMaskable(string srcPath, string outPath, int size)
    {
        Bitmap src;
        Load(srcPath, out src);
        using (src)
        using (var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        using (var g = Prepare(bmp))
        {
            g.Clear(Night);
            int inner = (int)Math.Round(size * 0.82);
            int offset = (size - inner) / 2;
            g.DrawImage(src, new Rectangle(offset, offset, inner, inner));
            bmp.Save(outPath, ImageFormat.Png);
        }
    }

    static void FillBackdrop(Graphics g, int w, int h)
    {
        using (var brush = new LinearGradientBrush(new Rectangle(0, 0, w, h), Color.FromArgb(255, 11, 15, 25), Color.FromArgb(255, 18, 29, 48), 55f))
        {
            g.FillRectangle(brush, 0, 0, w, h);
        }
        using (var path = new GraphicsPath())
        {
            path.AddEllipse(w * 0.42f, -h * 0.28f, w * 0.95f, h * 0.95f);
            using (var pgb = new PathGradientBrush(path))
            {
                pgb.CenterColor = Color.FromArgb(52, 56, 189, 248);
                pgb.SurroundColors = new Color[] { Color.FromArgb(0, 56, 189, 248) };
                pgb.CenterPoint = new PointF(w * 0.80f, h * 0.20f);
                g.FillPath(pgb, path);
            }
        }
    }

    public static void SaveSplash(string srcPath, string outPath, int w, int h)
    {
        Bitmap src;
        Load(srcPath, out src);
        using (src)
        using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
        using (var g = Prepare(bmp))
        {
            FillBackdrop(g, w, h);

            int tile = (int)Math.Round(Math.Min(w, h) * 0.34);
            int tx = (w - tile) / 2;
            int ty = (int)(h * 0.42) - tile / 2;

            using (var clip = RoundedRect(new Rectangle(tx, ty, tile, tile), (int)Math.Round(tile * 0.22)))
            {
                var old = g.Clip;
                g.SetClip(clip);
                g.DrawImage(src, new Rectangle(tx, ty, tile, tile));
                g.Clip = old;
            }

            using (var title = new Font("Segoe UI", (float)(Math.Min(w, h) * 0.062), FontStyle.Bold, GraphicsUnit.Pixel))
            using (var subtitle = new Font("Segoe UI", (float)(Math.Min(w, h) * 0.028), FontStyle.Regular, GraphicsUnit.Pixel))
            using (var white = new SolidBrush(Color.FromArgb(255, 226, 232, 240)))
            using (var muted = new SolidBrush(Color.FromArgb(255, 148, 163, 184)))
            using (var center = new StringFormat { Alignment = StringAlignment.Center })
            {
                float titleY = ty + tile + (float)(Math.Min(w, h) * 0.075);
                g.DrawString("Wave Focus", title, white, new RectangleF(0, titleY, w, title.Size * 1.6f), center);
                g.DrawString("Routine  ·  Focus  ·  Progress", subtitle, muted,
                    new RectangleF(0, titleY + title.Size * 1.5f, w, subtitle.Size * 2f), center);
            }
            bmp.Save(outPath, ImageFormat.Png);
        }
    }
}
'@

if (-not ("WaveAssets" -as [type])) { Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing }

Write-Host "Source : $source"
Write-Host "Output : $out"

# --- App icons -------------------------------------------------------------
[WaveAssets]::SaveIcon($source, (Join-Path $icons "icon-1024.png"), 1024)
[WaveAssets]::SaveIcon($source, (Join-Path $icons "icon-512.png"), 512)
[WaveAssets]::SaveIcon($source, (Join-Path $icons "icon-192.png"), 192)
[WaveAssets]::SaveIcon($source, (Join-Path $icons "apple-touch-icon.png"), 180)
[WaveAssets]::SaveIcon($source, (Join-Path $icons "favicon-32.png"), 32)
[WaveAssets]::SaveIcon($source, (Join-Path $icons "favicon-16.png"), 16)
[WaveAssets]::SaveMaskable($source, (Join-Path $icons "icon-maskable-512.png"), 512)
[WaveAssets]::SaveMaskable($source, (Join-Path $icons "icon-maskable-192.png"), 192)

# --- iOS launch images -----------------------------------------------------
$splashes = @(
    @{ n = "iphone-15-pro-max";  w = 1290; h = 2796 },
    @{ n = "iphone-15-pro";      w = 1179; h = 2556 },
    @{ n = "iphone-14-plus";     w = 1284; h = 2778 },
    @{ n = "iphone-13";          w = 1170; h = 2532 },
    @{ n = "iphone-x";           w = 1125; h = 2436 },
    @{ n = "iphone-xs-max";      w = 1242; h = 2688 },
    @{ n = "iphone-11";          w = 828;  h = 1792 },
    @{ n = "iphone-8";           w = 750;  h = 1334 },
    @{ n = "iphone-8-plus";      w = 1242; h = 2208 },
    @{ n = "ipad-pro-11";        w = 1668; h = 2388 },
    @{ n = "ipad-pro-12";        w = 2048; h = 2732 },
    @{ n = "ipad-air";           w = 1536; h = 2048 }
)
foreach ($s in $splashes) {
    [WaveAssets]::SaveSplash($source, (Join-Path $splash ("splash-" + $s.n + ".png")), $s.w, $s.h)
}

# --- Quality check: contact sheet -----------------------------------------
$sheetPath = Join-Path $out "tools\asset-preview.png"
$sheet = New-Object System.Drawing.Bitmap 720, 300
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.Clear([System.Drawing.Color]::FromArgb(255, 7, 10, 18))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$x = 20
foreach ($f in @("icon-192.png", "icon-maskable-512.png", "apple-touch-icon.png")) {
    $img = [System.Drawing.Image]::FromFile((Join-Path $icons $f))
    $g.DrawImage($img, $x, 40, 160, 160)
    $img.Dispose()
    $x += 180
}
$sp = [System.Drawing.Image]::FromFile((Join-Path $splash "splash-iphone-13.png"))
$g.DrawImage($sp, 580, 20, 120, 260)
$sp.Dispose()
$sheet.Save($sheetPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $sheet.Dispose()

Write-Host "Done. Check tools/asset-preview.png"
