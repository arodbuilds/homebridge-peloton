import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError, PELOTON_API_BASE, getLatestWorkout, getMe, getPerformanceGraph, getSubscriptions, getWorkout } from '../dist/api/peloton-api.js';
import { createFakeFetch } from './helpers/fake-fetch.mjs';
import { apiFixture, apiResponse, htmlResponse, jsonResponse } from './helpers/fixtures.mjs';

const TOKEN = 'redacted';

async function expectApiError(promise, status) {
  let caught;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ApiError, `expected ApiError, got ${caught}`);
  assert.equal(caught.status, status);
  return caught;
}

describe('headers', () => {
  it('sends the bearer token and Peloton-Platform: web on every call', async () => {
    const fetchImpl = createFakeFetch([
      apiResponse('me-owner'),
      apiResponse('subscriptions'),
      apiResponse('workout-in-progress-cycling'),
      apiResponse('workout-single-in-progress-cycling'),
      apiResponse('performance-graph-heart-rate'),
    ]);
    await getMe(TOKEN, fetchImpl);
    await getSubscriptions('u-owner-0001', TOKEN, fetchImpl);
    await getLatestWorkout('u-owner-0001', TOKEN, fetchImpl);
    await getWorkout('w-cyc-0001', TOKEN, fetchImpl);
    await getPerformanceGraph('w-cyc-0001', 5, TOKEN, fetchImpl);
    assert.equal(fetchImpl.requests.length, 5);
    for (const request of fetchImpl.requests) {
      assert.equal(request.method, 'GET');
      assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
      assert.equal(request.headers['peloton-platform'], 'web');
      assert.ok(request.url.startsWith(PELOTON_API_BASE));
    }
    assert.deepEqual(fetchImpl.requests.map((request) => request.url.slice(PELOTON_API_BASE.length)), [
      '/api/me',
      '/api/user/u-owner-0001/subscriptions',
      '/api/user/u-owner-0001/workouts?limit=1&sort_by=-created',
      '/api/workout/w-cyc-0001',
      '/api/workout/w-cyc-0001/performance_graph?every_n=5',
    ]);
  });
});

describe('getMe', () => {
  it('extracts the owner with customised zones and only the listed fields', async () => {
    const fetchImpl = createFakeFetch([apiResponse('me-owner')]);
    const me = await getMe(TOKEN, fetchImpl);
    assert.deepEqual(me, {
      id: 'u-owner-0001',
      username: 'owner_rider',
      firstName: 'Owner',
      lastName: 'Example',
      imageUrl: 'https://cdn.example.invalid/avatars/u-owner-0001.jpg',
      isProfileImageDefault: false,
      customizedHeartRateZones: [
        { zone: 1, slug: 'zone1', minValue: 0, maxValue: 109 },
        { zone: 2, slug: 'zone2', minValue: 110, maxValue: 125 },
        { zone: 3, slug: 'zone3', minValue: 126, maxValue: 142 },
        { zone: 4, slug: 'zone4', minValue: 143, maxValue: 159 },
        { zone: 5, slug: 'zone5', minValue: 160, maxValue: 220 },
      ],
      defaultMaxHeartRate: 175,
      customizedMaxHeartRate: 168,
      pairedDevices: [{ id: 'dev-hrm-0001', name: 'Peloton Heart Rate Band' }],
      lastWorkoutAt: 1789030000,
    });
    assert.equal('email' in me, false);
  });

  it('extracts a member with empty zones and nulls', async () => {
    const fetchImpl = createFakeFetch([apiResponse('me-member')]);
    const me = await getMe(TOKEN, fetchImpl);
    assert.equal(me.id, 'u-member-0002');
    assert.deepEqual(me.customizedHeartRateZones, []);
    assert.equal(me.customizedMaxHeartRate, null);
    assert.equal(me.defaultMaxHeartRate, 190);
    assert.equal(me.isProfileImageDefault, true);
    assert.deepEqual(me.pairedDevices, []);
    assert.equal(me.lastWorkoutAt, null);
  });
});

