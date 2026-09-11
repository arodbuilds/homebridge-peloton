import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import Ajv from 'ajv';

const schemaFile = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(schemaFile.schema);

/** The SPEC section 6 example. */
const SAMPLE = {
  platform: 'Peloton',
  name: 'Peloton',
  accounts: [{ id: 'a1', email: 'owner@example.com', password: '...', userId: '8084e81d', displayName: 'Alex' }],
  triggers: [
    { id: 't1', type: 'workout', name: 'Workout', accessory: 'occupancy', who: 'anyone', activities: ['cycling', 'running'], device: 'any', holdAfterEnd: 90 },
    { id: 't2', type: 'hrZone', name: 'Zone 4 or higher', accessory: 'occupancy', who: '8084e81d', zone: 4, holdTime: 20 },
  ],
  polling: { fastSwitch: true, fastSwitchName: 'Peloton fast polling', fastInterval: 10, standbyInterval: 120, calloutDismissed: false },
  advanced: { fastSwitchAutoOffMinutes: 120, attentionSensor: false, dailyCheckIn: '03:00' },
  debug: false,
};

function withPolling(polling) {
  return { ...SAMPLE, polling: { ...SAMPLE.polling, ...polling } };
}

function withTrigger(index, changes) {
  const triggers = SAMPLE.triggers.map((trigger, i) => (i === index ? { ...trigger, ...changes } : trigger));
  return { ...SAMPLE, triggers };
}

function errors(config) {
  validate(config);
  return (validate.errors ?? []).map((error) => `${error.instancePath} ${error.keyword}`);
}

