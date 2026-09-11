import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getLatestWorkout, getPerformanceGraph } from '../dist/api/peloton-api.js';
import {
  EMPTY_DEVICE_MAP,
  HoldAfterEnd,
  HoldState,
  defaultZones,
  deviceMatches,
  hrZoneTargets,
  isDetectable,
  matchWorkout,
  workoutMatches,
  zoneBounds,
  zoneForSample,
} from '../dist/poller/rules.js';
import { createFakeFetch } from './helpers/fake-fetch.mjs';
import { apiResponse } from './helpers/fixtures.mjs';

const OWNER = 'u-owner-0001';
const MEMBER = 'u-member-0003';

async function workoutFixture(name) {
  return getLatestWorkout(OWNER, 'redacted', createFakeFetch([apiResponse(name)]));
}

async function graphFixture(name) {
  return getPerformanceGraph('w-cyc-0001', 5, 'redacted', createFakeFetch([apiResponse(name)]));
}

function trigger(overrides = {}) {
  return { id: 't1', type: 'workout', name: 'Workout', accessory: 'occupancy', who: 'anyone', activities: [], device: 'any', holdAfterEnd: 90, ...overrides };
}

const BIKE_MAP = new Map([['home_bike_plus', 'dev-bike-0001']]);

describe('isDetectable', () => {
  it('accepts IN_PROGRESS and COMPLETE Peloton workouts', async () => {
    assert.equal(isDetectable(await workoutFixture('workout-in-progress-cycling')), true);
    assert.equal(isDetectable(await workoutFixture('workout-complete-cycling')), true);
    assert.equal(isDetectable(await workoutFixture('workout-in-progress-strength')), true);
  });

  it('rejects third-party imports, unknown statuses, and no workout at all', async () => {
    assert.equal(isDetectable(await workoutFixture('workout-3p-fit-feed-running')), false);
    const cycling = await workoutFixture('workout-in-progress-cycling');
    assert.equal(isDetectable({ ...cycling, status: 'PAUSED' }), false);
    assert.equal(isDetectable({ ...cycling, status: '' }), false);
    assert.equal(isDetectable(await workoutFixture('workouts-empty')), false);
    assert.equal(isDetectable(undefined), false);
  });
});

