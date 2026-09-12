const fs = require("fs");

const PATH = "/data/lighting.json";

const STATE_KEYS = ["booting", "home", "playing", "off"];
// The states a light can be told to sit out. 'off' isn't one of them: a light
// the bridge drove has to be handed back when the console sleeps, or it stays
// on the PS5's colours forever. Leaving that as a tick box was also a second
// thing called "off" next to each light's own on/off switch.
const JOINABLE_STATES = ["booting", "home", "playing"];

// Per-light overrides. Defaults are deliberately "behave exactly as before":
// every light reacts to every state, at the state's own brightness and colour.
// Someone who never opens this section shouldn't notice it exists.
function lightDefaults() {
  return {
    enabled: true, // the bridge leaves this light alone entirely when false
    states: { booting: true, home: true, playing: true, off: true },
    brightnessScale: 100, // percent of the state's brightness, 10-150
    hueShift: 0,          // degrees, -30..30
    satScale: 100,        // percent of the state's saturation, 0-150
  };
}

// One entry per PS5 state. 'booting' is off by default -- it's a brief
// window and most people don't want the lights reacting to it.
function defaults() {
  return {
    enabled: false,
    lights: [],
    perLight: {}, // entity_id -> lightDefaults()
    restoreOnOff: true, // snapshot lights when a session starts, put them back after
    states: {
      booting: { enabled: false, effect: null, color: "#ffffff", useGameColor: false, brightness: 120, speed: null, transition: 2 },
      home:    { enabled: true,  effect: null, color: "#ffc18d", useGameColor: false, brightness: 180, speed: 96,  transition: 3 },
      playing: { enabled: true,  effect: null, color: "#ff0000", useGameColor: true,  brightness: 120, speed: null, transition: 2 },
      off:     { enabled: true,  turnOff: true, transition: 2 },
    },
  };
}

// Fills in anything the saved entry is missing, so a config written before
// per-light settings existed still gets sane values.
function normaliseLight(saved) {
  const base = lightDefaults();
  const s = saved || {};
  return {
    ...base,
    ...s,
    // 'off' is always on: see JOINABLE_STATES. Configs written when it was a
    // tick box may have it false, which would strand that light lit.
    states: { ...base.states, ...(s.states || {}), off: true },
  };
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(PATH, "utf8"));
    const base = defaults();
    const perLight = {};
    // Only keep entries for lights that are still chosen, so removing a light
    // and adding it back doesn't silently resurrect old overrides.
    for (const id of saved.lights || []) {
      perLight[id] = normaliseLight(saved.perLight?.[id]);
    }
    // Merge rather than replace, so a config written by an older version
    // still gets any fields added since.
    const states = {};
    for (const k of STATE_KEYS) {
      states[k] = { ...base.states[k], ...(saved.states?.[k] || {}) };
    }
    return { ...base, ...saved, perLight, states };
  } catch {
    return defaults();
  }
}

function save(config) {
  fs.writeFileSync(PATH, JSON.stringify(config, null, 2));
  return config;
}

module.exports = { load, save, defaults, lightDefaults, STATE_KEYS, JOINABLE_STATES };
