import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as hap from '@homebridge/hap-nodejs';

import { attentionSensorUuid, fastPollingSwitchUuid, triggerUuid } from '../dist/accessories/common.js';
import { AuthError } from '../dist/auth/peloton-auth.js';
import { PelotonPlatform } from '../dist/platform.js';
import { AccountStore } from '../dist/store/account-store.js';
import { createFakeClock } from './helpers/fake-clock.mjs';
import { apiResponse, jsonResponse } from './helpers/fixtures.mjs';
import { createRoutedFetch } from './helpers/routed-fetch.mjs';

const { Accessory, Characteristic, Service } = hap;
const HOUR = 60 * 60 * 1000;

let storagePath;

beforeEach(() => {
  storagePath = mkdtempSync(join(tmpdir(), 'peloton-platform-'));
});

afterEach(() => {
  rmSync(storagePath, { recursive: true, force: true });
});

class FakePlatformAccessory extends Accessory {
  constructor(displayName, uuid) {
    super(displayName, uuid);
    this.context = {};
  }
}

function fakeApi() {
  const handlers = new Map();
  const calls = { registered: [], unregistered: [], updated: [] };
  return {
    hap,
    platformAccessory: FakePlatformAccessory,
    user: { storagePath: () => storagePath },
    on: (event, handler) => handlers.set(event, handler),
    fire: (event) => handlers.get(event)?.(),
    registerPlatformAccessories: (plugin, platform, accessories) => calls.registered.push({ plugin, platform, accessories }),
    unregisterPlatformAccessories: (plugin, platform, accessories) => calls.unregistered.push({ plugin, platform, accessories }),
    updatePlatformAccessories: (accessories) => calls.updated.push(accessories),
    calls,
  };
}

function fakeLog() {
  const lines = { info: [], warn: [], error: [], debug: [] };
  return {
    lines,
    info: (line) => lines.info.push(line),
    warn: (line) => lines.warn.push(line),
    error: (line) => lines.error.push(line),
    debug: (line) => lines.debug.push(line),
    success: () => undefined,
  };
}

async function seedStore(clock, records) {
  const store = new AccountStore({ storagePath, now: clock.now });
  for (const [id, record] of Object.entries(records)) {
    await store.save(id, record);
  }
  return store;
}

function connected(userId, displayName, extra = {}) {
  return {
    userId,
    username: `${displayName.toLowerCase()}_rider`,
    displayName,
    accessToken: 'access-1',
    accessTokenExpiresAt: 1_789_000_000_000 + 40 * HOUR,
    refreshToken: 'refresh-1',
    state: 'connected',
    ...extra,
  };
}

const CONFIG = {
  platform: 'Peloton',
  name: 'Peloton',
  accounts: [
    { id: 'a1', email: 'owner@example.com', userId: 'u-owner-0001', displayName: 'Alex' },
    { id: 'a2', email: 'member@example.com' },
    { id: 'a3', email: 'other@example.com', displayName: 'Other' },
  ],
  triggers: [
    { id: 't1', type: 'workout', name: 'Workout', accessory: 'occupancy', who: 'anyone', device: 'bike' },
    { id: 't2', type: 'workout', name: 'Strength', accessory: 'switch', activities: ['strength'] },
  ],
  polling: { fastSwitch: true, standbyInterval: 120 },
  advanced: { attentionSensor: true },
};

async function launch({ config = CONFIG, cached = [], records, fetch = createRoutedFetch(), login } = {}) {
  const clock = createFakeClock();
  const store = await seedStore(clock, records ?? {
    a1: connected('u-owner-0001', 'Owner', { isOwner: true, devices: [{ id: 'dev-bike-0001', name: 'Bike+', deviceType: 'home_bike_plus' }] }),
    a2: { state: 'reconnect_needed', userId: 'u-member-0003', displayName: 'Lifter', username: 'member_lifter' },
    a3: { state: 'not_connected', userId: 'u-member-0002', displayName: 'Member' },
  });
  const api = fakeApi();
  const log = fakeLog();
  const platform = new PelotonPlatform(log, config, api, { now: clock.now, scheduler: clock, fetchImpl: fetch, login });
  for (const accessory of cached) {
    platform.configureAccessory(accessory);
  }
  api.fire('didFinishLaunching');
  await platform.launched;
  clock.idle = () => platform.activePoller?.whenIdle() ?? Promise.resolve();
  return { platform, api, log, clock, fetch, store };
}

