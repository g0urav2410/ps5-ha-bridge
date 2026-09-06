const { logError } = require("./logger");

// Talks to Home Assistant's REST API from inside the add-on. Requires
// `homeassistant_api: true` in config.yaml, which is what makes the
// SUPERVISOR_TOKEN usable against the core API.
const BASE = "http://supervisor/core/api";
const TOKEN = process.env.SUPERVISOR_TOKEN;

async function request(path, options = {}) {
  if (!TOKEN) throw new Error("SUPERVISOR_TOKEN missing (is homeassistant_api enabled?)");
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`HA API ${path} -> HTTP ${res.status}`);
  }
  return res.json();
}

async function callService(domain, service, data) {
  return request(`/services/${domain}/${service}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function getStates() {
  return request("/states");
}

// Areas aren't in /states, so ask the template engine for them. Purely a
// nicety for grouping the light picker -- if it fails, everything still
// works, the lights just aren't grouped.
const AREA_TEMPLATE =
  "{% for e in states.light %}{{ e.entity_id }}|{{ area_name(e.entity_id) or '' }};;{% endfor %}";

async function getAreasByEntity() {
  try {
    const res = await fetch(`${BASE}/template`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ template: AREA_TEMPLATE }),
    });
    if (!res.ok) return {};
    const text = await res.text();
    const map = {};
    for (const entry of text.split(";;")) {
      const [id, area] = entry.split("|");
      if (id && id.trim()) map[id.trim()] = (area || "").trim();
    }
    return map;
  } catch {
    return {};
  }
}

// Lights, with the extras the UI needs to build sensible controls:
// which effects they support, whether they can do colour, and which room
// they're in so a long list stays navigable.
async function listLights() {
  const [states, areas] = await Promise.all([getStates(), getAreasByEntity()]);
  return states
    .filter((e) => e.entity_id.startsWith("light."))
    .map((e) => ({
      entity_id: e.entity_id,
      name: e.attributes?.friendly_name || e.entity_id,
      area: areas[e.entity_id] || "",
      effects: e.attributes?.effect_list || [],
      supportsColor: (e.attributes?.supported_color_modes || []).some((m) =>
        ["rgb", "rgbw", "rgbww", "hs", "xy"].includes(m),
      ),
    }))
    .sort((a, b) => (a.area || "~").localeCompare(b.area || "~") || a.name.localeCompare(b.name));
}

// WLED exposes effect speed and palette as separate entities alongside the
// light (light.wled -> number.wled_speed, select.wled_color_palette). Find
// them by matching the light's object_id, so the UI can offer those controls
// only when they actually exist.
async function findWledCompanions(lightEntityId) {
  const objectId = lightEntityId.split(".")[1];
  const states = await getStates();
  const ids = new Set(states.map((e) => e.entity_id));

  const speed = [`number.${objectId}_speed`, `number.${objectId}_effect_speed`].find((id) =>
    ids.has(id),
  );
  const palette = [`select.${objectId}_color_palette`, `select.${objectId}_palette`].find((id) =>
    ids.has(id),
  );
  return { speed: speed || null, palette: palette || null };
}

async function isAvailable() {
  try {
    await request("/");
    return true;
  } catch (err) {
    logError(`Home Assistant API unreachable: ${err.message}`);
    return false;
  }
}

module.exports = { callService, getStates, listLights, findWledCompanions, isAvailable };
