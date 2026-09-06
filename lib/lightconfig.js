const fs = require("fs");

const PATH = "/data/lighting.json";

// One entry per PS5 state. 'booting' is off by default -- it's a brief
// window and most people don't want the lights reacting to it.
function defaults() {
  return {
    enabled: false,
    lights: [],
    restoreOnOff: true, // snapshot lights when a session starts, put them back after
    states: {
      booting: { enabled: false, effect: null, color: "#ffffff", useGameColor: false, brightness: 120, speed: null, transition: 2 },
      home:    { enabled: true,  effect: null, color: "#ffc18d", useGameColor: false, brightness: 180, speed: 96,  transition: 3 },
      playing: { enabled: true,  effect: null, color: "#ff0000", useGameColor: true,  brightness: 120, speed: null, transition: 2 },
      off:     { enabled: true,  turnOff: true, transition: 2 },
    },
  };
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(PATH, "utf8"));
    const base = defaults();
    // Merge rather than replace, so a config written by an older version
    // still gets any fields added since.
    return {
      ...base,
      ...saved,
      states: {
        booting: { ...base.states.booting, ...(saved.states?.booting || {}) },
        home: { ...base.states.home, ...(saved.states?.home || {}) },
        playing: { ...base.states.playing, ...(saved.states?.playing || {}) },
        off: { ...base.states.off, ...(saved.states?.off || {}) },
      },
    };
  } catch {
    return defaults();
  }
}

function save(config) {
  fs.writeFileSync(PATH, JSON.stringify(config, null, 2));
  return config;
}

module.exports = { load, save, defaults };