describe('workoutMatches', () => {
  it('matches anyone with all activities and any device', async () => {
    const cycling = await workoutFixture('workout-in-progress-cycling');
    assert.equal(workoutMatches(trigger(), cycling, OWNER, EMPTY_DEVICE_MAP), true);
    assert.equal(workoutMatches(trigger(), cycling, MEMBER, EMPTY_DEVICE_MAP), true);
  });

  it('matches who only for that account userId', async () => {
    const cycling = await workoutFixture('workout-in-progress-cycling');
    assert.equal(workoutMatches(trigger({ who: OWNER }), cycling, OWNER, EMPTY_DEVICE_MAP), true);
    assert.equal(workoutMatches(trigger({ who: OWNER }), cycling, MEMBER, EMPTY_DEVICE_MAP), false);
  });

  it('matches activities when the list is empty or contains the discipline', async () => {
    const cycling = await workoutFixture('workout-in-progress-cycling');
    const strength = await workoutFixture('workout-in-progress-strength');
    assert.equal(workoutMatches(trigger({ activities: ['cycling', 'running'] }), cycling, OWNER, EMPTY_DEVICE_MAP), true);
    assert.equal(workoutMatches(trigger({ activities: ['cycling', 'running'] }), strength, OWNER, EMPTY_DEVICE_MAP), false);
    assert.equal(workoutMatches(trigger({ activities: [] }), strength, OWNER, EMPTY_DEVICE_MAP), true);
  });

  it('never matches an unknown discipline against a restricted list but does against all activities', async () => {
    const cycling = await workoutFixture('workout-in-progress-cycling');
    const odd = { ...cycling, fitnessDiscipline: 'caving' };
    assert.equal(workoutMatches(trigger({ activities: ['cycling'] }), odd, OWNER, EMPTY_DEVICE_MAP), false);
    assert.equal(workoutMatches(trigger(), odd, OWNER, EMPTY_DEVICE_MAP), true);
  });

  it('matches device through the device_type map', async () => {
    const cycling = await workoutFixture('workout-in-progress-cycling');
    assert.equal(deviceMatches('any', cycling, EMPTY_DEVICE_MAP), 'match');
    assert.equal(deviceMatches('dev-bike-0001', cycling, BIKE_MAP), 'match');
    assert.equal(deviceMatches('dev-tread-0002', cycling, BIKE_MAP), 'no_match');
    assert.equal(workoutMatches(trigger({ device: 'dev-bike-0001' }), cycling, OWNER, BIKE_MAP), true);
    assert.equal(workoutMatches(trigger({ device: 'dev-tread-0002' }), cycling, OWNER, BIKE_MAP), false);
  });

  it('treats the device filter as any and reports it when the map has no entry for the device_type', async () => {
    const strength = await workoutFixture('workout-in-progress-strength');
    assert.equal(deviceMatches('dev-bike-0001', strength, BIKE_MAP), 'unavailable');
    assert.deepEqual(matchWorkout(trigger({ device: 'dev-bike-0001' }), strength, OWNER, BIKE_MAP), { matches: true, deviceUnavailable: true });
    const noType = { ...strength, deviceType: '' };
    assert.equal(deviceMatches('dev-bike-0001', noType, BIKE_MAP), 'unavailable');
  });

  it('does not report the device as unavailable when who or activities already exclude the workout', async () => {
    const strength = await workoutFixture('workout-in-progress-strength');
    assert.deepEqual(matchWorkout(trigger({ who: OWNER, device: 'dev-bike-0001' }), strength, MEMBER, BIKE_MAP), {
      matches: false, deviceUnavailable: false,
    });
    assert.deepEqual(matchWorkout(trigger({ activities: ['cycling'], device: 'dev-bike-0001' }), strength, OWNER, BIKE_MAP), {
      matches: false, deviceUnavailable: false,
    });
  });

  it('targets a heart-rate zone trigger only at its account, never anyone', () => {
    assert.equal(hrZoneTargets({ who: OWNER }, OWNER), true);
    assert.equal(hrZoneTargets({ who: OWNER }, MEMBER), false);
    assert.equal(hrZoneTargets({ who: 'anyone' }, OWNER), false);
  });
});

describe('zone bounds', () => {
  it('derives the defaults from a max heart rate with lower bounds rounded down', () => {
    assert.deepEqual(defaultZones(168), [
      { zone: 1, min: 0, max: 108 },
      { zone: 2, min: 109, max: 125 },
      { zone: 3, min: 126, max: 141 },
      { zone: 4, min: 142, max: 158 },
      { zone: 5, min: 159, max: 168 },
    ]);
  });

  it('prefers the performance graph zones, then customised zones, then the max heart rate', async () => {
    const graph = await graphFixture('performance-graph-heart-rate');
    const customised = [
      { zone: 1, min: 0, max: 99 }, { zone: 2, min: 100, max: 119 }, { zone: 3, min: 120, max: 139 },
      { zone: 4, min: 140, max: 159 }, { zone: 5, min: 160, max: 200 },
    ];
    assert.deepEqual(zoneBounds(graph, { hrZones: customised, maxHr: 200 }).map((zone) => zone.min), [0, 109, 126, 142, 159]);
    const noHr = await graphFixture('performance-graph-no-heart-rate');
    assert.deepEqual(zoneBounds(noHr, { hrZones: customised, maxHr: 200 }), customised);
    assert.deepEqual(zoneBounds(noHr, { hrZones: [], maxHr: 168 }), defaultZones(168));
    assert.deepEqual(zoneBounds(null, { maxHr: 168 }), defaultZones(168));
    assert.deepEqual(zoneBounds(null, {}), []);
    assert.deepEqual(zoneBounds(undefined, { hrZones: [], maxHr: null }), []);
  });

  it('maps a sample to the highest zone whose lower bound it reaches', () => {
    const zones = defaultZones(168);
    assert.equal(zoneForSample(0, zones), 1);
    assert.equal(zoneForSample(108, zones), 1);
    assert.equal(zoneForSample(109, zones), 2);
    assert.equal(zoneForSample(141, zones), 3);
    assert.equal(zoneForSample(142, zones), 4);
    assert.equal(zoneForSample(159, zones), 5);
    assert.equal(zoneForSample(190, zones), 5);
    assert.equal(zoneForSample(null, zones), 0);
    assert.equal(zoneForSample(120, []), 0);
    assert.equal(zoneForSample(50, [{ zone: 1, min: 60, max: 100 }]), 0);
  });
});

