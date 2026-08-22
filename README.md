# PS5 to MQTT Bridge

A custom Home Assistant add-on. Combines two independent data sources for a
PS5 and publishes them to MQTT with HA auto-discovery:

- **LAN power ping** (port 9302, Sony's local discovery protocol) — no login
  needed, tells you `AWAKE` vs `STANDBY` the instant the console starts
  powering on.
- **PSN presence** (Sony's account API) — tells you what you're actually
  doing: at the home screen, or playing a specific game. Requires a one-time
  setup (see below), but never needs to be redone under normal use — see
  "Why setup is only once" below.

Combining both gives a state machine richer than plain on/off:

| Power (LAN) | Presence (PSN) | `sensor.<name>_state` |
|---|---|---|
| STANDBY | — | `off` |
| AWAKE | offline/away (not fully booted yet) | `booting` |
| AWAKE | online, no game running | `home` |
| AWAKE | online, a game running | `playing` |

## Entities published

- `binary_sensor.<name>_power` — on/off, from the LAN ping alone
- `sensor.<name>_state` — `off` / `awake` / `booting` / `home` / `playing`
  (`awake` only shows if you skip PSN setup — otherwise it resolves to one
  of the more specific states)
- `sensor.<name>_activity` — the current game's title, or `Home Screen`, or `none`
- `binary_sensor.<name>_psn_auth` — diagnostic "problem" sensor; turns on if
  PSN re-authentication is needed (set up an HA notification on this so you
  actually hear about it instead of finding out weeks later)

## Install on HAOS

1. Copy this whole `ps5-ha-bridge` folder onto your HA box's
   `/addons/ps5-ha-bridge` (via Samba share, SSH, or the Studio Code Server
   add-on's file browser).
2. Settings → Add-ons → Add-on Store → ⋮ → **Check for updates**. A "Local
   add-ons" section appears with **PS5 to MQTT Bridge**.
3. Install it, open its **Configuration** tab, set:
   - `ps5_ip`: your PS5's LAN IP (give it a DHCP reservation on your router)
   - `mqtt_host` / `mqtt_port` / `mqtt_user` / `mqtt_password` (Mosquitto
     add-on: host is `core-mosquitto`)
   - `poll_interval`: seconds between polls (default 10)
4. Start the add-on.
5. Open the add-on — it has its own panel (via Ingress) with a **PS5
   Bridge** icon in the HA sidebar. Power on/off already works at this
   point with zero further setup.

## Optional: connect your PSN account (for game/activity data)

Open the **PS5 Bridge** panel (sidebar icon from step 5 above) and follow
the on-page steps — it's a single copy-paste from an already-logged-in
`playstation.com` browser tab, no console interaction needed.

### Why setup is only once

Sony issues a **new** refresh token every time the old one is used, with its
expiry reset. The bridge stores whichever one it was last given and swaps it
in automatically every refresh cycle (roughly hourly, since it's polling
presence that often). As long as the add-on runs at least once every couple
of months, the refresh token never actually reaches its expiry — so in
practice this is a true one-time setup. It only breaks if the add-on is
powered off for 2+ months straight, or if you change your PSN password
(which revokes all app sessions). If that happens, the `psn_auth` problem
sensor turns on and the setup panel shows "Not connected" again — just
redo the same copy-paste.

## Automation ideas

- Trigger on `sensor.<name>_state` changing to `home` → dim white light
- Trigger on `sensor.<name>_state` changing to `playing` → your gaming scene
- Trigger on `sensor.<name>_state` changing to `off` → lights off after a delay
- Trigger on `binary_sensor.<name>_psn_auth` turning on → a persistent
  notification reminding you to re-open the setup panel

## Notes / honesty about limits

- This is all built on **unofficial, reverse-engineered protocols** (the
  same ones community projects like `playactor` and `psn-api` use) — Sony
  could change either at any time. Both are read-only here; nothing is sent
  to your account beyond a login/presence check, same as the official PS app.
- Power detection is AWAKE vs STANDBY, not true cold-off — a PS5 that's
  unplugged won't reply and `availability` goes `offline` after 3 missed
  polls.
- There's no way to read the PS5's actual light-bar color/pattern — it
  isn't broadcast anywhere. The `state` sensor above is what you use to
  drive *your own* light colors/patterns per state in an HA automation.
- Wake-on-LAN style remote power-on/off from HA is a separate, heavier
  feature (needs console pairing + an encrypted session) and isn't built
  here — ask if you want it added.
