<!-- Banner placeholder: the regenerated banner with the round-two tagline arrives in build 4. -->

# homebridge-peloton

Peloton workouts as HomeKit sensors for Homebridge automations. The plugin watches one or more Peloton accounts in a household and exposes trigger sensors that turn on when a workout starts, when it ends, or when a rider reaches a heart-rate zone, so Home app automations can react to what is happening on the bike, the tread, or the mat.

Status: beta, not yet functional as a plugin; build 1 of 4. This build carries the sign-in module, the API wrappers, the account store, fixtures, tests, and a probe script for the first live run. Accessories, polling, and the settings page arrive in later builds.

Not affiliated with Peloton Interactive. Uses Peloton's undocumented member API.

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
```

Tokens are stored in `./probe-tokens.json` with mode 0600 and are never printed. On failure the probe prints the auth stage and HTTP status only. With `--dump`, every HTML page of the login flow is written to the given directory with form values redacted, which is what to attach when the flow needs adjusting. Token responses are never written. Delete `probe-tokens.json` and the dump directory when done.

## License

Apache-2.0. Copyright 2026 Alex Rodriguez (arodbuilds).
