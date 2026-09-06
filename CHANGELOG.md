# Changelog

## 2.5.0

- **Lighting can now be configured in the add-on's panel**, instead of by
  hand-writing automations. Pick which lights to drive, then set effect,
  colour, brightness, effect speed and fade per PS5 state, with a "Try it
  now" button to test without waiting for the console to change state. The
  snapshot-and-restore behaviour (put the lights back how they were when the
  session ends) is a checkbox. This needs the new `homeassistant_api`
  permission so the add-on can call HA services directly.

  The YAML automation still works and is still supported -- if you prefer it,
  just leave built-in lighting switched off.

- **Redesigned the panel.** Live status, per-state cards with toggles, and a
  colour swatch, in a dark neon theme that follows the browser's light/dark
  preference (with a manual override button, since Ingress gives no way to
  read Home Assistant's own theme).

- **Better colour picking on dark cover art.** Dark covers were collapsing to
  washed-out grey -- Demon's Souls resolved to `#567181`, a flat slate that
  looked nothing like the game. Output saturation now has a floor, and
  lightness tracks the art instead of being pinned mid-range.

  The obvious alternative -- scoring hue families by vividness rather than
  size -- was tried and rejected: it fixed dark covers but pushed muted ones
  to neon (The Last of Us went from a faithful olive to `#00ff24`). Family
  selection stays size-weighted; only the final saturation is lifted.

- Fixed the lighting form rebuilding itself on every keystroke, which
  discarded the control being interacted with -- selecting a light did
  nothing as a result.

## 2.4.1

- The add-on's panel now shows the sampled game colour as a swatch beside
  the live status, so it's obvious at a glance whether cover-art sampling is
  working without going to Developer Tools. Hidden when no game is running.

## 2.4.0

- New `Game Color` sensor. While a game is running, the bridge samples the
  game's own cover art (which PSN already gives us) and publishes a
  representative colour, so lighting can match whatever is being played
  without maintaining a per-game mapping. The hex is the sensor state; an
  `rgb` attribute holds a `[r, g, b]` list ready to pass to `light.turn_on`.

  Colours are derived by grouping the art's pixels into hue families rather
  than exact shades -- a sunset spans dozens of oranges, and bucketing by
  exact value splits that one obvious colour so finely that none of the
  buckets looks dominant. Near-black, near-white and grey pixels are
  discarded first (most covers are heavily dark, and without this nearly
  every game resolves to black). The winning family's hue is then rebuilt at
  a vivid saturation and mid lightness, because averaging the family's raw
  RGB comes out washed-out and reads poorly on a strip.

  Each cover is fetched once and cached. Art that yields no usable colour
  (fully greyscale, all black) publishes `none`, leaving the automation to
  apply its own fallback.

## 2.3.2

- Documented the automation example and added a failsafe automation to it,
  for the case where the add-on stops mid-session and so never reports
  `off` (leaving the lights stuck on).

## 2.3.1

- The raw presence diagnostic is now a button in the add-on's panel rather
  than a URL you have to assemble by hand (the panel lives behind a long
  Ingress token, so editing its address was awkward).

## 2.3.0

- Added a diagnostic endpoint, `/api/presence-raw` on the add-on's Web UI,
  which returns exactly what Sony's presence API sends back. Useful when the
  state looks stuck (e.g. always `home` even while a game is running) --
  the raw payload shows whether `gameTitleInfoList` is actually populated.
- A transient presence failure no longer looks like a state change. Before,
  a dropped network call briefly reported `awake`/`unknown` before
  recovering; the last known good state is now held instead.

## 2.2.1

- Faster power-off detection. The 3 confirmation polls that rule out a
  dropped packet were waiting a full `poll_interval` between each, so a
  powered-down console took up to 3x that to register. Those re-checks now
  happen 1s apart -- worst case drops from ~15s to ~7s at the default
  `poll_interval` of 5s (about 4s if you lower it to 2s). Rest mode was
  never affected: the console still answers the ping, so it's caught in a
  single poll.

## 2.2.0

- Split polling into two intervals. The LAN power ping (`poll_interval`,
  now defaulting to 5s instead of 10s) is a local UDP packet and can run
  fast; PSN presence (`presence_interval`, default 15s) is a cloud call and
  is now throttled separately so faster power detection doesn't mean
  hammering Sony's API. Presence is still fetched immediately during the
  post-wake window so the booting -> home transition isn't missed.
- All log lines are now timestamped, and repeated state lines are
  suppressed -- a console sitting in one state logs once, not every poll.

## 2.1.3

- Fixed automations never firing when the PS5 is fully powered off. The
  bridge was publishing availability `offline` for an unreachable console,
  which made Home Assistant mark the entities `unavailable` -- overriding
  the state, so a trigger like `to: "off"` never matched. Availability now
  only reflects whether the bridge itself is running (via MQTT last-will);
  an unreachable PS5 is simply reported as `off`.

## 2.1.2

- Quieter logging: state lines are only written when something actually
  changes, and repeated "No reply from PS5" misses stop once the console
  has been confirmed unreachable (a single line notes it went offline, and
  another notes when it's reachable again).

## 2.1.1

- Fixed the live status card (and `sensor.<name>_state`) freezing on its
  last value (e.g. stuck on `booting`) when the PS5 goes fully unreachable
  instead of resetting to `off`.

## 2.1.0

- Added `icon.png` / `logo.png`
- Added proper add-on `DOCS.md` (shown in the add-on's Documentation tab)

## 2.0.2

- Fixed the Ingress setup panel returning "Cannot GET /" — the page was
  named `setup.html` instead of `index.html`, which Express only auto-serves
  at the root path under that exact name.

## 2.0.1

- Removed `host_network: true` — it's incompatible with Home Assistant
  Ingress (the proxy needs the container's internal Docker IP, which doesn't
  exist under host networking). The LAN polling doesn't need host
  networking anyway since it's unicast request/reply, not broadcast.

## 2.0.0

- Added PSN presence integration: `sensor.<name>_activity` (current game
  title) and a derived `sensor.<name>_state`
  (`off`/`booting`/`home`/`playing`) combining LAN power polling with PSN
  presence.
- Added the Ingress setup panel for one-time PSN pairing, with a
  self-rotating refresh token so re-auth is effectively never needed under
  normal use.
- Added `binary_sensor.<name>_psn_connection_problem` diagnostic sensor.

## 1.0.0

- Initial release: LAN power polling only
  (`binary_sensor.<name>_power`), no PSN account needed.
