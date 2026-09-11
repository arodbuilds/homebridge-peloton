import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';

import { getLatestWorkout, getMe, getSubscriptions } from '../dist/api/peloton-api.js';
import { AuthError, PELOTON_AUTH, browserFinish, browserStart } from '../dist/auth/peloton-auth.js';
import { AVATAR_CACHE_TTL_MS, BROWSER_SESSION_TTL_MS, LAST_WORKOUT_CACHE_TTL_MS, UiHandlers, errorResponse } from '../dist/ui/handlers.js';
import { createFakeStore } from './helpers/fake-store.mjs';
import { apiResponse, authFixture, jsonResponse } from './helpers/fixtures.mjs';
import { createRoutedFetch } from './helpers/routed-fetch.mjs';

const NOW = 1_789_000_000_000;
const HOUR = 60 * 60 * 1000;
const TOKENS = { accessToken: 'access-login', refreshToken: 'refresh-login', expiresAt: NOW + 48 * HOUR };
const AVATAR_URL = 'https://cdn.example.invalid/avatars/u-owner-0001.jpg';

function connected(overrides = {}) {
  return {
    userId: 'u-owner-0001',
    username: 'owner_rider',
    displayName: 'Owner',
    imageUrl: AVATAR_URL,
    isProfileImageDefault: false,
    accessToken: 'access-1',
    accessTokenExpiresAt: NOW + 40 * HOUR,
    refreshToken: 'refresh-1',
    isOwner: true,
    devices: [{ id: 'dev-bike-0001', name: 'Bike+', deviceType: 'home_bike_plus' }],
    state: 'connected',
    lastCheckedAt: NOW - HOUR,
    ...overrides,
  };
}

const PROFILE = {
  userId: 'u-member-0002',
  username: 'member_runner',
  displayName: 'Member Example',
  imageUrl: 'https://cdn.example.invalid/avatars/default.png',
  isProfileImageDefault: true,
  state: 'not_connected',
};

/** A login stub answering per email with tokens or an error to throw. */
function fakeLogin(answers) {
  const calls = [];
  const fn = async (email, password) => {
    calls.push({ email, password });
    const answer = answers[email];
    if (answer instanceof Error) {
      throw answer;
    }
    if (answer === undefined) {
      throw new Error(`unexpected login for ${email}`);
    }
    return answer;
  };
  fn.calls = calls;
  return fn;
}

