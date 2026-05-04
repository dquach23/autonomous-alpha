/**
 * Halo icon + splash builder
 * Rasterizes halo-icon.svg and a generated splash SVG into PNGs at the sizes
 * iOS / Android PWAs expect. Run with `npm run icons` from scripts/.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "../../public");
const ICON_SVG   = fs.readFileSync(path.join(__dirname, "halo-icon.svg"));

// ── Splash SVG generator (cream bg, centered halo, wordmark below) ───────────
// One template parameterised by w/h so we cover multiple iPhone resolutions.
function splashSvg(w, h) {
  const cx = w / 2;
  // Place halo a touch above center so the wordmark sits in the visual focal area.
  const cy = h * 0.42;
  const r  = Math.min(w, h) * 0.18;          // halo radius (~18% of short side)
  const stroke = r * 0.22;
  const dot = r * 0.16;
  // Wordmark sizing
  const wordSize = Math.min(w, h) * 0.11;
  const subSize  = Math.min(w, h) * 0.024;
  const wordY    = cy + r * 1.95;
  const subY     = wordY + subSize * 2.1;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <defs>
      <radialGradient id="bg" cx="50%" cy="40%" r="70%">
        <stop offset="0%"   stop-color="#fffaf2"/>
        <stop offset="65%"  stop-color="#faf2e0"/>
        <stop offset="100%" stop-color="#ecdcb3"/>
      </radialGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="30%" stop-color="#f5d9b3" stop-opacity="0"/>
        <stop offset="68%" stop-color="#f0c585" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#f0c585" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="ring" x1="20%" y1="8%" x2="80%" y2="92%">
        <stop offset="0%"   stop-color="#fae0bf"/>
        <stop offset="30%"  stop-color="#dfb07e"/>
        <stop offset="60%"  stop-color="#c2904f"/>
        <stop offset="100%" stop-color="#8c5e2d"/>
      </linearGradient>
      <linearGradient id="sheen" x1="50%" y1="0%" x2="50%" y2="100%">
        <stop offset="0%"   stop-color="#fff" stop-opacity="0.6"/>
        <stop offset="45%"  stop-color="#fff" stop-opacity="0.04"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="dot" cx="40%" cy="35%" r="65%">
        <stop offset="0%"  stop-color="#fae6c6"/>
        <stop offset="50%" stop-color="#d4a574"/>
        <stop offset="100%" stop-color="#a06a37"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 1.55}" fill="url(#glow)"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#ring)" stroke-width="${stroke}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#sheen)" stroke-width="${stroke * 0.32}"/>
    <circle cx="${cx}" cy="${cy}" r="${dot}" fill="url(#dot)"/>
    <ellipse cx="${cx - dot * 0.3}" cy="${cy - dot * 0.32}" rx="${dot * 0.32}" ry="${dot * 0.22}" fill="#fff" fill-opacity="0.55"/>
    <text x="${cx}" y="${wordY}" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif"
          font-weight="800" font-size="${wordSize}"
          letter-spacing="${-wordSize * 0.04}"
          fill="#1c1f2e">halo</text>
    <text x="${cx}" y="${subY}" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif"
          font-weight="600" font-size="${subSize}"
          letter-spacing="${subSize * 0.18}"
          fill="#7a7f93">AI MARKET INTELLIGENCE</text>
  </svg>`;
}

// ── Targets ───────────────────────────────────────────────────────────────────
const ICON_TARGETS = [
  { name: "icon-192.png",        size: 192 },
  { name: "icon-512.png",        size: 512 },
  { name: "apple-touch-icon.png", size: 180 }, // iOS standard
];

const SPLASH_TARGETS = [
  // iPhone 13/14/15 Pro (the user's device)
  { name: "splash-1170x2532.png", w: 1170, h: 2532 },
  // iPhone 13/14/15 Pro Max
  { name: "splash-1284x2778.png", w: 1284, h: 2778 },
  // iPhone 14/15 (non-Pro)
  { name: "splash-1179x2556.png", w: 1179, h: 2556 },
  // Older iPhones (XR/11/SE3)
  { name: "splash-828x1792.png",  w: 828,  h: 1792 },
  // iPhone 8/SE2 fallback
  { name: "splash-750x1334.png",  w: 750,  h: 1334 },
];

async function build() {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  for (const t of ICON_TARGETS) {
    await sharp(ICON_SVG, { density: 384 })
      .resize(t.size, t.size, { fit: "cover" })
      .png({ compressionLevel: 9 })
      .toFile(path.join(PUBLIC_DIR, t.name));
    console.log(`  ✓ ${t.name} (${t.size}×${t.size})`);
  }

  for (const t of SPLASH_TARGETS) {
    const svg = Buffer.from(splashSvg(t.w, t.h));
    await sharp(svg)
      .png({ compressionLevel: 9 })
      .toFile(path.join(PUBLIC_DIR, t.name));
    console.log(`  ✓ ${t.name} (${t.w}×${t.h})`);
  }

  console.log("\nDone.");
}

build().catch(err => {
  console.error("Icon build failed:", err);
  process.exit(1);
});
