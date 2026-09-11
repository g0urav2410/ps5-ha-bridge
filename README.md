# PS5 to MQTT Bridge

A Home Assistant add-on that watches a PlayStation 5 and publishes what it's
doing to MQTT — awake or asleep, at the home screen or in a game, and which
game. It can drive your lights from that directly, so no automations are
needed unless you want them.

Full documentation is in [DOCS.md](DOCS.md), which is also what the add-on
shows on its Documentation tab.

## How it knows

Two independent sources, because neither alone is enough:

| Source | Needs an account? | Tells you |
|---|---|---|
| LAN ping, UDP 9302 (Sony's local discovery protocol) | No | Awake vs rest mode, within seconds |
| PSN presence (Sony's account API) | One-time sign-in | Home screen vs in a game, and the title |

Together they give a state machine rather than a switch:

| LAN ping | PSN presence | `sensor.<name>_state` |
|---|---|---|
| rest mode / unreachable | — | `off` |
| awake | not online yet | `booting` |
| awake | online, no game | `home` |
| awake | online, in a game | `playing` |

The gap between "the console answers the network" and "PSN says it's online"
is what makes `booting` possible — nothing reports it directly.

## Entities

- `binary_sensor.<name>_power` — on while the console is awake
- `sensor.<name>_state` — `off` / `booting` / `home` / `playing`
  (`awake` if you skip the PSN step)
- `sensor.<name>_activity` — the running game's title, `Home Screen`, or `none`
- `sensor.<name>_game_color` — a colour sampled from the running game's cover
  art, hex as the state and `[r, g, b]` in an `rgb` attribute. `none` when the
  artwork yields nothing usable.
- `binary_sensor.<name>_psn_connection_problem` — diagnostic; on when PSN
  needs signing in to again. Worth a notification, so you hear about it rather
  than noticing weeks later.

## Install

1. Home Assistant → Settings → Add-ons → Add-on Store → ⋮ → **Repositories**,
   and add `https://github.com/g0urav2410/ps5-ha-bridge`
2. Install **PS5 to MQTT Bridge** from the store.
3. In its Configuration tab set `ps5_ip` and your MQTT details
   (`core-mosquitto` if you use the Mosquitto add-on).
4. Start it. Power detection works from here with nothing further.
5. Open the add-on's Web UI to connect your PSN account — one copy-paste,
   which unlocks the game title and the richer states.

## Lighting

The add-on's panel can drive your lights itself: choose which lights, then
set effect, colour, brightness, speed and fade for each state, with a **Try it
now** that applies it to the real lights and can be undone.

A mixed set of lights is handled per light: each one can be switched out
entirely, react to only some states — a room lamp joining in only once a game
starts — and carry its own brightness, hue and saturation trim, since the same
colour lands warmer on a bulb than on a strip. Lights with no effects take the
colour and skip the effect rather than failing.

Colours are chosen on a WLED-style wheel with a shade bar, quick colours, and
hex or R/G/B entry. On the *Playing* state the colour can come from the
running game's own cover art instead, with a fallback for games whose artwork
yields nothing usable.

It can also record your lighting exactly as it was when a session starts —
brightness, colour, effect, and which lights were off — and put it back when
the console goes to sleep. That record survives a restart of the add-on or of
Home Assistant.

If you'd rather write automations, leave that switched off — the add-on won't
touch your lights, and the sensors behave the same either way. A worked
example is in [`examples/ps5-lighting-automation.yaml`](examples/ps5-lighting-automation.yaml),
including a failsafe for the case where the add-on stops mid-session and never
gets to report `off`.

## Honest limits

- Built on **unofficial, reverse-engineered protocols** — the same ones
  `playactor` and `psn-api` use. Sony could change either at any time. Both
  are read-only here.
- Power detection is awake vs rest mode, not true cold-off.
- PSN presence reports **games**, not apps: YouTube or Netflix reads the same
  as the home screen.
- Remote Play looks identical to playing in the room — the game runs on the
  console either way.
- The console's actual light-bar colour isn't broadcast anywhere, so it can't
  be mirrored. `sensor.<name>_state` is what you drive your own colours from.
- Waking or shutting down the console from Home Assistant isn't supported. It
  needs console pairing and an encrypted session, which is separate work.

## Licence

MIT.