/** A login stub that records calls and answers per email with tokens or an Error to throw. */
function fakeLogin(answers) {
  const calls = [];
  const fn = async (email, password) => {
    calls.push({ email, password });
    const answer = answers[email];
    if (answer === undefined) {
      throw new Error(`unexpected login for ${email}`);
    }
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };
  fn.calls = calls;
  return fn;
}

const TOKENS = { accessToken: 'access-login', refreshToken: 'refresh-login', expiresAt: 1_789_000_000_000 + 48 * HOUR };

const SIGN_IN_CONFIG = {
  ...CONFIG,
  accounts: [
    { id: 'a1', email: 'owner@example.com', password: 'secret-1', displayName: 'Alex' },
    { id: 'a2', email: 'member@example.com', password: 'secret-2' },
    { id: 'a3', email: 'other@example.com', password: 'secret-3' },
    { id: 'a4', email: 'nopassword@example.com' },
  ],
};

describe('startup', () => {
  it('registers the configured accessories, refreshes cached ones, and unregisters orphans', async () => {
    const staleTrigger = new FakePlatformAccessory('Old workout name', triggerUuid(hap, 't1'));
    staleTrigger.addService(Service.Switch, 'Old workout name');
    const orphan = new FakePlatformAccessory('Gone', triggerUuid(hap, 't-removed'));
    const { api, log } = await launch({ cached: [staleTrigger, orphan] });

    assert.equal(api.calls.registered.length, 1);
    assert.deepEqual(api.calls.registered[0].plugin, 'homebridge-peloton');
    assert.deepEqual(api.calls.registered[0].platform, 'Peloton');
    assert.deepEqual(api.calls.registered[0].accessories.map((accessory) => accessory.displayName).sort(), [
      'Peloton attention needed', 'Peloton fast polling', 'Strength',
    ]);
    assert.deepEqual(api.calls.registered[0].accessories.map((accessory) => accessory.UUID).sort(), [
      attentionSensorUuid(hap), fastPollingSwitchUuid(hap), triggerUuid(hap, 't2'),
    ].sort());
    assert.deepEqual(api.calls.unregistered.map((call) => call.accessories.map((accessory) => accessory.UUID)), [[orphan.UUID]]);
    assert.deepEqual(api.calls.updated, [[staleTrigger]]);
    assert.equal(staleTrigger.displayName, 'Workout');
    assert.equal(staleTrigger.getService(Service.Switch), undefined);
    assert.ok(staleTrigger.getService(Service.OccupancySensor));
    assert.deepEqual(log.lines.info, [
      'Lifter: reconnect needed, not polling until the account is connected again',
      'Other: not connected, not polling',
    ]);
    assert.deepEqual(log.lines.error, []);
  });

  it('removes the fast polling switch and attention sensor when config turns them off', async () => {
    const fast = new FakePlatformAccessory('Peloton fast polling', fastPollingSwitchUuid(hap));
    const attention = new FakePlatformAccessory('Peloton attention needed', attentionSensorUuid(hap));
    const { api } = await launch({
      cached: [fast, attention],
      config: { ...CONFIG, polling: { fastSwitch: false }, advanced: { attentionSensor: false } },
    });
    assert.deepEqual(api.calls.unregistered[0].accessories.map((accessory) => accessory.UUID).sort(), [fast.UUID, attention.UUID].sort());
    assert.deepEqual(api.calls.registered[0].accessories.map((accessory) => accessory.displayName).sort(), ['Strength', 'Workout']);
  });

  it('turns the attention sensor on for accounts already in reconnect_needed', async () => {
    const { api } = await launch();
    const attention = api.calls.registered[0].accessories.find((accessory) => accessory.UUID === attentionSensorUuid(hap));
    assert.equal(
      attention.getService(Service.OccupancySensor).getCharacteristic(Characteristic.OccupancyDetected).value,
      Characteristic.OccupancyDetected.OCCUPANCY_DETECTED,
    );
  });

  it('warns about config problems and still starts', async () => {
    const { log, platform } = await launch({ config: { ...CONFIG, polling: { fastInterval: 1 } } });
    assert.deepEqual(log.lines.warn, ['polling.fastInterval is below 5, using 5']);
    assert.equal(platform.pelotonConfig.polling.fastInterval, 5);
    assert.ok(platform.activePoller);
  });
});

