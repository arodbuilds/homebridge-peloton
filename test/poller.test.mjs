import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { getLatestWorkout, getMe, getPerformanceGraph, getSubscriptions, getWorkout } from '../dist/api/peloton-api.js';
import { AuthError } from '../dist/auth/peloton-auth.js';
import { parseConfig } from '../dist/config.js';
import { Poller, backoffInterval, nextLocalTime } from '../dist/poller/poller.js';
import { AccountStore } from '../dist/store/account-store.js';
import { createFakeClock } from './helpers/fake-clock.mjs';
import { apiFixture, apiResponse, jsonResponse } from './helpers/fixtures.mjs';
import { createRoutedFetch } from './helpers/routed-fetch.mjs';

const HOUR = 60 * 60 * 1000;
const OWNER = { id: 'a1', userId: 'u-owner-0001', displayName: 'Owner' };
const MEMBER = { id: 'a2', userId: 'u-member-0003', displayName: 'Lifter' };

const LIST_OWNER = '/api/user/u-owner-0001/workouts';
const LIST_MEMBER = '/api/user/u-member-0003/workouts';
const WORKOUT_CYC = /\/api\/workout\/w-cyc-0001$/;
const WORKOUT_STR = /\/api\/workout\/w-str-0002$/;
const GRAPH_CYC = '/api/workout/w-cyc-0001/performance_graph';

let storagePath;

beforeEach(() => {
  storagePath = mkdtempSync(join(tmpdir(), 'peloton-poller-'));
});

afterEach(() => {
  rmSync(storagePath, { recursive: true, force: true });
});

function workoutTrigger(overrides = {}) {
  return { id: 't-workout', type: 'workout', name: 'Workout', who: 'anyone', ...overrides };
}

function hrTrigger(overrides = {}) {
  return { id: 't-zone', type: 'hrZone', name: 'Zone 4 or higher', who: OWNER.userId, zone: 4, holdTime: 20, ...overrides };
}

/** A workouts-list body with the given id and status, based on the cycling fixture. */
function listBody(id, status, extra = {}) {
  const body = apiFixture('workout-in-progress-cycling');
  body.data[0] = { ...body.data[0], id, status, ...extra };
  return jsonResponse(200, body);
}

/** A single-workout body with the given id and status. */
function workoutBody(id, status) {
  const body = apiFixture('workout-single-in-progress-cycling');
  return jsonResponse(200, { ...body, id, status });
}

/** A performance graph whose latest heart-rate sample is bpm at the given offset. */
function graphBody(bpm, offset) {
  const body = apiFixture('performance-graph-heart-rate');
  const count = Math.max(1, Math.floor(offset / 5) + 1);
  body.seconds_since_pedaling_start = Array.from({ length: count }, (_, index) => index * 5);
  for (const metric of body.metrics) {
    metric.values = Array.from({ length: count }, () => 100);
  }
  const heartRate = body.metrics.find((metric) => metric.slug === 'heart_rate');
  heartRate.values[count - 1] = bpm;
  return jsonResponse(200, body);
}

async function harness({ config: rawConfig = {}, accounts = [OWNER, MEMBER], refresh, records = {}, reconnect } = {}) {
  const clock = createFakeClock();
  const fetch = createRoutedFetch();
  const lines = { info: [], warn: [], debug: [] };
  const log = {
    info: (line) => lines.info.push(line),
    warn: (line) => lines.warn.push(line),
    debug: (line) => lines.debug.push(line),
  };
  const refreshCalls = [];
  const store = new AccountStore({
    storagePath,
    now: clock.now,
    fetchImpl: fetch,
    refresh: async (token) => {
      refreshCalls.push(token);
      if (refresh !== undefined) {
        return refresh(token);
      }
      return { accessToken: `access-${refreshCalls.length + 1}`, refreshToken: `refresh-${refreshCalls.length + 1}`, expiresAt: clock.now() + 48 * HOUR };
    },
  });
  for (const account of accounts) {
    await store.save(account.id, {
      userId: account.userId,
      username: account.userId,
      displayName: account.displayName,
      accessToken: 'access-1',
      accessTokenExpiresAt: clock.now() + 40 * HOUR,
      refreshToken: 'refresh-1',
      state: 'connected',
      ...(records[account.id] ?? {}),
    });
  }
  const api = {
    getLatestWorkout: (userId, token) => getLatestWorkout(userId, token, fetch),
    getWorkout: (workoutId, token) => getWorkout(workoutId, token, fetch),
    getPerformanceGraph: (workoutId, everyN, token) => getPerformanceGraph(workoutId, everyN, token, fetch),
    getMe: (token) => getMe(token, fetch),
    getSubscriptions: (userId, token) => getSubscriptions(userId, token, fetch),
  };
  const config = parseConfig({ triggers: [workoutTrigger()], ...rawConfig }, { warn: log.warn });
  const poller = new Poller({ config, accounts, api, store, log, now: clock.now, scheduler: clock, reconnect });
  clock.idle = () => poller.whenIdle();
  const events = [];
  const eventNames = [
    'workoutStarted', 'workoutEnded', 'sampleReceived', 'accountStateChanged', 'switchChanged', 'switchAutoOff', 'triggerChanged', 'stateChanged',
    'checkInComplete',
  ];
  for (const name of eventNames) {
    poller.on(name, (event) => events.push({ event: name, ...event }));
  }
  const named = (name) => events.filter((entry) => entry.event === name);
  return { clock, fetch, store, poller, events, named, lines, refreshCalls, config };
}

function readRecord(store, id) {
  return JSON.parse(readFileSync(join(store.directory, `${id}.json`), 'utf8'));
}

