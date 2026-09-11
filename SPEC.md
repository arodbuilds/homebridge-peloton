# homebridge-peloton SPEC

Version: draft 1 for 1.0.0-beta.1 (10 September 2026)
Status: source of truth for the build. design/README.md is normative for the settings page layout, copy, and states; this document is normative for everything else. Where the two disagree, this document wins and the design README gets a clarification in the same PR.

## 1. Purpose

Exposes Peloton workout state as HomeKit sensors so Home app automations can run when a workout starts, ends, or reaches a heart-rate zone. One Homebridge platform, several Peloton accounts (a household), several trigger sensors, one optional input switch that controls polling speed.

Not affiliated with Peloton Interactive. Uses Peloton's undocumented member API.

## 2. Decisions that must not change

1. Triggers are stateful sensors: on while the condition is true, off when it stops. Occupancy sensor by default, Switch optional. No momentary behaviour, no cooldown, no "stay on" option.
2. No default account, no master switch.
3. The Fast polling switch exists by default. It turns itself off after a configurable period, default 120 minutes, counted from the later of the switch turning on and the last workout ending.
4. Intervals: fast 10 s (floor 5), standby 120 s (0 allowed, meaning no standby polling).
5. Lock-on: while scanning, the first account seen with a workout in progress becomes the active account; other accounts are not polled until that workout ends.
6. Keep on after workout ends: 90 s default. Heart-rate zone hold time: 20 s default.
7. Attention needed sensor: off by default, under Advanced.
8. The auth layer is owned by this plugin, isolated in one module, with zero runtime dependencies beyond @homebridge/plugin-ui-utils.
9. Copy rules: no em dashes, sentence case, "sensor" for triggers, "switch" only for the Fast polling switch and the Switch accessory kind.
10. Beta first: 1.0.0-beta.1 to the npm beta tag, tested on Alex's Pi, then a tester call, then 1.0.0.

## 3. Runtime and toolchain

- Node 20 or later (Homebridge 2.x requirement). Built-in fetch and crypto; no HTTP or HTML parsing libraries.
- TypeScript, same lint, build, and test toolchain as homebridge-notify-switch.
- Runtime dependency: @homebridge/plugin-ui-utils only.
- Dynamic platform plugin. Platform name "Peloton", plugin identifier homebridge-peloton.
- Target hardware: Raspberry Pi. Keep the poll loop allocation-light; never hold more than the latest workout and the latest performance sample per account.

## 4. Peloton API contract (verified 10 September 2026)

All values below were confirmed with a live token from Alex's account. Treat them as facts until a fixture proves otherwise.

### 4.1 Auth0

- Tenant: https://auth.onepeloton.com
- Client id: WVoJxVDdPoFx4RNewvvg6ch2mZ7bwnsM
- Redirect URI: https://members.onepeloton.com/callback
- Scope: offline_access openid peloton-api.members:default
- Audience: https://api.onepeloton.com/
- PKCE S256. Access token lifetime 172800 s (48 h). Refresh tokens rotate on every refresh: the response carries a new refresh_token and the old one must be discarded.
- Token endpoint: POST https://auth.onepeloton.com/oauth/token with a JSON body.
  - Code exchange: grant_type authorization_code, client_id, code_verifier, code, redirect_uri.
  - Refresh: grant_type refresh_token, client_id, refresh_token.
- Refresh failure with invalid_grant means the session is gone (revoked, expired, password changed). Any other failure is transient.

Headless login (primary path) drives Auth0 Universal Login without a browser:
1. GET /authorize with the PKCE parameters; follow to the login page, keep the cookies (at least the CSRF cookie).
2. POST the username/password form Auth0 renders (connection name and form fields are recorded in fixtures/auth/ from a live capture; the module reads the form action and hidden inputs from the HTML rather than hard-coding them).
3. Auth0 returns an HTML form that auto-posts to /callback; the module parses its hidden inputs and posts them.
4. The final redirect to members.onepeloton.com/callback carries code and state. The module does not follow it; it extracts the code and exchanges it.

Browser sign-in (fallback): the plugin generates verifier and state, gives the user the authorize URL, and later receives the full callback URL by paste. It checks state, exchanges the code with the stored verifier. Codes are single use and short-lived; the members web app does not consume them (verified).

### 4.2 API

Base https://api.onepeloton.com. Headers on every call: Authorization: Bearer {access_token}, Peloton-Platform: web. JSON responses.