describe('getSubscriptions', () => {
  it('extracts both entries including the unused one', async () => {
    const fetchImpl = createFakeFetch([apiResponse('subscriptions')]);
    const subscriptions = await getSubscriptions('u-owner-0001', TOKEN, fetchImpl);
    assert.equal(subscriptions.length, 2);
    const [active, unused] = subscriptions;
    assert.equal(active.id, 'sub-0001');
    assert.equal(active.status, 'active_normal');
    assert.equal(active.ownerId, 'u-owner-0001');
    assert.equal(active.maxSharedUsers, 20);
    assert.deepEqual(active.attachedDevices, [{ id: 'dev-bike-0001', name: 'Bike+', deviceType: 'home_bike_plus' }]);
    assert.deepEqual(active.sharedUsers, [
      {
        id: 'u-member-0002', username: 'member_runner', firstName: 'Member', lastName: 'Example',
        imageUrl: 'https://cdn.example.invalid/avatars/default.png', isProfileImageDefault: true, lastWorkoutAt: null,
      },
      {
        id: 'u-member-0003', username: 'member_lifter', firstName: 'Lifter', lastName: 'Example',
        imageUrl: 'https://cdn.example.invalid/avatars/u-member-0003.jpg', isProfileImageDefault: false, lastWorkoutAt: 1788900000,
      },
    ]);
    assert.equal(unused.status, 'unused');
    assert.deepEqual(unused.sharedUsers, []);
    assert.deepEqual(unused.attachedDevices, []);
  });

  it('encodes the user id in the path', async () => {
    const fetchImpl = createFakeFetch([jsonResponse(200, { data: [] })]);
    await getSubscriptions('a/b', TOKEN, fetchImpl);
    assert.equal(fetchImpl.requests[0].url, `${PELOTON_API_BASE}/api/user/a%2Fb/subscriptions`);
  });

  it('keeps a device whose id is numeric or missing, reads numeric user ids as strings, and drops an entry with neither id nor name', async () => {
    const body = apiFixture('subscriptions');
    body.data[0].owner.id = 777;
    body.data[0].shared_user_set[0].id = 42;
    body.data[0].attached_devices = [
      { id: 12345, name: 'Blue Door+', device_type: 'home_bike_plus' },
      { name: 'Tread', device_type: 'prism' },
      { device_type: 'ghost' },
    ];
    const [active] = await getSubscriptions('777', TOKEN, createFakeFetch([jsonResponse(200, body)]));
    assert.equal(active.ownerId, '777');
    assert.equal(active.sharedUsers[0].id, '42');
    assert.deepEqual(active.attachedDevices, [
      { id: '12345', name: 'Blue Door+', deviceType: 'home_bike_plus' },
      { id: '', name: 'Tread', deviceType: 'prism' },
    ]);
  });
});

const IN_PROGRESS_CYCLING = {
  id: 'w-cyc-0001',
  status: 'IN_PROGRESS',
  fitnessDiscipline: 'cycling',
  deviceType: 'home_bike_plus',
  workoutType: 'class',
  startTime: 1789031000,
  endTime: null,
  createdAt: 1789030990,
  title: '30 min Power Zone Ride',
  name: 'Cycling Workout',
  isPelotonOriginatedWorkout: true,
  is3pFitFeedWorkout: false,
  platform: 'home_bike',
  pelotonId: 'redacted',
  ride: { id: 'redacted', title: '30 min Power Zone Ride', duration: 1800, instructorId: 'redacted-instructor' },
};