describe('standby', () => {
  it('polls every account at standbyInterval staggered evenly and never touches the single-workout call', async () => {
    const h = await harness();
    h.fetch.route(LIST_OWNER, apiResponse('workout-complete-cycling')).route(LIST_MEMBER, apiResponse('workouts-empty'));
    h.poller.start();
    assert.equal(h.poller.state, 'standby');
    await h.clock.advance(0);
    assert.equal(h.fetch.count(LIST_OWNER), 1);
    assert.equal(h.fetch.count(LIST_MEMBER), 0);
    await h.clock.advance(59_000);
    assert.equal(h.fetch.count(LIST_MEMBER), 0);
    await h.clock.advance(1_000);
    assert.equal(h.fetch.count(LIST_MEMBER), 1);
    await h.clock.advance(60_000);
    assert.equal(h.fetch.count(LIST_OWNER), 2);
    await h.clock.advance(240_000);
    assert.equal(h.fetch.count(LIST_OWNER), 4);
    assert.equal(h.fetch.count(LIST_MEMBER), 3);
    assert.equal(h.fetch.count('/api/workout/'), 0);
    assert.deepEqual(h.named('workoutStarted'), []);
    assert.deepEqual(h.lines.info, []);
    assert.match(h.lines.debug[0], /^Owner: poll workout w-cyc-0001 COMPLETE cycling device_type=home_bike_plus platform=home_bike$/);
  });

  it('never polls when standbyInterval is 0 and the switch is off', async () => {
    const h = await harness({ config: { polling: { standbyInterval: 0 } } });
    h.fetch.route('/api/', apiResponse('workout-in-progress-cycling'));
    h.poller.start();
    await h.clock.advance(HOUR);
    assert.equal(h.fetch.requests.length, 0);
    assert.equal(h.poller.state, 'standby');
  });

  it('counts a workout already in progress at startup as started on the first poll', async () => {
    const h = await harness({ accounts: [OWNER] });
    h.fetch.route(LIST_OWNER, apiResponse('workout-in-progress-cycling')).route(WORKOUT_CYC, apiResponse('workout-single-in-progress-cycling'));
    h.poller.start();
    await h.clock.advance(0);
    assert.equal(h.poller.state, 'locked');
    assert.equal(h.named('workoutStarted').length, 1);
    assert.deepEqual(h.lines.info, ['Owner: workout started (cycling, 30 min Power Zone Ride)', 'Workout: on']);
  });
});

describe('scanning', () => {
  it('polls all accounts at once when the switch turns on, then at fastInterval staggered', async () => {
    const h = await harness();
    h.fetch.route('/workouts', apiResponse('workouts-empty'));
    h.poller.start();
    await h.clock.advance(0);
    assert.equal(h.fetch.requests.length, 1);
    h.poller.setSwitch(true);
    assert.equal(h.poller.state, 'scanning');
    await h.clock.advance(0);
    assert.equal(h.fetch.count(LIST_OWNER), 2);
    assert.equal(h.fetch.count(LIST_MEMBER), 1);
    assert.deepEqual(h.lines.info, ['Fast polling switch on: scanning 2 accounts every 10s']);
    assert.deepEqual(h.named('switchChanged'), [{ event: 'switchChanged', on: true, reason: 'user' }]);
    await h.clock.advance(5_000);
    assert.equal(h.fetch.count(LIST_OWNER), 3);
    assert.equal(h.fetch.count(LIST_MEMBER), 1);
    await h.clock.advance(5_000);
    assert.equal(h.fetch.count(LIST_MEMBER), 2);
    await h.clock.advance(10_000);
    assert.equal(h.fetch.count(LIST_OWNER), 4);
    assert.equal(h.fetch.count(LIST_MEMBER), 3);
  });

  it('returns to standby with an immediate cycle when the switch turns off', async () => {
    const h = await harness({ accounts: [OWNER] });
    h.fetch.route('/workouts', apiResponse('workouts-empty'));
    h.poller.start();
    h.poller.setSwitch(true);
    await h.clock.advance(20_000);
    const before = h.fetch.count(LIST_OWNER);
    h.poller.setSwitch(false);
    assert.equal(h.poller.state, 'standby');
    await h.clock.advance(0);
    assert.equal(h.fetch.count(LIST_OWNER), before + 1);
    await h.clock.advance(119_000);
    assert.equal(h.fetch.count(LIST_OWNER), before + 1);
    await h.clock.advance(1_000);
    assert.equal(h.fetch.count(LIST_OWNER), before + 2);
    assert.equal(h.lines.info.at(-1), 'Fast polling switch off');
  });

  it('ignores the switch when it is disabled in config', async () => {
    const h = await harness({ config: { polling: { fastSwitch: false } } });
    h.fetch.route('/workouts', apiResponse('workouts-empty'));
    h.poller.start();
    h.poller.setSwitch(true);
    assert.equal(h.poller.switchOn, false);
    assert.equal(h.poller.state, 'standby');
    assert.deepEqual(h.named('switchChanged'), []);
  });
});

