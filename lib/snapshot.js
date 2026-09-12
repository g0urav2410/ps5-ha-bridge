const fs = require("fs");
const hass = require("./hass");
const { log, logError } = require("./logger");

// Home Assistant's own scene.create was what this used to rely on, but those
// scenes live in memory only -- an HA restart mid-session threw the snapshot
// away and the lights got switched off instead of put back. So capture the
// attributes ourselves and write them to /data, which survives a restart of
// either side.
const PATH = "/data/snapshot.json";

// Only the attributes that describe how a light looks. Copying everything
// back would include read-only ones, which HA rejects.
const COLOR_FIELDS = ["rgb_color", "rgbw_color", "rgbww_color", "hs_color", "xy_color", "color_temp_kelvin"];

function read(key) {
  try {
    const all = JSON.parse(fs.readFileSync(PATH, "utf8"));
    return all[key] || null;
  } catch {
    return null;
  }
}

function write(key, value) {
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(PATH, "utf8"));
  } catch {}
  if (value === null) delete all[key];
  else all[key] = value;
  try {
    fs.writeFileSync(PATH, JSON.stringify(all, null, 2));
  } catch (err) {
    logError(`Could not persist snapshot: ${err.message}`);
  }
}

function has(key) {
  return !!read(key);
}

// What the bridge last sent to each light, kept so it can recognise its own
// output later. Persisted, because the case this exists for is the add-on
// restarting and no longer remembering what it did before.
function noteApplied(entityId, data) {
  const all = read("applied") || {};
  all[entityId] = {
    brightness: data.brightness ?? null,
    effect: data.effect ?? null,
    rgb_color: data.rgb_color ?? null,
  };
  write("applied", all);
}

function clearApplied() {
  write("applied", null);
}

function near(a, b, tol) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) <= tol;
}

// Does this light currently look like something the bridge put there?
// Colours make a round trip through the light's own colour space, so exact
// equality is too strict -- a few units either way is still our own output.
function looksApplied(entity, applied) {
  if (!applied || entity.state !== "on") return false;
  const a = entity.attributes || {};
  if (!near(a.brightness, applied.brightness, 3)) return false;
  if ((a.effect || null) !== (applied.effect || null)) return false;
  if (applied.rgb_color) {
    const cur = a.rgb_color;
    if (!cur) return false;
    if (!cur.every((v, i) => near(v, applied.rgb_color[i], 4))) return false;
  }
  return true;
}

// Records each light exactly as it is right now.
async function capture(key, lights) {
  if (!lights?.length) return false;
  try {
    const states = await hass.getStates();
    const byId = new Map(states.map((e) => [e.entity_id, e]));
    const applied = read("applied") || {};
    const saved = [];
    let skipped = 0;
    for (const id of lights) {
      const e = byId.get(id);
      if (!e) continue;
      // Never record the bridge's own output as if it were the user's
      // lighting -- that would "restore" the light to whatever the PS5 had
      // it doing, and the original would be gone for good.
      if (looksApplied(e, applied[id])) {
        skipped++;
        continue;
      }
      const a = e.attributes || {};
      const entry = { entity_id: id, on: e.state === "on" };
      if (entry.on) {
        if (a.brightness != null) entry.brightness = a.brightness;
        if (a.effect) entry.effect = a.effect;
        // Whichever colour form the light is actually using. Sending back a
        // different one than it reported can land on a different colour.
        for (const f of COLOR_FIELDS) {
          if (a[f] != null && a.color_mode && f.startsWith(a.color_mode)) { entry[f] = a[f]; break; }
        }
        if (!COLOR_FIELDS.some((f) => entry[f] != null)) {
          for (const f of COLOR_FIELDS) if (a[f] != null) { entry[f] = a[f]; break; }
        }
      }
      saved.push(entry);
    }
    if (skipped) {
      log(`Skipped ${skipped} light(s) already showing the bridge's own lighting`);
    }
    if (!saved.length) {
      log("Nothing to snapshot -- every light is already under the bridge's control");
      return false;
    }
    write(key, { at: Date.now(), lights: saved });
    log(`Snapshotted ${saved.length} light(s)`);
    return true;
  } catch (err) {
    logError(`Could not snapshot lights: ${err.message}`);
    return false;
  }
}

// Puts them back exactly: the ones that were off go off, the ones that were
// on get their own brightness, colour and effect again.
async function restore(key, transition = 1) {
  const snap = read(key);
  if (!snap) return false;
  let ok = true;
  for (const entry of snap.lights) {
    try {
      if (!entry.on) {
        await hass.callService("light", "turn_off", { entity_id: entry.entity_id, transition });
        continue;
      }
      const data = { entity_id: entry.entity_id, transition };
      if (entry.brightness != null) data.brightness = entry.brightness;
      if (entry.effect) data.effect = entry.effect;
      for (const f of COLOR_FIELDS) if (entry[f] != null) { data[f] = entry[f]; break; }
      await hass.callService("light", "turn_on", data);
    } catch (err) {
      ok = false;
      logError(`Could not restore ${entry.entity_id}: ${err.message}`);
    }
  }
  write(key, null);
  if (key !== "preview") clearApplied();
  log(ok ? "Lights put back the way they were" : "Lights put back, with errors");
  return true;
}

function forget(key) {
  write(key, null);
}

module.exports = { capture, restore, has, forget, noteApplied, clearApplied };
