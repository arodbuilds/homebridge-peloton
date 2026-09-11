import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { describe, it } from 'node:test';

import * as hap from '@homebridge/hap-nodejs';

import { ATTENTION_SENSOR_NAME, AttentionSensor } from '../dist/accessories/attention-sensor.js';
import { attentionSensorUuid, fastPollingSwitchUuid, triggerUuid } from '../dist/accessories/common.js';
import { FastPollingSwitch } from '../dist/accessories/fast-polling-switch.js';
import { TriggerSensor } from '../dist/accessories/trigger-sensor.js';

const { Accessory, Characteristic, Service } = hap;
const VERSION = '1.0.0-beta.1';

function accessory(name, uuid) {
  return new Accessory(name, uuid);
}

function workoutTrigger(overrides = {}) {
  return { id: 't1', type: 'workout', name: 'Workout', accessory: 'occupancy', who: 'anyone', activities: [], device: 'any', holdAfterEnd: 90, ...overrides };
}

function information(acc) {
  const service = acc.getService(Service.AccessoryInformation);
  return {
    manufacturer: service.getCharacteristic(Characteristic.Manufacturer).value,
    model: service.getCharacteristic(Characteristic.Model).value,
    serial: service.getCharacteristic(Characteristic.SerialNumber).value,
    firmware: service.getCharacteristic(Characteristic.FirmwareRevision).value,
  };
}

describe('UUIDs', () => {
  it('derive from ids and fixed strings, never from names', () => {
    const first = triggerUuid(hap, 't1');
    assert.equal(triggerUuid(hap, 't1'), first);
    assert.notEqual(triggerUuid(hap, 't2'), first);
    assert.ok(hap.uuid.isValid(first));
    assert.notEqual(fastPollingSwitchUuid(hap), attentionSensorUuid(hap));
    assert.equal(fastPollingSwitchUuid(hap), fastPollingSwitchUuid(hap));
    assert.notEqual(fastPollingSwitchUuid(hap), first);
  });
});

describe('TriggerSensor', () => {
  it('exposes an occupancy sensor with the accessory information fields and reflects updates', () => {
    const acc = accessory('Old name', triggerUuid(hap, 't1'));
    const sensor = new TriggerSensor(hap, acc, workoutTrigger(), VERSION);
    assert.equal(acc.displayName, 'Workout');
    assert.deepEqual(information(acc), { manufacturer: 'Alex Rodriguez', model: 'Peloton trigger', serial: 't1', firmware: VERSION });
    const service = acc.getService(Service.OccupancySensor);
    assert.ok(service);
    assert.equal(acc.getService(Service.Switch), undefined);
    assert.equal(service.getCharacteristic(Characteristic.Name).value, 'Workout');
    assert.equal(service.getCharacteristic(Characteristic.OccupancyDetected).value, Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    sensor.update(true);
    assert.equal(service.getCharacteristic(Characteristic.OccupancyDetected).value, Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
    assert.equal(sensor.value, true);
    sensor.update(false);
    assert.equal(service.getCharacteristic(Characteristic.OccupancyDetected).value, Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
  });

  it('swaps the service in place when the accessory kind changes, keeping the accessory', () => {
    const acc = accessory('Workout', triggerUuid(hap, 't1'));
    new TriggerSensor(hap, acc, workoutTrigger(), VERSION);
    assert.ok(acc.getService(Service.OccupancySensor));
    new TriggerSensor(hap, acc, workoutTrigger({ accessory: 'switch', name: 'Workout switch' }), VERSION);
    assert.equal(acc.getService(Service.OccupancySensor), undefined);
    assert.ok(acc.getService(Service.Switch));
    assert.equal(acc.displayName, 'Workout switch');
    assert.equal(acc.getService(Service.Switch).getCharacteristic(Characteristic.Name).value, 'Workout switch');
    new TriggerSensor(hap, acc, workoutTrigger(), VERSION);
    assert.equal(acc.getService(Service.Switch), undefined);
    assert.ok(acc.getService(Service.OccupancySensor));
    assert.equal(acc.services.filter((service) => service.UUID !== Service.AccessoryInformation.UUID).length, 1);
  });

  it('acknowledges a Home app write to a switch trigger and resets it to the computed state', async () => {
    const acc = accessory('Workout', triggerUuid(hap, 't1'));
    const sensor = new TriggerSensor(hap, acc, workoutTrigger({ accessory: 'switch' }), VERSION);
    const on = acc.getService(Service.Switch).getCharacteristic(Characteristic.On);
    await on.handleSetRequest(true);
    assert.equal(on.value, true, 'the write is acknowledged');
    await setImmediate();
    assert.equal(on.value, false, 'then the computed state is restored');
    sensor.update(true);
    await on.handleSetRequest(false);
    await setImmediate();
    assert.equal(on.value, true);
    assert.equal(sensor.value, true);
  });
});

describe('FastPollingSwitch', () => {
  it('is a writable switch that forwards writes and reflects the poller', async () => {
    const acc = accessory('x', fastPollingSwitchUuid(hap));
    const writes = [];
    const fast = new FastPollingSwitch(hap, acc, 'Peloton fast polling', VERSION, (on) => writes.push(on));
    assert.equal(acc.displayName, 'Peloton fast polling');
    assert.deepEqual(information(acc), {
      manufacturer: 'Alex Rodriguez', model: 'Peloton fast polling switch', serial: 'fast-polling-switch', firmware: VERSION,
    });
    const on = acc.getService(Service.Switch).getCharacteristic(Characteristic.On);
    assert.equal(on.value, false);
    await on.handleSetRequest(true);
    assert.deepEqual(writes, [true]);
    fast.update(true);
    assert.equal(on.value, true);
    fast.update(false);
    assert.equal(on.value, false);
    assert.equal(fast.value, false);
  });
});

describe('AttentionSensor', () => {
  it('is on while any account needs attention', () => {
    const acc = accessory('x', attentionSensorUuid(hap));
    const sensor = new AttentionSensor(hap, acc, VERSION);
    assert.equal(acc.displayName, ATTENTION_SENSOR_NAME);
    assert.deepEqual(information(acc), {
      manufacturer: 'Alex Rodriguez', model: 'Peloton attention sensor', serial: 'attention-sensor', firmware: VERSION,
    });
    const detected = acc.getService(Service.OccupancySensor).getCharacteristic(Characteristic.OccupancyDetected);
    assert.equal(detected.value, Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    sensor.setAccountNeedsAttention('a1', true);
    sensor.setAccountNeedsAttention('a2', true);
    assert.equal(detected.value, Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
    sensor.setAccountNeedsAttention('a1', false);
    assert.equal(detected.value, Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
    sensor.setAccountNeedsAttention('a2', false);
    assert.equal(detected.value, Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    assert.equal(sensor.value, false);
  });
});
