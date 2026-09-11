import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CONFIG_DEFAULTS, parseConfig } from '../dist/config.js';

function parse(raw, generateId) {
  const warnings = [];
  let counter = 0;
  const config = parseConfig(raw, {
    warn: (line) => warnings.push(line),
    generateId: generateId ?? (() => `generated-${++counter}`),
  });
  return { config, warnings };
}

describe('defaults', () => {
  it('fills every default from SPEC section 2 for an empty block', () => {
    const { config, warnings } = parse({ platform: 'Peloton' });
    assert.deepEqual(config, {
      name: 'Peloton',
      accounts: [],
      triggers: [],
      polling: {
        fastSwitch: true,
        fastSwitchName: 'Peloton fast polling',
        fastInterval: 10,
        standbyInterval: 120,
        calloutDismissed: false,
      },
      advanced: { fastSwitchAutoOffMinutes: 120, attentionSensor: false, dailyCheckIn: '03:00' },
      debug: false,
    });
    assert.deepEqual(warnings, []);
  });

  it('parses the SPEC section 6 example as written', () => {
    const { config, warnings } = parse({
      platform: 'Peloton',
      name: 'Peloton',
      accounts: [{ id: 'a1', email: 'owner@example.com', password: 'secret', userId: 'u-owner-0001', displayName: 'Alex' }],
      triggers: [
        {
          id: 't1', type: 'workout', name: 'Workout', accessory: 'occupancy', who: 'anyone',
          activities: ['cycling', 'running'], device: 'any', holdAfterEnd: 90,
        },
        { id: 't2', type: 'hrZone', name: 'Zone 4 or higher', accessory: 'occupancy', who: 'u-owner-0001', zone: 4, holdTime: 20 },
      ],
      polling: { fastSwitch: true, fastSwitchName: 'Peloton fast polling', fastInterval: 10, standbyInterval: 120, calloutDismissed: false },
      advanced: { fastSwitchAutoOffMinutes: 120, attentionSensor: false, dailyCheckIn: '03:00' },
      debug: false,
    });
    assert.deepEqual(warnings, []);
    assert.deepEqual(config.accounts, [{ id: 'a1', email: 'owner@example.com', password: 'secret', userId: 'u-owner-0001', displayName: 'Alex' }]);
    assert.deepEqual(config.triggers, [
      {
        id: 't1', type: 'workout', name: 'Workout', accessory: 'occupancy', who: 'anyone',
        activities: ['cycling', 'running'], device: 'any', holdAfterEnd: 90,
      },
      { id: 't2', type: 'hrZone', name: 'Zone 4 or higher', accessory: 'occupancy', who: 'u-owner-0001', zone: 4, holdTime: 20 },
    ]);
  });

  it('fills trigger defaults when only type and id are given', () => {
    const { config, warnings } = parse({ triggers: [{ id: 't1', type: 'workout' }, { id: 't2', type: 'hrZone', who: 'u-owner-0001' }] });
    assert.deepEqual(warnings, []);
    assert.deepEqual(config.triggers[0], {
      id: 't1', type: 'workout', name: CONFIG_DEFAULTS.workoutTriggerName, accessory: 'occupancy', who: 'anyone',
      activities: [], device: 'any', holdAfterEnd: 90,
    });
    assert.deepEqual(config.triggers[1], {
      id: 't2', type: 'hrZone', name: CONFIG_DEFAULTS.hrZoneTriggerName, accessory: 'occupancy', who: 'u-owner-0001', zone: 4, holdTime: 20,
    });
  });
});