| Call | Use | Fields used |
| --- | --- | --- |
| GET /api/me | identity, zones, avatar, devices | id, username, first_name, last_name, image_url, is_profile_image_default, customized_heart_rate_zones (array, may be empty), default_max_heart_rate, customized_max_heart_rate, paired_devices, last_workout_at |
| GET /api/user/{id}/subscriptions | household (owner only) | data[].id, data[].status ("active_normal" or "unused"), data[].owner.id, data[].max_shared_users, data[].shared_user_set[] (id, username, first_name, last_name, image_url, is_profile_image_default, last_workout_at), data[].attached_devices[] (id, name) |
| GET /api/user/{id}/workouts?limit=1&sort_by=-created | latest workout | data[0]: id, status ("IN_PROGRESS" or "COMPLETE"), fitness_discipline, device_type, workout_type, start_time, end_time, created_at, title, name; a device id field if present (see 8.3) |
| GET /api/workout/{id}/performance_graph?every_n=5 | live metrics for the active workout | metrics[] where slug is "heart_rate": values[] (latest sample), zones[] (slug, min_value, max_value) when present; seconds_since_pedaling_start |

fitness_discipline values mapped to the Activities chips: cycling, running, walking, rowing, strength, yoga, stretching, meditation, cardio, bike_bootcamp, tread_bootcamp, row_bootcamp. Unknown values are logged once at debug and never match a trigger with a restricted activity list; they do match "all activities".

## 5. Module boundaries

```
src/
  platform.ts          Homebridge platform: config load, accessory registry, wiring
  auth/peloton-auth.ts login(email, password), refresh(refreshToken), browserStart(), browserFinish(callbackUrl); nothing else
  api/peloton-api.ts   typed wrappers for the four calls; takes an access token, never stores one
  store/account-store.ts   per-account persistence (7)
  poller/poller.ts     the state machine (8)
  poller/rules.ts      pure functions: does this workout match this trigger; zone from sample; hold and dwell logic
  accessories/         trigger sensor, fast polling switch, attention sensor
  ui/server.ts         @homebridge/plugin-ui-utils server (10)
  scripts/auth-probe.mts   standalone auth probe for the Pi, compiled to dist/scripts/auth-probe.mjs (build 1 clarification, see 15)
homebridge-ui/public/  settings page (design/README.md)
fixtures/              recorded, sanitised JSON used by tests
```

peloton-auth.ts is the only file that knows Auth0 URLs, the client id, scopes, or HTML form handling. When Peloton changes the login flow, the fix is inside this file.

### 5.1 Auth errors

All auth failures throw AuthError with stage in: authorize, credentials, callback, exchange, refresh, verification_required, state_mismatch, expired_code, malformed_callback. Includes the HTTP status where there was one. Never includes response bodies, tokens, or the password. Log lines print stage and status only.

## 6. Configuration (config.json)

```json
{
  "platform": "Peloton",
  "name": "Peloton",
  "accounts": [
    { "id": "a1", "email": "owner@example.com", "password": "...", "userId": "8084e81d...", "displayName": "Alex" }
  ],
  "triggers": [
    { "id": "t1", "type": "workout", "name": "Workout", "accessory": "occupancy",
      "who": "anyone", "activities": ["cycling", "running"], "device": "any", "holdAfterEnd": 90 },
    { "id": "t2", "type": "hrZone", "name": "Zone 4 or higher", "accessory": "occupancy",
      "who": "8084e81d...", "zone": 4, "holdTime": 20 }
  ],
  "polling": { "fastSwitch": true, "fastSwitchName": "Peloton fast polling",
               "fastInterval": 10, "standbyInterval": 120, "calloutDismissed": false },
  "advanced": { "fastSwitchAutoOffMinutes": 120, "attentionSensor": false, "dailyCheckIn": "03:00" },
  "debug": false
}
```

Rules:
- accounts[].id and triggers[].id are generated by the UI (crypto.randomUUID) on creation, never shown, never edited. Accessory UUIDs derive from them, so renaming never orphans an accessory.
- accounts[].password is optional: absent for accounts connected through the browser path. userId is filled by the plugin after the first successful connection.
- who is "anyone" or an account userId. hrZone triggers never use "anyone".
- activities absent or empty means all.
- device is "any" or a device id from attached_devices.
- config.schema.json mirrors this shape with the defaults above and marks the custom UI.

