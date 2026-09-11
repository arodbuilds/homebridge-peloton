# homebridge-peloton SPEC

Version: draft 3 for 1.0.0-beta.1 (11 September 2026, after build 3 and its two Chrome passes on the Pi)
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

- Node 20 or later (Homebridge 2.x requirement); engines.node is ">=20" and CI runs Node 20, 22, and 24. Built-in fetch and crypto; no HTTP or HTML parsing libraries.
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

Login page facts (build 1 live probe, 11 September 2026): GET /authorize redirects to https://auth.onepeloton.com/login (HTTP 200, title "Log in | Peloton", Auth0 widget https://cdn.auth0.com/w2/auth0-widget-5.2.min.js). The page embeds its configuration on one line as `window.injectedConfig = window.injectedConfig || "<base64 JSON>";` and decodes it with `decodeURIComponent(escape(window.atob(window.injectedConfig)))`, which is a UTF-8 decode. The JSON carries auth0Domain ("auth.onepeloton.com"), auth0Tenant ("peloton-prod"), callbackURL ("https://members.onepeloton.com/callback"), clientID, clientConfigurationBaseUrl ("https://auth.onepeloton.com/"), internalOptions, extraParams (the same values as internalOptions), and presentation keys the module ignores. internalOptions is Auth0's transaction: _csrf, _intstate ("deprecated"), audience, code_challenge, code_challenge_method, nonce, protocol ("oauth2"), response_type ("code"), scope, state. internalOptions.state is Auth0's transaction state, about 160 characters, and is different from the state on the authorize URL; internalOptions.nonce and code_challenge echo the values sent on the authorize URL. The client configuration script at {clientConfigurationBaseUrl}client/{clientID}.js lists the auth0 strategy with the single database connection "pelo-user-password".

Headless login (primary path) drives Auth0 Universal Login without a browser:
1. GET /authorize with the PKCE parameters; follow to the login page, keep the cookies (the _csrf cookie when Auth0 sets one).
2. Parse window.injectedConfig from the login page: find the line, take the quoted base64, decode it as UTF-8, JSON.parse it. Missing or malformed config is AuthError stage authorize. internalOptions.code_challenge must equal the challenge and internalOptions.nonce must equal the nonce sent on the authorize URL; otherwise AuthError stage state_mismatch. Nothing is posted in either case.
3. POST JSON to /usernamepassword/login. Body: every key and value of internalOptions verbatim (state, _csrf, _intstate, audience, code_challenge, code_challenge_method, nonce, protocol, response_type, scope), plus client_id (the constant), redirect_uri (callbackURL from the page), tenant (auth0Tenant from the page), connection ("pelo-user-password"), username, and password. Headers: content-type application/json, origin, referer (the login page URL), the cookie jar, and x-csrf-token carrying the _csrf cookie when it exists. CSRF handling: the body _csrf comes from the page config, the header from the cookie when present. Sending the authorize state in the body instead of the transaction state is rejected with HTTP 403 {"name":"AnomalyDetected","code":"access_denied","description":"Invalid state"}; that response maps to stage authorize (a request-shape failure, not a wrong password), so the settings page offers the browser fallback. access_denied counts as a wrong password only when the description says so.
4. Auth0 returns an HTML form that auto-posts to /login/callback; the module parses its action and hidden inputs from the HTML rather than hard-coding them, and posts them. Any failure on the credentials POST that does not indicate a wrong password or a verification step (rate limit, 5xx, 403 AnomalyDetected) maps to stage authorize, not credentials, so the settings page shows the browser fallback; a 401 still counts as a wrong password, a 403 does not on its own. verification_required detection runs on the credentials response, the callback page, and the token error path only, never on the initial login page: Universal Login bundles its Lock library and text dictionary, whose words such as "passwordless" and "verify your email" appear whatever the account's settings. The module takes an onLoginPage callback so the probe can print the tenant and connection it is about to use.
5. The callback POST starts a redirect chain that completes the session across two hosts. Observed on the build 2 Pi probe (11 September 2026), after POST /login/callback (form fields wa, wctx, wresult):
   1. 302 to /authorize/resume?state=... on auth.onepeloton.com; sets the auth0 and auth0_compat cookies.
   2. GET /authorize/resume: 302 to https://auth-orca.onepeloton.com/sso/login_site?visited_site=https%3A%2F%2Fmembers.onepeloton.com&user_id=...&client_name=Members&session_claim_token=...&state=...
   3. GET auth-orca /sso/login_site: 303 to https://auth-orca.onepeloton.com/sso/login_domain?state=...&visited_domain=onepeloton.com; sets peloton_logged_in_user_hash and peloton_visited_sites on auth-orca.onepeloton.com.
   4. GET auth-orca /sso/login_domain: 303 to https://auth.onepeloton.com/continue?state=...; sets peloton_visited_domains on auth-orca.onepeloton.com.
   5. GET /continue: 302 to /authorize/resume?state=...
   6. GET /authorize/resume: 302 to https://members.onepeloton.com/callback?code=...&state=... where state is the one from our authorize URL.

   Redirect rule: the module follows every 3xx on any host, sending each host only the cookies the jar holds for that host and never resending the POST body, and stops at the first Location whose scheme, host, and path equal the redirect URI (a trailing slash is tolerated, the query is ignored). At most 12 redirects are followed after any single request. A 3xx without a Location is AuthError at the current stage, and a non-3xx response before the redirect URI is treated as a page (verification check, then AuthError stage callback). The single-hop shape, where /login/callback redirects straight to the redirect URI, is still accepted.
