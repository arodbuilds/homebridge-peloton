# Changelog

All notable changes to homebridge-peloton are listed here. The format follows Keep a Changelog, and the project follows semantic versioning from 1.0.0-beta.1.

## Unreleased

Build 3 of 4: config schema, settings page, UI server, device matching by platform. Build 2 of 4: config, rules, poller, accessories, platform wiring. Build 1 of 4: scaffold, auth module, account store, fixtures, tests.

### Added

- The settings page (`homebridge-ui/public/`), plain HTML, CSS, and ES modules served by the Homebridge UI: Accounts with cards, status pills, avatars, the inline connect panel with email and password and the Sign in with browser fallback, Add account, and the membership's device names; Triggers as Workout and Heart-rate zone cards with badges, activity chips, the add chooser, Duplicate and Remove; Polling with the Fast polling switch block, the intervals, the live request estimate, and the dismissible automation callout; Settings with Name, Debug logging, and Advanced holding the auto-off minutes, the Attention needed sensor, the daily check-in time, and Restore from backup. Validation on blur, a sticky summary box that gates Save, the blocking Polling error, the reconnect banner, the unsaved-changes bar, empty and first-run states, the phone layout, and both host themes follow design/README.md.
- The settings UI server (`src/ui/`, started by `homebridge-ui/server.js`): /status, /connect, /browser/start, /browser/finish, /test, /household, /remove, and /avatar over the same account store, auth, and API modules the platform uses. Errors carry an auth stage or `api` with the HTTP status; tokens never leave the server; config.json is never written by it. Profile photos are proxied with a 24 hour cache.
- `connectWithTokens` in the shared connect flow for the browser sign-in path, and the removal of a household profile once a configured account connects as that member.
- `config.schema.json` with the full SPEC section 6 shape, the section 2 defaults, the settings page copy, and the validation constraints, marked as using the custom UI.
- Account write-back from the page: id, email, display name, and userId from the store on save; the password only when entered on the page, else the stored one unchanged.
- Test suites for the schema (ajv, a dev dependency), the UI server handlers with a fake store and fake fetch, the page model, and platform reconciliation by id.
- README walkthrough for the settings page: connect the owner, members connect, add a trigger, set up the fast polling automation, and the browser sign-in fallback with the Back button instruction; the hand-edited config.json moved to a Manual configuration appendix.

### Changed

- A trigger's device is `any`, `bike`, or `tread`, matched by the workout's platform (`home_bike` for the Bike and Bike+, `home_tread` for the Tread), the codes the Pi ride tests reported. The device_type map learned from attached_devices and the "device filtering is unavailable" log line are gone; device_type stays in the debug poll line. Any other device value becomes `any` with a warn line.
- The third-party import fixture is an Apple Health import (device_type `apple_health`, platform `iOS_app`), as the Pi reported it.
- SPEC sections 6, 7, 8.3, 9, 10, and 15 fold build 3 in; section 15 keeps the one open item.

### Added in builds 1 and 2

- Config parsing and validation (`src/config.ts`) with the SPEC defaults: invalid values are clamped or defaulted with one warn line each, and missing or duplicate ids are generated for the run with a warn line asking for a save from the settings page.
- Trigger rules (`src/poller/rules.ts`): workout detectability, matching by who, activities, and device through a device_type map learned from attached devices, zone bounds in SPEC priority order with rounded-down defaults, zone from a sample, a hold helper with a hold time in each direction, and the workout sensor's hold after end.
- The poller (`src/poller/poller.ts`): standby, scanning, locked, and released states with staggered polling, lock-on to the first workout in progress, following it by id so a synced import cannot end it, the performance graph only while a zone trigger targets the locked account, backoff after three consecutive failures, refresh on 401, and account drop with an attention event on invalid_grant. The Fast polling switch with its auto-off timer anchored to the later of switch-on and the last workout end, and the daily check-in that refreshes tokens, zones, household profiles, and devices.
- Accessories (`src/accessories/`): trigger sensors as OccupancySensor or Switch with the service swapped in place when the kind changes, the Fast polling switch, and the optional Attention needed sensor, with UUIDs from ids and the SPEC accessory information fields.
- Platform wiring: config load, account store, device map from stored household devices, accessory registration with orphan cleanup, poller events connected to the accessories, startup skip lines for accounts that are not connected, and a clean stop on Homebridge shutdown.
- Startup sign-in and re-login (`src/store/account-connect.ts`): at startup the platform signs in, one after another, each configured account that has email and password but no stored sign-in, saves the tokens, fills the profile from `/api/me`, and settles the owner and household from subscriptions; after an invalid_grant drop it signs in once more when config has the password. Log lines "Connected {name} (@{username})" and "{name}: sign-in failed at stage {stage}, HTTP {status}; use the settings page to connect".
- Test suites for config, rules, poller, accessories, and platform with a fake clock and scheduler and a route-based fixture-replaying fetch.