describe('startup sign-in', () => {
  it('signs in accounts with credentials and no stored sign-in, sequentially, and settles the owner from subscriptions', async () => {
    const fetch = createRoutedFetch();
    fetch.route('/api/me', [apiResponse('me-member'), apiResponse('me-owner')])
      .route('/subscriptions', apiResponse('subscriptions'))
      .route('/workouts', apiResponse('workouts-empty'));
    const login = fakeLogin({ 'owner@example.com': TOKENS, 'member@example.com': { ...TOKENS, accessToken: 'access-member' } });
    const { log, store, platform, clock } = await launch({
      fetch,
      login,
      // a2 is listed before the owner's profile answers, so owner status cannot come from config order.
      config: { ...SIGN_IN_CONFIG, accounts: [SIGN_IN_CONFIG.accounts[1], SIGN_IN_CONFIG.accounts[0], SIGN_IN_CONFIG.accounts[3]] },
      records: {},
    });
    assert.deepEqual(login.calls, [{ email: 'member@example.com', password: 'secret-2' }, { email: 'owner@example.com', password: 'secret-1' }]);
    assert.deepEqual(log.lines.info.slice(0, 3), [
      'Connected Member Example (@member_runner)',
      'Connected Alex (@owner_rider)',
      'a4: not connected, not polling',
    ]);
    const owner = await store.load('a1');
    assert.equal(owner.state, 'connected');
    assert.equal(owner.accessToken, 'access-login');
    assert.equal(owner.refreshToken, 'refresh-login');
    assert.equal(owner.userId, 'u-owner-0001');
    assert.equal(owner.username, 'owner_rider');
    assert.equal(owner.displayName, 'Owner Example');
    assert.equal(owner.imageUrl, 'https://cdn.example.invalid/avatars/u-owner-0001.jpg');
    assert.equal(owner.isProfileImageDefault, false);
    assert.equal(owner.maxHr, 168);
    assert.equal(owner.hrZones.length, 5);
    assert.equal(owner.isOwner, true);
    assert.deepEqual(owner.devices, [{ id: 'dev-bike-0001', name: 'Bike+', deviceType: 'home_bike_plus' }]);
    const member = await store.load('a2');
    assert.equal(member.state, 'connected');
    assert.equal(member.userId, 'u-member-0002');
    assert.equal(member.isOwner, false);
    assert.equal(member.devices, undefined);
    assert.deepEqual([...(await store.loadAll()).keys()].sort(), ['a1', 'a2', 'u-member-0003']);
    assert.equal((await store.loadAll()).get('u-member-0003').state, 'not_connected');
    assert.deepEqual(platform.activePoller.activeAccountIds.sort(), ['a1', 'a2']);
    await clock.advance(0);
    assert.ok(fetch.calls('/api/user/u-member-0002/workouts').length >= 1);
    assert.equal(fetch.calls('/api/user/u-owner-0001/workouts')[0]?.headers.authorization ?? 'Bearer access-login', 'Bearer access-login');
  });

  it('logs one line and leaves the record untouched when the sign-in fails, then skips the account', async () => {
    const fetch = createRoutedFetch();
    fetch.route('/workouts', apiResponse('workouts-empty'));
    const login = fakeLogin({ 'owner@example.com': new AuthError('credentials', 401), 'other@example.com': new AuthError('authorize', 403) });
    const before = { state: 'reconnect_needed', userId: 'u-owner-0001', displayName: 'Owner', lastError: { stage: 'refresh', status: 403, at: 1 } };
    const { log, store, platform } = await launch({
      fetch,
      login,
      config: { ...SIGN_IN_CONFIG, accounts: [SIGN_IN_CONFIG.accounts[0], SIGN_IN_CONFIG.accounts[2]] },
      records: { a1: before },
    });
    assert.equal(login.calls.length, 2);
    assert.deepEqual(log.lines.info, [
      'Alex: sign-in failed at stage credentials, HTTP 401; use the settings page to connect',
      'a3: sign-in failed at stage authorize, HTTP 403; use the settings page to connect',
      'Alex: reconnect needed, not polling until the account is connected again',
      'a3: not connected, not polling',
    ]);
    assert.deepEqual(await store.load('a1'), before);
    assert.equal(await store.load('a3'), undefined);
    assert.deepEqual(platform.activePoller.activeAccountIds, []);
  });

  it('never re-logs in an account whose tokens are stored', async () => {
    const fetch = createRoutedFetch();
    fetch.route('/workouts', apiResponse('workouts-empty'));
    const login = fakeLogin({});
    const { log, store } = await launch({
      fetch,
      login,
      config: { ...SIGN_IN_CONFIG, accounts: [SIGN_IN_CONFIG.accounts[0]] },
      records: { a1: connected('u-owner-0001', 'Owner') },
    });
    assert.deepEqual(login.calls, []);
    assert.equal((await store.load('a1')).accessToken, 'access-1');
    assert.deepEqual(log.lines.info, []);
  });

  it('re-logs in once after invalid_grant when config has a password, and resumes polling', async () => {
    const fetch = createRoutedFetch();
    fetch.route('/api/user/u-owner-0001/workouts', [jsonResponse(401, {}), apiResponse('workouts-empty')])
      .route('/api/me', apiResponse('me-owner'))
      .route('/subscriptions', apiResponse('subscriptions'))
      .route('/oauth/token', jsonResponse(403, { error: 'invalid_grant', error_description: 'expired' }));
    const login = fakeLogin({ 'owner@example.com': TOKENS });
    const { log, store, platform, clock } = await launch({
      fetch,
      login,
      config: { ...SIGN_IN_CONFIG, accounts: [SIGN_IN_CONFIG.accounts[0]] },
      records: { a1: connected('u-owner-0001', 'Owner') },
    });
    await clock.advance(0);
    assert.deepEqual(login.calls, [{ email: 'owner@example.com', password: 'secret-1' }]);
    assert.deepEqual(log.lines.info, [
      'Alex: sign-in expired, reconnect needed (stage refresh, HTTP 403)',
      'Connected Alex (@owner_rider)',
    ]);
    assert.equal((await store.load('a1')).state, 'connected');
    assert.deepEqual(platform.activePoller.activeAccountIds, ['a1']);
    const attention = platform.accessories.get(attentionSensorUuid(hap));
    assert.equal(
      attention.getService(Service.OccupancySensor).getCharacteristic(Characteristic.OccupancyDetected).value,
      Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );
    await clock.advance(120_000);
    assert.equal(fetch.calls('/api/user/u-owner-0001/workouts').at(-1).headers.authorization, 'Bearer access-login');
  });
});