describe('HoldState', () => {
  function clock(start = 0) {
    let now = start;
    const fn = () => now;
    fn.advance = (ms) => {
      now += ms;
    };
    return fn;
  }

  it('turns on after the condition has held for the on time and off after the off time', () => {
    const now = clock();
    const hold = new HoldState(now, 20_000, 20_000);
    assert.equal(hold.update(true), false);
    assert.equal(hold.pendingAt(), 20_000);
    now.advance(10_000);
    assert.equal(hold.update(true), false);
    now.advance(10_000);
    assert.equal(hold.update(true), true);
    assert.equal(hold.pendingAt(), undefined);
    now.advance(5_000);
    assert.equal(hold.update(false), true);
    assert.equal(hold.pendingAt(), 45_000);
    now.advance(19_999);
    assert.equal(hold.settle(), true);
    now.advance(1);
    assert.equal(hold.settle(), false);
  });

  it('cancels a pending change when the condition flips back', () => {
    const now = clock();
    const hold = new HoldState(now, 20_000, 20_000);
    hold.update(true);
    now.advance(15_000);
    assert.equal(hold.update(false), false);
    assert.equal(hold.pendingAt(), undefined);
    now.advance(15_000);
    assert.equal(hold.update(true), false);
    now.advance(20_000);
    assert.equal(hold.settle(), true);
  });

  it('uses separate hold times per direction and resets to off', () => {
    const now = clock();
    const hold = new HoldState(now, 0, 30_000);
    assert.equal(hold.update(true), true);
    assert.equal(hold.update(false), true);
    now.advance(30_000);
    assert.equal(hold.settle(), false);
    hold.update(true);
    assert.equal(hold.value, true);
    hold.reset();
    assert.equal(hold.value, false);
    assert.equal(hold.pendingAt(), undefined);
  });
});

describe('HoldAfterEnd', () => {
  it('stays on for the hold after the end and turns off when it elapses', () => {
    let now = 0;
    const hold = new HoldAfterEnd(() => now, 90_000);
    assert.equal(hold.value, false);
    assert.equal(hold.start(), true);
    assert.equal(hold.holding, false);
    now = 1_000;
    assert.equal(hold.end(), true);
    assert.equal(hold.holding, true);
    assert.equal(hold.pendingAt(), 91_000);
    now = 90_999;
    assert.equal(hold.settle(), true);
    now = 91_000;
    assert.equal(hold.settle(), false);
    assert.equal(hold.pendingAt(), undefined);
  });

  it('keeps the value on without a gap when a new workout starts during the hold', () => {
    let now = 0;
    const hold = new HoldAfterEnd(() => now, 90_000);
    hold.start();
    now = 1_000;
    hold.end();
    now = 50_000;
    assert.equal(hold.start(), true);
    assert.equal(hold.pendingAt(), undefined);
    now = 200_000;
    assert.equal(hold.settle(), true);
  });

  it('turns off at once with a zero hold and ignores end when off', () => {
    let now = 0;
    const hold = new HoldAfterEnd(() => now, 0);
    assert.equal(hold.end(), false);
    hold.start();
    assert.equal(hold.end(), false);
    hold.start();
    hold.reset();
    assert.equal(hold.value, false);
  });
});
