const { log, logError } = require("./logger");

// Derives a representative colour from a game's cover art, so lighting can
// match whatever is being played without maintaining a per-game mapping.
//
// Sony's image CDN accepts a ?w= resize parameter, so we pull a 64px version
// rather than the full-size art -- a couple of KB instead of ~130KB.

const THUMB_WIDTH = 64;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(conv(h + 1 / 3) * 255),
    Math.round(conv(h) * 255),
    Math.round(conv(h - 1 / 3) * 255),
  ];
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

// A plain average of cover art comes out muddy brown, and the single most
// common exact shade is usually a dark background. So:
//
//   1. Discard pixels that carry no identity -- near-black, near-white, greys.
//      Most game covers are heavily dark, so skipping this gives you black
//      for nearly every game.
//   2. Group what's left by HUE FAMILY, not exact shade. A sunset might span
//      dozens of distinct oranges; bucketing by exact value splits that one
//      obvious "orange" across dozens of tiny buckets and none of them looks
//      dominant. Grouping by hue keeps the family together.
//   3. Pick the biggest family, weighted a little toward vivid colours, then
//      average the pixels within it -- but only the ones near its own centre,
//      so a stray dark red doesn't drag a bright red family down.
const HUE_BINS = 24; // 15 degrees per bin

function dominantColor(pixels, width, height) {
  const total = width * height;
  const bins = [];
  for (let i = 0; i < HUE_BINS; i++) bins.push([]);

  for (let i = 0; i < total; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 0.12 || l > 0.92) continue;
    if (s < 0.15) continue;
    bins[Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS))].push({ h, s, l });
  }

  let bestBin = null;
  let bestScore = -1;
  for (const bin of bins) {
    if (!bin.length) continue;
    const avgS = bin.reduce((a, p) => a + p.s, 0) / bin.length;
    // share of the image, nudged toward vivid families
    const score = (bin.length / total) * (0.5 + avgS);
    if (score > bestScore) {
      bestScore = score;
      bestBin = bin;
    }
  }

  if (!bestBin) return null;

  // Rebuild the colour rather than averaging the family's RGB directly.
  // Averaging pulls everything toward the middle and comes out washed-out
  // (a vivid orange family averages to muddy brick), which reads poorly on
  // LEDs. Instead: take the family's hue, but a vivid representative
  // saturation and a mid lightness, so the result is recognisably the
  // game's colour and actually looks like something on a light strip.
  const hues = bestBin.map((p) => p.h).sort((a, b) => a - b);
  const sats = bestBin.map((p) => p.s).sort((a, b) => a - b);
  const lights = bestBin.map((p) => p.l).sort((a, b) => a - b);

  const h = percentile(hues, 0.5);
  const s = percentile(sats, 0.75);
  // keep lightness in a band that renders well on a strip: too dark reads as
  // off, too bright washes the hue out to white
  const l = Math.min(0.62, Math.max(0.42, percentile(lights, 0.5)));

  return { rgb: hslToRgb(h, s, l), share: bestBin.length / total };
}

function toHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

class GameColors {
  constructor() {
    // titleId -> { rgb, hex }; cover art never changes, so this never expires
    this.cache = new Map();
  }

  async forTitle(titleId, iconUrl) {
    if (!titleId || !iconUrl) return null;
    if (this.cache.has(titleId)) return this.cache.get(titleId);

    try {
      const url = `${iconUrl}${iconUrl.includes("?") ? "&" : "?"}w=${THUMB_WIDTH}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());

      // Required lazily: if the decoder is somehow unavailable, colour
      // extraction should degrade quietly rather than take the bridge down.
      const jpeg = require("jpeg-js");
      const { data, width, height } = jpeg.decode(buf, { useTArray: true });

      const picked = dominantColor(data, width, height);
      if (!picked) throw new Error("no usable colour in cover art");

      const result = { rgb: picked.rgb, hex: toHex(picked.rgb) };
      this.cache.set(titleId, result);
      log(
        `Cover art colour for ${titleId}: ${result.hex} ` +
          `(${(picked.share * 100).toFixed(0)}% of the image)`,
      );
      return result;
    } catch (err) {
      logError(`Could not derive colour for ${titleId}: ${err.message}`);
      this.cache.set(titleId, null); // don't retry a broken URL every poll
      return null;
    }
  }
}

module.exports = { GameColors, dominantColor, toHex };
