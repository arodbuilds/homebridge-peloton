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
- CLAUDE.md with the working rules, README first pass, and this changelog.