describe('wiring', () => {
  it('polls the connected account and drives the sensors and the switch', async () => {
    const fetch = createRoutedFetch();
    fetch.route('/api/user/u-owner-0001/workouts', apiResponse('workout-in-progress-cycling'))
      .route(/\/api\/workout\/w-cyc-0001$/, apiResponse('workout-single-in-progress-cycling'));
    const { api, log, clock, platform } = await launch({ fetch });
    await clock.advance(0);
    assert.equal(platform.activePoller.state, 'locked');
    const workout = platform.accessories.get(triggerUuid(hap, 't1'));
    const strength = platform.accessories.get(triggerUuid(hap, 't2'));
    assert.equal(
      workout.getService(Service.OccupancySensor).getCharacteristic(Characteristic.OccupancyDetected).value,
      Characteristic.OccupancyDetected.OCCUPANCY_DETECTED,
    );
    assert.equal(strength.getService(Service.Switch).getCharacteristic(Characteristic.On).value, false);
    assert.deepEqual(log.lines.info.slice(2), ['Alex: workout started (cycling, 30 min Power Zone Ride)', 'Workout: on']);

    const fast = platform.accessories.get(fastPollingSwitchUuid(hap));
    const on = fast.getService(Service.Switch).getCharacteristic(Characteristic.On);
    await on.handleSetRequest(true);
    assert.equal(platform.activePoller.switchOn, true);
    assert.equal(log.lines.info.at(-1), 'Fast polling switch on: scanning 1 accounts every 10s');
    await clock.advance(0);
    assert.equal(fetch.requests.every((request) => !request.url.includes('u-member')), true);

    api.fire('shutdown');
    assert.deepEqual(clock.pending(), []);
  });

  it('logs debug lines at info when config.debug is set', async () => {
    const fetch = createRoutedFetch();
    fetch.route('/api/user/u-owner-0001/workouts', apiResponse('workouts-empty'));
    const { log, clock } = await launch({ fetch, config: { ...CONFIG, debug: true } });
    await clock.advance(0);
    assert.ok(log.lines.info.includes('Alex: poll found no workouts'));
    assert.deepEqual(log.lines.debug, []);
  });
});
