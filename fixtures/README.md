# Fixtures

Sanitised responses used by the tests. No live capture exists yet; every file here was synthesised from SPEC.md section 4 and from Auth0's documented Universal Login behaviour. When the Pi probe produces a real capture, replace these files and keep the same names and sanitisation rules.

Sanitisation: ids shortened, names replaced, tokens replaced with "redacted", codes replaced with "redacted-code".

## auth

Each JSON file is a response envelope: `status`, `headers` (lower-case names, values are strings or arrays of strings), and either `body` or `bodyFile` (an HTML file next to it). The literal `{{state}}` in a header or body is replaced by the fake fetch with the state it saw in the /authorize request.

| File | Step |
| --- | --- |
| authorize-redirect.json | GET /authorize: 302 to the login page with Set-Cookie |
| login-page.json, login-page.html | The login page: 200 with the CSRF cookie |
| login-page-lock-bundle.json, login-page-lock-bundle.html | The login page as Universal Login really serves it, with the Lock library and text dictionary whose words look like a verification step |
| credentials-success.json, credentials-success.html | POST /usernamepassword/login: 200 with the auto-post form |
| credentials-failure.json | POST /usernamepassword/login: 401 wrong password |
| verification-required.json, verification-required.html | POST /usernamepassword/login: 200 with a verification step instead of the form |
| callback-redirect.json | POST /login/callback: 302 to members.onepeloton.com/callback with code and state |
| token-success.json | POST /oauth/token: 200 |
| token-invalid-grant.json | POST /oauth/token: 403 invalid_grant |

## api

Plain JSON bodies, one per call and case.

| File | Call |
| --- | --- |
| me-owner.json | GET /api/me for the subscription owner, customized_heart_rate_zones populated |
| me-member.json | GET /api/me for a household member, customized_heart_rate_zones empty |
| subscriptions.json | GET /api/user/{id}/subscriptions with two entries, one unused |
| workout-in-progress-cycling.json | GET /api/user/{id}/workouts?limit=1&sort_by=-created |
| workout-complete-cycling.json | same, COMPLETE |
| workout-in-progress-strength.json | same, strength |
| workouts-empty.json | same, no workouts yet |
| performance-graph-heart-rate.json | GET /api/workout/{id}/performance_graph?every_n=5 with heart_rate and zones |
| performance-graph-no-heart-rate.json | same, without a heart_rate metric |
