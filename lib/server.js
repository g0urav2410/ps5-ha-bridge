const path = require("path");
const express = require("express");
const sharedState = require("./state");

function startServer(psn, port, ps5Ip) {
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
