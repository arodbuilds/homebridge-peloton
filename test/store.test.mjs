import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ApiError } from '../dist/api/peloton-api.js';
import { AuthError } from '../dist/auth/peloton-auth.js';
import { AccountStore, REFRESH_AHEAD_MS } from '../dist/store/account-store.js';
import { createFakeFetch } from './helpers/fake-fetch.mjs';
import { authFixture, jsonResponse } from './helpers/fixtures.mjs';

const NOW = 1_789_000_000_000;
const HOUR = 60 * 60 * 1000;

let storagePath;

beforeEach(() => {
  storagePath = mkdtempSync(join(tmpdir(), 'peloton-store-'));
});

afterEach(() => {
  rmSync(storagePath, { recursive: true, force: true });
});

function connected(overrides = {}) {
  return {
    userId: 'u-owner-0001',
    username: 'owner_rider',
    displayName: 'Owner',
    accessToken: 'access-1',
    accessTokenExpiresAt: NOW + 40 * HOUR,
    refreshToken: 'refresh-1',
    state: 'connected',
    ...overrides,
  };
}

function readRecord(store, id) {
  return JSON.parse(readFileSync(join(store.directory, `${id}.json`), 'utf8'));
}

function tempFiles(store) {
  return readdirSync(store.directory).filter((name) => name.endsWith('.tmp'));
}