function harness({ records = { a1: connected(), 'u-member-0002': PROFILE }, login = fakeLogin({}) } = {}) {
  let now = NOW;
  const clock = {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
  const fetch = createRoutedFetch();
  fetch.route('/api/user/u-owner-0001/workouts', apiResponse('workout-complete-cycling'))
    .route('/api/me', apiResponse('me-member'))
    .route('/subscriptions', apiResponse('subscriptions'))
    .route('/oauth/token', authFixture('token-success'))
    .route(AVATAR_URL, { status: 200, headers: { 'content-type': 'image/jpeg' }, body: 'JPEGBYTES' });
  const store = createFakeStore(records);
  const handlers = new UiHandlers({
    store,
    api: {
      getMe: (token) => getMe(token, fetch),
      getSubscriptions: (userId, token) => getSubscriptions(userId, token, fetch),
      getLatestWorkout: (userId, token) => getLatestWorkout(userId, token, fetch),
    },
    auth: { login, browserStart, browserFinish: (url, verifier, state) => browserFinish(url, verifier, state, fetch, { now: clock.now }) },
    fetchImpl: fetch,
    now: clock.now,
    version: '1.0.0-beta.1',
  });
  return { handlers, store, fetch, clock, login, routes: handlers.routes() };
}

function callbackUrl(authorizeUrl, code = 'redacted-code') {
  const state = new URL(authorizeUrl).searchParams.get('state');
  return `${PELOTON_AUTH.redirectUri}?code=${code}&state=${state}`;
}

describe('routes', () => {
  it('exposes the eight SPEC section 10 requests', () => {
    const { routes } = harness();
    assert.deepEqual(Object.keys(routes).sort(), [
      '/avatar', '/browser/finish', '/browser/start', '/connect', '/household', '/remove', '/status', '/test',
    ]);
  });

  it('rejects a payload without a valid account id before anything else runs', async () => {
    const { routes, fetch } = harness();
    for (const payload of [undefined, {}, { id: '' }, { id: '../x' }, { id: 42 }]) {
      await assert.rejects(routes['/test'](payload), /Invalid account id/);
    }
    await assert.rejects(routes['/connect']({ id: 'a1', email: 'x@example.com' }), /Missing password/);
    await assert.rejects(routes['/connect']({ id: 'a1', password: 'x' }), /Missing email/);
    await assert.rejects(routes['/browser/finish']({ id: 'a1' }), /Missing callbackUrl/);
    assert.equal(fetch.requests.length, 0);
  });
});

describe('/status', () => {
  it('summarises every stored account without tokens, with the last workout from the workouts list and the devices', async () => {
    const { routes, fetch } = harness();
    const result = await routes['/status']();
    assert.equal(result.ok, true);
    assert.equal(result.version, '1.0.0-beta.1');
    assert.deepEqual(result.devices, [{ id: 'dev-bike-0001', name: 'Bike+' }]);
    const owner = result.accounts.find((account) => account.id === 'a1');
    assert.deepEqual(owner, {
      id: 'a1', userId: 'u-owner-0001', displayName: 'Owner', username: 'owner_rider', avatar: true, isOwner: true, state: 'connected',
      lastCheckedAt: NOW - HOUR, lastWorkoutAt: 1789030990 * 1000,
    });
    const member = result.accounts.find((account) => account.id === 'u-member-0002');
    assert.deepEqual(member, {
      id: 'u-member-0002', userId: 'u-member-0002', displayName: 'Member Example', username: 'member_runner', avatar: false, isOwner: false,
      state: 'not_connected', lastWorkoutAt: null,
    });
    assert.equal(JSON.stringify(result).includes('access-1'), false);
    assert.equal(JSON.stringify(result).includes('refresh-1'), false);
    assert.equal(fetch.count('/workouts'), 1, 'only the connected account is asked');
  });

  it('omits the last workout when the top of the list is an import or the list is empty, and asks at most once a minute', async () => {
    const { routes, fetch, clock } = harness();
    fetch.route('/api/user/u-owner-0001/workouts', [
      apiResponse('workout-3p-fit-feed-running'), apiResponse('workouts-empty'), apiResponse('workout-complete-cycling'),
    ]);
    assert.equal((await routes['/status']()).accounts.find((a) => a.id === 'a1').lastWorkoutAt, null);
    assert.equal(fetch.count('/workouts'), 1);
    assert.equal((await routes['/status']()).accounts.find((a) => a.id === 'a1').lastWorkoutAt, null, 'cached');
    assert.equal(fetch.count('/workouts'), 1);
    clock.advance(LAST_WORKOUT_CACHE_TTL_MS);
    assert.equal((await routes['/status']()).accounts.find((a) => a.id === 'a1').lastWorkoutAt, null, 'empty list');
    assert.equal(fetch.count('/workouts'), 2);
    clock.advance(LAST_WORKOUT_CACHE_TTL_MS);
    assert.equal((await routes['/status']()).accounts.find((a) => a.id === 'a1').lastWorkoutAt, 1789030990 * 1000);
  });

  it('reflects a session that died while asking for the last workout', async () => {
    const { routes, fetch } = harness();
    fetch.route('/api/user/u-owner-0001/workouts', jsonResponse(401, {}));
    const owner = (await routes['/status']()).accounts.find((a) => a.id === 'a1');
    assert.equal(owner.state, 'reconnect_needed');
    assert.equal(owner.lastWorkoutAt, null);
  });
});

describe('/connect', () => {
  it('signs in with the shared connect flow, stores tokens but never the password, and claims the household profile', async () => {
    const login = fakeLogin({ 'member@example.com': TOKENS });
    const { routes, store } = harness({ login });
    const result = await routes['/connect']({ id: 'a2', email: 'member@example.com', password: 'secret' });
    assert.equal(result.ok, true);
    assert.deepEqual(login.calls, [{ email: 'member@example.com', password: 'secret' }]);
    assert.equal(result.account.id, 'a2');
    assert.equal(result.account.userId, 'u-member-0002');
    assert.equal(result.account.username, 'member_runner');
    assert.equal(result.account.state, 'connected');
    assert.equal(result.account.isOwner, false);
    assert.equal('accessToken' in result.account, false);
    const record = store.records.get('a2');
    assert.equal(record.accessToken, 'access-login');
    assert.equal(record.refreshToken, 'refresh-login');
    assert.equal(JSON.stringify(record).includes('secret'), false);
    assert.equal(JSON.stringify(record).includes('member@example.com'), false);
    assert.equal(store.records.has('u-member-0002'), false, 'the household profile for the same member is removed');
    assert.deepEqual(store.calls.remove, ['u-member-0002']);
  });

  it('maps every login stage to the page error shape with the HTTP status', async () => {
    const stages = [
      ['credentials', 401], ['authorize', 403], ['callback', 302], ['exchange', 400], ['verification_required', 200], ['state_mismatch', undefined],
    ];
    const answers = {};
    for (const [stage, status] of stages) {
      answers[`${stage}@example.com`] = new AuthError(stage, status);
    }
    const { routes, store } = harness({ login: fakeLogin(answers) });
    for (const [stage, status] of stages) {
      const result = await routes['/connect']({ id: 'a2', email: `${stage}@example.com`, password: 'x' });
      assert.deepEqual(result, status === undefined ? { ok: false, stage } : { ok: false, stage, status });
    }
    assert.equal(store.records.has('a2'), false);
  });

  it('reports a profile failure after a successful sign-in as stage api while the tokens stay stored', async () => {
    const { routes, store, fetch } = harness({ login: fakeLogin({ 'member@example.com': TOKENS }) });
    fetch.route('/api/me', jsonResponse(503, {}));
    const result = await routes['/connect']({ id: 'a2', email: 'member@example.com', password: 'x' });
    assert.deepEqual(result, { ok: false, stage: 'api', status: 503 });
    assert.equal(store.records.get('a2').state, 'connected');
    assert.equal(store.records.get('a2').accessToken, 'access-login');
  });

  it('maps a network failure to stage api without a status', () => {
    assert.deepEqual(errorResponse(new TypeError('fetch failed')), { ok: false, stage: 'api' });
    assert.deepEqual(errorResponse(new AuthError('refresh', 403, 'invalid_grant')), { ok: false, stage: 'refresh', status: 403 });
  });
});

describe('/browser/start and /browser/finish', () => {
  it('hands out the authorize URL, keeps verifier and state in memory, and connects from the pasted callback', async () => {
    const { routes, store, fetch } = harness();
    const start = await routes['/browser/start']({ id: 'a2' });
    assert.equal(start.ok, true);
    const url = new URL(start.authorizeUrl);
    assert.equal(url.origin, PELOTON_AUTH.tenantUrl);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('state'));
    assert.equal(fetch.requests.length, 0);

    const result = await routes['/browser/finish']({ id: 'a2', callbackUrl: callbackUrl(start.authorizeUrl) });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.account.state, 'connected');
    assert.equal(result.account.userId, 'u-member-0002');
    const exchange = fetch.calls('/oauth/token')[0];
    const body = JSON.parse(exchange.body);
    assert.equal(body.grant_type, 'authorization_code');
    assert.equal(body.code, 'redacted-code');
    assert.ok(body.code_verifier.length > 0);
    assert.equal(store.records.get('a2').accessToken, 'redacted');
    assert.equal('password' in store.records.get('a2'), false);
    // The session is used up: the same link again is an expired one.
    const again = await routes['/browser/finish']({ id: 'a2', callbackUrl: callbackUrl(start.authorizeUrl) });
    assert.deepEqual(again, { ok: false, stage: 'expired_code' });
  });

  it('answers expired_code without a session, after ten minutes, and after the account is removed', async () => {
    const { routes, clock } = harness();
    const finish = (id, url) => routes['/browser/finish']({ id, callbackUrl: url });
    assert.deepEqual(await finish('a2', `${PELOTON_AUTH.redirectUri}?code=x&state=y`), { ok: false, stage: 'expired_code' });
    const start = await routes['/browser/start']({ id: 'a2' });
    clock.advance(BROWSER_SESSION_TTL_MS - 1);
    const early = await routes['/browser/start']({ id: 'a3' });
    clock.advance(1);
    assert.deepEqual(await finish('a2', callbackUrl(start.authorizeUrl)), { ok: false, stage: 'expired_code' });
    assert.equal((await finish('a3', callbackUrl(early.authorizeUrl))).ok, true, 'the younger session still lives');
    const again = await routes['/browser/start']({ id: 'a4' });
    await routes['/remove']({ id: 'a4' });
    assert.deepEqual(await finish('a4', callbackUrl(again.authorizeUrl)), { ok: false, stage: 'expired_code' });
  });

  it('keeps the session for a link from an earlier attempt or a malformed one, and drops it for a used code', async () => {
    const { routes, fetch } = harness();
    const finish = (url) => routes['/browser/finish']({ id: 'a2', callbackUrl: url });
    const start = await routes['/browser/start']({ id: 'a2' });
    assert.deepEqual(await finish(`${PELOTON_AUTH.redirectUri}?code=x&state=older`), { ok: false, stage: 'state_mismatch' });
    assert.deepEqual(await finish('https://members.onepeloton.com/home'), { ok: false, stage: 'malformed_callback' });
    assert.deepEqual(await finish('not a url at all'), { ok: false, stage: 'malformed_callback' });
    assert.equal(fetch.count('/oauth/token'), 0);
    fetch.route('/oauth/token', [authFixture('token-invalid-grant'), authFixture('token-success')]);
    assert.deepEqual(await finish(callbackUrl(start.authorizeUrl, 'used')), { ok: false, stage: 'expired_code', status: 403 });
    assert.deepEqual(await finish(callbackUrl(start.authorizeUrl)), { ok: false, stage: 'expired_code' }, 'the session went with the used code');
    const fresh = await routes['/browser/start']({ id: 'a2' });
    assert.equal((await finish(callbackUrl(fresh.authorizeUrl))).ok, true);
  });

  it('maps an exchange failure to stage exchange with its status and keeps the session', async () => {
    const { routes, fetch } = harness();
    fetch.route('/oauth/token', [jsonResponse(500, {}), authFixture('token-success')]);
    const start = await routes['/browser/start']({ id: 'a2' });
    const url = callbackUrl(start.authorizeUrl);
    assert.deepEqual(await routes['/browser/finish']({ id: 'a2', callbackUrl: url }), { ok: false, stage: 'exchange', status: 500 });
    assert.equal((await routes['/browser/finish']({ id: 'a2', callbackUrl: url })).ok, true);
  });
});

