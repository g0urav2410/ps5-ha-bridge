const hass = require("./hass");
const lightConfig = require("./lightconfig");
const snapshot = require("./snapshot");
const { log, logError } = require("./logger");

// Two independent snapshots. Kept separate so trying a setting out can't
// clobber the lights the bridge is holding for the end of a session.
const SESSION = "session";
const PREVIEW = "preview";
const PREVIEW_TIMEOUT_MS = 45000;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return t.map((n) => Math.round((n + m) * 255));
}

// Two lights given the same rgb triple rarely look the same: a phosphor bulb
// and an RGB strip have different primaries, so even plain white lands warm on
// one and blue on the other. There's no way to know a given light's white
// point from here, so this is a manual trim -- shift the hue a little, pull
// the saturation back -- applied per light on top of the state's colour.
function trimColor(rgb, per) {
  if (!rgb) return rgb;
  const shift = per.hueShift || 0;
  const sat = (per.satScale ?? 100) / 100;
  if (!shift && sat === 1) return rgb;
  let [h, s, v] = rgbToHsv(rgb);
  h = (h + shift + 360) % 360;
  s = Math.max(0, Math.min(1, s * sat));
  return hsvToRgb(h, s, v);
}

function scaleBrightness(brightness, per) {
  if (brightness == null) return brightness;
  const pct = (per.brightnessScale ?? 100) / 100;
  if (pct === 1) return brightness;
  return Math.max(1, Math.min(255, Math.round(brightness * pct)));
}

class Lighting {
  constructor() {
    this.companions = new Map(); // light entity -> { speed, palette }
    this.effectLists = null; // entity -> supported effect names
    this.previewing = false;
    this.previewTimer = null;
  }

