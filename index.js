const fs = require("fs");
const mqtt = require("mqtt");

const { pollPower } = require("./lib/ps5");
const { PsnClient } = require("./lib/psn");
const { startServer } = require("./lib/server");
const sharedState = require("./lib/state");
const { log, logError, logState, resetStateLog } = require("./lib/logger");

const options = JSON.parse(fs.readFileSync("/data/options.json", "utf8"));

const PS5_IP = options.ps5_ip;
const MQTT_HOST = options.mqtt_host;
const MQTT_PORT = options.mqtt_port || 1883;
const MQTT_USER = options.mqtt_user || undefined;
const MQTT_PASSWORD = options.mqtt_password || undefined;
const POLL_INTERVAL_MS = (options.poll_interval || 10) * 1000;
// PSN presence is a cloud API call, so it gets its own slower interval --
// the LAN ping is local and free, but hammering Sony risks rate-limiting.
const PRESENCE_INTERVAL_MS = (options.presence_interval || 15) * 1000;
const FAST_POLL_MS = 3000; // used briefly right after waking, to catch the boot->home transition
// A missed reply just needs a dropped-packet re-check, which is instant --
// no reason to wait a full poll_interval between confirmation attempts.
const MISS_RETRY_MS = 1000;
const FAST_POLL_WINDOW_MS = 30000;
const DEVICE_NAME = options.device_name || "PlayStation 5";

if (!PS5_IP) {
  console.error("ps5_ip is not configured. Set it in the add-on's Configuration tab.");
  process.exit(1);
}

const UNIQUE_ID = "ps5_" + PS5_IP.replace(/\./g, "_");
const DEVICE_BLOCK = {
  identifiers: [UNIQUE_ID],
  name: DEVICE_NAME,
  manufacturer: "Sony",
  model: "PlayStation 5",
};

const TOPICS = {
  availability: `ps5-mqtt-bridge/${UNIQUE_ID}/availability`,
  power: `ps5-mqtt-bridge/${UNIQUE_ID}/power`,
  activity: `ps5-mqtt-bridge/${UNIQUE_ID}/activity`,
  state: `ps5-mqtt-bridge/${UNIQUE_ID}/state`,
  psnAuth: `ps5-mqtt-bridge/${UNIQUE_ID}/psn_auth`,
};

const psn = new PsnClient();
startServer(psn, options.ingress_port || 8099, PS5_IP);

const client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
  username: MQTT_USER,
  password: MQTT_PASSWORD,
  will: { topic: TOPICS.availability, payload: "offline", retain: true },
});

client.on("error", (err) => logError(`MQTT error: ${err.message}`));

client.on("connect", () => {
  log("Connected to MQTT broker");
  publishDiscovery();
  client.publish(TOPICS.availability, "online", { retain: true });
  loop();
});

function publishDiscovery() {
  const entities = [
    {
      topic: `homeassistant/binary_sensor/${UNIQUE_ID}_power/config`,
      config: {
        name: "Power",
        unique_id: `${UNIQUE_ID}_power`,
        device_class: "power",
        state_topic: TOPICS.power,
        payload_on: "ON",
        payload_off: "OFF",
        availability_topic: TOPICS.availability,
        device: DEVICE_BLOCK,
      },
    },
    {
      topic: `homeassistant/sensor/${UNIQUE_ID}_activity/config`,
      config: {
        name: "Activity",
        unique_id: `${UNIQUE_ID}_activity`,
        icon: "mdi:controller",
        state_topic: TOPICS.activity,
        availability_topic: TOPICS.availability,
        device: DEVICE_BLOCK,
      },
    },
    {
      topic: `homeassistant/sensor/${UNIQUE_ID}_state/config`,
      config: {
        name: "State",
        unique_id: `${UNIQUE_ID}_state`,
        icon: "mdi:sony-playstation",
        state_topic: TOPICS.state,
        availability_topic: TOPICS.availability,
        device: DEVICE_BLOCK,
      },
    },
    {
      topic: `homeassistant/binary_sensor/${UNIQUE_ID}_psn_auth/config`,
      config: {
        name: "PSN Connection Problem",
        unique_id: `${UNIQUE_ID}_psn_auth`,
        device_class: "problem",
        entity_category: "diagnostic",
        state_topic: TOPICS.psnAuth,
        payload_on: "ON",
        payload_off: "OFF",
        availability_topic: TOPICS.availability,
        device: DEVICE_BLOCK,
      },
    },
  ];

  for (const entity of entities) {
    client.publish(entity.topic, JSON.stringify(entity.config), { retain: true });
  }
}