function fakeRefresh(results) {
  const queue = [...results];
  const calls = [];
  const fn = async (refreshToken) => {
    calls.push(refreshToken);
    const next = queue.shift();
    if (next === undefined) {
      throw new Error('unexpected refresh');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  fn.calls = calls;
  return fn;
}

describe('files and permissions', () => {
  it('creates the directory 0700 and files 0600 under storagePath/homebridge-peloton/accounts', async () => {
    const store = new AccountStore({ storagePath, now: () => NOW });
    await store.save('a1', connected());
    assert.equal(store.directory, join(storagePath, 'homebridge-peloton', 'accounts'));
    assert.equal(statSync(store.directory).mode & 0o777, 0o700);
    assert.equal(statSync(join(store.directory, 'a1.json')).mode & 0o777, 0o600);
    assert.deepEqual(readRecord(store, 'a1'), connected());
  });

  it('keeps 0600 when overwriting an existing file', async () => {
    const store = new AccountStore({ storagePath, now: () => NOW });
    await store.save('a1', connected());
    await store.save('a1', connected({ displayName: 'Renamed' }));
    assert.equal(statSync(join(store.directory, 'a1.json')).mode & 0o777, 0o600);
    assert.equal(readRecord(store, 'a1').displayName, 'Renamed');
    assert.deepEqual(tempFiles(store), []);
  });

  it('loads all, loads one, and removes one', async () => {
    const store = new AccountStore({ storagePath, now: () => NOW });
    await store.save('a1', connected());
    await store.save('a2', { state: 'not_connected', userId: 'u-member-0002', displayName: 'Member' });
    writeFileSync(join(store.directory, 'broken.json'), '{not json');
    writeFileSync(join(store.directory, 'notes.txt'), 'ignored');
    const all = await store.loadAll();
    assert.deepEqual([...all.keys()].sort(), ['a1', 'a2']);
    assert.equal(all.get('a2').state, 'not_connected');
    assert.deepEqual(await store.load('a1'), connected());
    assert.equal(await store.load('missing'), undefined);
    assert.equal(await store.load('broken'), undefined);
    await store.remove('a1');
    assert.equal(await store.load('a1'), undefined);
    await store.remove('a1');
    assert.deepEqual([...(await store.loadAll()).keys()], ['a2']);
  });

  it('rejects account ids that could escape the directory', async () => {
    const store = new AccountStore({ storagePath, now: () => NOW });
    await assert.rejects(store.save('../escape', connected()), /Invalid account id/);
    await assert.rejects(store.load('a/b'), /Invalid account id/);
    await assert.rejects(store.remove(''), /Invalid account id/);
  });
});

describe('atomic write', () => {
  it('leaves no temp file after a successful save', async () => {
    const store = new AccountStore({ storagePath, now: () => NOW });
    await store.save('a1', connected());
    assert.deepEqual(readdirSync(store.directory), ['a1.json']);
  });

  it('leaves no temp file when the rename fails', async () => {
    const store = new AccountStore({ storagePath, now: () => NOW });
    await store.ensureDirectory();
    mkdirSync(join(store.directory, 'a1.json'));
    await assert.rejects(store.save('a1', connected()));
    assert.deepEqual(tempFiles(store), []);
    assert.deepEqual(readdirSync(store.directory), ['a1.json']);
  });

  it('leaves the previous file intact when the write fails', async () => {
    const store = new AccountStore({ storagePath, now: () => NOW });
    await store.save('a1', connected());
    const circular = connected();
    circular.self = circular;
    await assert.rejects(store.save('a1', circular), TypeError);
    assert.deepEqual(readRecord(store, 'a1'), connected());
    assert.deepEqual(tempFiles(store), []);
  });
});

describe('withValidToken', () => {
  it('uses the stored token without refreshing when it is far from expiry', async () => {
    const refresh = fakeRefresh([]);
    const store = new AccountStore({ storagePath, now: () => NOW, refresh });
    await store.save('a1', connected());
    const result = await store.withValidToken('a1', async (token) => `used ${token}`);
    assert.equal(result, 'used access-1');
    assert.deepEqual(refresh.calls, []);
  });

  it('refreshes first when within 6 hours of expiry and persists the rotated token before running fn', async () => {
    const refresh = fakeRefresh([{ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: NOW + 48 * HOUR }]);
    const store = new AccountStore({ storagePath, now: () => NOW, refresh });
    await store.save('a1', connected({ accessTokenExpiresAt: NOW + REFRESH_AHEAD_MS - 1 }));
    let onDiskDuringFn;
    const result = await store.withValidToken('a1', async (token) => {
      onDiskDuringFn = readRecord(store, 'a1');
      return token;
    });
    assert.equal(result, 'access-2');
    assert.deepEqual(refresh.calls, ['refresh-1']);
    assert.equal(onDiskDuringFn.refreshToken, 'refresh-2', 'the rotated refresh token was on disk before fn ran');
    assert.equal(onDiskDuringFn.accessToken, 'access-2');
    assert.equal(onDiskDuringFn.accessTokenExpiresAt, NOW + 48 * HOUR);
    assert.equal(onDiskDuringFn.state, 'connected');
    assert.equal(onDiskDuringFn.lastCheckedAt, NOW);
  });

  it('does not refresh when exactly more than 6 hours remain', async () => {
    const refresh = fakeRefresh([]);
    const store = new AccountStore({ storagePath, now: () => NOW, refresh });
    await store.save('a1', connected({ accessTokenExpiresAt: NOW + REFRESH_AHEAD_MS + 1 }));
    await store.withValidToken('a1', async () => undefined);
    assert.deepEqual(refresh.calls, []);
  });

  it('refreshes once and retries when fn throws ApiError 401', async () => {
    const refresh = fakeRefresh([{ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: NOW + 48 * HOUR }]);
    const store = new AccountStore({ storagePath, now: () => NOW, refresh });
    await store.save('a1', connected());
    const seen = [];
    const result = await store.withValidToken('a1', async (token) => {
      seen.push({ token, onDisk: readRecord(store, 'a1').refreshToken });
      if (token === 'access-1') {
        throw new ApiError(401, '/api/me');
      }
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.deepEqual(seen, [
      { token: 'access-1', onDisk: 'refresh-1' },
      { token: 'access-2', onDisk: 'refresh-2' },
    ]);
    assert.deepEqual(refresh.calls, ['refresh-1']);
  });

  it('rethrows a second 401 after the refresh instead of looping', async () => {
    const refresh = fakeRefresh([{ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: NOW + 48 * HOUR }]);
    const store = new AccountStore({ storagePath, now: () => NOW, refresh });
    await store.save('a1', connected());
    let calls = 0;
    await assert.rejects(store.withValidToken('a1', async () => {
      calls += 1;
      throw new ApiError(401, '/api/me');
    }), (error) => error instanceof ApiError && error.status === 401);
    assert.equal(calls, 2);
    assert.deepEqual(refresh.calls, ['refresh-1']);
  });

  it('rethrows other API errors without refreshing', async () => {
    const refresh = fakeRefresh([]);
    const store = new AccountStore({ storagePath, now: () => NOW, refresh });
    await store.save('a1', connected());
    await assert.rejects(store.withValidToken('a1', async () => {
      throw new ApiError(503, '/api/me');
    }), (error) => error instanceof ApiError && error.status === 503);
    assert.deepEqual(refresh.calls, []);
  });

  it('marks the account reconnect_needed on invalid_grant and rethrows AuthError stage refresh', async () => {
    const refresh = fakeRefresh([new AuthError('refresh', 403, 'invalid_grant')]);
    const store = new AccountStore({ storagePath, now: () => NOW, refresh });
    await store.save('a1', connected({ accessTokenExpiresAt: NOW + HOUR }));
    let fnCalls = 0;
    await assert.rejects(store.withValidToken('a1', async () => {
      fnCalls += 1;
    }), (error) => error instanceof AuthError && error.stage === 'refresh' && error.code === 'invalid_grant' && error.status === 403);
    assert.equal(fnCalls, 0);
    const onDisk = readRecord(store, 'a1');
    assert.equal(onDisk.state, 'reconnect_needed');
    assert.deepEqual(onDisk.lastError, { stage: 'refresh', status: 403, at: NOW });
    assert.equal(onDisk.accessToken, undefined);
    assert.equal(onDisk.refreshToken, undefined);
    assert.equal(onDisk.userId, 'u-owner-0001', 'identity fields are kept');
  });

  it('marks reconnect_needed when a 401 retry hits invalid_grant', async () => {
    const refresh = fakeRefresh([new AuthError('refresh', 403, 'invalid_grant')]);
    const store = new AccountStore({ storagePath, now: () => NOW, refresh });
    await store.save('a1', connected());
    await assert.rejects(store.withValidToken('a1', async () => {
      throw new ApiError(401, '/api/me');
    }), (error) => error instanceof AuthError && error.stage === 'refresh');
    assert.equal(readRecord(store, 'a1').state, 'reconnect_needed');
  });

  it('leaves the account connected when the refresh failure is transient', async () => {
    const refresh = fakeRefresh([new AuthError('refresh', 503)]);
    const store = new AccountStore({ storagePath, now: () => NOW, refresh });
    await store.save('a1', connected({ accessTokenExpiresAt: NOW + HOUR }));
    await assert.rejects(store.withValidToken('a1', async () => undefined),
      (error) => error instanceof AuthError && error.stage === 'refresh' && error.status === 503);
    const onDisk = readRecord(store, 'a1');
    assert.equal(onDisk.state, 'connected');
    assert.equal(onDisk.refreshToken, 'refresh-1');
    assert.equal(onDisk.lastError, undefined);
  });

  it('throws when the account has no tokens', async () => {
    const store = new AccountStore({ storagePath, now: () => NOW, refresh: fakeRefresh([]) });
    await store.save('a1', { state: 'not_connected' });
    await assert.rejects(store.withValidToken('a1', async () => undefined), /has no tokens/);
    await assert.rejects(store.withValidToken('missing', async () => undefined), /has no tokens/);
  });

  it('shares one refresh between concurrent callers', async () => {
    const refresh = fakeRefresh([{ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: NOW + 48 * HOUR }]);
    const store = new AccountStore({ storagePath, now: () => NOW, refresh });
    await store.save('a1', connected({ accessTokenExpiresAt: NOW + HOUR }));
    const results = await Promise.all([
      store.withValidToken('a1', async (token) => token),
      store.withValidToken('a1', async (token) => token),
    ]);
    assert.deepEqual(results, ['access-2', 'access-2']);
    assert.deepEqual(refresh.calls, ['refresh-1']);
  });

  it('reuses a rotation another caller already persisted instead of refreshing with a retired token', async () => {
    const refresh = fakeRefresh([{ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: NOW + 48 * HOUR }]);
    const store = new AccountStore({ storagePath, now: () => NOW, refresh });
    const stale = connected({ accessTokenExpiresAt: NOW + HOUR });
    await store.save('a1', stale);
    // Caller A refreshes and persists the rotation.
    assert.equal(await store.withValidToken('a1', async (token) => token), 'access-2');
    // Caller B loaded the record before that rotation landed and only now reaches the refresh step.
    const result = await store.refreshAccount('a1', stale);
    assert.equal(result.accessToken, 'access-2');
    assert.equal(result.refreshToken, 'refresh-2');
    assert.deepEqual(refresh.calls, ['refresh-1'], 'refresh-1 was never sent a second time');
  });

  it('refreshes with the token on disk when a stale caller finds a rotation that is itself near expiry', async () => {
    const refresh = fakeRefresh([
      { accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: NOW + HOUR },
      { accessToken: 'access-3', refreshToken: 'refresh-3', expiresAt: NOW + 48 * HOUR },
    ]);
    const store = new AccountStore({ storagePath, now: () => NOW, refresh });
    const stale = connected({ accessTokenExpiresAt: NOW + HOUR });
    await store.save('a1', stale);
    await store.withValidToken('a1', async (token) => token);
    const result = await store.refreshAccount('a1', stale);
    assert.equal(result.accessToken, 'access-3');
    assert.deepEqual(refresh.calls, ['refresh-1', 'refresh-2']);
  });

  it('uses the real refresh through the injected fetch by default', async () => {
    const fetchImpl = createFakeFetch([
      jsonResponse(200, { access_token: 'access-live', refresh_token: 'refresh-live', expires_in: 172800 }),
    ]);
    const store = new AccountStore({ storagePath, now: () => NOW, fetchImpl });
    await store.save('a1', connected({ accessTokenExpiresAt: NOW + HOUR }));
    const token = await store.withValidToken('a1', async (value) => value);
    assert.equal(token, 'access-live');
    assert.equal(JSON.parse(fetchImpl.requests[0].body).refresh_token, 'refresh-1');
    assert.equal(readRecord(store, 'a1').refreshToken, 'refresh-live');
  });

  it('marks reconnect_needed through the real refresh on the invalid_grant fixture', async () => {
    const fetchImpl = createFakeFetch([authFixture('token-invalid-grant')]);
    const store = new AccountStore({ storagePath, now: () => NOW, fetchImpl });
    await store.save('a1', connected({ accessTokenExpiresAt: NOW + HOUR }));
    await assert.rejects(store.withValidToken('a1', async (value) => value), (error) => error instanceof AuthError && error.stage === 'refresh');
    assert.equal(readRecord(store, 'a1').state, 'reconnect_needed');
  });
});