## 7. Account store

Path: {homebridge storagePath}/homebridge-peloton/accounts/{account id}.json, file mode 0600, directory 0700.

```json
{ "userId": "...", "username": "...", "displayName": "...", "imageUrl": "...", "isProfileImageDefault": false,
  "accessToken": "...", "accessTokenExpiresAt": 1789000000000, "refreshToken": "...",
  "hrZones": [{ "zone": 1, "min": 0, "max": 110 }, ...], "maxHr": 168,
  "state": "connected" | "reconnect_needed" | "not_connected",
  "lastCheckedAt": 1789000000000, "lastError": { "stage": "refresh", "status": 403, "at": 1789000000000 } }
```

- Writes are atomic: write to a temp file in the same directory, then rename. A refresh is not considered complete until the new refresh token is on disk.
- Access tokens are refreshed when within 6 hours of expiry, or on any 401.
- state is persisted so the settings page shows the right pill immediately after a restart.
- Household profiles that have never connected exist in the store with state not_connected and no tokens, populated from the owner's subscriptions call.
- Removing an account in the UI deletes its file.

## 8. Poller

One loop per platform. All timing uses an injectable clock so tests can drive it.

### 8.1 States

- standby: Fast polling switch off, no workout locked. Poll every connected account at standbyInterval, staggered evenly across the interval. If standbyInterval is 0, no polling at all.
- scanning: switch on, no workout locked. Poll every connected account at fastInterval, staggered.
- locked: one account has a workout IN_PROGRESS. Poll only that account at fastInterval. Add the performance_graph call on each poll only if at least one hrZone trigger targets that account.
- Transitions: standby or scanning to locked on the first IN_PROGRESS seen. locked to scanning when the switch is on, or to standby when it is off, once the workout ends and holdAfterEnd has elapsed for every trigger that was on. Switch turning off during locked does not leave locked (the workout is followed to its end).
- Any switch change triggers an immediate poll cycle before the new schedule starts.

### 8.2 Workout detection per account

- Latest workout = data[0] of the workouts call.
- Started: status IN_PROGRESS and id differs from the last seen active id.
- Ended: status COMPLETE for the last seen active id, or a different workout id appears in any status. A new IN_PROGRESS id while locked is an end followed by a start on the same poll (stacked classes).
- A workout already IN_PROGRESS at plugin startup counts as started on the first poll.
- Transient API failures (network, 5xx, 429) keep the last known state and retry on the next tick with backoff: after three consecutive failures the interval doubles up to 60 s until a success. A 401 goes through refresh once; a refresh failure with invalid_grant marks the account reconnect_needed and drops it from polling.

### 8.3 Trigger evaluation (pure, in rules.ts)

Workout trigger matches when: who is "anyone" or equals the account userId; activities is empty or contains the workout's fitness_discipline; device is "any" or matches. Device matching: use the workout's device id field when the fixtures show one; otherwise map device_type to attached_devices via a lookup recorded at connect time. If neither is available, log once at info that device filtering is unavailable for this workout and treat the filter as "any". The first Pi test with a real bike ride settles which field exists; update this section with the finding.

The sensor is on from start until end plus holdAfterEnd seconds. A new matching workout during the hold keeps it on without a gap.

Heart-rate zone trigger: from each performance_graph poll take the latest heart_rate sample. Zone bounds, in priority order: zones[] on the heart_rate metric in performance_graph; customized_heart_rate_zones from /api/me; otherwise Peloton's defaults from max heart rate (customized_max_heart_rate, else default_max_heart_rate): zone 1 below 65 percent, zone 2 65 to 75, zone 3 75 to 85, zone 4 85 to 95, zone 5 95 and above. Condition is zone at or above the configured zone. The sensor turns on after the condition has held for holdTime seconds and off after it has been false for holdTime seconds, and always off when the workout ends. No sample within two polls means the condition is false. No heart_rate metric at all: log once per workout at info, sensor stays off.

### 8.4 Fast polling switch

- Exposed as a Switch service, writable. Off at startup.
- Auto-off: a timer of fastSwitchAutoOffMinutes, reset on switch-on and on every workout end. When it fires, the switch turns off and a log line says so.
- When fastSwitch is false in config, the accessory is removed and the poller behaves as if the switch were permanently off.

### 8.5 Daily check-in

