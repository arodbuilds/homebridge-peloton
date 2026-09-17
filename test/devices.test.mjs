import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEVICE_NAMES, deviceDisplayName, isKnownDevice } from '../dist/devices.js';

describe('device names', () => {
  it('maps every observed device_type to its display name (SPEC section 4.2)', () => {
    assert.deepEqual(DEVICE_NAMES, {
      home_bike_v1: 'Bike',
      home_bike_plus: 'Bike+',
      prism: 'Tread',
      t21n8m2: 'Guide',
      apple_tv: 'Apple TV',
      iPhone: 'iPhone',
      iPad: 'iPad',
      apple_health: 'Apple Health import',
    });
    assert.equal(deviceDisplayName('home_bike_plus'), 'Bike+');
    assert.equal(deviceDisplayName('t21n8m2'), 'Guide');
    assert.equal(deviceDisplayName('apple_health'), 'Apple Health import');
    assert.equal(isKnownDevice('prism'), true);
  });

  it('shows an unmapped code as the raw code and counts it as unknown', () => {
    assert.equal(deviceDisplayName('row_v1'), 'row_v1');
    assert.equal(deviceDisplayName('android'), 'android');
    assert.equal(deviceDisplayName(''), '');
    assert.equal(isKnownDevice('row_v1'), false);
    assert.equal(isKnownDevice('toString'), false, 'inherited object keys are not device codes');
    assert.equal(deviceDisplayName('constructor'), 'constructor');
  });
});
