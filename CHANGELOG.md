# Changelog

## 3.3.1

- **A light taken out of the bridge's control mid-session is handed back
  straight away.** Switching a light's own toggle off while a game was
  running, unticking every state, or removing it from the selection left it
  stuck on the PS5's colours until the console turned off -- so the toggle
  looked like it had done nothing. It now returns to what it was doing
  before the bridge touched it, immediately, while the other lights carry on.
  Turning a light's toggle back on mid-game already worked: it joins in at
  once and is restored with the rest at the end.

## 3.3.0

Three restore bugs, found by working through what actually happens with a
mixed set of lights rather than the happy path.

- **Switching the `Off` row off cancelled the restore.** That row reads as
  "don't switch my lights off", but it also skipped putting them back, so the
  lights stayed on the PS5's colours indefinitely and the "put the lights
  back" toggle was silently ignored. Restoring is now governed by its own
  setting, and the row only controls the switch-off fallback.
- **A light told to sit out was still snapshotted and restored.** A bulb with
  its own switch off, or sitting out every state, got recorded at the start of
  a session and put back at the end -- undoing anything the user did to it in
  between, on a light the bridge was told not to touch. Only lights the bridge
  may actually drive are recorded now.
- **A light added mid-session was never restored.** The snapshot was taken
  once and then left alone, so a light chosen later finished the session stuck
  on the PS5's colours. Snapshots now merge: lights already recorded keep
  their original entry, and newly chosen ones are picked up.

## 3.2.2

- **The bridge no longer records its own lighting as if it were yours.** It
  now remembers what it last sent to each light, and a light still showing
  that is left out of the snapshot rather than captured. Without this, losing
  the stored snapshot mid-session meant the next capture would record the
  PS5's own colours and "restore" to them later, with the original gone for
  good. Only lighting the bridge didn't put there is ever recorded.

## 3.2.1

- **The lights are recorded the first time the bridge touches them**, rather
  than on the `off` -> awake transition. Those are normally the same moment,
  but they come apart when the add-on starts while the console is already on
  -- installed mid-session, or restarted with no stored snapshot. The
  transition has already gone by, while the lights are still exactly as you
  left them, which is the state worth keeping. Previously that session ended
  with the lights simply switched off.

## 3.2.0

Mixed sets of lights, and lights that come back the way you left them.

- **Per-light settings.** Each chosen light gets a switch of its own, the
  states it joins in at, and a brightness, hue and saturation trim. A room
  lamp can sit out the home screen and come on only once a game starts,
  while the strip follows everything.
- **Lights without effects no longer break.** Sending an effect name a light
  doesn't know made Home Assistant reject the whole call, so a plain bulb
  chosen alongside a WLED strip took nothing at all -- not even the colour.
  Effects are now only sent to lights that have them, and the effect list is
  the union of every chosen light rather than the first one's.
- **A colour trim, for lights that don't agree.** The same rgb value lands
  warmer on a bulb than on a strip, and no two sets of LED primaries match.
  Hue and saturation can now be nudged per light, with a swatch showing the
  state's colour above this light's version of it, so it can be matched by
  eye against the wall.
- **Restoring is now exact, and survives a restart.** Snapshots were made
  with `scene.create`, which lives in memory only -- an HA restart mid-session
  threw it away and the lights were switched off instead of put back. The
  add-on now records each light's own state to `/data` and replays it, so
  brightness, colour, effect and which lights were off all come back, even if
  the add-on or Home Assistant restarted in between.

## 3.1.3

Documentation brought back in line with the code, which had drifted over the
last several releases.

- Corrected the diagnostic sensor's name in the README. It was documented as
  `binary_sensor.<name>_psn_auth`, but the entity ID follows the entity's
  name, so it is really `binary_sensor.<name>_psn_connection_problem`. Anyone
  who had wired an automation to the documented name would have found it
  matched nothing.
- Corrected the description of how the game colour is derived. It still
  described the pre-2.5 behaviour ("vivid saturation and mid lightness")
  rather than the saturation floor and artwork-following lightness that
  actually ship, and it omitted why: dark covers were collapsing to grey.
- Removed descriptions of interface that no longer exists -- the per-card
  glow and the "Enable built-in lighting control" label both predate the 3.0
  redesign.
- Documented what was never written down: how quickly each transition is
  detected and why, the colour picker, live-applying settings, the preview
  and its 45-second revert, and the effect list.
- Added the MIT licence file the README claimed existed.
- Noted at the top of the automation example that the add-on can now do all
  of it from its own panel, so the YAML is for logic the panel can't express.

