<!-- Banner placeholder: the regenerated banner with the round-two tagline arrives in build 4. -->

# homebridge-peloton

Peloton workouts as HomeKit sensors for Homebridge automations. The plugin watches one or more Peloton accounts in a household and exposes trigger sensors that turn on when a workout starts, when it ends, or when a rider reaches a heart-rate zone, so Home app automations can react to what is happening on the bike, the tread, or the mat.

Status: beta, build 2 of 4. Works with a hand-edited config.json; the settings page arrives in build 3.

Not affiliated with Peloton Interactive. Uses Peloton's undocumented member API.

## Configuration

Add a platform block to config.json. This example has one account and one Workout trigger; every other value is optional and takes the defaults shown in the comments below the block.

```json
{
  "platform": "Peloton",
  "name": "Peloton",
  "accounts": [
    { "id": "a1", "email": "you@example.com", "password": "your Peloton password", "displayName": "Alex" }
  ],
  "triggers": [
    { "id": "t1", "type": "workout", "name": "Workout", "accessory": "occupancy",
      "who": "anyone", "activities": [], "device": "any", "holdAfterEnd": 90 }
  ],
  "polling": { "fastSwitch": true, "fastSwitchName": "Peloton fast polling", "fastInterval": 10, "standbyInterval": 120 },
  "advanced": { "fastSwitchAutoOffMinutes": 120, "attentionSensor": false, "dailyCheckIn": "03:00" },
  "debug": false
}
```

- `accounts[].id` and `triggers[].id` identify the account store file and the HomeKit accessory. Keep them stable; the settings page generates them in build 3, and until then any short unique string works. A missing id is generated for the run with a warning.
- A Workout trigger is on while a matching workout is in progress and for `holdAfterEnd` seconds after it ends. `who` is "anyone" or an account userId, `activities` is empty for all activities or a list such as `["cycling", "running"]`, `device` is "any" or a device id from the household.
- A heart-rate zone trigger looks like `{ "id": "t2", "type": "hrZone", "name": "Zone 4 or higher", "who": "<userId>", "zone": 4, "holdTime": 20 }` and is on once the rider has been at or above the zone for `holdTime` seconds.
- `accessory` is "occupancy" (default) or "switch". Both kinds are read-only sensors in effect.
- `polling.fastInterval` is in seconds with a floor of 5; `standbyInterval` may be 0 for no polling while the Fast polling switch is off.
- An account with `email` and `password` in config is enough for the plugin to connect on its own: at startup it signs in each such account that has no stored sign-in, one after another, and signs in again once if Peloton later invalidates the session. The log shows "Connected {name} (@{username})" or the sign-in stage and HTTP status that failed. The settings page in build 3 adds the browser sign-in path, which stores no password.

The plugin keeps each account's sign-in under `homebridge-peloton/accounts/` in the Homebridge storage folder, in files readable only by the Homebridge user. Delete that folder to remove every stored sign-in.

## Development

Node 20 or later. Install with `npm install`, then:

| Script | What it does |
| --- | --- |
| `npm run lint` | ESLint over the source, tests, and config, zero warnings allowed |
| `npm run build` | Compiles `src/` to `dist/` with TypeScript, including the probe |
| `npm test` | Builds, then runs the node:test suites in `test/` against `dist/` |
| `npm run watch` | Rebuilds on change and restarts a development Homebridge from `test/hbConfig` |

The network is always mocked in tests. Fixtures live under `fixtures/`; see `fixtures/README.md` for what each file stands in for.

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