const MISSES_BEFORE_OFF = 3;
let consecutiveMisses = 0;
let lastPower = null;
let fastPollUntil = 0;
// Cached PSN presence, so the LAN ping can run fast without dragging the
// cloud call along with it at the same rate.
let lastPresence = null;
let lastPresenceAt = 0;

async function loop() {
  for (;;) {
    try {
      await tick();
    } catch (err) {
      logError(`Poll failed: ${err.message}`);
    }
    let interval = POLL_INTERVAL_MS;
    if (consecutiveMisses > 0 && consecutiveMisses < MISSES_BEFORE_OFF) {
      // mid-confirmation: re-check quickly rather than dawdling
      interval = MISS_RETRY_MS;
    } else if (Date.now() < fastPollUntil) {
      interval = FAST_POLL_MS;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function tick() {
  const power = await pollPower(PS5_IP);

  if (power === null) {
    consecutiveMisses += 1;
    // Only log while we're still deciding; once we've settled on offline,
    // stay quiet until something actually changes.
    if (consecutiveMisses <= MISSES_BEFORE_OFF) {
      log(`No reply from PS5 (miss #${consecutiveMisses})`);
    }
    if (consecutiveMisses === MISSES_BEFORE_OFF) {
      log("PS5 unreachable -- treating as off, silencing further misses");
    }
    if (consecutiveMisses >= MISSES_BEFORE_OFF) {
      // NOTE: deliberately do NOT publish availability "offline" here.
      // Availability means "is this bridge working" -- an unreachable PS5
      // is a normal off state, and marking the entities unavailable would
      // hide the state from automations entirely (they'd see "unavailable"
      // instead of "off" and never fire).
      client.publish(TOPICS.power, "OFF", { retain: true });
      client.publish(TOPICS.state, "off", { retain: true });
      client.publish(TOPICS.activity, "none", { retain: true });
      sharedState.update({ power: null, derivedState: "off", activity: "none" });
      lastPower = "STANDBY";
      fastPollUntil = 0;
      lastPresence = null;
      resetStateLog();
    }
    return;
  }

  if (consecutiveMisses >= MISSES_BEFORE_OFF) {
    log("PS5 reachable again");
  }
  consecutiveMisses = 0;
  client.publish(TOPICS.availability, "online", { retain: true });
  client.publish(TOPICS.power, power === "AWAKE" ? "ON" : "OFF", { retain: true });

  if (lastPower !== "AWAKE" && power === "AWAKE") {
    // just woke up: poll presence quickly for a while to catch the
    // booting -> home-screen transition instead of missing it between
    // slow polls
    fastPollUntil = Date.now() + FAST_POLL_WINDOW_MS;
  }
  if (power === "STANDBY") {
    fastPollUntil = 0;
    lastPresence = null;
  }
  lastPower = power;

  let derivedState = power === "AWAKE" ? "awake" : "off";
  let activity = power === "AWAKE" ? "unknown" : "none";

  if (power === "AWAKE" && psn.isPaired) {
    try {
      // Refetch presence only when it's due -- except during the post-wake
      // fast window, where catching the booting -> home moment matters more
      // than sparing a few API calls.
      const presenceDue = Date.now() - lastPresenceAt >= PRESENCE_INTERVAL_MS;
      const inFastWindow = Date.now() < fastPollUntil;
      let presence = lastPresence;
      if (presence === null || presenceDue || inFastWindow) {
        presence = await psn.getPresence();
        lastPresence = presence;
        lastPresenceAt = Date.now();
      }
      client.publish(TOPICS.psnAuth, "OFF", { retain: true });

      const onlineStatus = presence?.basicPresence?.primaryPlatformInfo?.onlineStatus;
      const gameTitle = presence?.basicPresence?.gameTitleInfoList?.[0]?.titleName;

      if (onlineStatus !== "online") {
        derivedState = "booting";
        activity = "none";
      } else if (gameTitle) {
        derivedState = "playing";
        activity = gameTitle;
      } else {
        derivedState = "home";
        activity = "Home Screen";
      }
    } catch (err) {
      if (err.message === "REAUTH_REQUIRED") {
        logError("PSN refresh token expired or was revoked -- re-pair via the add-on's setup panel.");
        client.publish(TOPICS.psnAuth, "ON", { retain: true });
      } else {
        logError(`Presence poll failed: ${err.message}`);
      }
    }
  } else if (power === "AWAKE") {
    activity = "unknown";
  }

  client.publish(TOPICS.state, derivedState, { retain: true });
  client.publish(TOPICS.activity, activity, { retain: true });
  sharedState.update({ power, derivedState, activity });

  // logState() suppresses repeats, so a console sitting in one state
  // logs once instead of every poll.
  logState(`power=${power} state=${derivedState} activity=${activity}`);
}

process.on("SIGTERM", () => {
  client.end(true, {}, () => process.exit(0));
});