describe('getLatestWorkout', () => {
  it('extracts an in-progress cycling workout with the flags, platform, and ride', async () => {
    const fetchImpl = createFakeFetch([apiResponse('workout-in-progress-cycling')]);
    const workout = await getLatestWorkout('u-owner-0001', TOKEN, fetchImpl);
    assert.deepEqual(workout, IN_PROGRESS_CYCLING);
    assert.equal('deviceId' in workout, false, 'workouts carry no device id field; device_type is the model code');
    assert.equal('user_id' in workout, false, 'only the listed fields are returned');
  });

  it('extracts a completed cycling workout', async () => {
    const fetchImpl = createFakeFetch([apiResponse('workout-complete-cycling')]);
    const workout = await getLatestWorkout('u-owner-0001', TOKEN, fetchImpl);
    assert.equal(workout.status, 'COMPLETE');
    assert.equal(workout.endTime, 1789032800);
    assert.equal(workout.createdAt, 1789030990, 'created_at of the latest workout is the source for last workout');
  });

  it('extracts an in-progress strength workout', async () => {
    const fetchImpl = createFakeFetch([apiResponse('workout-in-progress-strength')]);
    const workout = await getLatestWorkout('u-member-0003', TOKEN, fetchImpl);
    assert.equal(workout.id, 'w-str-0002');
    assert.equal(workout.fitnessDiscipline, 'strength');
    assert.equal(workout.deviceType, 'iOS');
    assert.equal(workout.platform, 'ios');
    assert.equal(workout.title, '20 min Full Body Strength');
    assert.equal(workout.ride.instructorId, 'redacted-instructor');
  });

  it('flags a run synced from a third-party fitness feed so detection can ignore it', async () => {
    const fetchImpl = createFakeFetch([apiResponse('workout-3p-fit-feed-running')]);
    const workout = await getLatestWorkout('u-owner-0001', TOKEN, fetchImpl);
    assert.equal(workout.id, 'w-3p-0003');
    assert.equal(workout.is3pFitFeedWorkout, true);
    assert.equal(workout.isPelotonOriginatedWorkout, false);
    assert.equal(workout.platform, 'iOS_app');
    assert.equal(workout.deviceType, 'apple_health');
    assert.equal(workout.pelotonId, '');
    assert.deepEqual(workout.ride, { id: 'redacted', title: 'Outdoor Run', duration: 1800 });
    assert.equal('instructorId' in workout.ride, false, 'instructor id only when present');
  });

  it('returns null when the member has no workouts', async () => {
    const fetchImpl = createFakeFetch([apiResponse('workouts-empty')]);
    assert.equal(await getLatestWorkout('u-member-0002', TOKEN, fetchImpl), null);
  });

  it('tolerates a workout without a ride and with the flags missing', async () => {
    const fetchImpl = createFakeFetch([jsonResponse(200, { data: [{ id: 'w', status: 'IN_PROGRESS', ride: null }] })]);
    const workout = await getLatestWorkout('u', TOKEN, fetchImpl);
    assert.equal(workout.ride, null);
    assert.equal(workout.isPelotonOriginatedWorkout, false);
    assert.equal(workout.is3pFitFeedWorkout, false);
    assert.equal(workout.platform, '');
    assert.equal(workout.pelotonId, '');
  });
});

describe('getWorkout', () => {
  it('reads one workout by id with the same shape as a list entry', async () => {
    const fetchImpl = createFakeFetch([apiResponse('workout-single-in-progress-cycling')]);
    const workout = await getWorkout('w-cyc-0001', TOKEN, fetchImpl);
    assert.deepEqual(workout, IN_PROGRESS_CYCLING);
    assert.equal(fetchImpl.requests[0].url, `${PELOTON_API_BASE}/api/workout/w-cyc-0001`);
  });

  it('reads a completed workout by id', async () => {
    const fetchImpl = createFakeFetch([apiResponse('workout-single-complete-cycling')]);
    const workout = await getWorkout('w-cyc-0001', TOKEN, fetchImpl);
    assert.equal(workout.status, 'COMPLETE');
    assert.equal(workout.endTime, 1789032800);
  });

  it('encodes the workout id in the path', async () => {
    const fetchImpl = createFakeFetch([jsonResponse(200, { id: 'a/b', status: 'COMPLETE' })]);
    const workout = await getWorkout('a/b', TOKEN, fetchImpl);
    assert.equal(fetchImpl.requests[0].url, `${PELOTON_API_BASE}/api/workout/a%2Fb`);
    assert.equal(workout.id, 'a/b');
  });

  it('surfaces 404 as ApiError with the path', async () => {
    const fetchImpl = createFakeFetch([jsonResponse(404, { status: 404, message: 'Not found' })]);
    const error = await expectApiError(getWorkout('w-gone', TOKEN, fetchImpl), 404);
    assert.equal(error.path, '/api/workout/w-gone');
    assert.doesNotMatch(error.message, /Not found/);
  });
});

