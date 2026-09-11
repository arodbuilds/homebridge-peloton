# Changelog

All notable changes to homebridge-peloton are listed here. The format follows Keep a Changelog, and the project follows semantic versioning from 1.0.0-beta.1.

## Unreleased

Build 1 of 4: scaffold, auth module, account store, fixtures, tests.

### Added

- Project scaffold: TypeScript strict, ESLint, node:test, lint, build, and test scripts, CI on Node 20, 22, and 24, and a release workflow that publishes through npm trusted publishing (pre-release to the beta tag, latest release to latest).
- Stub Peloton platform that loads config and logs "Peloton platform loaded".
- Auth module (`src/auth/peloton-auth.ts`): headless Auth0 Universal Login with PKCE, refresh with token rotation, browser sign-in fallback (`browserStart` and `browserFinish`), an in-file cookie jar, HTML form parsing that reads the action and hidden inputs by name, `AuthError` with stage, status, and OAuth code, and an opt-in redacted debug dump of the login pages.
- API wrappers (`src/api/peloton-api.ts`) for me, subscriptions, latest workout, and performance graph, returning typed objects with only the fields SPEC lists and throwing `ApiError` with the HTTP status on non-2xx.
- Account store (`src/store/account-store.ts`): directory 0700, files 0600, atomic writes through a temp file and rename, and `withValidToken` that refreshes within 6 hours of expiry or on 401, persists the rotated refresh token before returning, and marks the account reconnect_needed on invalid_grant.
- Synthesised, sanitised fixtures under `fixtures/auth` and `fixtures/api`.
- Test suites for auth, api, and store with a fake fetch that replays fixtures in sequence and records requests.
- Standalone auth probe for the Pi (`dist/scripts/auth-probe.mjs`) with login, refresh, browser, me, and workout commands.
- `getWorkout(workoutId)` in the API wrappers for GET /api/workout/{id}, and the workout type now carries `isPelotonOriginatedWorkout`, `is3pFitFeedWorkout`, `platform`, `pelotonId`, and `ride` (id, title, duration, instructor id when present). Fixtures for the single-workout call and for a run synced from a third-party fitness feed, which detection ignores.
- CLAUDE.md with the working rules, README first pass, and this changelog.

### Changed

- Verification detection no longer runs on the initial login page, whose bundled Lock library and text dictionary contain verification words for every account. It runs on the credentials response, the callback page, and the token error path only.
- The workout type no longer has a device id field: the second Pi probe confirmed that workouts carry none and that `device_type` is the hardware model code. `/api/me` `last_workout_at` is stale and is no longer the source for "last workout"; the latest workout's `created_at` is. The performance graph fixture carries the heart-rate zone bounds the probe confirmed on a 168 max. The probe prints the new workout fields and labels the stale `/api/me` value.

### Fixed

- Headless login got past the credentials POST on the second Pi run and failed at stage callback with HTTP 302, because the module stopped at the first redirect that left auth.onepeloton.com and treated it as the callback. The live flow is six hops across auth.onepeloton.com and auth-orca.onepeloton.com before the redirect to members.onepeloton.com/callback. The module now follows every 3xx on any host, sends each host only its own cookies, never resends the form body, stops at the first Location that is the redirect URI (scheme, host, and path; a trailing slash tolerated, the query ignored), and allows up to 12 redirects. Fixtures carry the six-hop chain with its cookies per hop, and the single-hop shape is still accepted.
- Headless login failed at the credentials POST with HTTP 403 AnomalyDetected "Invalid state" on the first Pi run. The module now parses `window.injectedConfig` from the login page, checks that its code_challenge and nonce are ours, and posts every internalOptions value verbatim (Auth0's transaction state and `_csrf` among them) with the tenant and callback URL from the page. The confirmed tenant is "peloton-prod" and the connection "pelo-user-password". A 403 AnomalyDetected response maps to stage authorize so the settings page offers the browser fallback, and `access_denied` counts as a wrong password only when the description says so. The probe prints the tenant and connection it is about to use.
- The account store re-reads the record before refreshing, so a caller that loaded the record before another caller's rotation reuses that rotation instead of sending the retired refresh token to Auth0, which would have marked the account reconnect_needed for no reason.
