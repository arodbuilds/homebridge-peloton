import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  AuthError,
  CookieJar,
  PELOTON_AUTH,
  browserFinish,
  browserStart,
  login,
  parseForm,
  redactFormValues,
  refresh,
} from '../dist/auth/peloton-auth.js';
import { createFakeFetch, formBody, jsonBody } from './helpers/fake-fetch.mjs';
import { authFixture, htmlResponse, jsonResponse, redirectResponse } from './helpers/fixtures.mjs';

const NOW = 1_789_000_000_000;
const now = () => NOW;

function happyPath() {
  return [
    authFixture('authorize-redirect'),
    authFixture('login-page'),
    authFixture('credentials-success'),
    authFixture('callback-redirect'),
    authFixture('token-success'),
  ];
}

async function expectAuthError(promise, stage, status, code) {
  let caught;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AuthError, `expected AuthError, got ${caught}`);
  assert.equal(caught.stage, stage);
  if (status !== undefined) {
    assert.equal(caught.status, status);
  }
  if (code !== undefined) {
    assert.equal(caught.code, code);
  }
  return caught;
}

function challengeFor(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

describe('login', () => {
  it('drives the headless flow and returns tokens', async () => {
    const fetchImpl = createFakeFetch(happyPath());
    const tokens = await login('rider@example.com', 'hunter2', fetchImpl, { now });

    assert.deepEqual(tokens, { accessToken: 'redacted', refreshToken: 'redacted', expiresAt: NOW + 172_800_000 });
    assert.equal(fetchImpl.remaining(), 0);
    assert.equal(fetchImpl.requests.length, 5);
    assert.ok(fetchImpl.requests.every((request) => request.redirect === 'manual'), 'every request uses manual redirects');
    assert.ok(fetchImpl.requests.every((request) => !request.url.startsWith('https://members.onepeloton.com')),
      'the final redirect to members.onepeloton.com is never followed');

    const [authorize, loginPage, credentials, callback, token] = fetchImpl.requests;

    const authorizeUrl = new URL(authorize.url);
    assert.equal(authorize.method, 'GET');
    assert.equal(authorizeUrl.origin + authorizeUrl.pathname, `${PELOTON_AUTH.tenantUrl}/authorize`);
    assert.equal(authorizeUrl.searchParams.get('client_id'), PELOTON_AUTH.clientId);
    assert.equal(authorizeUrl.searchParams.get('redirect_uri'), PELOTON_AUTH.redirectUri);
    assert.equal(authorizeUrl.searchParams.get('response_type'), 'code');
    assert.equal(authorizeUrl.searchParams.get('scope'), PELOTON_AUTH.scope);
    assert.equal(authorizeUrl.searchParams.get('audience'), PELOTON_AUTH.audience);
    assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'S256');
    const state = authorizeUrl.searchParams.get('state');
    const nonce = authorizeUrl.searchParams.get('nonce');
    const challenge = authorizeUrl.searchParams.get('code_challenge');
    assert.ok(state.length >= 16 && nonce.length >= 16 && challenge.length === 43);
    assert.notEqual(state, nonce);

    assert.equal(loginPage.method, 'GET');
    assert.equal(loginPage.url, `${PELOTON_AUTH.tenantUrl}/login?state=redacted-login-state&client=${PELOTON_AUTH.clientId}&protocol=oauth2`);
    assert.match(loginPage.headers.cookie, /auth0=redacted-session/);
    assert.match(loginPage.headers.cookie, /did=redacted-device/);

    assert.equal(credentials.method, 'POST');
    assert.equal(credentials.url, `${PELOTON_AUTH.tenantUrl}${PELOTON_AUTH.credentialsPath}`);
    assert.equal(credentials.headers['content-type'], 'application/json');
    assert.equal(credentials.headers[PELOTON_AUTH.csrfHeader], 'redacted-csrf');
    assert.match(credentials.headers.cookie, /_csrf=redacted-csrf/);
    assert.match(credentials.headers.cookie, /auth0=redacted-session/);
    const body = jsonBody(credentials);
    assert.equal(body.client_id, PELOTON_AUTH.clientId);
    assert.equal(body.redirect_uri, PELOTON_AUTH.redirectUri);
    assert.equal(body.tenant, PELOTON_AUTH.tenant);
    assert.equal(body.response_type, 'code');
    assert.equal(body.scope, PELOTON_AUTH.scope);
    assert.equal(body.audience, PELOTON_AUTH.audience);
    assert.equal(body.state, state);
    assert.equal(body.nonce, nonce);
    assert.equal(body.connection, PELOTON_AUTH.connection);
    assert.equal(body.code_challenge, challenge);
    assert.equal(body.code_challenge_method, 'S256');
    assert.equal(body.username, 'rider@example.com');
    assert.equal(body.password, 'hunter2');
    assert.equal(body._csrf, 'redacted-csrf');

    assert.equal(callback.method, 'POST');
    assert.equal(callback.url, `${PELOTON_AUTH.tenantUrl}/login/callback`);
    assert.equal(callback.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.ok(callback.headers.cookie, 'cookies are sent to the callback');
    const form = formBody(callback);
    assert.equal(form.wa, 'wsignin1.0');
    assert.equal(form.wresult, 'redacted-wresult');
    const wctx = JSON.parse(form.wctx);
    assert.equal(wctx.state, state, 'entities inside hidden values are decoded');
    assert.equal(wctx.connection, PELOTON_AUTH.connection);

    assert.equal(token.method, 'POST');
    assert.equal(token.url, `${PELOTON_AUTH.tenantUrl}${PELOTON_AUTH.tokenPath}`);
    const exchange = jsonBody(token);
    assert.equal(exchange.grant_type, 'authorization_code');
    assert.equal(exchange.client_id, PELOTON_AUTH.clientId);
    assert.equal(exchange.code, 'redacted-code');
    assert.equal(exchange.redirect_uri, PELOTON_AUTH.redirectUri);
    assert.equal(challengeFor(exchange.code_verifier), challenge, 'the verifier matches the challenge sent to /authorize');
  });

  it('does not read verification markers in the Lock bundle on the initial login page', async () => {
    const steps = happyPath();
    steps[1] = authFixture('login-page-lock-bundle');
    assert.match(steps[1].body, /passwordless/i);
    assert.match(steps[1].body, /verify your email/i);
    assert.match(steps[1].body, /mfa_required/);
    const fetchImpl = createFakeFetch(steps);
    const tokens = await login('rider@example.com', 'hunter2', fetchImpl, { now });
    assert.equal(tokens.accessToken, 'redacted');
    assert.equal(fetchImpl.requests[2].url, `${PELOTON_AUTH.tenantUrl}${PELOTON_AUTH.credentialsPath}`, 'login proceeded to the credentials POST');
    assert.equal(fetchImpl.requests[2].headers[PELOTON_AUTH.csrfHeader], 'redacted-csrf', 'the CSRF cookie from that page is still used');
    assert.equal(fetchImpl.remaining(), 0);
  });

  it('follows several redirects on the tenant and stops at the first one that leaves it', async () => {
    const steps = happyPath();
    steps.splice(3, 1,
      redirectResponse('/authorize/resume?state=redacted-resume'),
      authFixture('callback-redirect'),
    );
    const fetchImpl = createFakeFetch(steps);
    await login('rider@example.com', 'hunter2', fetchImpl, { now });
    assert.equal(fetchImpl.requests[4].method, 'GET');
    assert.equal(fetchImpl.requests[4].url, `${PELOTON_AUTH.tenantUrl}/authorize/resume?state=redacted-resume`);
    assert.equal(fetchImpl.requests[5].url, `${PELOTON_AUTH.tenantUrl}${PELOTON_AUTH.tokenPath}`);
  });

  it('maps a failing /authorize to stage authorize with the status', async () => {
    const fetchImpl = createFakeFetch([htmlResponse(503, '<html>down</html>')]);
    await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'authorize', 503);
  });

  it('maps a network failure to stage authorize without a status', async () => {
    const fetchImpl = createFakeFetch([new Error('ECONNRESET')]);
    const error = await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'authorize');
    assert.equal(error.status, undefined);
  });

  it('maps a wrong password to stage credentials', async () => {
    const fetchImpl = createFakeFetch([
      authFixture('authorize-redirect'),
      authFixture('login-page'),
      authFixture('credentials-failure'),
    ]);
    const error = await expectAuthError(login('a@example.com', 'wrong', fetchImpl, { now }), 'credentials', 401, 'invalid_user_password');
    assert.doesNotMatch(error.message, /Wrong email/, 'the response body never reaches the error');
    assert.doesNotMatch(error.message, /wrong/, 'the password never reaches the error');
  });

  it('maps a non-credential failure on the credentials POST to stage authorize', async () => {
    const fetchImpl = createFakeFetch([
      authFixture('authorize-redirect'),
      authFixture('login-page'),
      jsonResponse(429, { error: 'too_many_requests', error_description: 'Slow down' }),
    ]);
    await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'authorize', 429);
  });

  it('maps a verification page after the credentials POST to verification_required', async () => {
    const fetchImpl = createFakeFetch([
      authFixture('authorize-redirect'),
      authFixture('login-page'),
      authFixture('verification-required'),
    ]);
    await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'verification_required', 200);
  });

  it('maps an MFA error body on the credentials POST to verification_required', async () => {
    const fetchImpl = createFakeFetch([
      authFixture('authorize-redirect'),
      authFixture('login-page'),
      jsonResponse(403, { error: 'mfa_required', error_description: 'Multifactor authentication required' }),
    ]);
    await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'verification_required', 403, 'mfa_required');
  });

  it('maps an MFA step after the callback POST to verification_required', async () => {
    const fetchImpl = createFakeFetch([
      authFixture('authorize-redirect'),
      authFixture('login-page'),
      authFixture('credentials-success'),
      redirectResponse('/u/mfa-otp-challenge?state=redacted-mfa'),
      htmlResponse(200, '<html><body><h1>Verify your identity</h1><input name="code"></body></html>'),
    ]);
    await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'verification_required', 200);
  });

  it('maps a callback redirect carrying an MFA error to verification_required', async () => {
    const fetchImpl = createFakeFetch([
      authFixture('authorize-redirect'),
      authFixture('login-page'),
      authFixture('credentials-success'),
      redirectResponse('https://members.onepeloton.com/callback?error=mfa_required&error_description=Multifactor%20authentication%20required&state={{state}}'),
    ]);
    await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'verification_required', 302, 'mfa_required');
  });

  it('maps a credentials response without an auto-post form to stage callback', async () => {
    const fetchImpl = createFakeFetch([
      authFixture('authorize-redirect'),
      authFixture('login-page'),
      htmlResponse(200, '<html><body><p>Nothing to see here.</p></body></html>'),
    ]);
    await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'callback', 200);
  });

  it('maps a failing callback POST to stage callback with the status', async () => {
    const fetchImpl = createFakeFetch([
      authFixture('authorize-redirect'),
      authFixture('login-page'),
      authFixture('credentials-success'),
      htmlResponse(500, '<html>error</html>'),
    ]);
    await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'callback', 500);
  });

  it('maps a callback redirect with an unexpected error to stage callback with the code', async () => {
    const fetchImpl = createFakeFetch([
      authFixture('authorize-redirect'),
      authFixture('login-page'),
      authFixture('credentials-success'),
      redirectResponse('https://members.onepeloton.com/callback?error=access_denied&error_description=Denied&state={{state}}'),
    ]);
    await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'callback', 302, 'access_denied');
  });

  it('maps a state that does not match to state_mismatch and does not exchange the code', async () => {
    const fetchImpl = createFakeFetch([
      authFixture('authorize-redirect'),
      authFixture('login-page'),
      authFixture('credentials-success'),
      redirectResponse('https://members.onepeloton.com/callback?code=redacted-code&state=someone-elses-state'),
    ]);
    await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'state_mismatch');
    assert.equal(fetchImpl.requests.length, 4, 'no token request was made');
  });

  it('maps invalid_grant on the code exchange to expired_code', async () => {
    const steps = happyPath();
    steps[4] = authFixture('token-invalid-grant');
    const fetchImpl = createFakeFetch(steps);
    await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'expired_code', 403, 'invalid_grant');
  });

  it('maps any other token endpoint failure on exchange to stage exchange', async () => {
    const steps = happyPath();
    steps[4] = jsonResponse(500, { error: 'server_error' });
    const fetchImpl = createFakeFetch(steps);
    await expectAuthError(login('a@example.com', 'p', fetchImpl, { now }), 'exchange', 500, 'server_error');
  });

  it('writes redacted HTML dumps when debugDump is set and never dumps token responses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'peloton-dump-'));
    try {
      const fetchImpl = createFakeFetch(happyPath());
      await login('rider@example.com', 'hunter2', fetchImpl, { now, debugDump: dir });
      const files = readdirSync(dir).sort();
      assert.deepEqual(files, ['01-authorize-login-page.html', '02-credentials-response.html']);
      const credentials = readFileSync(join(dir, files[1]), 'utf8');
      assert.match(credentials, /name="wresult" value="redacted"/);
      assert.doesNotMatch(credentials, /redacted-wresult/);
      assert.doesNotMatch(credentials, /hunter2/);
      for (const file of files) {
        assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /access_token/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes nothing when debugDump is not set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'peloton-nodump-'));
    try {
      const fetchImpl = createFakeFetch(happyPath());
      await login('rider@example.com', 'hunter2', fetchImpl, { now });
      assert.deepEqual(readdirSync(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('refresh', () => {
  it('posts the refresh grant and returns the rotated tokens', async () => {
    const fetchImpl = createFakeFetch([
      jsonResponse(200, { access_token: 'redacted-2', refresh_token: 'redacted-rotated', expires_in: 172800, token_type: 'Bearer' }),
    ]);
    const tokens = await refresh('redacted-old', fetchImpl, { now });
    assert.deepEqual(tokens, { accessToken: 'redacted-2', refreshToken: 'redacted-rotated', expiresAt: NOW + 172_800_000 });
    const request = fetchImpl.requests[0];
    assert.equal(request.url, `${PELOTON_AUTH.tenantUrl}${PELOTON_AUTH.tokenPath}`);
    assert.deepEqual(jsonBody(request), { grant_type: 'refresh_token', client_id: PELOTON_AUTH.clientId, refresh_token: 'redacted-old' });
  });

  it('keeps the old refresh token when the response does not rotate it', async () => {
    const fetchImpl = createFakeFetch([jsonResponse(200, { access_token: 'redacted-2', expires_in: 100 })]);
    const tokens = await refresh('redacted-old', fetchImpl, { now });
    assert.equal(tokens.refreshToken, 'redacted-old');
  });

  it('maps invalid_grant to stage refresh with code invalid_grant', async () => {
    const fetchImpl = createFakeFetch([authFixture('token-invalid-grant')]);
    await expectAuthError(refresh('redacted-old', fetchImpl, { now }), 'refresh', 403, 'invalid_grant');
  });

  it('maps a transient failure to stage refresh without a code', async () => {
    const fetchImpl = createFakeFetch([htmlResponse(503, 'down')]);
    const error = await expectAuthError(refresh('redacted-old', fetchImpl, { now }), 'refresh', 503);
    assert.equal(error.code, undefined);
  });

  it('maps a network failure to stage refresh without a status', async () => {
    const fetchImpl = createFakeFetch([new Error('ENOTFOUND')]);
    const error = await expectAuthError(refresh('redacted-old', fetchImpl, { now }), 'refresh');
    assert.equal(error.status, undefined);
  });
});

describe('browserStart', () => {
  it('returns an authorize URL whose challenge matches the verifier and state', () => {
    const start = browserStart();
    const url = new URL(start.authorizeUrl);
    assert.equal(url.origin + url.pathname, `${PELOTON_AUTH.tenantUrl}/authorize`);
    assert.equal(url.searchParams.get('state'), start.state);
    assert.equal(url.searchParams.get('code_challenge'), challengeFor(start.verifier));
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('redirect_uri'), PELOTON_AUTH.redirectUri);
    assert.equal(url.searchParams.get('scope'), PELOTON_AUTH.scope);
    assert.ok(url.searchParams.get('nonce'));
    assert.notEqual(browserStart().state, start.state, 'state is fresh every time');
  });
});

describe('browserFinish', () => {
  const state = 'browser-state';
  const verifier = 'browser-verifier-browser-verifier-browser-verifier';

  it('exchanges the code from a pasted callback URL', async () => {
    const fetchImpl = createFakeFetch([authFixture('token-success')]);
    const tokens = await browserFinish(`https://members.onepeloton.com/callback?code=redacted-code&state=${state}`, verifier, state, fetchImpl, { now });
    assert.equal(tokens.accessToken, 'redacted');
    const body = jsonBody(fetchImpl.requests[0]);
    assert.equal(body.grant_type, 'authorization_code');
    assert.equal(body.code, 'redacted-code');
    assert.equal(body.code_verifier, verifier);
    assert.equal(body.redirect_uri, PELOTON_AUTH.redirectUri);
  });

  it('accepts the trailing slash form without a scheme', async () => {
    const fetchImpl = createFakeFetch([authFixture('token-success')]);
    await browserFinish(`members.onepeloton.com/callback/?code=redacted-code&state=${state}`, verifier, state, fetchImpl, { now });
    assert.equal(fetchImpl.requests.length, 1);
  });

  it('accepts surrounding whitespace and a mixed case host', async () => {
    const fetchImpl = createFakeFetch([authFixture('token-success')]);
    await browserFinish(`  https://Members.OnePeloton.com/callback?code=redacted-code&state=${state}\n`, verifier, state, fetchImpl, { now });
    assert.equal(fetchImpl.requests.length, 1);
  });

  for (const [label, url] of [
    ['a different host', `https://example.com/callback?code=x&state=${state}`],
    ['a look-alike host', `https://members.onepeloton.com.example.com/callback?code=x&state=${state}`],
    ['a subdomain', `https://evil.members.onepeloton.com/callback?code=x&state=${state}`],
    ['a different path', `https://members.onepeloton.com/callbacks?code=x&state=${state}`],
    ['the members home page', `https://members.onepeloton.com/?code=x&state=${state}`],
    ['a plain http scheme', `http://members.onepeloton.com/callback?code=x&state=${state}`],
    ['a missing code', `https://members.onepeloton.com/callback?state=${state}`],
    ['a missing state', 'https://members.onepeloton.com/callback?code=x'],
    ['garbage', 'not a url at all'],
    ['an empty string', ''],
  ]) {
    it(`rejects ${label} as malformed_callback without a network call`, async () => {
      const fetchImpl = createFakeFetch([]);
      await expectAuthError(browserFinish(url, verifier, state, fetchImpl, { now }), 'malformed_callback');
      assert.equal(fetchImpl.requests.length, 0);
    });
  }

  it('rejects a state from an earlier attempt as state_mismatch without a network call', async () => {
    const fetchImpl = createFakeFetch([]);
    await expectAuthError(browserFinish('https://members.onepeloton.com/callback?code=x&state=old', verifier, state, fetchImpl, { now }), 'state_mismatch');
    assert.equal(fetchImpl.requests.length, 0);
  });

  it('maps invalid_grant on a used or old code to expired_code', async () => {
    const fetchImpl = createFakeFetch([authFixture('token-invalid-grant')]);
    await expectAuthError(
      browserFinish(`https://members.onepeloton.com/callback?code=old&state=${state}`, verifier, state, fetchImpl, { now }),
      'expired_code', 403, 'invalid_grant',
    );
  });
});

describe('CookieJar', () => {
  it('stores every Set-Cookie line and sends them back to the same host', () => {
    const jar = new CookieJar();
    const url = new URL('https://auth.onepeloton.com/authorize');
    const headers = new Headers();
    headers.append('set-cookie', 'auth0=one; Path=/; HttpOnly; Secure');
    headers.append('set-cookie', '_csrf=two; Path=/; HttpOnly');
    headers.append('set-cookie', 'did=three; Path=/; Expires=Sat, 11 Sep 2027 00:00:00 GMT');
    jar.store(url, new Response('', { status: 200, headers }));
    const header = jar.header(new URL('https://auth.onepeloton.com/usernamepassword/login'));
    assert.ok(header.includes('auth0=one'));
    assert.ok(header.includes('_csrf=two'));
    assert.ok(header.includes('did=three'));
    assert.equal(jar.get(url, '_csrf'), 'two');
    assert.equal(jar.header(new URL('https://api.onepeloton.com/api/me')), undefined, 'other hosts get nothing');
  });

  it('overwrites a cookie with the same name and deletes on Max-Age=0', () => {
    const jar = new CookieJar();
    const url = new URL('https://auth.onepeloton.com/login');
    jar.storeLine(url, 'auth0=first; Path=/');
    jar.storeLine(url, 'auth0=second; Path=/');
    assert.equal(jar.header(url), 'auth0=second');
    jar.storeLine(url, 'auth0=; Path=/; Max-Age=0');
    assert.equal(jar.header(url), undefined);
  });

  it('honours Domain, Path, and Secure', () => {
    const jar = new CookieJar();
    const url = new URL('https://auth.onepeloton.com/u/login');
    jar.storeLine(url, 'shared=yes; Domain=.onepeloton.com; Path=/');
    jar.storeLine(url, 'scoped=yes; Path=/u');
    jar.storeLine(url, 'locked=yes; Path=/; Secure');
    assert.ok(jar.header(new URL('https://members.onepeloton.com/callback')).includes('shared=yes'));
    assert.equal(jar.header(new URL('https://auth.onepeloton.com/oauth/token')).includes('scoped=yes'), false);
    assert.ok(jar.header(new URL('https://auth.onepeloton.com/u/mfa')).includes('scoped=yes'));
    assert.equal(jar.header(new URL('http://auth.onepeloton.com/')).includes('locked=yes'), false);
    assert.equal(jar.header(new URL('https://evil-onepeloton.com/')), undefined);
  });

  it('ignores a Domain attribute that does not cover the responding host', () => {
    const jar = new CookieJar();
    const url = new URL('https://auth.onepeloton.com/login');
    jar.storeLine(url, 'x=1; Domain=example.com');
    assert.equal(jar.header(new URL('https://example.com/')), undefined);
    assert.equal(jar.header(url), 'x=1');
  });
});

describe('parseForm', () => {
  it('reads the action and every hidden input by name, including unknown extras', () => {
    const html = `
      <form id="skip" method="get"><input type="hidden" name="ignored" value="no action"></form>
      <form method="post" name="hiddenform" action="https://auth.onepeloton.com/login/callback">
        <input name="wa" type="hidden" value="wsignin1.0">
        <input value='single &amp; quoted' type='hidden' name='wresult'>
        <input type="hidden" name="future_field" value="&#x7B;&quot;k&quot;:1&#125;">
        <input type=hidden name=bare value=plain>
        <input type="hidden" name="empty">
        <input type="text" name="visible" value="not included">
        <input type="submit" value="Go">
      </form>`;
    const form = parseForm(html);
    assert.equal(form.action, 'https://auth.onepeloton.com/login/callback');
    assert.equal(form.method, 'POST');
    assert.deepEqual(form.fields, {
      wa: 'wsignin1.0',
      wresult: 'single & quoted',
      future_field: '{"k":1}',
      bare: 'plain',
      empty: '',
    });
  });

  it('parses the credentials fixture', () => {
    const form = parseForm(authFixture('credentials-success').body);
    assert.equal(form.action, 'https://auth.onepeloton.com/login/callback');
    assert.deepEqual(Object.keys(form.fields).sort(), ['wa', 'wctx', 'wresult']);
    assert.equal(JSON.parse(form.fields.wctx).tenant, 'peloton');
  });

  it('returns undefined when there is no form with an action', () => {
    assert.equal(parseForm('<html><body>hi</body></html>'), undefined);
    assert.equal(parseForm('<form><input type="hidden" name="a" value="b"></form>'), undefined);
  });
});

describe('redactFormValues', () => {
  it('replaces every input value but leaves the structure', () => {
    const out = redactFormValues('<input type="hidden" name="a" value="secret"><input name=b value=\'s2\' type="hidden"><input value=bare>');
    assert.equal(out, '<input type="hidden" name="a" value="redacted"><input name=b value="redacted" type="hidden"><input value="redacted">');
  });
});
