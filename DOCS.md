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
| `sensor.<name>_game_color` | hex colour sampled from the running game's cover art, or `none`. An `rgb` attribute holds `[r, g, b]`. | Yes |
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

## Game colour

While a game is running, the bridge samples that game's cover art and
publishes a representative colour, so a light can match whatever is being
played without you maintaining a list of games. Use it like this:

```yaml
rgb_color: >
  {{ state_attr('sensor.playstation_5_game_color', 'rgb') or [255, 0, 0] }}
```

The `or [...]` is the fallback, and it lives in *your* automation rather than
in the add-on -- some cover art (fully greyscale, or all black) yields no
usable colour, and the bridge publishes `none` in that case so you can decide
what should happen.

Two notes on getting a *uniform* colour on a strip:

- WLED's palette must be `Default`. With any other palette selected, the
  palette overrides `rgb_color` and paints a spread of colours along the
  strip. Set `select.wled_color_palette` to `Default` in the same automation.
- Use the `Solid` effect (or set the colour on an animated effect that
  respects the primary colour, like `Candle Multi`).

### How the colour is chosen

Cover art is not one flat colour, so the bridge looks for the dominant colour
*family*:

1. Pixels that carry no identity are discarded -- near-black, near-white and
   greys. Most covers are heavily dark, and skipping this step resolves
   almost every game to black.
2. The rest are grouped by hue family, not exact shade. A sunset spans dozens
   of distinct oranges; bucketing by exact value splits that one obvious
   colour so finely that no bucket looks dominant.
3. The largest family wins, nudged slightly toward vivid families.
4. Its hue is rebuilt at a vivid saturation and mid lightness. Averaging the
   family's raw RGB instead comes out washed-out -- a vivid orange averages
   to muddy brick, which reads poorly on a strip.

Each cover is fetched once (at 64px, a couple of KB) and cached for as long
as the add-on runs.

## Lighting (built in)

The add-on's panel can drive your lights directly, so no automation is
needed. Turn on **Enable built-in lighting control**, pick the lights, and
configure each state:

| Setting | Notes |
|---|---|
| Effect | Comes from the light's own effect list. Only meaningful for lights that have one (WLED does). |
| Colour | A fixed colour, or **use game colour** to take it from the running game's cover art. |
| Brightness | 0-255. |
| Effect speed | Only applied when a matching `number.<light>_speed` entity exists, which is how WLED exposes it. |
| Fade | Transition time in seconds. |

Each state's card previews itself: the simulated strip runs around the card's
border the way a bias light wraps a TV, blurred so what you see is the spill,
with a crisp bar underneath for judging the effect itself. Both animate at
the speed, brightness and colour configured. The simulations are approximations: WLED has around 180
effects, so names are matched loosely to about a dozen behaviours, and
anything unrecognised is shown as generic motion rather than guessed at.

With **use game colour** on, the colour swatch becomes the *fallback*, used
when a game has no usable cover art. Each card states which colour is
currently in play.

The light picker is searchable and grouped by room.

**Restore previous lighting when the PS5 turns off** snapshots the lights
when a session starts and puts them back afterwards. If the snapshot is gone
(Home Assistant restarted mid-session), the lights are simply turned off.

The WLED palette is forced to `Default` before applying a colour, since any
other palette overrides the colour and spreads a gradient along the strip.

This needs the `homeassistant_api` permission, which the add-on declares --
Home Assistant will ask you to approve it.

### Prefer automations instead?

Leave built-in lighting switched off and the add-on won't touch your lights;
drive them from `sensor.<name>_state` as before.

## Automations

A worked example, heavily commented, lives in the repo at
`examples/ps5-lighting-automation.yaml`. It covers driving a WLED strip from
the state sensor and restoring the previous lighting afterwards.

### Failsafe

One failure mode is worth guarding against: if this add-on stops while a
session is in progress (crash, add-on update, host reboot), its MQTT
last-will marks the entities `unavailable`. An automation triggering on
`to: "off"` will never fire, so whatever lighting was active stays on
indefinitely.

The example file includes a second, separate `PS5 Lighting Failsafe`
automation for this: it triggers on the state being `unavailable` for 5
minutes, then restores the lights. The delay lets brief restarts pass
without disturbing anything.

Whether you need it is a judgement call -- add-ons with the watchdog enabled
usually restart within seconds, well inside the 5-minute window. It matters
if lights being stuck on overnight would bother you; skip it if you'd rather
just flip them off by hand on the rare occasion.

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