describe('/test', () => {
  it('fetches the profile with the stored session and returns the new lastCheckedAt', async () => {
    const { routes, store, fetch } = harness();
    fetch.route('/api/me', apiResponse('me-owner'));
    const result = await routes['/test']({ id: 'a1' });
    assert.deepEqual(result, { ok: true, lastCheckedAt: NOW });
    assert.equal(fetch.calls('/api/me')[0].headers.authorization, 'Bearer access-1');
    assert.equal(store.records.get('a1').lastCheckedAt, NOW);
    assert.equal(store.records.get('a1').maxHr, 168);
  });

  it('reports a dead session as stage refresh and an account without tokens too', async () => {
    const { routes, store, fetch } = harness();
    fetch.route('/api/me', jsonResponse(401, {}));
    assert.deepEqual(await routes['/test']({ id: 'a1' }), { ok: false, stage: 'refresh', status: 401 });
    assert.equal(store.records.get('a1').state, 'reconnect_needed');
    assert.deepEqual(await routes['/test']({ id: 'u-member-0002' }), { ok: false, stage: 'refresh' });
  });

  it('reports a Peloton failure as stage api with the status', async () => {
    const { routes, fetch } = harness();
    fetch.route('/api/me', jsonResponse(502, {}));
    assert.deepEqual(await routes['/test']({ id: 'a1' }), { ok: false, stage: 'api', status: 502 });
  });
});