describe('config.schema.json', () => {
  it('marks the custom UI and the platform', () => {
    assert.equal(schemaFile.pluginAlias, 'Peloton');
    assert.equal(schemaFile.pluginType, 'platform');
    assert.equal(schemaFile.singular, true);
    assert.equal(schemaFile.customUi, true);
    assert.equal(schemaFile.customUiPath, './homebridge-ui');
  });

  it('accepts the SPEC section 6 sample and an empty block', () => {
    assert.equal(validate(SAMPLE), true, JSON.stringify(validate.errors));
    assert.equal(validate({ name: 'Peloton' }), true, JSON.stringify(validate.errors));
  });

  it('carries the section 2 defaults', () => {
    const p = schemaFile.schema.properties;
    assert.equal(p.name.default, 'Peloton');
    assert.equal(p.polling.properties.fastSwitch.default, true);
    assert.equal(p.polling.properties.fastSwitchName.default, 'Peloton fast polling');
    assert.equal(p.polling.properties.fastInterval.default, 10);
    assert.equal(p.polling.properties.fastInterval.minimum, 5);
    assert.equal(p.polling.properties.standbyInterval.default, 120);
    assert.equal(p.advanced.properties.fastSwitchAutoOffMinutes.default, 120);
    assert.equal(p.advanced.properties.attentionSensor.default, false);
    assert.equal(p.advanced.properties.dailyCheckIn.default, '03:00');
    assert.equal(p.triggers.items.properties.holdAfterEnd.default, 90);
    assert.equal(p.triggers.items.properties.holdTime.default, 20);
    assert.equal(p.triggers.items.properties.zone.default, 4);
    assert.equal(p.triggers.items.properties.accessory.default, 'occupancy');
    assert.equal(p.triggers.items.properties.device.default, 'any');
  });

  it('enforces the fast floor of 5', () => {
    assert.equal(validate(withPolling({ fastInterval: 5 })), true);
    assert.deepEqual(errors(withPolling({ fastInterval: 4 })), ['/polling/fastInterval minimum']);
  });

  it('allows standby 0 or 30 and above only', () => {
    assert.equal(validate(withPolling({ standbyInterval: 0 })), true);
    assert.equal(validate(withPolling({ standbyInterval: 30 })), true);
    assert.equal(validate(withPolling({ standbyInterval: 120 })), true);
    assert.equal(validate(withPolling({ standbyInterval: 10 })), false);
    assert.ok(errors(withPolling({ standbyInterval: 10 })).some((line) => line.startsWith('/polling/standbyInterval')));
  });

  it('rejects no fast polling switch together with standby 0', () => {
    assert.equal(validate(withPolling({ fastSwitch: false, standbyInterval: 0 })), false);
    assert.ok(errors(withPolling({ fastSwitch: false, standbyInterval: 0 })).includes('/polling not'));
    assert.equal(validate(withPolling({ fastSwitch: false, standbyInterval: 30 })), true);
    assert.equal(validate(withPolling({ fastSwitch: true, standbyInterval: 0 })), true);
  });

  it('requires names', () => {
    assert.equal(validate({ ...SAMPLE, name: '' }), false);
    assert.equal(validate(withTrigger(0, { name: '' })), false);
    const missing = { ...SAMPLE, triggers: [{ id: 't1', type: 'workout' }] };
    assert.equal(validate(missing), false);
    assert.ok(errors(missing).includes('/triggers/0 required'));
  });

  it('requires a named member for a heart-rate zone trigger and accepts anyone for a workout', () => {
    assert.equal(validate(withTrigger(1, { who: 'anyone' })), false);
    assert.equal(validate(withTrigger(1, { who: '' })), false);
    assert.equal(validate({ ...SAMPLE, triggers: [{ id: 't2', type: 'hrZone', name: 'Zone 4' }] }), false);
    assert.equal(validate(withTrigger(0, { who: 'anyone' })), true);
    assert.equal(validate(withTrigger(1, { who: 'u-member-0003' })), true);
  });

  it('limits device, accessory, type, activities, zone, and the check-in time to their values', () => {
    assert.equal(validate(withTrigger(0, { device: 'bike' })), true);
    assert.equal(validate(withTrigger(0, { device: 'tread' })), true);
    assert.equal(validate(withTrigger(0, { device: 'dev-bike-0001' })), false);
    assert.equal(validate(withTrigger(0, { accessory: 'contact' })), false);
    assert.equal(validate(withTrigger(0, { type: 'motion' })), false);
    assert.equal(validate(withTrigger(0, { activities: ['caving'] })), false);
    assert.equal(validate(withTrigger(1, { zone: 6 })), false);
    assert.equal(validate(withTrigger(1, { zone: 0 })), false);
    assert.equal(validate(withTrigger(0, { holdAfterEnd: -1 })), false);
    assert.equal(validate({ ...SAMPLE, advanced: { ...SAMPLE.advanced, dailyCheckIn: '25:00' } }), false);
    assert.equal(validate({ ...SAMPLE, advanced: { ...SAMPLE.advanced, fastSwitchAutoOffMinutes: 0 } }), false);
    assert.equal(validate({ ...SAMPLE, accounts: [{ id: 'a 1', email: 'x@example.com' }] }), false);
    assert.equal(validate({ ...SAMPLE, accounts: [{ id: 'a1' }] }), false);
  });

  it('gives every field a title and description in sentence case, with no em dashes', () => {
    const text = readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8');
    assert.equal(text.includes('—'), false, 'no em dashes');
    assert.equal(/ -- /.test(text), false, 'no double dashes as punctuation');
    const walk = (node, path) => {
      if (node === null || typeof node !== 'object') {
        return;
      }
      if (node.properties) {
        for (const [key, property] of Object.entries(node.properties)) {
          assert.equal(typeof property.title, 'string', `${path}.${key} has a title`);
          assert.equal(typeof property.description, 'string', `${path}.${key} has a description`);
          assert.match(property.title, /^[A-Z]/, `${path}.${key} title starts with a capital`);
          const words = property.title.replace(/\(.*\)/, '').trim();
          assert.equal(/^[A-Z][a-z]+ [A-Z][a-z]+/.test(words), false, `${path}.${key} title is sentence case: ${property.title}`);
          walk(property, `${path}.${key}`);
          if (property.items) {
            walk(property.items, `${path}.${key}[]`);
          }
        }
      }
    };
    walk(schemaFile.schema, 'schema');
  });
});
