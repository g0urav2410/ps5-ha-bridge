# Changelog

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