At dailyCheckIn local time: for each connected account refresh the token, fetch /api/me (zones, avatar, name), and for the owner fetch subscriptions to update household profiles and devices. Failures follow 8.2.

### 8.6 Attention needed sensor

Occupancy service, on while any account is in reconnect_needed, off otherwise. Created only when advanced.attentionSensor is true.

## 9. Accessories

- One accessory per trigger. Service is OccupancySensor or Switch per accessory kind. Switch triggers are read-only in effect: a write from the Home app is acknowledged and the value is immediately re-set to the computed state (the Home app then shows the true state).
- Accessory names come from the trigger name; UUIDs from the trigger id. Changing accessory kind replaces the service in place, keeping the accessory UUID.
- Fast polling switch accessory UUID derives from the platform plus a fixed string. Attention sensor likewise.
- Accessory information: Manufacturer "Alex Rodriguez", Model "Peloton trigger" / "Peloton fast polling switch" / "Peloton attention sensor", Serial the trigger id, Firmware the package version.
- Orphan cleanup on startup: cached accessories whose id is no longer in config are unregistered.

## 10. Settings UI server (@homebridge/plugin-ui-utils)

Requests are handled in the plugin's UI server process; it reads and writes the account store directly and never returns tokens to the page.

| Request | Body | Response |
| --- | --- | --- |
| /status | none | accounts[] with id, userId, displayName, username, avatar (see below), isOwner, state, lastCheckedAt, lastWorkoutAt; devices[]; version |
| /connect | account id, email, password | ok with the account summary, or error with stage |
| /browser/start | account id | authorizeUrl (verifier and state kept in server memory for 10 minutes) |
| /browser/finish | account id, callbackUrl | ok with account summary, or error with stage |
| /test | account id | ok with lastCheckedAt, or error with stage |
| /household | none | refreshes the owner's subscriptions and returns accounts[] |
| /remove | account id | ok |
| /avatar | account id | image bytes proxied from image_url, cached 24 h; 204 when isProfileImageDefault |

Error stage to page message mapping (page copy lives in design/README.md):
- credentials: "Peloton did not accept that email and password."
- authorize, callback, exchange: "Peloton sign-in did not complete. You can connect using your browser instead."
- verification_required: "This account has extra verification turned on. Use Sign in with browser."
- malformed_callback: "That does not look like the Peloton callback address. It should start with members.onepeloton.com/callback."
- state_mismatch: "This link was from an earlier attempt. Click Open Peloton sign-in again and use the new one."
- expired_code: "The sign-in link expired. Click Open Peloton sign-in and try again."

Password handling: the page sends the password to /connect once; the server performs the login and stores tokens. The page also writes the password to config.json through the host's normal save so the plugin can re-login headlessly after invalid_grant. The browser path stores no password.

## 11. Logging

Info level, one line each, never more than one per event:
- "Connected {displayName} (@{username})"
- "{displayName}: workout started ({fitness_discipline}, {title})"
- "{displayName}: workout ended"
- "{trigger name}: on" / "{trigger name}: off"
- "Fast polling switch on: scanning {n} accounts every {fastInterval}s"
- "Fast polling switch off"
- "Fast polling switch turned off automatically after {minutes} minutes"
- "{displayName}: sign-in expired, reconnect needed (stage {stage}, HTTP {status})"
- "Daily check-in complete for {n} accounts"

Debug level (config.debug): each poll result with workout id, status, discipline, latest heart-rate sample and zone. Never tokens, passwords, emails, or response bodies.

## 12. Privacy and security

- Tokens only in the account store, 0600. Never in config.json, logs, or UI responses.
- Avatar images proxied through the UI server, not fetched by the page from Peloton's CDN.
- Only the owner's token is used for the household list; members' workouts are read only with their own tokens.
- README states what is stored where and how to remove it (delete the account in the UI or delete the storage folder).

## 13. Tests

- Claude Code cannot reach onepeloton.com. All network is mocked with fixtures under fixtures/: auth (login page, form post response, callback form, token responses including invalid_grant), api (me for owner and member, subscriptions, workouts in IN_PROGRESS and COMPLETE for cycling and strength, performance_graph with and without heart_rate). Fixtures are sanitised: ids shortened, names replaced, tokens replaced with "redacted".
- Poller tests use the injectable clock and cover: standby with 0 and 120 s, scanning stagger, lock-on, stacked classes with hold, switch off during locked, auto-off timer anchoring, HR dwell on and off, 401 then refresh, invalid_grant to reconnect_needed, backoff on 5xx.
- Rules tests cover every matching path in 8.3.
- Store tests cover atomic write and rotation.
- Live verification is manual on the Pi with the probe script findings (peloton-test/p.mjs) as reference, and one real ride with the fast polling switch on.