describe('/household', () => {
  it('re-reads the owner subscriptions, adds new profiles and devices, and answers like /status', async () => {
    const { routes, store, fetch } = harness({ records: { a1: connected({ devices: [] }) } });
    const result = await routes['/household']();
    assert.equal(result.ok, true);
    assert.equal(fetch.count('/subscriptions'), 1);
    assert.deepEqual([...store.records.keys()].sort(), ['a1', 'u-member-0002', 'u-member-0003']);
    assert.deepEqual(result.accounts.map((account) => account.id).sort(), ['a1', 'u-member-0002', 'u-member-0003']);
    assert.deepEqual(result.devices, [{ id: 'dev-bike-0001', name: 'Bike+' }]);
    assert.equal(result.accounts.find((account) => account.id === 'u-member-0003').state, 'not_connected');
  });

  it('skips members and reports the owner failure by stage', async () => {
    const { routes, fetch } = harness({ records: { a1: connected(), a2: connected({ userId: 'u-member-0003', isOwner: false }) } });
    fetch.route('/subscriptions', jsonResponse(500, {}));
    assert.deepEqual(await routes['/household'](), { ok: false, stage: 'api', status: 500 });
    assert.equal(fetch.count('/api/user/u-member-0003/subscriptions'), 0);
  });
});

