# PS5 to MQTT Bridge

Turns your PS5's power state — and optionally what you're actually playing —
into MQTT sensors, so you can trigger lights (or anything else) in Home
Assistant from what's happening on the console.

## What it publishes

| Entity | Values | Requires PSN setup? |
|---|---|---|
| `binary_sensor.<name>_power` | `on` / `off` | No |
| `sensor.<name>_state` | `off` / `booting` / `home` / `playing` | Only for `booting`/`home`/`playing` — otherwise reads `off`/`awake` |
| `sensor.<name>_activity` | current game title, `Home Screen`, or `none` | Yes |
| `binary_sensor.<name>_psn_connection_problem` | `on` if PSN re-auth is needed | Diagnostic |

## Configuration

| Option | Description |
|---|---|
| `ps5_ip` | Your PS5's LAN IP. Set a DHCP reservation for it on your router so it never changes. |
| `mqtt_host` | Your MQTT broker's address. Use `core-mosquitto` if you're running the Mosquitto add-on. |
| `mqtt_port` | Usually `1883`. |
| `mqtt_user` / `mqtt_password` | Credentials for that broker. |
| `poll_interval` | Seconds between LAN power pings (2–300). Default `5`. This is a local UDP packet, so it's cheap — lower it for snappier on/off reactions. Governs `off` ↔ `booting`, i.e. powering on and off. |
| `presence_interval` | Seconds between PSN presence checks (5–600). Default `15`. This one is a cloud API call, so keep it well above `poll_interval` to avoid rate-limiting. Governs `home` ↔ `playing`, i.e. starting and closing a game. Sony's own presence lag is a few seconds, so going below ~5 buys little. |
| `device_name` | Display name for the device in Home Assistant. |

## First run

1. Set `ps5_ip` and your MQTT details above, then **Start** the add-on.
2. Check the **Log** tab — you should see `Connected to MQTT broker` and a
   timestamped `power=... state=... activity=...` line. That line is only
   written when something changes, so a steady console logs once, not
   every poll.
3. Power detection works immediately with no further setup — check
   Settings → Devices & Services → MQTT in Home Assistant for the new device.

## Optional: connect your PSN account

Open the add-on's **Web UI** (or the sidebar panel, if `panel_title` shows up
for you) — it walks through a one-time step:

1. Log into `playstation.com` in any browser on the same device.
2. Follow the link on the page to get a login code (a page that prints
   `{"npsso":"..."}`).
3. Paste the whole thing into the box, click Connect.

This unlocks `booting`, `home`, and `playing` states plus the current game
title. It's a genuine one-time step — the add-on automatically rotates its
own refresh token forever after, as long as it keeps running at least once
every couple of months. If it ever does need to be redone (e.g. you changed
your PSN password), the `psn_connection_problem` sensor turns on and the
panel shows "Not connected" again.

## Known limits

- This relies on Sony's local discovery protocol and the same presence API
  the official PS app uses — both are unofficial/reverse-engineered, not a
  published API. They're read-only here and could change at any time.
- Power detection distinguishes awake vs. rest mode, not true cold power-off.
  A PS5 that's fully unplugged won't reply, and `binary_sensor.power`'s
  availability drops to `offline` after 3 missed polls in a row.
- Presence only reports actual **games**, not media apps — watching YouTube
  or Netflix reads the same as sitting at the home screen (`home`).
- There's no way to read the console's actual light-bar color — nothing
  exposes that. Use `sensor.<name>_state` to drive your own light colors
  and effects per state instead.