describe('clamping and defaulting', () => {
  it('clamps fastInterval to the floor of 5 with one warn line', () => {
    const { config, warnings } = parse({ polling: { fastInterval: 2 } });
    assert.equal(config.polling.fastInterval, 5);
    assert.deepEqual(warnings, ['polling.fastInterval is below 5, using 5']);
  });

  it('allows standbyInterval 0 without a warning and clamps negatives to 0', () => {
    assert.equal(parse({ polling: { standbyInterval: 0 } }).config.polling.standbyInterval, 0);
    assert.deepEqual(parse({ polling: { standbyInterval: 0 } }).warnings, []);
    const negative = parse({ polling: { standbyInterval: -5 } });
    assert.equal(negative.config.polling.standbyInterval, 0);
    assert.deepEqual(negative.warnings, ['polling.standbyInterval is below 0, using 0']);
  });

  it('defaults non-numeric values with one warn line each and accepts numeric strings', () => {
    const { config, warnings } = parse({
      polling: { fastInterval: 'fast', standbyInterval: '30' },
      advanced: { fastSwitchAutoOffMinutes: null },
      triggers: [{ id: 't1', type: 'workout', holdAfterEnd: {} }, { id: 't2', type: 'hrZone', who: 'u1', zone: 9, holdTime: -1 }],
    });
    assert.equal(config.polling.fastInterval, 10);
    assert.equal(config.polling.standbyInterval, 30);
    assert.equal(config.advanced.fastSwitchAutoOffMinutes, 120);
    assert.equal(config.triggers[0].holdAfterEnd, 90);
    assert.equal(config.triggers[1].zone, 5);
    assert.equal(config.triggers[1].holdTime, 0);
    assert.deepEqual(warnings, [
      'triggers[0].holdAfterEnd is not a number, using 90',
      'triggers[1].zone is above 5, using 5',
      'triggers[1].holdTime is below 0, using 0',
      'polling.fastInterval is not a number, using 10',
      'advanced.fastSwitchAutoOffMinutes is not a number, using 120',
    ]);
  });

  it('defaults booleans, the check-in time, and unknown trigger type or accessory kind', () => {
    const { config, warnings } = parse({
      polling: { fastSwitch: 'yes' },
      advanced: { attentionSensor: 1, dailyCheckIn: '25:00' },
      debug: 'true',
      triggers: [{ id: 't1', type: 'motion', accessory: 'contact' }],
    });
    assert.equal(config.polling.fastSwitch, true);
    assert.equal(config.advanced.attentionSensor, false);
    assert.equal(config.advanced.dailyCheckIn, '03:00');
    assert.equal(config.debug, false);
    assert.equal(config.triggers[0].type, 'workout');
    assert.equal(config.triggers[0].accessory, 'occupancy');
    assert.deepEqual(warnings, [
      'triggers[0].type is not "workout" or "hrZone", using "workout"',
      'triggers[0].accessory is not "occupancy" or "switch", using "occupancy"',
      'polling.fastSwitch is not true or false, using true',
      'advanced.attentionSensor is not true or false, using false',
      'advanced.dailyCheckIn is not a time in HH:MM form, using 03:00',
      'debug is not true or false, using false',
    ]);
  });

  it('ignores lists that are not lists and activity entries that are not names', () => {
    const { config, warnings } = parse({
      accounts: 'none',
      triggers: [{ id: 't1', type: 'workout', activities: 'cycling' }, { id: 't2', type: 'workout', activities: ['cycling', 3, 'cycling'] }],
    });
    assert.deepEqual(config.accounts, []);
    assert.deepEqual(config.triggers[0].activities, []);
    assert.deepEqual(config.triggers[1].activities, ['cycling']);
    assert.deepEqual(warnings, [
      'accounts is not a list, ignoring it',
      'triggers[0].activities is not a list, matching all activities',
      'triggers[1].activities contains a value that is not a name, ignoring it',
    ]);
  });

  it('warns when a heart-rate zone trigger has no account', () => {
    const { config, warnings } = parse({ triggers: [{ id: 't1', type: 'hrZone' }] });
    assert.equal(config.triggers[0].who, 'anyone');
    assert.deepEqual(warnings, ['triggers[0].who must be an account for a heart-rate zone trigger; the sensor will stay off until one is chosen']);
  });

  it('never throws on garbage input', () => {
    for (const raw of [undefined, null, 42, 'text', [], { accounts: [null, 1], triggers: [[], 'x'], polling: 3, advanced: [] }]) {
      const { config } = parse(raw);
      assert.equal(config.polling.fastInterval, 10);
    }
  });
});

describe('ids', () => {
  it('generates ids for accounts and triggers that have none and asks the user to save from the settings page', () => {
    const { config, warnings } = parse({ accounts: [{ email: 'a@example.com' }], triggers: [{ type: 'workout' }] });
    assert.equal(config.accounts[0].id, 'generated-1');
    assert.equal(config.triggers[0].id, 'generated-2');
    assert.deepEqual(warnings, [
      'accounts[0] has no id; using a generated id for this run. Save the config from the settings page so the id persists',
      'triggers[0] has no id; using a generated id for this run. Save the config from the settings page so the id persists',
    ]);
  });

  it('replaces duplicate ids and ids with unsafe characters', () => {
    const { config, warnings } = parse({ accounts: [{ id: 'a1' }, { id: 'a1' }], triggers: [{ id: '../t', type: 'workout' }] });
    assert.deepEqual(config.accounts.map((account) => account.id), ['a1', 'generated-1']);
    assert.equal(config.triggers[0].id, 'generated-2');
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /^accounts\[1\] duplicates another id/);
    assert.match(warnings[1], /^triggers\[0\] has no id/);
  });

  it('uses crypto.randomUUID when no generator is injected', () => {
    const config = parseConfig({ triggers: [{ type: 'workout' }] });
    assert.match(config.triggers[0].id, /^[0-9a-f-]{36}$/);
  });
});
