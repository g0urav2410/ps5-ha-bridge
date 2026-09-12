# PS5 to MQTT Bridge

Watches a PlayStation 5 and publishes what it's doing to MQTT, so Home
Assistant can react to it. It can also drive your lights directly, without
you writing any automations.

## What it watches

Two independent sources, because neither alone is enough:

- **A LAN ping** to the console (UDP port 9302, Sony's local discovery
  protocol). Needs no account and no pairing. Tells you the console is awake
  or in rest mode, within seconds.
- **PSN presence** (Sony's account API). Needs a one-time sign-in. Tells you
  whether you're at the home screen or in a game, and which game.

Combined, they give a state richer than on/off:

| LAN ping | PSN presence | `sensor.<name>_state` |
|---|---|---|
| rest mode / unreachable | — | `off` |
| awake | not online yet | `booting` |
| awake | online, no game | `home` |
| awake | online, in a game | `playing` |

Without the PSN step you still get `off` and `awake`, plus the power sensor.

## Entities

| Entity | Values |
|---|---|
| `binary_sensor.<name>_power` | `on` while the console is awake |
| `sensor.<name>_state` | `off` / `booting` / `home` / `playing` (or `awake` without PSN) |
| `sensor.<name>_activity` | the running game's title, `Home Screen`, or `none` |
| `sensor.<name>_game_color` | a colour sampled from the running game's cover art, or `none`. An `rgb` attribute holds `[r, g, b]`. |
| `binary_sensor.<name>_psn_connection_problem` | `on` when PSN needs signing in to again (diagnostic) |

`<name>` comes from the `device_name` option, so by default these are
`sensor.playstation_5_state` and so on.

## Configuration

| Option | Description |
|---|---|
| `ps5_ip` | The console's IP. Give it a DHCP reservation on your router so it doesn't move. |
| `mqtt_host` | Your broker. `core-mosquitto` if you use the Mosquitto add-on. |
| `mqtt_port` | Usually `1883`. |
| `mqtt_user` / `mqtt_password` | Credentials for that broker. |
| `poll_interval` | Seconds between LAN pings (2–300, default 5). A local UDP packet, so it's cheap. Governs how fast `off` ↔ `booting` reacts. |
| `presence_interval` | Seconds between PSN checks (5–600, default 15). A call to Sony's servers, so keep it well above `poll_interval`. Governs how fast `home` ↔ `playing` reacts. Sony's own lag is a few seconds, so going below 5 buys nothing. |
| `device_name` | What the device is called in Home Assistant. |

### How quickly it reacts

- **Waking up** shows within one `poll_interval`.
- **Rest mode** also shows within one `poll_interval` — the console still
  answers the ping, it just reports standby.
- **Fully powered down or unplugged** takes three missed pings to confirm.
  Those retries are a second apart rather than a full interval, so it lands
  in roughly `poll_interval + 2s`.
- **Starting or closing a game** is bounded by `presence_interval` plus
  Sony's own propagation delay. This one will never feel instant.

## First run

1. Set `ps5_ip` and your MQTT details, then start the add-on.
2. Check the **Log** tab. You want `Connected to MQTT broker` and a
   timestamped `power=… state=… activity=…` line. That line is only written
   when something changes, so a console sitting still logs once, not on
   every poll.
3. Power detection works immediately. Look under Settings → Devices &
   Services → MQTT for the new device.

## Connecting your PSN account

Open the add-on's **Web UI**. It walks through one copy-paste:

1. Sign in to `playstation.com` in a browser.
2. Open the login-code link on the page. It prints `{"npsso":"…"}`.
3. Paste that in and press Connect.

This unlocks `booting`, `home`, `playing`, the game title, and the game
colour.

### Why this is only asked once

Sony issues a **new** refresh token every time the old one is used, with the
expiry reset. The add-on stores whichever one it was last handed. Since it
refreshes while polling presence, the token keeps rolling forward and never
reaches its expiry.

It only breaks if the add-on is stopped for a couple of months, or if you
change your PSN password (which revokes app sessions). When that happens the
`psn_connection_problem` sensor turns on and the panel shows the connect
steps again.

### If the game title never appears

Use **Show what PSN returns** in the panel. If `gameTitleInfoList` is empty
while a game is running, Sony is withholding it rather than the add-on
losing it — check **Online Status and Now Playing** under the console's
privacy settings.

## Lighting, without automations

The panel can drive your lights itself. Turn on the toggle in the Lighting
section, choose which lights to control, then set up each state.

The four states are listed as rows. Opening one shows:

| Setting | Notes |
|---|---|
| Effect | Everything the chosen lights report, pooled. Click to browse the list, or type to filter. Lights that don't have the chosen effect just take the colour, and the panel says how many will run it. Leave blank for none. |
| Colour | A wheel for hue and saturation, a bar for shade, quick colours, and hex or R/G/B entry. On **Playing** only, *Take it from the game* uses the cover-art colour instead, and the swatch becomes the fallback for games with no usable artwork. |
| Brightness | The light's output, 1–255. Separate from the picker's shade, which changes the colour itself. |
| Speed | Effect speed. Only applied when the light exposes a matching `number.<light>_speed` entity, which is how WLED does it. |
| Fade | Transition time in seconds. |
| React to this state | Whether this state does anything at all. On **Off** this controls the switch-off fallback only — putting the lights back is governed by its own toggle and happens either way. |

### Per-light settings

A row appears for each chosen light once there are two of them, because a
mixed set rarely wants the same treatment:

| Setting | Notes |
|---|---|
| The row's switch | Whether the bridge touches this light at all. Off leaves it entirely alone — and switching it off mid-session hands that light straight back to what it was doing, while the others carry on. Switching it on mid-session brings the light in immediately. |
| Joins in at | Which of the four states this light reacts to. A room lamp can sit out the home screen and come on only once a game starts, while a strip follows everything. |
| Brightness | A percentage of whatever the state asks for, so one light can run dimmer than the rest without editing every state. |
| Hue trim / Saturation | Nudges this light's colour. |

The **Result** swatches show each state's own colour above this light's
version of it. Match them by eye against the wall rather than by the
numbers — that's the only reference that counts.

Why a trim is needed at all: two lights given the same RGB value rarely look
the same. A bulb and an LED strip have different primaries and different
white points, so even plain white lands warm on one and blue on the other.
Nothing in Home Assistant reports a light's white point, so this can't be
corrected automatically.

**Try it now** applies a state's settings to the real lights immediately. It
snapshots them first, turns into **Stop and restore**, and reverts on its own
after 45 seconds if you forget.

**Put the lights back when the PS5 turns off** records each light exactly as
it was the first time the add-on touches it — brightness, colour, effect, and which ones
were switched off — and replays that at the end. The record is written to the
add-on's own storage, so it survives the add-on or Home Assistant restarting
mid-session, and it's taken even if the add-on started up with the console
already on.

Only lights the add-on actually drives are recorded — one switched off in
the per-light settings, or sitting out every state, is left entirely alone,
including anything you change on it mid-session. Lights chosen part-way
through a session are picked up and restored with the rest.

Only lighting the add-on didn't put there is ever recorded: it remembers what
it last sent to each light, and a light still showing that is left out rather
than captured. Otherwise a lost record would be replaced by the PS5's own
colours, and the lighting you actually had would be gone for good. If there's
no record to replay at all, the lights are switched off instead.

### Things worth knowing

- **An effect a light doesn't have is simply not sent to it.** Home Assistant
  rejects the whole call otherwise, which used to mean a plain bulb chosen
  alongside a strip took nothing at all — not even the colour.
- **Settings apply as you change them.** There's no Save button. Switching a
  state off while the console is in that state releases the lights straight
  away rather than waiting for the next transition, and editing the active
  state updates the lights live.
- **Effects are not simulated.** WLED has around 180 of them and any
  approximation would mislead, so the panel shows only the colour, which it
  can state accurately. Use *Try it now* to see an effect on the real strip.
- **The WLED palette is forced to `Default`** before a colour is applied. Any
  other palette overrides the colour and spreads a gradient along the strip.
- This needs the `homeassistant_api` permission, which the add-on declares.
  Home Assistant will ask you to approve it.

### Prefer automations?

Leave the Lighting toggle off and the add-on won't touch your lights. Drive
them from `sensor.<name>_state` yourself. A worked example is in the repo at
`examples/ps5-lighting-automation.yaml`, including a failsafe for the case
where the add-on stops mid-session and never gets to report `off`.

## Game colour

While a game is running, the add-on fetches that game's cover art (at 64px,
a couple of KB, cached per game) and derives a colour from it.

