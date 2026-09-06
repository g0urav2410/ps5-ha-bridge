// Small shared, in-memory snapshot of the latest known state, so the
// ingress setup page can show live status without duplicating the poll
// loop or reaching into MQTT.
const state = {
  onlineId: null,
  power: null, // "AWAKE" | "STANDBY" | null (unknown yet)
  derivedState: null, // "off" | "booting" | "home" | "playing" | "awake"
  activity: null,
  gameColor: null, // hex sampled from the running game's cover art
  lastUpdated: null,
};

function update(patch) {
  Object.assign(state, patch, { lastUpdated: Date.now() });
}

function snapshot() {
  return { ...state };
}

module.exports = { update, snapshot };