6. The final redirect to members.onepeloton.com/callback carries code and state. Auth0 restores the state from the authorize URL here, so the module compares against that state, not the transaction state. The module does not follow the redirect; it extracts the code and exchanges it.

Browser sign-in (fallback): the plugin generates verifier and state, gives the user the authorize URL, and later receives the full callback URL by paste. It checks state, exchanges the code with the stored verifier. Codes are single use and short-lived; the members web app does not consume them (verified).

### 4.2 API

Base https://api.onepeloton.com. Headers on every call: Authorization: Bearer {access_token}, Peloton-Platform: web. JSON responses.

| Call | Use | Fields used |
| --- | --- | --- |
| GET /api/me | identity, zones, avatar, devices | id, username, first_name, last_name, image_url, is_profile_image_default, customized_heart_rate_zones (array, empty when unset), default_max_heart_rate, customized_max_heart_rate, paired_devices. last_workout_at is read but stale and must not be used (see below) |
| GET /api/user/{id}/subscriptions | household (owner only) | data[].id, data[].status ("active_normal" or "unused"), data[].owner.id, data[].max_shared_users, data[].shared_user_set[] (id, username, name, image_url, last_workout_at), data[].attached_devices[] (device_id, device_name, device_group). Live shapes below |
| GET /api/user/{id}/workouts?limit=1&sort_by=-created | latest workout | data[0]: id, status ("IN_PROGRESS" or "COMPLETE"), fitness_discipline, device_type, workout_type, start_time, end_time, created_at, title, name, is_peloton_originated_workout, is_3p_fit_feed_workout, platform, peloton_id, ride (id, title, duration, instructor_id when present). No device id field exists on workouts; device_type is the hardware model code and platform is what device matching compares (see 8.3) |
| GET /api/workout/{id} | status of the locked workout (8.2) | the same fields as one entry of the workouts list, unwrapped |
| GET /api/workout/{id}/performance_graph?every_n=5 | live metrics for the active workout | metrics[] where slug is "heart_rate": values[] (latest sample), zones[] (slug, min_value, max_value); seconds_since_pedaling_start (array of sample offsets) |

