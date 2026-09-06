const hass = require("./hass");
const lightConfig = require("./lightconfig");
const { log, logError } = require("./logger");

const SCENE_ID = "ps5_light_snapshot";
const SCENE_ENTITY = `scene.${SCENE_ID}`;
// Kept separate from the session snapshot so trying a setting out can't
// clobber the lights the bridge is holding for the end of a session.
const PREVIEW_SCENE_ID = "ps5_preview_snapshot";
const PREVIEW_SCENE_ENTITY = `scene.${PREVIEW_SCENE_ID}`;
const PREVIEW_TIMEOUT_MS = 45000;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

class Lighting {
  constructor() {
    this.companions = new Map(); // light entity -> { speed, palette }
    this.snapshotTaken = false;
    this.previewing = false;
    this.previewTimer = null;
  }

  // Trying a setting out shouldn't leave the lights stuck that way. The
  // first preview captures the lights; stopping (or the timeout) restores.
  async beginPreview(config) {
    if (!this.previewing) {
      try {
        await hass.callService("scene", "create", {
          scene_id: PREVIEW_SCENE_ID,
          snapshot_entities: config.lights,
        });
        this.previewing = true;
      } catch (err) {
        logError(`Could not snapshot before preview: ${err.message}`);
      }
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
    try {
      await hass.callService("scene", "turn_on", {
        entity_id: PREVIEW_SCENE_ENTITY,
        transition: 1,
      });
      log("Preview ended, lights restored");
      return true;
    } catch (err) {
      logError(`Could not restore after preview: ${err.message}`);
      return false;
    }
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
      // Leaving 'off' means a session is starting: capture the lights first,
      // before we overwrite them, so they can be put back afterwards.
      if (from === "off" && to !== "off" && config.restoreOnOff) {
        await this.snapshot(config.lights);
      }

      const stateConfig = config.states[to];
      if (!stateConfig || !stateConfig.enabled) return;

      if (to === "off") {
        await this.handleOff(config, stateConfig);
        return;
      }

      await this.applyState(config, stateConfig, gameColor);
    } catch (err) {
      logError(`Lighting update failed (${from} -> ${to}): ${err.message}`);
    }
  }

  async snapshot(lights) {
    try {
      await hass.callService("scene", "create", {
        scene_id: SCENE_ID,
        snapshot_entities: lights,
      });
      this.snapshotTaken = true;
      log(`Snapshotted ${lights.length} light(s) before the session`);
    } catch (err) {
      this.snapshotTaken = false;
      logError(`Could not snapshot lights: ${err.message}`);
    }
  }

  async handleOff(config, stateConfig) {
    if (config.restoreOnOff && this.snapshotTaken) {
      try {
        await hass.callService("scene", "turn_on", {
          entity_id: SCENE_ENTITY,
          transition: stateConfig.transition ?? 2,
        });
        this.snapshotTaken = false;
        log("Restored lights to their pre-session state");
        return;
      } catch (err) {
        // Scenes made by scene.create don't survive an HA restart, so this
        // is an expected failure rather than a broken setup -- fall through
        // to simply turning the lights off.
        logError(`Could not restore snapshot (${err.message}); turning lights off instead`);
      }
    }

    if (stateConfig.turnOff !== false) {
      await hass.callService("light", "turn_off", {
        entity_id: config.lights,
        transition: stateConfig.transition ?? 2,
      });
    }
  }

  async applyState(config, stateConfig, gameColor) {
    const rgb =
      stateConfig.useGameColor && gameColor
        ? gameColor.rgb
        : hexToRgb(stateConfig.color);

    for (const entityId of config.lights) {
      const companions = await this.companionsFor(entityId);

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

      const data = {
        entity_id: entityId,
        brightness: stateConfig.brightness,
        transition: stateConfig.transition ?? 2,
      };
      if (rgb) data.rgb_color = rgb;
      if (stateConfig.effect) data.effect = stateConfig.effect;

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
