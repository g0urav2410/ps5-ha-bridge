const path = require("path");
const express = require("express");
const sharedState = require("./state");
const lightConfig = require("./lightconfig");
const hass = require("./hass");

function startServer(psn, port, ps5Ip, lighting) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/api/status", (req, res) => {
    res.json({ paired: psn.isPaired, ps5Ip, ...sharedState.snapshot() });
  });

  app.post("/api/pair", async (req, res) => {
    const { npsso } = req.body || {};
    if (!npsso || typeof npsso !== "string") {
      return res.status(400).json({ error: "Missing npsso value." });
    }
    try {
      const profile = await psn.pairWithNpsso(npsso);
      sharedState.update({ onlineId: profile.onlineId });
      res.json({ onlineId: profile.onlineId });
    } catch (err) {
      console.error("Pairing failed:", err.message);
      res.status(400).json({
        error: "Could not connect. Double-check the code was copied fully and try again.",
      });
    }
  });

  // Diagnostic: dump exactly what Sony returns for presence. Useful when
  // the state seems stuck (e.g. always 'home' even while in a game) -- the
  // raw payload shows whether gameTitleInfoList is actually being sent.
  app.get("/api/presence-raw", async (req, res) => {
    if (!psn.isPaired) {
      return res.status(400).json({ error: "Not connected to PSN." });
    }
    try {
      const presence = await psn.getPresence();
      res.json(presence);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- built-in lighting control -------------------------------------------

  app.get("/api/lights", async (req, res) => {
    try {
      res.json(await hass.listLights());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/lighting", (req, res) => {
    res.json(lightConfig.load());
  });

  app.put("/api/lighting", (req, res) => {
    try {
      const saved = lightConfig.save(req.body);
      res.json(saved);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Apply one state's lighting immediately, so settings can be tried out
  // without waiting for the console to actually enter that state.
  app.post("/api/lighting/preview", async (req, res) => {
    const { state } = req.body || {};
    const config = lightConfig.load();
    const stateConfig = config.states?.[state];
    if (!stateConfig) return res.status(400).json({ error: "Unknown state." });
    if (!config.lights?.length) return res.status(400).json({ error: "No lights selected." });
    try {
      const snap = sharedState.snapshot();
      const gameColor = snap.gameColor
        ? { hex: snap.gameColor, rgb: require("./lighting").hexToRgb(snap.gameColor) }
        : null;
      if (state === "off") {
        await lighting.handleOff(config, stateConfig);
      } else {
        await lighting.applyState(config, stateConfig, gameColor);
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/unpair", (req, res) => {
    psn.forget();
    sharedState.update({ onlineId: null });
    res.json({ ok: true });
  });

  app.listen(port, () => {
    console.log(`Setup panel listening on port ${port}`);
  });
}

module.exports = { startServer };