describe('/remove', () => {
  it('deletes the account file and forgets the account', async () => {
    const { routes, store } = harness();
    await routes['/avatar']({ id: 'a1' });
    assert.deepEqual(await routes['/remove']({ id: 'a1' }), { ok: true });
    assert.equal(store.records.has('a1'), false);
    assert.deepEqual(store.calls.remove, ['a1']);
    assert.deepEqual(await routes['/avatar']({ id: 'a1' }), { ok: true, status: 204 });
    assert.deepEqual((await routes['/status']()).accounts.map((account) => account.id), ['u-member-0002']);
  });
});

describe('/avatar', () => {
  it('answers 204 for the default profile image and for an unknown account', async () => {
    const { routes, fetch } = harness();
    assert.deepEqual(await routes['/avatar']({ id: 'u-member-0002' }), { ok: true, status: 204 });
    assert.deepEqual(await routes['/avatar']({ id: 'nobody' }), { ok: true, status: 204 });
    assert.equal(fetch.requests.length, 0);
  });

  it('proxies the image bytes once and serves them from memory for 24 hours', async () => {
    const { routes, fetch, clock } = harness();
    const first = await routes['/avatar']({ id: 'a1' });
    assert.deepEqual(first, { ok: true, status: 200, contentType: 'image/jpeg', data: Buffer.from('JPEGBYTES').toString('base64') });
    assert.equal(fetch.count(AVATAR_URL), 1);
    assert.equal(fetch.calls(AVATAR_URL)[0].headers.authorization, undefined, 'no token goes to the CDN');
    clock.advance(AVATAR_CACHE_TTL_MS - 1);
    assert.deepEqual(await routes['/avatar']({ id: 'a1' }), first);
    assert.equal(fetch.count(AVATAR_URL), 1);
    clock.advance(1);
    await routes['/avatar']({ id: 'a1' });
    assert.equal(fetch.count(AVATAR_URL), 2);
  });

  it('reports a CDN failure or a non-image answer as stage api', async () => {
    const { routes, fetch } = harness();
    fetch.route(AVATAR_URL, [
      { status: 404, body: '' }, { status: 200, headers: { 'content-type': 'text/html' }, body: '<html>' }, new TypeError('fetch failed'),
    ]);
    assert.deepEqual(await routes['/avatar']({ id: 'a1' }), { ok: false, stage: 'api', status: 404 });
    assert.deepEqual(await routes['/avatar']({ id: 'a1' }), { ok: false, stage: 'api', status: 200 });
    assert.deepEqual(await routes['/avatar']({ id: 'a1' }), { ok: false, stage: 'api' });
  });
});