## 3.1.2

- The colour wheel is much finer to work with. It was squeezed to 148px
  beside the controls, where one pixel covered over two degrees of hue --
  far coarser than WLED's own control. The picker is now stacked so the
  wheel gets the panel's full width (240px, drawn at 480px on a retina
  screen), which is about 0.5 degrees per pixel: five times finer.
- Arrow keys nudge the wheel by one degree, or ten with Shift, for when
  dragging still isn't exact enough. Hex and R/G/B entry remain for setting
  an exact value outright.

## 3.1.1

- Fixed the colour wheel being a quarter turn out. It was painted with a CSS
  `conic-gradient(from 90deg, ...)`, which puts red at 3 o'clock, while the
  hit-testing and the marker both assumed red at 12 -- so the colour you got
  was 90 degrees away from the one you pressed.

  The wheel is now drawn pixel by pixel on a canvas using the same
  angle-and-radius mapping the hit-testing uses, so the two cannot drift
  apart again. This also made it testable: pressing a point and reading the
  pixel underneath now agree, which is the check that would have caught the
  original bug (the earlier test only compared the maths against itself).

## 3.1.0

- Replaced the browser's colour input with a picker shaped like WLED's own
  controls: a hue/saturation wheel, a shade bar, quick colours, and hex or
  R/G/B entry. The native control handed you the operating system's colour
  dialog, which knows nothing about LED colour and drops you out of the
  panel entirely.
- The first quick colour is the live colour sampled from the running game,
  ringed to mark it. It's the one swatch nothing else can offer.
- The wheel dims along with the shade bar, so it always shows the colour
  you would actually get rather than a full-brightness version of it.
- The bar is called "shade", not "brightness", because the row already has
  a Brightness slider and they do different things: shade changes the
  colour itself, brightness drives the light's output.

## 3.0.0

Redesigned the panel around one idea: this is a tool for configuring
colour, so the interface itself should be monochrome and let the only
saturated things on screen be the colours the lights will actually
produce. The previous purple-and-cyan treatment competed with the very
data it was meant to present, which is what made it feel busy.

- **A signal path replaces the status tiles.** `Off - Booting - Home -
  Playing` is the console's real sequence, so the layout says so. The live
  node is lit and breathes the way the console's own indicator does; each
  node carries the colour that state produces, so the whole configuration
  reads at a glance; and clicking one jumps to its settings.
- **The four state cards are now an accordion of rows**, each showing a
  one-line summary ("Scanner - game colour - 47%") with one open at a time.
  Everything fits on a single screen instead of scrolling through four
  large cards.
- Values -- hex codes, IPs, percentages, 0-255 -- are set in monospace
  throughout, against a heavier grotesk for headings.
- One chrome accent only: PlayStation blue, reserved for interactive
  affordance and the live state.

## 2.12.1

- Switching lighting off now also works while a "Try it now" preview is
  running. Reconciling deliberately stood aside for a preview, so if one
  happened to be active the main toggle did nothing at all -- which is
  indistinguishable from a broken toggle. Turning lighting off now ends the
  preview and restores the lights.