describe('lock-on', () => {
  it('locks on the first IN_PROGRESS workout, stops polling other accounts, and follows it by id', async () => {
    const h = await harness();
    h.fetch.route(LIST_OWNER, apiResponse('workouts-empty'))
      .route(LIST_MEMBER, apiResponse('workout-in-progress-strength'))
      .route(WORKOUT_STR, jsonResponse(200, { ...apiFixture('workout-in-progress-strength').data[0] }));
    h.poller.start();
    h.poller.setSwitch(true);
    await h.clock.advance(0);
    assert.equal(h.poller.state, 'locked');
    assert.deepEqual(h.named('workoutStarted').map((event) => [event.accountId, event.workout.id]), [['a2', 'w-str-0002']]);
    const listsBefore = h.fetch.count('/workouts');
    await h.clock.advance(30_000);
    assert.equal(h.fetch.count('/workouts'), listsBefore);
    assert.equal(h.fetch.count(WORKOUT_STR), 3);
    assert.equal(h.fetch.count(GRAPH_CYC), 0);
    assert.deepEqual(h.named('triggerChanged'), [{ event: 'triggerChanged', triggerId: 't-workout', name: 'Workout', on: true }]);
  });

  it('never starts on a third-party import and keeps following a locked workout while an import tops the list', async () => {
    const h = await harness({ accounts: [OWNER] });
    h.fetch.route(LIST_OWNER, apiResponse('workout-3p-fit-feed-running'));
    h.poller.start();
    h.poller.setSwitch(true);
    await h.clock.advance(30_000);
    assert.equal(h.poller.state, 'scanning');
    assert.deepEqual(h.named('workoutStarted'), []);
    assert.match(h.lines.debug[0], /third-party import$/);

    h.fetch.route(LIST_OWNER, apiResponse('workout-in-progress-cycling')).route(WORKOUT_CYC, apiResponse('workout-single-in-progress-cycling'));
    await h.clock.advance(10_000);
    assert.equal(h.poller.state, 'locked');
    h.fetch.route(LIST_OWNER, apiResponse('workout-3p-fit-feed-running'));
    const lists = h.fetch.count(LIST_OWNER);
    await h.clock.advance(60_000);
    assert.equal(h.poller.state, 'locked');
    assert.equal(h.fetch.count(LIST_OWNER), lists);
    assert.deepEqual(h.named('workoutEnded'), []);
  });

  it('applies who, activities, and device filters at lock-on, matching the device by the workout platform', async () => {
    const triggers = [
      workoutTrigger({ id: 't-any' }),
      workoutTrigger({ id: 't-member', who: MEMBER.userId }),
      workoutTrigger({ id: 't-run', activities: ['running'] }),
      workoutTrigger({ id: 't-bike', device: 'bike' }),
      workoutTrigger({ id: 't-tread', device: 'tread' }),
    ];
    // A Bike+ ride: device_type home_bike_plus, platform home_bike.
    const bike = await harness({ accounts: [OWNER], config: { triggers } });
    bike.fetch.route(LIST_OWNER, apiResponse('workout-in-progress-cycling')).route(WORKOUT_CYC, apiResponse('workout-single-in-progress-cycling'));
    bike.poller.start();
    await bike.clock.advance(0);
    assert.deepEqual([...bike.poller.triggerStates], [['t-any', true], ['t-member', false], ['t-run', false], ['t-bike', true], ['t-tread', false]]);
    assert.match(bike.lines.debug[0], /device_type=home_bike_plus platform=home_bike$/);
    bike.poller.stop();

    // A Tread run: device_type prism, platform home_tread.
    const tread = await harness({ accounts: [OWNER], config: { triggers } });
    tread.fetch.route(LIST_OWNER, listBody('w-str-0002', 'IN_PROGRESS', { fitness_discipline: 'running', device_type: 'prism', platform: 'home_tread' }))
      .route(WORKOUT_STR, workoutBody('w-str-0002', 'IN_PROGRESS'));
    tread.poller.start();
    await tread.clock.advance(0);
    assert.deepEqual([...tread.poller.triggerStates], [['t-any', true], ['t-member', false], ['t-run', true], ['t-bike', false], ['t-tread', true]]);
    assert.match(tread.lines.debug[0], /device_type=prism platform=home_tread$/);
    tread.poller.stop();

    // An app workout matches neither hardware filter; nothing about devices is logged at info.
    const app = await harness({ accounts: [OWNER], config: { triggers } });
    app.fetch.route(LIST_OWNER, listBody('w-str-0002', 'IN_PROGRESS', { fitness_discipline: 'strength', device_type: 'iOS', platform: 'ios' }))
      .route(WORKOUT_STR, workoutBody('w-str-0002', 'IN_PROGRESS'));
    app.poller.start();
    await app.clock.advance(0);
    assert.deepEqual([...app.poller.triggerStates], [['t-any', true], ['t-member', false], ['t-run', false], ['t-bike', false], ['t-tread', false]]);
    assert.equal(app.lines.info.some((line) => line.includes('device')), false);
  });
});

