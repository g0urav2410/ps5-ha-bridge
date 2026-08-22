const fs = require("fs");
const mqtt = require("mqtt");

const { pollPower } = require("./lib/ps5");
const { PsnClient } = require("./lib/psn");
const { startServer } = require("./lib/server");
const sharedState = require("./lib/state");

const options = JSON.parse(fs.readFileSync("/data/options.json", "utf8"));

const PS5_IP = options.ps5_ip;
const MQTT_HOST = options.mqtt_host;
const MQTT_PORT = options.mqtt_port || 1883;
const MQTT_USER = options.mqtt_user || undefined;
const MQTT_PASSWORD = options.mqtt_password || undefined;
const POLL_INTERVAL_MS = (options.poll_interval || 10) * 1000;
const FAST_POLL_MS = 3000; // used briefly right after waking, to catch the boot->home transition
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

client.on("error", (err) => console.error("MQTT error:", err.message));

client.on("connect", () => {
  console.log("Connected to MQTT broker");
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

let consecutiveMisses = 0;
let lastPower = null;
let fastPollUntil = 0;
let lastLoggedLine = null;

async function loop() {
  for (;;) {
    try {
      await tick();
    } catch (err) {
      console.error("Poll failed:", err.message);
    }
    const interval = Date.now() < fastPollUntil ? FAST_POLL_MS : POLL_INTERVAL_MS;
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function tick() {
  const power = await pollPower(PS5_IP);

  if (power === null) {
    consecutiveMisses += 1;
    // Only log while we're still deciding; once we've settled on offline,
    // stay quiet until something actually changes.
    if (consecutiveMisses <= 3) {
      console.log(`No reply from PS5 (miss #${consecutiveMisses})`);
    }
    if (consecutiveMisses === 3) {
      console.log("PS5 unreachable -- reporting offline, silencing further misses");
    }
    if (consecutiveMisses >= 3) {
      client.publish(TOPICS.availability, "offline", { retain: true });
      client.publish(TOPICS.power, "OFF", { retain: true });
      client.publish(TOPICS.state, "off", { retain: true });
      client.publish(TOPICS.activity, "none", { retain: true });
      sharedState.update({ power: null, derivedState: "off", activity: "none" });
      lastPower = "STANDBY";
      fastPollUntil = 0;
      lastLoggedLine = null;
    }
    return;
  }

  if (consecutiveMisses >= 3) {
    console.log("PS5 reachable again");
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
  }
  lastPower = power;

  let derivedState = power === "AWAKE" ? "awake" : "off";
  let activity = power === "AWAKE" ? "unknown" : "none";

  if (power === "AWAKE" && psn.isPaired) {
    try {
      const presence = await psn.getPresence();
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
        console.error("PSN refresh token expired or was revoked -- re-pair via the add-on's setup panel.");
        client.publish(TOPICS.psnAuth, "ON", { retain: true });
      } else {
        console.error("Presence poll failed:", err.message);
      }
    }
  } else if (power === "AWAKE") {
    activity = "unknown";
  }

  client.publish(TOPICS.state, derivedState, { retain: true });
  client.publish(TOPICS.activity, activity, { retain: true });
  sharedState.update({ power, derivedState, activity });

  // Only log when something actually changed -- an unchanging console
  // shouldn't fill the log with identical lines every poll.
  const line = `power=${power} state=${derivedState} activity=${activity}`;
  if (line !== lastLoggedLine) {
    console.log(line);
    lastLoggedLine = line;
  }
}

process.on("SIGTERM", () => {
  client.end(true, {}, () => process.exit(0));
});
