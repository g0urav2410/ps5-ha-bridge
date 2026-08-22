const dgram = require("dgram");

// PS5 discovery/wake port and protocol version, per Sony's local discovery
// protocol (same one used by the official Remote Play app). No auth needed.
const WAKE_PORT = 9302;
const DISCOVERY_VERSION = "00030010";
const REPLY_TIMEOUT_MS = 1500;

function buildSearchPacket() {
  return Buffer.from(`SRCH * HTTP/1.1\ndevice-discovery-protocol-version:${DISCOVERY_VERSION}\n`);
}

function parseReply(buf) {
  const statusLine = buf.toString().split("\n")[0] || "";
  const code = (statusLine.split(" ")[1] || "").trim();
  // The PS5 replies "HTTP/1.1 620 Server Standby" while asleep, or
  // "HTTP/1.1 200 OK" while awake.
  return code === "620" ? "STANDBY" : "AWAKE";
}

function pollPower(ps5Ip) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), REPLY_TIMEOUT_MS);

    socket.on("message", (msg) => finish(parseReply(msg)));
    socket.on("error", () => finish(null));

    socket.send(buildSearchPacket(), WAKE_PORT, ps5Ip);
  });
}

module.exports = { pollPower };
