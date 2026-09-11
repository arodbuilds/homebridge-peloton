import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getLatestWorkout, getPerformanceGraph } from '../dist/api/peloton-api.js';
import {
  HoldAfterEnd,
  HoldState,
  PLATFORM_BY_DEVICE,
  defaultZones,
  deviceMatches,
  hrZoneTargets,
  isDetectable,
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

/** A Tread run as the Pi ride test reported it: device_type prism, platform home_tread. */
function onTread(workout) {
  return { ...workout, fitnessDiscipline: 'running', deviceType: 'prism', platform: 'home_tread' };
}

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
    assert.equal(workoutMatches(trigger(), cycling, OWNER), true);
    assert.equal(workoutMatches(trigger(), cycling, MEMBER), true);
  });

  it('matches who only for that account userId', async () => {
    const cycling = await workoutFixture('workout-in-progress-cycling');
    assert.equal(workoutMatches(trigger({ who: OWNER }), cycling, OWNER), true);
    assert.equal(workoutMatches(trigger({ who: OWNER }), cycling, MEMBER), false);
  });

  it('matches activities when the list is empty or contains the discipline', async () => {
    const cycling = await workoutFixture('workout-in-progress-cycling');
    const strength = await workoutFixture('workout-in-progress-strength');
    assert.equal(workoutMatches(trigger({ activities: ['cycling', 'running'] }), cycling, OWNER), true);
    assert.equal(workoutMatches(trigger({ activities: ['cycling', 'running'] }), strength, OWNER), false);
    assert.equal(workoutMatches(trigger({ activities: [] }), strength, OWNER), true);
  });

  it('never matches an unknown discipline against a restricted list but does against all activities', async () => {
    const cycling = await workoutFixture('workout-in-progress-cycling');
    const odd = { ...cycling, fitnessDiscipline: 'caving' };
    assert.equal(workoutMatches(trigger({ activities: ['cycling'] }), odd, OWNER), false);
    assert.equal(workoutMatches(trigger(), odd, OWNER), true);
  });

  it('maps the bike filter to platform home_bike and the tread filter to home_tread', () => {
    assert.deepEqual(PLATFORM_BY_DEVICE, { bike: 'home_bike', tread: 'home_tread' });
  });

  it('matches a Bike+ ride (device_type home_bike_plus, platform home_bike) for bike and any but not tread', async () => {
    const cycling = await workoutFixture('workout-in-progress-cycling');
    assert.equal(cycling.deviceType, 'home_bike_plus');
    assert.equal(cycling.platform, 'home_bike');
    assert.equal(deviceMatches('any', cycling), true);
    assert.equal(deviceMatches('bike', cycling), true);
    assert.equal(deviceMatches('tread', cycling), false);
    assert.equal(workoutMatches(trigger({ device: 'bike' }), cycling, OWNER), true);
    assert.equal(workoutMatches(trigger({ device: 'tread' }), cycling, OWNER), false);
    assert.equal(workoutMatches(trigger({ device: 'any' }), cycling, OWNER), true);
  });

  it('matches a Tread run (device_type prism, platform home_tread) for tread and any but not bike', async () => {
    const run = onTread(await workoutFixture('workout-in-progress-cycling'));
    assert.equal(deviceMatches('tread', run), true);
    assert.equal(deviceMatches('bike', run), false);
    assert.equal(deviceMatches('any', run), true);
    assert.equal(workoutMatches(trigger({ device: 'tread' }), run, OWNER), true);
    assert.equal(workoutMatches(trigger({ device: 'tread', activities: ['running'] }), run, OWNER), true);
    assert.equal(workoutMatches(trigger({ device: 'bike' }), run, OWNER), false);
  });

  it('matches an app workout or an Apple Health import (platform iOS_app) only for any', async () => {
    const strength = await workoutFixture('workout-in-progress-strength');
    assert.equal(deviceMatches('bike', strength), false);
    assert.equal(deviceMatches('tread', strength), false);
    assert.equal(deviceMatches('any', strength), true);
    const imported = await workoutFixture('workout-3p-fit-feed-running');
    assert.equal(imported.deviceType, 'apple_health');
    assert.equal(imported.platform, 'iOS_app');
    assert.equal(deviceMatches('bike', imported), false);
    assert.equal(deviceMatches('tread', imported), false);
    assert.equal(deviceMatches('any', imported), true);
    // An unknown filter value never matches; config.ts replaces it with "any" before it gets here.
    assert.equal(deviceMatches('rower', strength), false);
  });

  it('checks who and activities before the device, so an excluded workout never matches on device alone', async () => {
    const cycling = await workoutFixture('workout-in-progress-cycling');
    assert.equal(workoutMatches(trigger({ who: OWNER, device: 'bike' }), cycling, MEMBER), false);
    assert.equal(workoutMatches(trigger({ activities: ['running'], device: 'bike' }), cycling, OWNER), false);
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
