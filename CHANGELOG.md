# Changelog

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
