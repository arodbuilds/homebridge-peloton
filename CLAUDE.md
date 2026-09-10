# CLAUDE.md

Working rules for homebridge-peloton. Read SPEC.md in full before changing anything.

## Source of truth

- SPEC.md governs the plugin: behaviour, module boundaries, API contract, storage, logging, privacy, tests, and release.
- design/README.md governs the settings page: layout, copy, and states.
- When the two disagree, SPEC.md wins and design/README.md gets a clarification in the same PR.
- Nothing in SPEC.md changes without a note in SPEC.md section 15.

## Rules

- No attribution trailers, co-author footers, or generated-by lines in commits, PRs, code, or docs.
- No em dashes and no double dashes used as punctuation in code, comments, docs, or UI strings. Command-line flags such as `--dump` are syntax, not punctuation.
- Sentence case for headings, labels, and messages.
- Say "sensor" for triggers. Say "switch" only for the Fast polling switch and the Switch accessory kind.
- Say "clarifications", not "corrections", when a document is brought in line with SPEC.md.
- Runtime dependencies are limited to @homebridge/plugin-ui-utils. Use the Node built-ins for fetch, crypto, and file handling. No HTTP or HTML parsing libraries.
- Never log or persist tokens, passwords, emails, or response bodies. Log lines print an error stage and HTTP status only.
- Every PR updates SPEC.md, README.md, and CHANGELOG.md when its scope touches them.
- Lint, build, and test must be clean before a PR is opened.
- Conventional commit messages, one commit per scope item.

## Layout

```
src/
  platform.ts              Homebridge platform: config load, accessory registry, wiring
  auth/peloton-auth.ts     login, refresh, browserStart, browserFinish; the only file that knows Auth0
  api/peloton-api.ts       typed wrappers for the four Peloton API calls; takes a token, never stores one
  store/account-store.ts   per-account persistence (SPEC section 7)
  poller/poller.ts         the polling state machine (SPEC section 8)
  poller/rules.ts          pure functions: trigger matching, zone from sample, hold and dwell logic
  accessories/             trigger sensor, fast polling switch, attention sensor
  ui/server.ts             @homebridge/plugin-ui-utils server (SPEC section 10)
  scripts/auth-probe.mts   standalone auth probe for the Pi, compiled to dist/scripts/auth-probe.mjs
homebridge-ui/public/      settings page (design/README.md)
fixtures/                  sanitised JSON and HTML used by tests
test/                      node:test suites and helpers
```

## Testing

- Test runner is node:test. `npm test` builds first, then runs `test/*.test.mjs` against `dist/`.
- Claude Code cannot reach onepeloton.com. The network is always mocked: tests use a fake fetch that replays fixtures from `fixtures/` in sequence and records every request so headers and bodies can be asserted.
- The clock is injectable everywhere timing matters (token expiry, the poller, hold and dwell timers). Tests drive it; nothing sleeps.
- Fixtures are sanitised: shortened ids, replaced names, tokens replaced with "redacted".
- Coverage expectations are in SPEC.md section 13. Poller tests cover every state transition; rules tests cover every matching path; store tests cover atomic writes and refresh token rotation.