Cover art is not one flat colour, so it looks for the dominant colour
*family*:

1. Pixels carrying no identity are discarded — near-black, near-white and
   greys. Most covers are dark enough that skipping this step resolves almost
   every game to black.
2. The rest are grouped by hue family rather than exact shade. A sunset spans
   dozens of oranges, and bucketing by exact value splits that one obvious
   colour so finely that no bucket looks dominant.
3. The largest family wins, nudged slightly toward vivid ones.
4. Its hue is rebuilt with a floor under the saturation, and a lightness that
   follows the artwork rather than being pinned mid-range.

Step 4 is deliberate. Without the saturation floor, dark covers collapse to
grey — Demon's Souls resolved to `#567181`, a flat slate. The obvious
alternative, scoring families by vividness instead of size, was tried and
rejected: it fixed dark covers but pushed muted ones to neon, taking The Last
of Us from a faithful olive to `#00ff24`.

Art that yields nothing usable (fully greyscale, all black) publishes `none`,
so an automation can apply its own fallback.

## Known limits

- This is built on **unofficial, reverse-engineered protocols** — the same
  ones community projects like `playactor` and `psn-api` use. Sony could
  change either at any time. Both are read-only here.
- Power detection is awake vs rest mode, not true cold-off. An unplugged
  console simply stops answering, and after three missed pings is reported
  as `off`.
- `availability` deliberately stays online when the console is off. It tracks
  whether the *bridge* is running, not the console. Marking the entities
  unavailable would hide the state from automations entirely.
- PSN presence reports **games**, not apps. Watching YouTube or Netflix reads
  the same as sitting on the home screen.
- Remote Play is indistinguishable from playing in the room. The game runs on
  the console either way, and nothing in either data source says otherwise.
- Waking or shutting down the console from Home Assistant isn't supported.
  That needs console pairing and an encrypted session, which is separate work.
