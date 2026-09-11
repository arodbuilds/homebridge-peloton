<!-- Banner placeholder: the regenerated banner with the round-two tagline arrives in build 4. -->

# homebridge-peloton

Peloton workouts as HomeKit sensors for Homebridge automations. The plugin watches one or more Peloton accounts in a household and exposes trigger sensors that turn on when a workout starts, when it ends, or when a rider reaches a heart-rate zone, so Home app automations can react to what is happening on the bike, the tread, or the mat.

Status: beta, build 3 of 4. Configure everything from the plugin settings page.

Not affiliated with Peloton Interactive. Uses Peloton's undocumented member API, which can change without notice.

## Install

Search for "Peloton" under Plugins in the Homebridge UI and install the beta, or from a shell on the Homebridge host:

```shell
npm install -g homebridge-peloton@beta
```

Then open the plugin's settings from the Plugins page. Everything below happens on that page; the host's Save button writes config.json and Homebridge restarts the plugin.

## Set up from the settings page

### 1. Connect the owner

Under Accounts, enter the email and password of the Peloton account that owns the membership and click Connect. The card shows a Connected pill with "Last checked just now", and every profile on the membership appears under it as its own card marked Not connected. A Devices line lists the hardware on the membership, with the names from your Peloton account.

The password is stored in your Homebridge config so the plugin can sign in again by itself if Peloton ever ends the session. The plugin keeps a session token and refreshes it, so signing in is rare.

### 2. Members connect

Each member connects their own profile before it is polled. Click Connect on the member's card and enter that member's Peloton email and password, or hand them the page. A member who prefers not to type a password on the Homebridge host can use Sign in with browser (below), which stores no password.

### 3. Add a trigger

Under Triggers, click Add trigger and choose what the sensor should watch:

- Workout: on while a workout is in progress. Choose who (anyone on the membership or one member), the device (any, Bike, or Tread), the activities, and how long the sensor stays on after the workout ends (90 seconds by default, so stacked classes do not turn your scene off between them).
- Heart-rate zone: on while heart rate is at or above a zone. Choose the member, the zone, and the hold time (20 seconds by default). Zones come from that member's Peloton profile and need a heart-rate monitor paired to the workout.

Give the trigger a name, pick Occupancy sensor or Switch as its HomeKit kind, click Save, and restart Homebridge. The sensor appears in the Home app under the bridge. In Automations, choose the sensor as the trigger and pick what should happen when it turns on and when it turns off.

### 4. Set up the fast polling automation

The plugin creates a switch called Peloton fast polling. While it is on, the plugin checks every account every 10 seconds, locks onto the first workout it sees, and follows it to the end. While it is off, it polls at the standby interval (120 seconds by default; 0 turns standby polling off). The switch turns itself off 120 minutes after the later of turning on and the last workout ending.

Add two Home app automations: one that turns the Peloton fast polling switch on when your workout routine starts (for example when the gym light comes on, or a time of day), and one that turns it off when the routine ends. Without them the plugin still works, just at the standby interval, so a workout may be noticed up to two minutes after it starts. The intervals and the auto-off period are under Polling and Settings > Advanced.

### 5. Sign in with browser

If Peloton does not accept the sign-in from the plugin, or an account has extra verification turned on, the connect panel offers Sign in with browser:

1. Click Open Peloton sign-in. A new tab opens on Peloton's sign-in page. Sign in there. If you are already signed in, it jumps straight to your home page; that is fine.
2. Press your browser's Back button once. The address bar shows an address that starts with members.onepeloton.com/callback. Copy it.
3. Paste it into the field on the settings page and click Connect.

If Back does not show the callback address, long-press the Back button and pick the callback entry, or search your browser history for "callback". The address is single use and expires within minutes; if the page says the link expired or came from an earlier attempt, click Open Peloton sign-in again and use the new one.

### Accounts that need attention

An account whose session Peloton has ended shows Reconnect needed with the line "Sign-in expired. Reconnect to resume polling." Click Reconnect and sign in again. Under Settings > Advanced, the Attention needed sensor turns on while any account is in that state, so a Home automation can send you a notification. Remove on an account card deletes its stored sign-in and drops it from the configuration.

## What is stored where

- Session tokens live in `homebridge-peloton/accounts/` inside the Homebridge storage folder, one file per account, readable only by the Homebridge user. They are never written to config.json, the log, or the settings page.
- Passwords are stored in config.json only for accounts connected with email and password on the settings page (or entered by hand). Accounts connected with Sign in with browser store no password.
- Profile photos are fetched through the plugin, not by the page from Peloton's servers.
- To remove everything for an account, click Remove on its card. To remove every stored sign-in, delete the `homebridge-peloton` folder in the Homebridge storage folder.

## Manual configuration

The settings page is the normal way to configure the plugin. The platform block it writes looks like this, and can be edited by hand when the page is unavailable; every value not shown takes the default in the comments.