Subscriptions shape (second Chrome pass on the Pi, 11 September 2026, GET /api/user/{id}/subscriptions on the owner's account):

- attached_devices[] entries are { device_id, device_name, device_group, last_attached_at }. device_group values seen: "bike", "tread", "guide". device_name is null for a device the membership has not named (the Guide). There is no id, name, or device_type field. The module reads each entry as { id: device_id, name: device_name or null, group: device_group } and keeps every entry that has at least one of them.
- shared_user_set[] entries carry name (the member's display name, a single string), username, id, image_url, is_profile_private, is_provisional, last_workout_at, total_workouts, and location. There is no first_name, last_name, or is_profile_image_default. The module reads name as the profile's displayName, falling back to username when name is empty or null; is_profile_image_default is read as false when absent, so a household profile's avatar is decided by image_url alone until the member connects and /api/me settles it.
- The subscription object also carries bike_device_name and tread_device_name at the top level. The module does not read them; attached_devices is the device list.

Last workout time: /api/me last_workout_at is stale (the build 2 probe returned a 2020 value against a workout from that day) and must not be used. The latest workout's created_at from the workouts list is the source for "last workout" everywhere it is shown or compared.

Third-party imports: workouts with is_3p_fit_feed_workout true are runs and other activities synced in from Apple Health, Strava, or Fitbit. They appear in the workouts list with COMPLETE status and a created_at of the sync time, and can land at the top of the list while a Peloton workout is in progress. Detection ignores them (8.2).

Device codes (Pi ride tests, 11 September 2026), the facts behind the device rule in 8.3:

| Hardware or source | device_type | platform |
| --- | --- | --- |
| Bike+ | home_bike_plus | home_bike |
| Tread | prism | home_tread |
| Apple Health import | apple_health | iOS_app |

Start latency on both rides was within one fastInterval (10 s) of the workout starting.

fitness_discipline values mapped to the Activities chips: cycling, running, walking, rowing, strength, yoga, stretching, meditation, cardio, bike_bootcamp, tread_bootcamp, row_bootcamp. Unknown values are logged once at debug and never match a trigger with a restricted activity list; they do match "all activities".

## 5. Module boundaries

```
src/
  platform.ts          Homebridge platform: config load, accessory registry, wiring
  auth/peloton-auth.ts login(email, password), refresh(refreshToken), browserStart(), browserFinish(callbackUrl); nothing else
  api/peloton-api.ts   typed wrappers for the five calls in 4.2; takes an access token, never stores one
  store/account-store.ts   per-account persistence (7)
  poller/poller.ts     the state machine (8)
  poller/rules.ts      pure functions: does this workout match this trigger; zone from sample; hold and dwell logic
  accessories/         trigger sensor, fast polling switch, attention sensor
  ui/server.ts         @homebridge/plugin-ui-utils server (10)
  config.ts            config types and validation (6): defaults, clamping, generated ids
  scripts/auth-probe.mts   standalone auth probe for the Pi, compiled to dist/scripts/auth-probe.mjs; imports the auth and api modules and nothing else
homebridge-ui/public/  settings page (design/README.md)
fixtures/              recorded, sanitised JSON used by tests
```

peloton-auth.ts is the only file that knows Auth0 URLs, the client id, scopes, or HTML form handling. When Peloton changes the login flow, the fix is inside this file.

### 5.1 Auth errors

All auth failures throw AuthError with stage in: authorize, credentials, callback, exchange, refresh, verification_required, state_mismatch, expired_code, malformed_callback. Includes the HTTP status where there was one, and an optional `code`, the OAuth error code when the response had one (for example invalid_grant), which the store uses to tell a dead session from a transient refresh failure. Never includes response bodies, tokens, or the password. Log lines print stage and status only.

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
- accounts[].id and triggers[].id are generated by the UI on creation, never shown, never edited: crypto.randomUUID where the page has it, else a version 4 UUID from crypto.getRandomValues, since randomUUID exists only in a secure context and the Homebridge UI is usually served over plain http. Accessory UUIDs derive from them, so renaming never orphans an accessory.
- accounts[].password is optional: absent for accounts connected through the browser path. userId is filled by the plugin after the first successful connection and written by the settings page on save.
- Account entries written by the settings page carry id, email, displayName, and userId (the last two from the store when config lacks them), and password only when the user entered one on the page or one was already stored; a stored password is written back unchanged and never shown in the form.
- who is "anyone" or an account userId. hrZone triggers never use "anyone".
- activities absent or empty means all.
- device is "any", "bike", or "tread". Any other value becomes "any" with a warn line.
- config.schema.json mirrors this shape with the defaults above, the settings page copy as titles and descriptions, and marks the custom UI (customUi true, customUiPath ./homebridge-ui). It carries the constraints the page enforces: fastInterval minimum 5, standbyInterval 0 or 30 and above, name and triggers[].name required, an hrZone trigger's who a member (never "anyone"), device one of any, bike, tread, and never fastSwitch false together with standbyInterval 0. Trigger names must differ from each other (case-insensitive); the page enforces it and the schema states it, since JSON Schema cannot express it across items.
- The settings page (design/README.md) is the normal editor. It pushes the block through updatePluginConfig and the host's Save writes config.json; the plugin's UI server never writes config.json.
- Validation (config.ts): invalid values are clamped or defaulted with one warn line each and never a crash. fastInterval has a floor of 5, standbyInterval a floor of 0, holdAfterEnd and holdTime a floor of 0, zone a range of 1 to 5, fastSwitchAutoOffMinutes a floor of 1, dailyCheckIn must be HH:MM. An unknown trigger type becomes workout and an unknown accessory kind occupancy. A missing, duplicate, or unsafe id is replaced by a generated id for the run with a warn line asking the user to save the config from the settings page so the id persists. An hrZone trigger whose who is "anyone" is kept, warned about, and never turns on.

## 7. Account store

Path: {homebridge storagePath}/homebridge-peloton/accounts/{account id}.json, file mode 0600, directory 0700.

```json
{ "userId": "...", "username": "...", "displayName": "...", "imageUrl": "...", "isProfileImageDefault": false,
  "accessToken": "...", "accessTokenExpiresAt": 1789000000000, "refreshToken": "...",
  "hrZones": [{ "zone": 1, "min": 0, "max": 110 }, ...], "maxHr": 168,
  "isOwner": true, "devices": [{ "id": "...", "name": "Bike+", "group": "bike" }], "householdFetchedAt": 1789000000000,
  "state": "connected" | "reconnect_needed" | "not_connected",
  "lastCheckedAt": 1789000000000, "lastError": { "stage": "refresh", "status": 403, "at": 1789000000000 } }
```

- Writes are atomic: write to a temp file in the same directory, then rename. A refresh is not considered complete until the new refresh token is on disk.
- Access tokens are refreshed when within 6 hours of expiry, or on any 401. withValidToken refreshes at most once per call: a second 401 after a successful refresh is rethrown as ApiError so the poller's transient-failure handling in 8.2 applies. Its forceRefresh option refreshes unconditionally; the daily check-in uses it.
- Before refreshing, the store re-reads the account file. If another caller has already persisted a rotation with a fresh access token, that rotation is reused; a retired refresh token is never sent to Auth0.
- On invalid_grant the store sets state reconnect_needed and lastError, and removes the dead accessToken, accessTokenExpiresAt, and refreshToken from the record. Identity fields, zones, and maxHr are kept so the settings page can still show the profile.
- hrZones holds customized_heart_rate_zones from /api/me (empty when unset) and maxHr the customised max, else the default max. Both are the fallback for zone bounds (8.3).
- isOwner is set by the subscriptions call at check-in (true when a subscription's owner.id is the account's userId). devices, on the owner's record only, is the union of attached_devices across the owned subscriptions as { id: device_id, name: device_name or null, group: device_group } (4.2). Devices are keyed by id, else by name, else by group, so none is dropped or folded into another; a device Peloton has not named (the Guide) keeps name null and the settings page shows its group (10). householdFetchedAt, on the owner's record only, is the time of the subscriptions read that last wrote devices and the household profiles; /status re-reads the membership when it is missing or older than one hour (10), and a member's record carries neither field. A record written by an earlier build holds devices without a group, which read as an empty group until the next subscriptions read. Device matching does not use devices (8.3).
- state is persisted so the settings page shows the right pill immediately after a restart.
- lastCheckedAt is the time of the account's last successful call: every successful poll writes it (8.2), as do a token refresh, the daily check-in, and the profile requests of the settings page. /status reads it for the Last checked line (10).
- Household profiles that have never connected exist in the store with state not_connected and no tokens, populated from the owner's subscriptions call. Their file is keyed by the member's userId, since no config account id exists for them yet; a member that already has a record with that userId is not duplicated. Their displayName is the shared_user_set entry's name (one display string; the entry carries no first_name or last_name, 4.2), else the username when name is empty or null. Every later subscriptions read (connect, check-in, /household, and the hourly refresh on /status) brings an existing profile up to date with the member's current username, name, and photo; a record that connected on its own is never overwritten by the profile.
- Removing an account in the UI deletes its file (/remove, 10).
- When a configured account connects and its profile names a userId for which a household profile file exists (keyed by that userId, no tokens), the profile file is removed: the account now stands for that member and the settings page shows one card (connectWithTokens, 10).

## 8. Poller

One loop per platform. All timing uses an injectable clock so tests can drive it.

### 8.1 States

- standby: Fast polling switch off, no workout locked. Poll every connected account at standbyInterval, staggered evenly across the interval. If standbyInterval is 0, no polling at all.
- scanning: switch on, no workout locked. Poll every connected account at fastInterval, staggered.
- locked: one account has a workout IN_PROGRESS. Poll only that account at fastInterval. Add the performance_graph call on each poll only if at least one hrZone trigger targets that account.
- released: the locked workout has ended and at least one workout trigger is still in its holdAfterEnd. Poll only that account's workouts list at fastInterval, which is where a stacked class shows up; a new IN_PROGRESS id locks on again and keeps the sensor on without a gap.
- Transitions: standby or scanning to locked on the first IN_PROGRESS seen. locked to released when the workout ends, then to scanning when the switch is on, or to standby when it is off, once holdAfterEnd has elapsed for every trigger that was on (at once when none was). Switch turning off during locked or released does not leave that state (the workout is followed to its end).
- Any switch change triggers an immediate poll cycle before the new schedule starts: in standby or scanning every account is polled at once and the staggered schedule restarts; in locked or released the followed account is polled at once.
- Stagger: at startup the first account polls immediately and the others follow at equal fractions of the interval. After an immediate cycle or a release, every account's first slot is one fraction away.

### 8.2 Workout detection per account

- Latest workout = data[0] of the workouts call. A workout is detectable when is_3p_fit_feed_workout is false and status is IN_PROGRESS or COMPLETE. A third-party import (Apple Health, Strava, or Fitbit) or an unknown status is ignored for detection: it never starts a workout, never ends one, and never becomes the last seen id.
- Started: status IN_PROGRESS and id differs from the last seen active id.
- While locked, the poller polls GET /api/workout/{id} for the locked workout's status instead of the list, so a synced import arriving mid-workout cannot end it. Once that call returns COMPLETE, the end is processed and the next cycle returns to the list, which is also where a stacked class shows up.
- Ended: status COMPLETE for the locked workout from GET /api/workout/{id}. A new IN_PROGRESS id in the list after the locked workout completes is an end followed by a start (stacked classes). When the locked account drops out of polling (invalid_grant), the workout is treated as ended so no sensor stays on.
- A workout already IN_PROGRESS at plugin startup counts as started on the first poll.
- Every poll result is logged at debug with the workout id, status, discipline, device_type, and platform, so a new hardware code can be checked against the platform rule (8.3).
- Every successful poll writes lastCheckedAt on the account record (7), so the settings page's Last checked line follows polling rather than the last sign-in or refresh. A failure to write it is logged at debug and is not a poll failure.
- Transient API failures (network, 5xx, 429, a second 401 after a refresh) keep the last known state and retry on the next tick with backoff: from the third consecutive failure the account's interval doubles (20 s, 40 s, 60 s on a 10 s base) up to 60 s, or the base interval when that is longer, until a success. The third failure logs one warn line with the HTTP status and the new interval; other failures log at debug. A 401 goes through refresh once; a refresh failure with invalid_grant marks the account reconnect_needed, drops it from polling, logs the sign-in expired line, and raises accountStateChanged for the attention sensor.
- Re-login after invalid_grant: when the dropped account has a password in config, the platform attempts login() once, not in a loop. Success runs the connect flow (10), logs the Connected line, puts the account back on the schedule, and raises accountStateChanged with state connected so the attention sensor clears. Failure logs the sign-in failed line once and leaves the account reconnect_needed; the attention event stands until the settings page connects it or the next restart signs it in.
- The poller keeps only the latest workout and the latest sample offset per account, and raises events for the platform: workoutStarted, workoutEnded, sampleReceived, accountStateChanged, switchChanged, switchAutoOff, triggerChanged, checkInComplete.

### 8.3 Trigger evaluation (pure, in rules.ts)

Workout trigger matches when: who is "anyone" or equals the account userId; activities is empty or contains the workout's fitness_discipline; device is "any" or matches. Device matching is by the workout's platform: "bike" matches platform home_bike and "tread" matches platform home_tread; "any" matches every workout. Workouts carry no device id field (settled by the build 2 probe) and device_type is the hardware model code (home_bike_plus, prism), which stays in the debug poll line but is not compared. App workouts (platform ios) and imports (platform iOS_app) match only "any". The who and activities checks run first.

The sensor is on from start until end plus holdAfterEnd seconds. A new matching workout during the hold keeps it on without a gap. Trigger changes are logged and raised as events at the moment they happen: holds run on their own timers, not on the next poll.

Heart-rate zone trigger: from each performance_graph poll take the latest heart_rate sample. Zone bounds, in priority order: zones[] on the heart_rate metric in performance_graph; customized_heart_rate_zones from /api/me (hrZones in the store); otherwise Peloton's defaults from max heart rate (customized_max_heart_rate, else default_max_heart_rate, maxHr in the store): zone 1 below 65 percent, zone 2 65 to 75, zone 3 75 to 85, zone 4 85 to 95, zone 5 95 and above, with each lower bound rounded down to a whole beat (on a 168 max this gives 109, 126, 142, and 159, the bounds performance_graph reports). The zone of a sample is the highest zone whose lower bound it reaches; without bounds the zone is unknown and the condition false. Condition is zone at or above the configured zone. The sensor turns on after the condition has held for holdTime seconds and off after it has been false for holdTime seconds, and always off when the workout ends. A sample counts as new when the last seconds_since_pedaling_start offset changed; the second consecutive poll without a new sample (or with a failed graph call) makes the condition false. No heart_rate metric at all: log once per workout at info, sensor stays off.

### 8.4 Fast polling switch

- Exposed as a Switch service, writable. Off at startup.
- Auto-off: a timer of fastSwitchAutoOffMinutes counted from the later of the switch turning on and the last workout ending, so it is re-armed on switch-on and on every workout end while the switch is on. When it fires, the switch turns off, a log line says so, and switchAutoOff is raised; a locked or released workout is still followed to its end. A manual off cancels the timer.
- When fastSwitch is false in config, the accessory is removed and the poller behaves as if the switch were permanently off.

### 8.5 Daily check-in

At dailyCheckIn local time (the process time zone), and again every day after: for each connected account refresh the token, fetch /api/me (zones, avatar, name), and for the owner fetch subscriptions to update household profiles and devices in the store. Subscriptions are read for every account whose owner status is unknown; the first check-in settles isOwner. Runs even when standbyInterval is 0. Failures follow 8.2: invalid_grant drops the account, anything else skips it until the next check-in. Ends with the check-in log line counting the accounts refreshed without error.

### 8.6 Attention needed sensor

Occupancy service, on while any account is in reconnect_needed, off otherwise. Created only when advanced.attentionSensor is true.

## 9. Accessories

- One accessory per trigger. Service is OccupancySensor or Switch per accessory kind. Switch triggers are read-only in effect: a write from the Home app is acknowledged and the value is immediately re-set to the computed state (the Home app then shows the true state).
- Accessory names come from the trigger name and are refreshed at startup, on the accessory and on the service's Name; UUIDs are hap.uuid.generate over "homebridge-peloton:trigger:{trigger id}". Changing accessory kind replaces the service in place, keeping the accessory UUID: the other kind's service is removed and the wanted one created.
- Fast polling switch accessory UUID is hap.uuid.generate over "homebridge-peloton:fast-polling-switch"; the attention sensor over "homebridge-peloton:attention-sensor". Their names are polling.fastSwitchName and "Peloton attention needed".
- Accessory information: Manufacturer "Alex Rodriguez", Model "Peloton trigger" / "Peloton fast polling switch" / "Peloton attention sensor", Serial the trigger id (or "fast-polling-switch" and "attention-sensor"), Firmware the package version.
- Reconciliation by id on every start, and so after every config change (Homebridge restarts the plugin when config.json is saved): a trigger id with no cached accessory gets one registered; a cached accessory whose id left config is unregistered, as are the Fast polling switch when polling.fastSwitch is false and the attention sensor when advanced.attentionSensor is false; a cached accessory whose kind changed has its service swapped in place. Cached accessories that stay are renamed from their trigger and passed to updatePlatformAccessories so renames persist. Accounts are reconciled by config account id against the store (7, 10): accounts with a password and no usable stored sign-in are signed in at startup, records whose id left config by hand are left in place and ignored.
- The platform starts polling on didFinishLaunching and stops every timer on the Homebridge shutdown event.

## 10. Settings UI server (@homebridge/plugin-ui-utils)

homebridge-ui/server.js starts the compiled src/ui/server.ts, a HomebridgePluginUiServer that opens the account store under the Homebridge storage path and answers the requests below through src/ui/handlers.ts, over the same store, auth, and API modules the platform uses. It reads and writes the account store directly, never returns tokens to the page, never reads or writes config.json (the page holds the block from getPluginConfig and writes it through the host's normal save), and logs nothing. Passwords and callback URLs are used for the one request that carries them.

Every answer is { ok: true, ... } or { ok: false, stage, status? } where stage is an auth stage from 5.1, or "api" for a Peloton API or network failure, with the HTTP status when there was one. A request whose payload has no valid account id (or no email, password, or callbackUrl where one is required) is rejected before anything runs; the page shows its generic server message for it.

| Request | Body | Response |
| --- | --- | --- |
| /status | none | accounts[] (every stored record, connected or not) with id (the store key: the config account id, or the member's userId for a household profile), userId, displayName, username, avatar (true when /avatar has a photo), isOwner, state, lastCheckedAt, lastWorkoutAt (created_at of the latest Peloton workout in the workouts list in epoch milliseconds, asked at most once a minute per connected account; null for an import at the top, an empty list, an unconnected account, or a failed call; never /api/me last_workout_at); devices[] (id, name or null, group) from the owner's record; version. Runs the household refresh below first |
| /connect | id, email, password | ok with account (a /status summary), or error with stage |
| /browser/start | id | ok with authorizeUrl; verifier and state kept in server memory for 10 minutes keyed by account id, a new start replacing the old one |
| /browser/finish | id, callbackUrl | ok with account, or error with stage: expired_code without a live session (none started, ten minutes passed, or the account removed); state_mismatch or malformed_callback from the auth module leave the session in place so the right link can still be pasted; a used or expired code (expired_code from the exchange) ends the session; any other exchange failure keeps it |
| /test | id | fetches /api/me with the stored session (refreshing when due), updates the profile, and answers ok with lastCheckedAt; refresh (with status) when the session is dead, refresh without status for an account with no tokens, api for a Peloton failure |
| /household | none | re-reads subscriptions for every connected account that may own a membership, updates household profiles and devices (7), and answers like /status; a single owner's failure is reported by stage |
| /remove | id | deletes the account file and everything the server remembers about the account (browser session, avatar, last workout); ok |
| /avatar | id | { ok, status 200, contentType, data (base64 image bytes) } proxied from image_url and served from memory for 24 hours. contentType is the CDN's content-type when it says image/*, else the type read from the first bytes (JPEG, PNG, GIF, or WebP), since the CDN behind image_url does not always say image/* (S3 answers binary/octet-stream for an object stored without a content type); { ok, status 204 } when isProfileImageDefault, the record has no https image_url, or the account is unknown; api with the CDN status for a failed answer or one whose bytes are not an image |

Household refresh on /status: before answering, /status re-reads the membership for every connected account that may own one (tokens, a userId, and isOwner not false) whose householdFetchedAt is missing or older than one hour, and applies the household to the store (7: devices, householdFetchedAt, and the not_connected profiles). A page opened after an upgrade or a change on the membership then shows current names and devices without waiting for the daily check-in (8.5). A failure on that read is swallowed: /status answers from the store as it stands, householdFetchedAt is left unchanged so the next /status tries again, and a dead session is already marked reconnect_needed by the store. /household reads unconditionally, as before.

Error stage to page message mapping (page copy lives in design/README.md):
- credentials: "Peloton did not accept that email and password."
- authorize, callback, exchange: "Peloton sign-in did not complete. You can connect using your browser instead." and the Sign in with browser link is promoted to an outlined button.
- verification_required: "This account has extra verification turned on. Use Sign in with browser."
- malformed_callback: "That does not look like the Peloton callback address. It should start with members.onepeloton.com/callback."
- state_mismatch: "This link was from an earlier attempt. Click Open Peloton sign-in again and use the new one."
- expired_code: "The sign-in link expired. Click Open Peloton sign-in and try again."
- refresh: "Sign-in expired. Reconnect to resume polling." and the card flips to Reconnect needed.
- api: "Peloton did not answer (HTTP {status}). Try again in a moment.", without the parenthesis when there was no status.

Password handling: the page sends the password to /connect once; the server performs the login and stores tokens. The page also writes the password to config.json through the host's normal save so the plugin can re-login headlessly after invalid_grant; on later saves a stored password goes back unchanged and is never shown in the form (6). The browser path stores no password. The unsaved draft the page keeps in localStorage never holds passwords.

Connect flow (store/account-connect.ts, shared by the settings page, the startup sign-in, and the re-login in 8.2): connectAccount runs login() once and hands the tokens to connectWithTokens, which the browser path calls directly. connectWithTokens saves the tokens with state connected before anything else; getMe fills userId, username, displayName (kept when the record already has one, unless it is only the username standing in for a name, which the profile's "first_name last_name" replaces), imageUrl, isProfileImageDefault, zones, and maxHr; a household profile file keyed by that userId is then removed (7); getSubscriptions settles isOwner and, for the owner, the household profiles and devices (7). AuthError from the login propagates untouched so the caller logs its stage; a profile failure after a successful login leaves a connected account whose profile the next check-in completes, and the UI server reports it as api.

Startup sign-in: on didFinishLaunching, before polling starts, the platform runs the connect flow once for each configured account that has email and password and whose store record is missing, not_connected, or reconnect_needed, one account after another in config order. Success logs the Connected line. AuthError logs the sign-in failed line once, leaves the record as it was, and skips the account for this run. Accounts with tokens already stored are not re-logged in.

Owner detection: the owner is the account whose getSubscriptions returns a membership with owner.id equal to its own userId; isOwner is set from that, never from config order.

Page-side account state: the page shows one card per config account (with the store's summary when there is one) and one per store record config does not name, in that order; a household profile connected from the page gets a config entry with a generated id, and the server removes the profile file. The Checking pill shows while a card's request is in flight. Ids for accounts and triggers are generated on the page (6) and are never shown.

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
- "{displayName}: sign-in failed at stage {stage}, HTTP {status}; use the settings page to connect", once per failed startup sign-in or re-login
- "{displayName}: reconnect needed, not polling until the account is connected again" and "{displayName}: not connected, not polling", once per skipped account at startup
- "{displayName}: no heart-rate data for this workout", once per workout

Warn level: config values clamped or defaulted (6), the third consecutive poll failure with its HTTP status and the backoff interval (8.2), a profile fetch that fails after a successful sign-in (10).

Debug level: each poll result with workout id, status, discipline, device_type, and platform, and each heart-rate sample with its zone. With config.debug these lines are printed at info so they show without Homebridge's debug flag. Never tokens, passwords, emails, or response bodies.

The settings UI server process logs nothing; its failures reach the page as stages (10).

## 12. Privacy and security

- Tokens only in the account store, 0600. Never in config.json, logs, or UI responses.
- Avatar images proxied through the UI server, not fetched by the page from Peloton's CDN.
- Only the owner's token is used for the household list; members' workouts are read only with their own tokens.
- README states what is stored where and how to remove it (delete the account in the UI or delete the storage folder).

## 13. Tests

- Claude Code cannot reach onepeloton.com. All network is mocked with fixtures under fixtures/: auth (login page, form post response, callback form, the six redirect hops after the callback POST and the single-hop shape, token responses including invalid_grant), api (me for owner and member, subscriptions in the live shape of the second Chrome pass with attached_devices as device_id, device_name, and device_group and shared_user_set with name, workouts in IN_PROGRESS and COMPLETE for cycling and strength, a third-party import at the top of the list, a single workout by id, performance_graph with and without heart_rate). Fixtures are sanitised: ids shortened, names replaced, tokens replaced with "redacted". The login page files and the redirect hops follow the redacted dumps from the Pi probes; the other auth fixtures are synthesised from section 4 and Auth0's documented behaviour and are replaced as the probe captures each step, keeping the names and rules in fixtures/README.md.
- Poller tests use the injectable clock and scheduler and a route-based fake fetch, with the real account store in a temporary directory and the real API wrappers, and cover: standby with 0 and 120 s, scanning stagger, lock-on, locked polling through getWorkout rather than the list, a synced import mid-workout, stacked classes with hold, switch off during locked, auto-off timer anchoring, HR dwell on and off, stale samples, 401 then refresh, invalid_grant to reconnect_needed with the attention event, backoff on 5xx, and the daily check-in.
- Rules tests cover every matching path in 8.3. Config tests cover every default, clamp, and generated id in 6. Accessory tests cover the service swap, the acknowledged write, and UUID stability with hap-nodejs objects; platform tests cover registration, orphan cleanup, skip lines, and event wiring with a fake Homebridge API.
- Store tests cover atomic write and rotation.
- Schema tests compile config.schema.json with ajv (a dev dependency) and check the section 6 sample, the defaults, and every constraint in 6. UI server tests run the handlers against an in-memory fake store and a routed fake fetch: every request in 10, every stage mapping, the household profile claim, browser start and finish through the real PKCE exchange including expiry, the avatar 204 path and cache, the last workout time, and the one-hour household refresh on /status (a stale or missing householdFetchedAt reads once and then serves the store for an hour, a failed read keeps the stored household, a member is never asked). The API tests parse the live-shaped subscriptions fixture, a null device_name, a missing device_group, and a member without a name. The page model (homebridge-ui/public/model.js) is imported into node:test for the account write-back, trigger defaults, validation messages, the copy rules, and the Devices line labels, and the page suite renders the Devices line with a device that has no name; the page itself is checked by hand in the Homebridge UI.
- Live verification is manual on the Pi with the probe in this repository (dist/scripts/auth-probe.mjs); peloton-test/p.mjs remains the record of the original capture. Then one real ride with the fast polling switch on.

## 14. Release

- 1.0.0-beta.1 to the npm beta tag through the GitHub release workflow (pre-release). Keywords include homebridge-plugin, supports-hap, peloton.
- README: regenerated banner with the round-two tagline, setup in two steps, the fast polling automation recipe, browser sign-in instructions with the Back-button and history alternatives, privacy section, not-affiliated line.
- CHANGELOG from beta.1.
- Verification submission only after 1.0.0 and a soak.

## 15. Open items to settle during beta

1. Whether Auth0 presents a verification-code step on any household account; if so, verification_required detection needs a fixture.

Resolved during builds 1 to 3 and folded into the body: workouts carry no device id field (4.2, 8.3); performance_graph zone bounds, seconds_since_pedaling_start, and empty customized_heart_rate_zones (4.2, 8.3); the Auth0 tenant, connection, CSRF handling, redirect chain, and login page config (4.1); /api/me last_workout_at is stale (4.2, 10); start latency was within one fast interval on both Pi rides (4.2); the device_type and platform codes of the Bike+, the Tread, and an Apple Health import are in the table in 4.2, and device matching compares the platform, so the device_type map and the "device filtering is unavailable" path are gone (6, 8.3, 11). The build 2 clarifications (config parsing in src/config.ts, the released state, the poller events and backoff, the connect flow module, the check-in rules, the UUID seeds, the log lines, hap-nodejs in tests) live in their sections.

### Build 3 clarifications

Each is a clarification to this document, not a change to the decisions in section 2. The text lives in the section named.

- 6: device is any, bike, or tread; config.schema.json carries the full shape, the page copy, and the validation constraints; account entries as the page writes them.
- 7: a household profile file is removed once a configured account connects as that member.
- 8.3: device matching is by workout platform; device_type stays in the debug line only.
- 9: reconciliation by id on every start, for triggers and accounts.
- 10: the UI server module layout, the answer shape with the api stage, per-request behaviour including the browser session rules and the avatar answer, the refresh and api page messages, connectWithTokens, and the page-side account state.
- 11: the UI server logs nothing.
- 13: the schema, UI server, and page model suites.
- design/README.md: the Device field caption, and the states and lines the page needed beyond the design (listed there under Clarifications from build 3).

### Build 3 Chrome pass clarifications

From the first pass through the settings page in Chrome on the Pi (Homebridge UI 5.29 over plain http). Each is a clarification, not a change to section 2.

- 6 and 10: ids on the page fall back to a version 4 UUID from crypto.getRandomValues, since crypto.randomUUID does not exist outside a secure context.
- 7 and 8.2: lastCheckedAt is written on every successful poll; household profiles are named "first_name last_name" and refreshed from every subscriptions read; devices are keyed by id or by name, and a nameless device is stored under its hardware family.
- 10: /avatar reads the image type from the bytes when the CDN's content-type is not image/*; connectWithTokens replaces a display name that is only the username.
- design/README.md: a Workout trigger with activities unset shows every chip selected (listed there under Clarifications from the build 3 Chrome pass).

### Build 3 second Chrome pass clarifications

From the second pass through the settings page in Chrome on the Pi, with the live shape of GET /api/user/{id}/subscriptions on the owner's account. Each is a clarification, not a change to section 2. Where it differs from the first pass above (the household name fields, the device keys, the hardware family from device_type), this pass wins.

- 4.2: attached_devices entries are { device_id, device_name, device_group, last_attached_at } with device_group bike, tread, or guide and device_name null for the Guide; there is no id, name, or device_type field. shared_user_set entries carry name as one display string and no first_name, last_name, or is_profile_image_default. The subscription carries bike_device_name and tread_device_name at the top level, which the plugin does not read.
- 7: devices are { id, name or null, group }, keyed by id, else name, else group; the hardware family from device_type is gone. Household profiles are named from name, the username when it is empty. householdFetchedAt on the owner's record is the time of the last subscriptions read.
- 10: /status re-reads the owner's membership first when householdFetchedAt is missing or older than one hour, and swallows a failure there; devices[] carries id, name or null, and group.
- 13: the API, UI server, page model, and page suites named above.
- design/README.md: the Devices line reads each device as its name with its group in brackets after it, the capitalised group alone for a device without a name (listed there under Clarifications from the second Chrome pass).