- The log now records what a change decided ("Lighting released, lights
  turned off"), so this is diagnosable from the add-on log.

## 2.12.0

- **Changing a setting now acts on the lights straight away.** Config was
  only applied at the next PS5 state change, so switching a state off -- or
  lighting off entirely -- left the lights running with nothing visibly
  happening. Turning off the state the console is currently in, or the main
  toggle, now releases the lights (restoring the pre-session snapshot, or
  switching them off). Editing the active state's colour or brightness
  updates the lights live.
- **The light picker is collapsed by default**, showing only what's selected
  with a "Change" link to open the full list. Listing every light in the
  house was noise once a choice had been made.
- **The lighting section stays editable when lighting is switched off.** It
  was pointer-events locked, so it couldn't be set up before being enabled --
  and in versions before 2.11 that also locked away the Save button, which is
  why turning the main toggle off appeared to strand the lights on.

## 2.11.0

- **Settings now save as you change them.** Nothing persisted until Save was
  pressed, so a toggle would silently revert whenever the panel was
  reopened -- which read as the toggles simply not working. They did work;
  the change just never reached the server. The Save button is gone, since
  there's nothing left for it to do.
- **Focusing the effect field no longer filters the list to what's already
  in it.** An effect already chosen meant reopening the list showed only
  that one entry, hiding the other ~180. Focus now shows everything and
  typing filters.
- **"Use game colour" is only offered on "Playing a game."** The other
  states have no game running, so there was no cover art for it to sample
  and the option did nothing.
- Softened the card glow -- smaller, less blur, lower opacity -- so the
  cards sit together rather than each shouting its colour.

## 2.10.2

- Fixed the effect list being invisible. It always opened downward with a
  fixed height, so on a field low in the window it rendered past the bottom
  and couldn't be seen at all. It now opens whichever way there's room and
  sizes itself to the space available. It was only ever tested against a
  stub with six effects, which is why this went unnoticed.
- The dropdown is opaque now; it used the translucent panel colour, so page
  content showed through it.
- Added a count ("7 of 184 effects"), since with a list this long it isn't
  otherwise obvious how much is there or that filtering is working. No cap
  is applied -- every effect the light reports is listed.

## 2.10.1

- The effect field now has a real dropdown. It was a `<datalist>`, which only
  surfaces matches once you start typing -- no use when you don't already
  know the effect names. Clicking the field now lists everything the light
  supports, and typing filters it.
- "Try it now" becomes "Stop & restore" while a preview is running, instead
  of putting that control at the bottom of the card where it went unnoticed.

## 2.10.0

- **Removed the effect simulation.** It was approximating about a dozen
  behaviours across WLED's ~180 effects, and side by side with a real strip
  several were plainly wrong -- anything in the Aurora/Pacifica/Plasma/Noise
  family shared one generic "flowing" animation and looked nothing like the
  real thing. A preview that misleads is worse than none, so the cards now
  show only what can be stated accurately: the colour that will actually be
  used, as a steady glow. For seeing an effect, "Try it now" runs it on the
  real lights, and is undoable as of 2.9.0.
- **Effects are searchable.** The field is now a typeahead rather than a
  dropdown, which was unusable at ~180 entries. Typing an effect the selected
  light doesn't have is flagged, rather than silently doing nothing.

## 2.9.0

- **"Try it now" can be undone.** It previously applied a setting to your
  lights and left them that way until the PS5 next changed state, with no way
  back. It now snapshots the lights first and offers a "Stop preview &
  restore" button, with an automatic restore after 45 seconds. The preview
  snapshot is kept separate from the session snapshot, so trying settings out
  can't clobber the lights the bridge is holding for the end of a session.

## 2.8.1

- Tightened and brightened the border glow, which was spreading too far and
  fading out into a dim haze. Less blur, a shorter reach, and the LEDs are
  now composited additively so overlapping ones sum the way real light does
  instead of each washing out the last.

## 2.8.0

- The effect simulation now runs **around each card's border**, the way a
  bias light strip wraps a TV, rather than only as a bar underneath. The
  strip is drawn to a canvas behind the card and blurred, so what shows is
  the spill on the surrounding surface. The crisp bar stays as well, since
  the blurred version is good for mood but poor for judging an effect.
- Fixed the glow being invisible: it sat at a negative z-index with no
  isolating ancestor, so it painted behind the panel's own background
  instead of between the panel and the card.
- Fixed the colour-explanation notes losing their styling.

## 2.7.0

- Each state card now previews the effect on a **simulated LED strip**, not
  just a colour swatch. Scanner sweeps, Candle flickers, Twinkle sparkles,
  Rainbow cycles -- animated at the speed and brightness you've set, in the
  colour that will actually be used.

  These are approximations, and labelled as such: WLED ships around 180
  effects and they're its own code, so names are matched loosely to about a
  dozen behaviours. An unrecognised effect is shown as generic motion rather
  than pretending to know it. It's enough to tell a scanner from a twinkle
  before committing, which a colour swatch could never do.

- The card's ambient spill is now taken from the strip's own average colour,
  so it behaves like a bias light behind a screen: brighter, tighter, and
  actually derived from what the strip is doing.

- The colour swatch stays editable when **use game colour** is on -- it's the
  fallback in that case, and is relabelled accordingly. Previously it was
  disabled, which left no way to choose what happens when a game has no
  usable cover art. Each card now spells out which colour is in play and why.

## 2.6.0

- The light picker is now searchable and grouped by room, since pulling in
  every `light.` entity gets unwieldy on a large Home Assistant. Areas come
  from the template API; if that call fails the lights simply aren't grouped.
  Selected lights stay visible even when filtered out, so it's never unclear
  what's currently chosen.
- Each state card now previews itself: it takes on the colour it will
  actually produce (including the live game colour where that's what it will
  use), and an animated effect gets a drifting sheen whose pace follows the
  speed slider. A `Solid` effect stays still, because it does.

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