```json
{
  "platform": "Peloton",
  "name": "Peloton",
  "accounts": [
    { "id": "8b1e6d0e-4a4b-4a5b-9c0a-2f1d9c1a7e11", "email": "you@example.com", "password": "your Peloton password", "displayName": "Alex" }
  ],
  "triggers": [
    { "id": "6f2c3b9a-7d8e-4f10-a1b2-c3d4e5f60718", "type": "workout", "name": "Workout", "accessory": "occupancy",
      "who": "anyone", "activities": [], "device": "any", "holdAfterEnd": 90 }
  ],
  "polling": { "fastSwitch": true, "fastSwitchName": "Peloton fast polling", "fastInterval": 10, "standbyInterval": 120 },
  "advanced": { "fastSwitchAutoOffMinutes": 120, "attentionSensor": false, "dailyCheckIn": "03:00" },
  "debug": false
}
```

- `accounts[].id` and `triggers[].id` identify the account store file and the HomeKit accessory. The settings page generates them; by hand any short unique string of letters, digits, dashes, and underscores works. A missing or duplicate id is replaced for the run with a warning until the config is saved from the settings page.
- `accounts[].userId` is filled in by the plugin after the first successful connection and written by the settings page on save. `password` is optional: an account connected through the browser path has none.
- A Workout trigger is on while a matching workout is in progress and for `holdAfterEnd` seconds after it ends. `who` is "anyone" or an account userId, `activities` is empty for all activities or a list such as `["cycling", "running"]`, `device` is "any", "bike" (a ride on the Bike or Bike+), or "tread" (a workout on the Tread or Tread+); it is matched by the platform the workout was recorded on.
- A heart-rate zone trigger looks like `{ "id": "...", "type": "hrZone", "name": "Zone 4 or higher", "who": "<userId>", "zone": 4, "holdTime": 20 }` and is on once the rider has been at or above the zone for `holdTime` seconds. `who` must name one member.
- `accessory` is "occupancy" (default) or "switch". Both kinds are read-only sensors in effect.
- `polling.fastInterval` is in seconds with a floor of 5; `standbyInterval` is 0 for no polling while the Fast polling switch is off, or 30 seconds or more. With `fastSwitch` false and `standbyInterval` 0 the plugin would never poll, and the settings page refuses the combination.
- An account with `email` and `password` in config is enough for the plugin to connect on its own: at startup it signs in each such account that has no stored sign-in, one after another, and signs in again once if Peloton later invalidates the session. The log shows "Connected {name} (@{username})" or the sign-in stage and HTTP status that failed.

## Development

Node 20 or later. Install with `npm install`, then:

| Script | What it does |
| --- | --- |
| `npm run lint` | ESLint over the source, the settings page, the tests, and the config, zero warnings allowed |
| `npm run build` | Compiles `src/` to `dist/` with TypeScript, including the UI server and the probe |
| `npm test` | Builds, then runs the node:test suites in `test/` against `dist/` and the settings page model |
| `npm run watch` | Rebuilds on change and restarts a development Homebridge from `test/hbConfig` |

The network is always mocked in tests. Fixtures live under `fixtures/`; see `fixtures/README.md` for what each file stands in for. The settings page is plain HTML, CSS, and ES modules under `homebridge-ui/public/`, served by the Homebridge UI with no build step; its server side is compiled from `src/ui/` and started by `homebridge-ui/server.js`.

### Auth probe

The probe gives the headless sign-in its first real run on the Pi, without Homebridge. Build first, then run from a directory where a token file may be written:

```shell
npm run build
node dist/scripts/auth-probe.mjs login you@example.com        # prompts for the password without echo
node dist/scripts/auth-probe.mjs login you@example.com --dump ./auth-dump
node dist/scripts/auth-probe.mjs refresh
node dist/scripts/auth-probe.mjs browser                       # prints the sign-in URL, waits for the pasted callback URL
node dist/scripts/auth-probe.mjs me
node dist/scripts/auth-probe.mjs workout --keys
node dist/scripts/auth-probe.mjs graph <workoutId>               # metric slugs, sample counts, heart-rate zone bounds
```

Tokens are stored in `./probe-tokens.json` with mode 0600 and are never printed. Before posting the credentials, `login` prints the Auth0 domain, tenant, and connection name it parsed from the login page, so a run confirms them at a glance. After the credentials POST the sign-in follows Auth0's redirect chain across auth.onepeloton.com and auth-orca.onepeloton.com until it reaches the members.onepeloton.com callback, which it reads without following. `workout` prints the platform, the Peloton-originated and third-party import flags, and the ride; `me` labels the `/api/me` last workout time as stale, since the plugin takes that time from the workouts list instead. `graph` takes a workout id (the one `workout` prints) and lists every metric slug with its sample count, then the heart-rate zone bounds as slug, min_value, and max_value, so a non-cycling workout can be checked for zones without a ride in progress. On failure the probe prints the auth stage and HTTP status only. With `--dump`, every HTML page of the login flow is written to the given directory with form values redacted, which is what to attach when the flow needs adjusting. Token responses are never written. Delete `probe-tokens.json` and the dump directory when done.

## License

Apache-2.0. Copyright 2026 Alex Rodriguez (arodbuilds).