## 14. Release

- 1.0.0-beta.1 to the npm beta tag through the GitHub release workflow (pre-release). Keywords include homebridge-plugin, supports-hap, peloton.
- README: regenerated banner with the round-two tagline, setup in two steps, the fast polling automation recipe, browser sign-in instructions with the Back-button and history alternatives, privacy section, not-affiliated line.
- CHANGELOG from beta.1.
- Verification submission only after 1.0.0 and a soak.

## 15. Open items to settle during beta

1. The device id field on workouts (8.3). The probe's `workout --keys` command prints the raw field names of the latest workout to settle this.
2. Whether Auth0 presents a verification-code step on any household account; if so, verification_required detection needs a fixture.
3. Whether performance_graph carries heart_rate zone bounds on non-cycling workouts.
4. Real-world start latency at fastInterval 10 with four accounts staggered.
5. Auth0 tenant name "peloton" (PELOTON_AUTH.tenant in src/auth/peloton-auth.ts): confirm on the Pi in build 1 live test.
6. Auth0 connection name "PelotonIDS" (PELOTON_AUTH.connection in src/auth/peloton-auth.ts): confirm on the Pi in build 1 live test.
7. CSRF handling on the credentials POST: the module sends the value of the `_csrf` cookie both as the `x-csrf-token` header and as a `_csrf` body field. Confirm on the Pi which one Auth0 requires and drop the other.
8. Shapes assumed without a live capture, to confirm from the probe: customized_heart_rate_zones on /api/me as objects with slug, min_value, and max_value; paired_devices entries carrying id and name; seconds_since_pedaling_start on performance_graph as an array of sample offsets.

### Build 1 clarifications

Deviations from the text above that build 1 had to make. Each is a clarification to this document, not a change to the decisions in section 2.

- 4.1 and 13: fixtures/auth/ is synthesised from this section and Auth0's documented Universal Login behaviour, not recorded from a live capture. Replace the files after the first Pi run, keeping the names and sanitisation rules in fixtures/README.md.
- 4.1: any failure on the credentials POST that does not indicate a wrong password or a verification step (rate limit, 5xx) maps to stage authorize, not credentials, so the settings page shows the browser fallback message rather than a wrong password message.
- 4.2: seconds_since_pedaling_start is an array of sample offsets, one per value in each metric's values[]. The wrapper returns it as a number array; the last element is the time of the latest sample.
- 5: the src tree gains scripts/auth-probe.mts, compiled by the normal build to dist/scripts/auth-probe.mjs. It imports the auth and api modules and nothing else.
- 5.1: AuthError also carries an optional `code`, the OAuth error code when the response had one (for example invalid_grant). The store uses it to tell a dead session from a transient refresh failure, as 4.1 requires. Stage and status stay the only values that reach log lines.
- 7: on invalid_grant the store sets state reconnect_needed and lastError, and also removes the dead accessToken, accessTokenExpiresAt, and refreshToken from the record. Identity fields, zones, and maxHr are kept so the settings page can still show the profile.
- 7: withValidToken refreshes at most once per call. A second 401 after a successful refresh is rethrown as ApiError so the poller's transient-failure handling in 8.2 applies.
- 7: before refreshing, the store re-reads the account file. If another caller has already persisted a rotation with a fresh access token, that rotation is reused; a retired refresh token is never sent to Auth0.
- 13: the probe in this repository (dist/scripts/auth-probe.mjs) is the live verification tool from build 1 on; peloton-test/p.mjs remains the record of the original capture.
- Toolchain: engines.node is ">=20" per the build brief, where notify-switch pins ^22.12.0. CI runs Node 20, 22, and 24.
- 4.1 and 5.1: verification_required detection does not run on the initial login page returned by GET /authorize. Universal Login bundles its Lock library and text dictionary, which contain words such as "passwordless" and "verify your email" whatever the account's settings, so a check there fails every login. The check runs on the credentials response, the callback page, and the token error path only.