  // Trying a setting out shouldn't leave the lights stuck that way. The
  // first preview captures the lights; stopping (or the timeout) restores.
  async beginPreview(config) {
    if (!this.previewing) {
      this.previewing = await snapshot.capture(PREVIEW, config.lights);
    }
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      this.endPreview(config).catch(() => {});
    }, PREVIEW_TIMEOUT_MS);
  }

  async endPreview(config) {
    clearTimeout(this.previewTimer);
    this.previewTimer = null;
    if (!this.previewing) return false;
    this.previewing = false;
    const done = await snapshot.restore(PREVIEW, 1);
    if (done) log("Preview ended, lights put back");
    return done;
  }

  get config() {
    return lightConfig.load();
  }

  async companionsFor(entityId) {
    if (!this.companions.has(entityId)) {
      try {
        this.companions.set(entityId, await hass.findWledCompanions(entityId));
      } catch {
        this.companions.set(entityId, { speed: null, palette: null });
      }
    }
    return this.companions.get(entityId);
  }

  // Called whenever the PS5 state changes. `gameColor` is the cover-art
  // colour ({rgb, hex}) or null.
  async onStateChange(from, to, gameColor) {
    const config = this.config;
    if (!config.enabled || !config.lights.length) return;

    try {
      const stateConfig = config.states[to];
      if (!stateConfig || !stateConfig.enabled) return;

      if (to === "off") {
        await this.handleOff(config, stateConfig);
        return;
      }

      await this.captureBeforeTouching(config);
      await this.applyState(config, stateConfig, gameColor, to);
    } catch (err) {
      logError(`Lighting update failed (${from} -> ${to}): ${err.message}`);
    }
  }

  // Applying config only on the next PS5 state change meant switching a
  // state off, or lighting off entirely, left the lights running -- nothing
  // visibly happened, so the toggle looked broken. Reconcile against what's
  // on screen right now instead.
  async reconcile(prev, next, derivedState, gameColorHex) {
    // A newly chosen light hasn't had its capabilities read yet, and a
    // removed one shouldn't keep a stale companion entry.
    if ((prev.lights || []).join() !== (next.lights || []).join()) {
      this.effectLists = null;
      this.companions.clear();
    }
    const wasOn = prev.enabled && prev.lights.length;
    const isOn = next.enabled && next.lights.length;

    // Switching lighting off has to win even mid-preview -- otherwise the
    // toggle does nothing whenever "Try it now" happens to be running,
    // which looks exactly like a broken toggle.
    if (wasOn && !isOn) {
      if (this.previewing) {
        await this.endPreview(prev);
        return;
      }
      await this.stopControlling(prev);
      return;
    }

    // Otherwise leave a preview alone; it's showing what was asked for.
    if (this.previewing) return;
    if (!isOn || !derivedState) return;

    const before = prev.states?.[derivedState];
    const after = next.states?.[derivedState];
    if (!after) return;

    // Turning off the state the console is currently in should release the
    // lights, not leave them stuck on that state's look.
    if (before?.enabled && !after.enabled) {
      log(`'${derivedState}' switched off while active -- releasing the lights`);
      await this.stopControlling(next);
      return;
    }

    // Otherwise keep the lights matching whatever was just edited, so
    // changes are visible immediately rather than at the next transition.
    if (after.enabled) {
      if (derivedState === "off") await this.handleOff(next, after);
      else {
        const gameColor = gameColorHex
          ? { hex: gameColorHex, rgb: hexToRgb(gameColorHex) }
          : null;
        await this.captureBeforeTouching(next);
        await this.applyState(next, after, gameColor, derivedState);
      }
    }
  }

  // Record the lights the first time the bridge is about to touch them,
  // rather than on the off -> awake transition. Those are usually the same
  // moment, but they come apart when the add-on starts while the console is
  // already on -- installed mid-session, or restarted after its stored
  // snapshot was lost. Then the transition has already been and gone, while
  // the lights are still exactly as the user left them, which is the thing
  // worth recording. Capturing on first touch gets both cases.
  async captureBeforeTouching(config) {
    if (!config.restoreOnOff) return;
    if (snapshot.has(SESSION)) return;
    await this.snapshot(config.lights);
  }

  // Hand the lights back: restore the pre-session snapshot if we have one,
  // otherwise just switch them off.
  async stopControlling(config) {
    if (!config.lights?.length) return;
    if (await snapshot.restore(SESSION, 1)) {
      log("Lighting released, previous lighting restored");
      return;
    }
    await hass.callService("light", "turn_off", {
      entity_id: config.lights,
      transition: 1,
    });
    log("Lighting released, lights turned off");
  }

  async snapshot(lights) {
    await snapshot.capture(SESSION, lights);
  }

  async handleOff(config, stateConfig) {
    // Putting the lights back exactly as they were is the whole point of the
    // snapshot, so it wins over the state's own settings when it exists.
    if (config.restoreOnOff && (await snapshot.restore(SESSION, stateConfig.transition ?? 2))) {
      return;
    }

    const targets = this.lightsFor(config, "off");
    if (stateConfig.turnOff !== false && targets.length) {
      await hass.callService("light", "turn_off", {
        entity_id: targets,
        transition: stateConfig.transition ?? 2,
      });
    }
  }

  // Which effects a light actually has. Sending an effect name a light
  // doesn't know makes Home Assistant reject the whole turn_on call, so a
  // plain bulb chosen alongside a WLED strip would take nothing at all --
  // not even the colour. Cached; the list only changes when a device does.
  async effectsFor(entityId) {
    if (!this.effectLists) {
      this.effectLists = new Map();
      try {
        for (const l of await hass.listLights()) {
          this.effectLists.set(l.entity_id, l.effects || []);
        }
      } catch (err) {
        logError(`Could not read light capabilities: ${err.message}`);
      }
    }
    return this.effectLists.get(entityId) || [];
  }

  settingsFor(config, entityId) {
    return config.perLight?.[entityId] || lightConfig.lightDefaults();
  }

  // A light can opt out of individual states -- the room lights joining in
  // only once a game starts, say, while the strip follows every state.
  lightsFor(config, stateKey) {
    return (config.lights || []).filter((id) => {
      const per = this.settingsFor(config, id);
      return per.enabled !== false && per.states?.[stateKey] !== false;
    });
  }

  async applyState(config, stateConfig, gameColor, stateKey) {
    const baseRgb =
      stateConfig.useGameColor && gameColor
        ? gameColor.rgb
        : hexToRgb(stateConfig.color);

    const targets = stateKey ? this.lightsFor(config, stateKey) : config.lights;

    for (const entityId of targets) {
      const companions = await this.companionsFor(entityId);
      const per = this.settingsFor(config, entityId);

      // Palette has to be Default or it overrides the colour and paints a
      // spread along the strip instead of the single colour asked for.
      if (companions.palette) {
        await hass
          .callService("select", "select_option", {
            entity_id: companions.palette,
            option: "Default",
          })
          .catch(() => {});
      }

      const rgb = trimColor(baseRgb, per);
      const data = {
        entity_id: entityId,
        brightness: scaleBrightness(stateConfig.brightness, per),
        transition: stateConfig.transition ?? 2,
      };
      if (rgb) data.rgb_color = rgb;
      if (stateConfig.effect && (await this.effectsFor(entityId)).includes(stateConfig.effect)) {
        data.effect = stateConfig.effect;
      }

      await hass.callService("light", "turn_on", data);

      if (companions.speed && stateConfig.speed != null) {
        await hass
          .callService("number", "set_value", {
            entity_id: companions.speed,
            value: stateConfig.speed,
          })
          .catch(() => {});
      }
    }
  }
}

module.exports = { Lighting, hexToRgb };