describe('workout end', () => {
  async function lockedOnCycling(options = {}) {
    const h = await harness({ accounts: [OWNER], ...options });
    h.fetch.route(LIST_OWNER, apiResponse('workout-in-progress-cycling')).route(WORKOUT_CYC, apiResponse('workout-single-in-progress-cycling'));
    h.poller.start();
    h.poller.setSwitch(true);
    await h.clock.advance(0);
    assert.equal(h.poller.state, 'locked');
    return h;
  }

  it('ends on COMPLETE from the single-workout call, holds the sensor for holdAfterEnd, then scans', async () => {
    const h = await lockedOnCycling();
    h.fetch.route(WORKOUT_CYC, apiResponse('workout-single-complete-cycling')).route(LIST_OWNER, apiResponse('workout-complete-cycling'));
    await h.clock.advance(10_000);
    assert.equal(h.poller.state, 'released');
    assert.equal(h.named('workoutEnded').length, 1);
    assert.equal(h.poller.triggerStates.get('t-workout'), true);
    await h.clock.advance(89_000);
    assert.equal(h.poller.triggerStates.get('t-workout'), true);
    assert.equal(h.poller.state, 'released');
    await h.clock.advance(1_000);
    assert.equal(h.poller.triggerStates.get('t-workout'), false);
    assert.equal(h.poller.state, 'scanning');
    assert.deepEqual(h.lines.info.slice(-2), ['Owner: workout ended', 'Workout: off']);
    assert.equal(h.fetch.count(WORKOUT_CYC), 1);
  });

  it('keeps the sensor on without a gap through stacked classes', async () => {
    const h = await lockedOnCycling();
    h.fetch.route(WORKOUT_CYC, apiResponse('workout-single-complete-cycling')).route(LIST_OWNER, apiResponse('workout-complete-cycling'));
    await h.clock.advance(10_000);
    assert.equal(h.poller.state, 'released');
    h.fetch.route(LIST_OWNER, listBody('w-cyc-0009', 'IN_PROGRESS')).route(/\/api\/workout\/w-cyc-0009$/, workoutBody('w-cyc-0009', 'IN_PROGRESS'));
    await h.clock.advance(10_000);
    assert.equal(h.poller.state, 'locked');
    assert.deepEqual(h.named('workoutStarted').map((event) => event.workout.id), ['w-cyc-0001', 'w-cyc-0009']);
    assert.deepEqual(h.named('triggerChanged').map((event) => event.on), [true]);
    h.fetch.route(/\/api\/workout\/w-cyc-0009$/, workoutBody('w-cyc-0009', 'COMPLETE')).route(LIST_OWNER, listBody('w-cyc-0009', 'COMPLETE'));
    await h.clock.advance(10_000);
    assert.equal(h.named('workoutEnded').length, 2);
    await h.clock.advance(90_000);
    assert.deepEqual(h.named('triggerChanged').map((event) => event.on), [true, false]);
    assert.equal(h.poller.state, 'scanning');
  });

  it('stays locked when the switch turns off and goes to standby after the hold', async () => {
    const h = await lockedOnCycling();
    h.poller.setSwitch(false);
    assert.equal(h.poller.state, 'locked');
    await h.clock.advance(0);
    assert.equal(h.fetch.count(WORKOUT_CYC), 1);
    await h.clock.advance(30_000);
    assert.equal(h.poller.state, 'locked');
    h.fetch.route(WORKOUT_CYC, apiResponse('workout-single-complete-cycling')).route(LIST_OWNER, apiResponse('workout-complete-cycling'));
    await h.clock.advance(10_000);
    assert.equal(h.poller.state, 'released');
    await h.clock.advance(90_000);
    assert.equal(h.poller.state, 'standby');
    assert.deepEqual(h.named('stateChanged').map((event) => event.state), ['scanning', 'locked', 'released', 'standby']);
  });

  it('turns off at once with holdAfterEnd 0 and leaves released immediately', async () => {
    const h = await lockedOnCycling({ config: { triggers: [workoutTrigger({ holdAfterEnd: 0 })] } });
    h.fetch.route(WORKOUT_CYC, apiResponse('workout-single-complete-cycling')).route(LIST_OWNER, apiResponse('workout-complete-cycling'));
    await h.clock.advance(10_000);
    assert.equal(h.poller.triggerStates.get('t-workout'), false);
    assert.equal(h.poller.state, 'scanning');
  });
});

describe('heart-rate zones', () => {
  async function lockedWithZones(config = {}) {
    const h = await harness({ accounts: [OWNER], config: { triggers: [workoutTrigger(), hrTrigger()], ...config } });
    h.fetch.route(LIST_OWNER, apiResponse('workout-in-progress-cycling')).route(WORKOUT_CYC, apiResponse('workout-single-in-progress-cycling'));
    return h;
  }

  it('polls the performance graph only while locked on an account with a zone trigger', async () => {
    const h = await lockedWithZones();
    h.fetch.route(GRAPH_CYC, graphBody(100, 0));
    h.poller.start();
    await h.clock.advance(0);
    assert.equal(h.fetch.count(GRAPH_CYC), 0);
    await h.clock.advance(10_000);
    assert.equal(h.fetch.count(GRAPH_CYC), 1);
    assert.equal(h.fetch.calls(GRAPH_CYC)[0].url.endsWith('?every_n=5'), true);
    assert.deepEqual(h.named('sampleReceived'), [{ event: 'sampleReceived', accountId: 'a1', workoutId: 'w-cyc-0001', bpm: 100, zone: 1, fresh: true }]);
  });

  it('turns on after the zone condition has held for holdTime and off after it has been false for holdTime', async () => {
    const h = await lockedWithZones();
    let offset = 0;
    let bpm = 100;
    h.fetch.route(GRAPH_CYC, () => {
      offset += 10;
      return graphBody(bpm, offset);
    });
    h.poller.start();
    await h.clock.advance(0);
    bpm = 150;
    await h.clock.advance(10_000);
    assert.equal(h.poller.triggerStates.get('t-zone'), false);
    await h.clock.advance(19_000);
    assert.equal(h.poller.triggerStates.get('t-zone'), false);
    await h.clock.advance(1_000);
    assert.equal(h.poller.triggerStates.get('t-zone'), true);
    assert.equal(h.lines.info.at(-1), 'Zone 4 or higher: on');
    bpm = 120;
    await h.clock.advance(10_000);
    assert.equal(h.poller.triggerStates.get('t-zone'), true);
    await h.clock.advance(19_000);
    assert.equal(h.poller.triggerStates.get('t-zone'), true);
    await h.clock.advance(1_000);
    assert.equal(h.poller.triggerStates.get('t-zone'), false);
    assert.equal(h.lines.info.at(-1), 'Zone 4 or higher: off');
    assert.match(h.lines.debug.find((line) => line.includes('heart rate 150')), /^Owner: heart rate 150 zone 4$/);
  });

  it('treats the condition as false when no new sample arrives within two polls', async () => {
    const h = await lockedWithZones();
    h.fetch.route(GRAPH_CYC, graphBody(150, 10));
    h.poller.start();
    await h.clock.advance(20_000);
    assert.deepEqual(h.named('sampleReceived').map((event) => event.fresh), [true, true]);
    assert.equal(h.poller.triggerStates.get('t-zone'), false);
    await h.clock.advance(10_000);
    // The hold elapsed at 30 s, just as the second poll without a new sample marked the condition false.
    assert.deepEqual(h.named('sampleReceived').map((event) => event.fresh), [true, true, false]);
    assert.equal(h.poller.triggerStates.get('t-zone'), true);
    await h.clock.advance(19_000);
    assert.equal(h.poller.triggerStates.get('t-zone'), true);
    await h.clock.advance(1_000);
    assert.equal(h.poller.triggerStates.get('t-zone'), false);
    assert.match(h.lines.debug.at(-1), /zone 4 \(stale\)$/);
  });

  it('turns the zone sensor off when the workout ends, whatever the hold', async () => {
    const h = await lockedWithZones();
    let offset = 0;
    h.fetch.route(GRAPH_CYC, () => {
      offset += 10;
      return graphBody(160, offset);
    });
    h.poller.start();
    await h.clock.advance(30_000);
    assert.equal(h.poller.triggerStates.get('t-zone'), true);
    h.fetch.route(WORKOUT_CYC, apiResponse('workout-single-complete-cycling')).route(LIST_OWNER, apiResponse('workout-complete-cycling'));
    await h.clock.advance(10_000);
    assert.equal(h.poller.triggerStates.get('t-zone'), false);
    assert.equal(h.poller.triggerStates.get('t-workout'), true);
    assert.deepEqual(h.lines.info.slice(-2), ['Owner: workout ended', 'Zone 4 or higher: off']);
  });

  it('logs once per workout and keeps the sensor off when the graph has no heart-rate metric', async () => {
    const h = await lockedWithZones();
    h.fetch.route(GRAPH_CYC, apiResponse('performance-graph-no-heart-rate'));
    h.poller.start();
    await h.clock.advance(40_000);
    assert.equal(h.poller.triggerStates.get('t-zone'), false);
    assert.equal(h.lines.info.filter((line) => line === 'Owner: no heart-rate data for this workout').length, 1);
    assert.equal(h.named('sampleReceived').at(-1).bpm, null);
  });

  it('falls back to the profile zones when the graph carries none', async () => {
    const h = await lockedWithZones();
    const stored = { hrZones: [], maxHr: 200 };
    h.poller.stop();
    const accounts = [{ ...OWNER, profile: stored }];
    const h2 = await harness({ accounts, config: { triggers: [workoutTrigger(), hrTrigger()] } });
    const body = apiFixture('performance-graph-heart-rate');
    delete body.metrics.find((metric) => metric.slug === 'heart_rate').zones;
    h2.fetch.route(LIST_OWNER, apiResponse('workout-in-progress-cycling'))
      .route(WORKOUT_CYC, apiResponse('workout-single-in-progress-cycling'))
      .route(GRAPH_CYC, jsonResponse(200, body));
    h2.poller.start();
    await h2.clock.advance(10_000);
    // 152 bpm on a 200 max is zone 3 (150 to 169), not zone 4 as the 168-max graph zones would say.
    assert.equal(h2.named('sampleReceived').at(-1).zone, 3);
    assert.equal(h.fetch.requests.length, 0);
  });
});