describe('getPerformanceGraph', () => {
  it('extracts the latest heart rate sample and zone bounds', async () => {
    const fetchImpl = createFakeFetch([apiResponse('performance-graph-heart-rate')]);
    const graph = await getPerformanceGraph('w-cyc-0001', 5, TOKEN, fetchImpl);
    assert.equal(graph.heartRate.latestSample, 152);
    assert.equal(graph.heartRate.zones.length, 5);
    assert.deepEqual(graph.heartRate.zones.map((zone) => [zone.zone, zone.slug, zone.minValue, zone.maxValue]), [
      [1, 'zone1', 0, 108],
      [2, 'zone2', 109, 125],
      [3, 'zone3', 126, 141],
      [4, 'zone4', 142, 158],
      [5, 'zone5', 159, 168],
    ], 'the bounds the build 2 probe confirmed on a 168 max');
    assert.deepEqual(graph.secondsSincePedalingStart, [0, 5, 10, 15, 20, 25, 30]);
  });

  it('returns null heart rate when the metric is absent', async () => {
    const fetchImpl = createFakeFetch([apiResponse('performance-graph-no-heart-rate')]);
    const graph = await getPerformanceGraph('w-str-0002', 5, TOKEN, fetchImpl);
    assert.equal(graph.heartRate, null);
    assert.deepEqual(graph.secondsSincePedalingStart, [0, 5, 10, 15]);
  });

  it('returns a null sample when heart_rate has no numeric values yet', async () => {
    const fetchImpl = createFakeFetch([jsonResponse(200, { metrics: [{ slug: 'heart_rate', values: [], zones: [] }] })]);
    const graph = await getPerformanceGraph('w', 5, TOKEN, fetchImpl);
    assert.deepEqual(graph.heartRate, { latestSample: null, zones: [] });
  });
});

describe('errors', () => {
  it('surfaces 401 as ApiError with status 401', async () => {
    const fetchImpl = createFakeFetch([jsonResponse(401, { status: 401, message: 'Unauthorized' })]);
    const error = await expectApiError(getMe(TOKEN, fetchImpl), 401);
    assert.doesNotMatch(error.message, /Unauthorized/, 'the body never reaches the error');
  });

  it('surfaces 5xx as ApiError with the status', async () => {
    const fetchImpl = createFakeFetch([htmlResponse(503, '<html>maintenance</html>')]);
    await expectApiError(getLatestWorkout('u', TOKEN, fetchImpl), 503);
  });

  it('surfaces 429 and 404 as ApiError too', async () => {
    const fetchImpl = createFakeFetch([jsonResponse(429, {}), jsonResponse(404, {})]);
    await expectApiError(getSubscriptions('u', TOKEN, fetchImpl), 429);
    await expectApiError(getPerformanceGraph('w', 5, TOKEN, fetchImpl), 404);
  });

  it('does not include the query string in the error path', async () => {
    const fetchImpl = createFakeFetch([jsonResponse(500, {})]);
    const error = await expectApiError(getLatestWorkout('u', TOKEN, fetchImpl), 500);
    assert.equal(error.path, '/api/user/u/workouts');
  });
});
