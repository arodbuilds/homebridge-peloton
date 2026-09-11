# Fixtures

Sanitised responses used by the tests. The login page files follow the redacted dump from the build 1 Pi probe (title, widget script, and the one-line window.injectedConfig). The other files were synthesised from SPEC.md section 4 and from Auth0's documented Universal Login behaviour; replace them as the probe captures each step, keeping the same names and sanitisation rules.

Sanitisation: ids shortened, names replaced, tokens replaced with "redacted", codes replaced with "redacted-code", the Auth0 transaction state replaced with a random 160-character string.

## auth

Each JSON file is a response envelope: `status`, `headers` (lower-case names, values are strings or arrays of strings), and either `body` or `bodyFile` (an HTML file next to it). The literals `{{state}}`, `{{nonce}}`, and `{{code_challenge}}` in a header or body are replaced by the fake fetch with the values it saw in the /authorize request, including inside the base64 JSON of a `window.injectedConfig` line.

The login page config is base64 on one line, as Auth0 serves it. To read it:

```
node -e "const h=require('fs').readFileSync('fixtures/auth/login-page.html','utf8');console.log(JSON.parse(Buffer.from(/injectedConfig \|\| \"([^\"]+)\"/.exec(h)[1],'base64').toString('utf8')))"
```

Its internalOptions carry `_csrf` "redacted-page-csrf" (the body value) while the `_csrf` cookie is "redacted-csrf" (the header value), so tests can tell the two apart.

| File | Step |
| --- | --- |
| authorize-redirect.json | GET /authorize: 302 to the login page with Set-Cookie |
| login-page.json, login-page.html | The login page: 200 with the CSRF cookie and the window.injectedConfig line (auth0Tenant, callbackURL, internalOptions with Auth0's transaction state) |
| login-page-lock-bundle.json, login-page-lock-bundle.html | The same page with the Lock library and text dictionary whose words look like a verification step |
| credentials-success.json, credentials-success.html | POST /usernamepassword/login: 200 with the auto-post form |
| credentials-failure.json | POST /usernamepassword/login: 401 wrong password |
| credentials-anomaly.json | POST /usernamepassword/login: 403 AnomalyDetected "Invalid state", what Auth0 returns when the body carries the wrong state |
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