describe('failures', () => {
  it('refreshes once on 401 and retries with the new token', async () => {
    const h = await harness({ accounts: [OWNER] });
    h.fetch.route(LIST_OWNER, [jsonResponse(401, { error: 'unauthorized' }), apiResponse('workouts-empty')]);
    h.poller.start();
    await h.clock.advance(0);
    assert.equal(h.fetch.count(LIST_OWNER), 2);
    assert.deepEqual(h.refreshCalls, ['refresh-1']);
    assert.equal(h.fetch.calls(LIST_OWNER)[1].headers.authorization, 'Bearer access-2');
    assert.equal(readRecord(h.store, 'a1').refreshToken, 'refresh-2');
    assert.deepEqual(h.lines.warn, []);
    assert.equal(h.poller.state, 'standby');
  });

  it('marks the account reconnect_needed on invalid_grant, drops it, and raises the attention event', async () => {
    const h = await harness({
      refresh: async () => {
        throw new AuthError('refresh', 403, 'invalid_grant');
      },
    });
    h.fetch.route(LIST_OWNER, jsonResponse(401, {})).route(LIST_MEMBER, apiResponse('workouts-empty'));
    h.poller.start();
    await h.clock.advance(0);
    assert.deepEqual(h.named('accountStateChanged'), [
      { event: 'accountStateChanged', accountId: 'a1', displayName: 'Owner', state: 'reconnect_needed', stage: 'refresh', status: 403 },
    ]);
    assert.deepEqual(h.lines.info, ['Owner: sign-in expired, reconnect needed (stage refresh, HTTP 403)']);
    assert.equal(readRecord(h.store, 'a1').state, 'reconnect_needed');
    assert.equal(readRecord(h.store, 'a1').refreshToken, undefined);
    assert.deepEqual(h.poller.activeAccountIds, ['a2']);
    await h.clock.advance(10 * 60_000);
    assert.equal(h.fetch.count(LIST_OWNER), 1);
    assert.ok(h.fetch.count(LIST_MEMBER) > 1);
  });

  it('calls reconnect once after invalid_grant and resumes polling when it returns an account', async () => {
    const reconnectCalls = [];
    const h = await harness({
      accounts: [OWNER],
      refresh: async () => {
        throw new AuthError('refresh', 403, 'invalid_grant');
      },
      reconnect: async (accountId) => {
        reconnectCalls.push(accountId);
        await h.store.save('a1', {
          ...(await h.store.load('a1')),
          state: 'connected',
          accessToken: 'access-new',
          accessTokenExpiresAt: h.clock.now() + 48 * HOUR,
          refreshToken: 'refresh-new',
        });
        return OWNER;
      },
    });
    h.fetch.route(LIST_OWNER, [jsonResponse(401, {}), apiResponse('workouts-empty')]);
    h.poller.start();
    await h.clock.advance(0);
    assert.deepEqual(reconnectCalls, ['a1']);
    assert.deepEqual(h.named('accountStateChanged').map((event) => event.state), ['reconnect_needed', 'connected']);
    assert.deepEqual(h.poller.activeAccountIds, ['a1']);
    await h.clock.advance(120_000);
    assert.equal(h.fetch.calls(LIST_OWNER).at(-1).headers.authorization, 'Bearer access-new');
    assert.deepEqual(reconnectCalls, ['a1']);
  });

  it('leaves the account dropped when reconnect returns nothing, without retrying', async () => {
    const reconnectCalls = [];
    const h = await harness({
      accounts: [OWNER],
      refresh: async () => {
        throw new AuthError('refresh', 403, 'invalid_grant');
      },
      reconnect: async (accountId) => {
        reconnectCalls.push(accountId);
        return undefined;
      },
    });
    h.fetch.route(LIST_OWNER, jsonResponse(401, {}));
    h.poller.start();
    await h.clock.advance(10 * 60_000);
    assert.deepEqual(reconnectCalls, ['a1']);
    assert.deepEqual(h.named('accountStateChanged').map((event) => event.state), ['reconnect_needed']);
    assert.deepEqual(h.poller.activeAccountIds, []);
    assert.equal(h.fetch.count(LIST_OWNER), 1);
  });

  it('ends a locked workout when the locked account loses its sign-in', async () => {
    const h = await harness({
      accounts: [OWNER],
      refresh: async () => {
        throw new AuthError('refresh', 403, 'invalid_grant');
      },
    });
    h.fetch.route(LIST_OWNER, apiResponse('workout-in-progress-cycling'))
      .route(WORKOUT_CYC, [apiResponse('workout-single-in-progress-cycling'), jsonResponse(401, {})]);
    h.poller.start();
    await h.clock.advance(0);
    assert.equal(h.poller.state, 'locked');
    await h.clock.advance(20_000);
    assert.equal(h.named('workoutEnded').length, 1);
    assert.equal(h.poller.state, 'standby');
    await h.clock.advance(90_000);
    assert.equal(h.poller.triggerStates.get('t-workout'), false);
    assert.deepEqual(h.poller.activeAccountIds, []);
  });

  it('keeps the last state and backs off after three consecutive failures, then recovers', async () => {
    const h = await harness({ accounts: [OWNER] });
    h.fetch.route(LIST_OWNER, jsonResponse(503, {}));
    h.poller.start();
    h.poller.setSwitch(true);
    await h.clock.advance(0);
    assert.equal(h.fetch.count(LIST_OWNER), 1);
    await h.clock.advance(10_000);
    await h.clock.advance(10_000);
    assert.equal(h.fetch.count(LIST_OWNER), 3);
    assert.deepEqual(h.lines.warn, ['Owner: 3 consecutive poll failures (HTTP 503), backing off to 20s']);
    await h.clock.advance(10_000);
    assert.equal(h.fetch.count(LIST_OWNER), 3);
    await h.clock.advance(10_000);
    assert.equal(h.fetch.count(LIST_OWNER), 4);
    await h.clock.advance(40_000);
    assert.equal(h.fetch.count(LIST_OWNER), 5);
    await h.clock.advance(60_000);
    assert.equal(h.fetch.count(LIST_OWNER), 6);
    await h.clock.advance(60_000);
    assert.equal(h.fetch.count(LIST_OWNER), 7);
    h.fetch.route(LIST_OWNER, apiResponse('workouts-empty'));
    await h.clock.advance(60_000);
    assert.equal(h.fetch.count(LIST_OWNER), 8);
    await h.clock.advance(10_000);
    assert.equal(h.fetch.count(LIST_OWNER), 9);
    assert.equal(h.poller.state, 'scanning');
    assert.deepEqual(h.named('accountStateChanged'), []);
  });

  it('treats a network error as transient and never logs at info', async () => {
    const h = await harness({ accounts: [OWNER] });
    h.fetch.route(LIST_OWNER, [new Error('ECONNRESET'), apiResponse('workouts-empty')]);
    h.poller.start();
    await h.clock.advance(120_000);
    assert.equal(h.fetch.count(LIST_OWNER), 2);
    assert.deepEqual(h.lines.info, []);
    assert.equal(h.lines.debug.filter((line) => line.includes('poll failed (network)')).length, 1);
  });

  it('computes backoff from the third failure, doubling up to 60 s or the base interval', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((failures) => backoffInterval(10, failures)), [10, 10, 10, 20, 40, 60, 60]);
    assert.deepEqual([2, 3, 4].map((failures) => backoffInterval(120, failures)), [120, 120, 120]);
    assert.deepEqual([3, 4].map((failures) => backoffInterval(40, failures)), [60, 60]);
  });
});