- Project scaffold: TypeScript strict, ESLint, node:test, lint, build, and test scripts, CI on Node 20, 22, and 24, and a release workflow that publishes through npm trusted publishing (pre-release to the beta tag, latest release to latest).
- Stub Peloton platform that loads config and logs "Peloton platform loaded".
- Auth module (`src/auth/peloton-auth.ts`): headless Auth0 Universal Login with PKCE, refresh with token rotation, browser sign-in fallback (`browserStart` and `browserFinish`), an in-file cookie jar, HTML form parsing that reads the action and hidden inputs by name, `AuthError` with stage, status, and OAuth code, and an opt-in redacted debug dump of the login pages.
- API wrappers (`src/api/peloton-api.ts`) for me, subscriptions, latest workout, and performance graph, returning typed objects with only the fields SPEC lists and throwing `ApiError` with the HTTP status on non-2xx.
- Account store (`src/store/account-store.ts`): directory 0700, files 0600, atomic writes through a temp file and rename, and `withValidToken` that refreshes within 6 hours of expiry or on 401, persists the rotated refresh token before returning, and marks the account reconnect_needed on invalid_grant.
- Synthesised, sanitised fixtures under `fixtures/auth` and `fixtures/api`.
- Test suites for auth, api, and store with a fake fetch that replays fixtures in sequence and records requests.
- Standalone auth probe for the Pi (`dist/scripts/auth-probe.mjs`) with login, refresh, browser, me, and workout commands.
- `getWorkout(workoutId)` in the API wrappers for GET /api/workout/{id}, and the workout type now carries `isPelotonOriginatedWorkout`, `is3pFitFeedWorkout`, `platform`, `pelotonId`, and `ride` (id, title, duration, instructor id when present). Fixtures for the single-workout call and for a run synced from a third-party fitness feed, which detection ignores.
- Probe `graph <workoutId>` command that prints the metric slugs, sample counts, and heart-rate zone bounds of one workout's performance graph.
- CLAUDE.md with the working rules, README first pass, and this changelog.

### Changed in builds 1 and 2

- Attached devices from the subscriptions call carry `deviceType` when present, and the account store keeps `isOwner` and the owner's `devices` so the device map survives a restart. `withValidToken` takes a `forceRefresh` option for the daily check-in.
- README describes the config.json shape for a hand-edited setup and where sign-ins are stored.

- Verification detection no longer runs on the initial login page, whose bundled Lock library and text dictionary contain verification words for every account. It runs on the credentials response, the callback page, and the token error path only.
- The workout type no longer has a device id field: the second Pi probe confirmed that workouts carry none and that `device_type` is the hardware model code. `/api/me` `last_workout_at` is stale and is no longer the source for "last workout"; the latest workout's `created_at` is. The performance graph fixture carries the heart-rate zone bounds the probe confirmed on a 168 max. The probe prints the new workout fields and labels the stale `/api/me` value.

### Fixed

- Headless login got past the credentials POST on the second Pi run and failed at stage callback with HTTP 302, because the module stopped at the first redirect that left auth.onepeloton.com and treated it as the callback. The live flow is six hops across auth.onepeloton.com and auth-orca.onepeloton.com before the redirect to members.onepeloton.com/callback. The module now follows every 3xx on any host, sends each host only its own cookies, never resends the form body, stops at the first Location that is the redirect URI (scheme, host, and path; a trailing slash tolerated, the query ignored), and allows up to 12 redirects. Fixtures carry the six-hop chain with its cookies per hop, and the single-hop shape is still accepted.
- Headless login failed at the credentials POST with HTTP 403 AnomalyDetected "Invalid state" on the first Pi run. The module now parses `window.injectedConfig` from the login page, checks that its code_challenge and nonce are ours, and posts every internalOptions value verbatim (Auth0's transaction state and `_csrf` among them) with the tenant and callback URL from the page. The confirmed tenant is "peloton-prod" and the connection "pelo-user-password". A 403 AnomalyDetected response maps to stage authorize so the settings page offers the browser fallback, and `access_denied` counts as a wrong password only when the description says so. The probe prints the tenant and connection it is about to use.
- The account store re-reads the record before refreshing, so a caller that loaded the record before another caller's rotation reuses that rotation instead of sending the retired refresh token to Auth0, which would have marked the account reconnect_needed for no reason.