describe('fast polling switch auto-off', () => {
  const MINUTE = 60_000;

  it('turns the switch off after fastSwitchAutoOffMinutes with no workout, logs it, and raises the event', async () => {
    const h = await harness({ accounts: [OWNER] });
    h.fetch.route(LIST_OWNER, apiResponse('workouts-empty'));
    h.poller.start();
    h.poller.setSwitch(true);
    assert.equal(h.poller.autoOffAt, h.clock.now() + 120 * MINUTE);
    await h.clock.advance(120 * MINUTE - 1);
    assert.equal(h.poller.switchOn, true);
    await h.clock.advance(1);
    assert.equal(h.poller.switchOn, false);
    assert.equal(h.poller.state, 'standby');
    assert.equal(h.poller.autoOffAt, undefined);
    assert.deepEqual(h.named('switchAutoOff'), [{ event: 'switchAutoOff', minutes: 120 }]);
    assert.deepEqual(h.named('switchChanged').map((event) => [event.on, event.reason]), [[true, 'user'], [false, 'auto']]);
    assert.equal(h.lines.info.at(-1), 'Fast polling switch turned off automatically after 120 minutes');
    // Back in standby: the immediate cycle ran, then the standby interval applies.
    const scans = h.fetch.count(LIST_OWNER);
    await h.clock.advance(119_000);
    assert.equal(h.fetch.count(LIST_OWNER), scans);
    await h.clock.advance(1_000);
    assert.equal(h.fetch.count(LIST_OWNER), scans + 1);
  });

  it('anchors the timer to the later of switch-on and the last workout end', async () => {
    const h = await harness({ accounts: [OWNER], config: { advanced: { fastSwitchAutoOffMinutes: 30 } } });
    h.fetch.route(LIST_OWNER, apiResponse('workouts-empty'));
    h.poller.start();
    h.poller.setSwitch(true);
    const switchOnAt = h.clock.now();
    await h.clock.advance(10 * MINUTE);
    h.fetch.route(LIST_OWNER, apiResponse('workout-in-progress-cycling')).route(WORKOUT_CYC, apiResponse('workout-single-in-progress-cycling'));
    await h.clock.advance(10_000);
    assert.equal(h.poller.state, 'locked');
    await h.clock.advance(15 * MINUTE);
    h.fetch.route(WORKOUT_CYC, apiResponse('workout-single-complete-cycling')).route(LIST_OWNER, apiResponse('workout-complete-cycling'));
    await h.clock.advance(10_000);
    assert.equal(h.named('workoutEnded').length, 1);
    const endedAt = h.clock.now();
    assert.equal(h.poller.autoOffAt, endedAt + 30 * MINUTE);
    await h.clock.advance(switchOnAt + 30 * MINUTE - h.clock.now());
    assert.equal(h.poller.switchOn, true, 'the original 30 minutes from switch-on must not turn it off');
    await h.clock.advance(endedAt + 30 * MINUTE - h.clock.now() - 1);
    assert.equal(h.poller.switchOn, true);
    await h.clock.advance(1);
    assert.equal(h.poller.switchOn, false);
    assert.equal(h.poller.state, 'standby');
  });

  it('counts from switch-on when the last workout ended earlier', async () => {
    const h = await harness({ accounts: [OWNER], config: { advanced: { fastSwitchAutoOffMinutes: 30 } } });
    h.fetch.route(LIST_OWNER, apiResponse('workout-in-progress-cycling')).route(WORKOUT_CYC, apiResponse('workout-single-in-progress-cycling'));
    h.poller.start();
    await h.clock.advance(0);
    h.fetch.route(WORKOUT_CYC, apiResponse('workout-single-complete-cycling')).route(LIST_OWNER, apiResponse('workout-complete-cycling'));
    await h.clock.advance(10_000);
    assert.equal(h.named('workoutEnded').length, 1);
    await h.clock.advance(10 * MINUTE);
    h.poller.setSwitch(true);
    assert.equal(h.poller.autoOffAt, h.clock.now() + 30 * MINUTE);
  });

  it('keeps following a locked workout when the timer fires, then goes to standby after the end', async () => {
    const h = await harness({ accounts: [OWNER], config: { advanced: { fastSwitchAutoOffMinutes: 1 } } });
    h.fetch.route(LIST_OWNER, apiResponse('workout-in-progress-cycling')).route(WORKOUT_CYC, apiResponse('workout-single-in-progress-cycling'));
    h.poller.start();
    h.poller.setSwitch(true);
    await h.clock.advance(0);
    assert.equal(h.poller.state, 'locked');
    await h.clock.advance(MINUTE);
    assert.equal(h.poller.switchOn, false);
    assert.equal(h.poller.state, 'locked');
    h.fetch.route(WORKOUT_CYC, apiResponse('workout-single-complete-cycling')).route(LIST_OWNER, apiResponse('workout-complete-cycling'));
    await h.clock.advance(10_000);
    await h.clock.advance(90_000);
    assert.equal(h.poller.state, 'standby');
  });

  it('cancels the timer when the switch is turned off by hand or the poller stops', async () => {
    const h = await harness({ accounts: [OWNER] });
    h.fetch.route(LIST_OWNER, apiResponse('workouts-empty'));
    h.poller.start();
    h.poller.setSwitch(true);
    h.poller.setSwitch(false);
    await h.clock.advance(121 * MINUTE);
    assert.deepEqual(h.named('switchAutoOff'), []);
    h.poller.setSwitch(true);
    h.poller.stop();
    assert.deepEqual(h.clock.pending(), []);
  });
});

describe('daily check-in', () => {
  function expectedCheckIn(now, time = '03:00') {
    const [hours, minutes] = time.split(':').map(Number);
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next.getTime() <= now) {
      next.setDate(next.getDate() + 1);
      next.setHours(hours, minutes, 0, 0);
    }
    return next.getTime();
  }

  it('computes the next local occurrence strictly after now', () => {
    const now = Date.UTC(2026, 8, 11, 12, 0, 0);
    assert.equal(nextLocalTime(now, '03:00'), expectedCheckIn(now, '03:00'));
    assert.ok(nextLocalTime(now, '03:00') > now);
    assert.ok(nextLocalTime(now, '03:00') - now <= 24 * HOUR);
    const at = nextLocalTime(now, '23:30');
    assert.equal(nextLocalTime(at, '23:30') - at, 24 * HOUR);
    assert.equal(nextLocalTime(now, 'nonsense'), expectedCheckIn(now, '03:00'));
  });

  it('runs at dailyCheckIn even with standby 0, refreshing tokens and updating zones, household, and devices', async () => {
    const h = await harness({ config: { polling: { standbyInterval: 0 }, triggers: [workoutTrigger({ device: 'bike' })] } });
    h.fetch.route('/api/me', [apiResponse('me-owner'), apiResponse('me-member')]).route('/subscriptions', apiResponse('subscriptions'));
    h.poller.start();
    const due = expectedCheckIn(h.clock.now());
    await h.clock.advance(due - h.clock.now() - 1);
    assert.equal(h.fetch.requests.length, 0);
    await h.clock.advance(1);
    assert.deepEqual(h.fetch.requests.map((request) => request.url.replace('https://api.onepeloton.com', '')), [
      '/api/me',
      '/api/user/u-owner-0001/subscriptions',
      '/api/me',
      '/api/user/u-member-0003/subscriptions',
    ]);
    assert.deepEqual(h.refreshCalls, ['refresh-1', 'refresh-1']);
    assert.equal(h.fetch.calls('/api/me')[0].headers.authorization, 'Bearer access-2');
    assert.deepEqual(h.lines.info, ['Daily check-in complete for 2 accounts']);
    assert.deepEqual(h.named('checkInComplete'), [{ event: 'checkInComplete', count: 2 }]);

    const owner = readRecord(h.store, 'a1');
    assert.equal(owner.isOwner, true);
    assert.equal(owner.maxHr, 168);
    assert.equal(owner.hrZones.length, 5);
    assert.deepEqual(owner.hrZones[3], { zone: 4, min: 143, max: 159 });
    assert.deepEqual(owner.devices, [{ id: 'dev-bike-0001', name: 'Bike+', deviceType: 'home_bike_plus' }]);
    assert.equal(owner.username, 'owner_rider');
    assert.equal(owner.displayName, 'Owner');
    assert.equal(owner.imageUrl, 'https://cdn.example.invalid/avatars/u-owner-0001.jpg');
    assert.equal(owner.lastCheckedAt, h.clock.now());
    assert.equal(owner.refreshToken, 'refresh-2');
    const member = readRecord(h.store, 'a2');
    assert.equal(member.isOwner, false);
    assert.equal(member.devices, undefined);
    assert.equal(member.maxHr, 190);
    assert.deepEqual(member.hrZones, []);
    const household = await h.store.loadAll();
    assert.deepEqual([...household.keys()].sort(), ['a1', 'a2', 'u-member-0002']);
    assert.deepEqual(household.get('u-member-0002'), {
      userId: 'u-member-0002',
      username: 'member_runner',
      displayName: 'Member Example',
      imageUrl: 'https://cdn.example.invalid/avatars/default.png',
      isProfileImageDefault: true,
      state: 'not_connected',
    });

    // The next check-in is a day later, and polling resumes on the switch with the bike trigger matching by platform.
    assert.equal(h.clock.pending().at(-1).at, due + 24 * HOUR);
    h.poller.setSwitch(true);
    h.fetch.route(LIST_OWNER, apiResponse('workout-in-progress-cycling')).route(LIST_MEMBER, apiResponse('workouts-empty'))
      .route(WORKOUT_CYC, apiResponse('workout-single-in-progress-cycling'));
    await h.clock.advance(0);
    assert.equal(h.poller.state, 'locked');
    assert.equal(h.poller.triggerStates.get('t-workout'), true);
  });

  it('skips an account whose check-in fails and drops one whose refresh returns invalid_grant', async () => {
    const h = await harness({
      config: { polling: { standbyInterval: 0 } },
      refresh: async (token) => {
        if (token === 'refresh-1') {
          return { accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: Date.now() + 48 * HOUR };
        }
        throw new AuthError('refresh', 403, 'invalid_grant');
      },
      records: { a2: { refreshToken: 'refresh-dead' } },
    });
    h.fetch.route('/api/me', jsonResponse(503, {}));
    h.poller.start();
    await h.poller.checkInNow();
    assert.deepEqual(h.lines.info, [
      'Lifter: sign-in expired, reconnect needed (stage refresh, HTTP 403)',
      'Daily check-in complete for 0 accounts',
    ]);
    assert.deepEqual(h.poller.activeAccountIds, ['a1']);
    assert.equal(readRecord(h.store, 'a1').state, 'connected');
    assert.equal(readRecord(h.store, 'a2').state, 'reconnect_needed');
    assert.equal(h.lines.debug.filter((line) => line === 'Owner: daily check-in failed (HTTP 503)').length, 1);
  });

  it('brings a stale household profile up to date and re-stores the owner devices at check-in', async () => {
    const h = await harness({ config: { polling: { standbyInterval: 0 } }, accounts: [OWNER] });
    await h.store.save('u-member-0002', {
      userId: 'u-member-0002', username: 'member_runner', displayName: 'member_runner', imageUrl: 'https://cdn.example.invalid/avatars/old.png',
      isProfileImageDefault: false, state: 'not_connected',
    });
    h.fetch.route('/api/me', apiResponse('me-owner')).route('/subscriptions', apiResponse('subscriptions'));
    h.poller.start();
    await h.poller.checkInNow();
    const profile = await h.store.load('u-member-0002');
    assert.equal(profile.displayName, 'Member Example');
    assert.equal(profile.imageUrl, 'https://cdn.example.invalid/avatars/default.png');
    assert.equal(profile.isProfileImageDefault, true);
    assert.equal(profile.state, 'not_connected');
    assert.deepEqual(readRecord(h.store, 'a1').devices, [{ id: 'dev-bike-0001', name: 'Bike+', deviceType: 'home_bike_plus' }]);
    assert.equal(readRecord(h.store, 'a1').lastCheckedAt, h.clock.now());
  });

  it('uses the profile zones learned at check-in for later heart-rate samples', async () => {
    const h = await harness({ accounts: [MEMBER], config: { triggers: [workoutTrigger(), hrTrigger({ who: MEMBER.userId })] } });
    h.fetch.route('/api/me', apiResponse('me-member')).route('/subscriptions', apiResponse('subscriptions'));
    h.poller.start();
    await h.poller.checkInNow();
    const body = apiFixture('performance-graph-heart-rate');
    delete body.metrics.find((metric) => metric.slug === 'heart_rate').zones;
    h.fetch.route(LIST_MEMBER, apiResponse('workout-in-progress-cycling'))
      .route(WORKOUT_CYC, apiResponse('workout-single-in-progress-cycling'))
      .route(GRAPH_CYC, jsonResponse(200, body));
    await h.clock.advance(120_000);
    await h.clock.advance(10_000);
    // 152 bpm on the member's 190 max: zone 4 starts at 161, so this is zone 3.
    assert.equal(h.named('sampleReceived').at(-1).zone, 3);
  });
});

describe('stop', () => {
  it('cancels every timer', async () => {
    const h = await harness();
    h.fetch.route('/workouts', apiResponse('workouts-empty'));
    h.poller.start();
    await h.clock.advance(0);
    h.poller.stop();
    assert.deepEqual(h.clock.pending(), []);
    await h.clock.advance(HOUR);
    assert.equal(h.fetch.requests.length, 1);
  });
});
