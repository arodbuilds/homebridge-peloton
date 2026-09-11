import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { STAGE_MESSAGES, stageMessage } from '../homebridge-ui/public/copy.js';
import {
  ACTIVITIES, backupBlock, deviceLabel, devicesText, duplicateTrigger, exportConfig, isFreshConfig, mergeConnectedAccount, newId, newTrigger, readConfig,
  removeAccountEntry, validate,
} from '../homebridge-ui/public/model.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('account write-back', () => {
  it('keeps a stored password out of the form and writes it back unchanged when none was entered', () => {
    const config = readConfig({ accounts: [{ id: 'a1', email: 'owner@example.com', password: 'stored', displayName: 'Alex' }] });
    assert.equal(config.accounts[0].storedPassword, 'stored');
    assert.equal(config.accounts[0].newPassword, undefined);
    assert.deepEqual(exportConfig(config).accounts, [{ id: 'a1', email: 'owner@example.com', displayName: 'Alex', password: 'stored' }]);
  });

  it('writes the password entered on this page instead of the stored one, and none for a browser sign-in', () => {
    const config = readConfig({ accounts: [{ id: 'a1', email: 'owner@example.com', password: 'stored' }] });
    mergeConnectedAccount(config, 'a1', { id: 'a1', userId: 'u-owner-0001', displayName: 'Owner Example' }, { email: 'owner@example.com', password: 'typed' });
    assert.deepEqual(exportConfig(config).accounts, [
      { id: 'a1', email: 'owner@example.com', displayName: 'Owner Example', userId: 'u-owner-0001', password: 'typed' },
    ]);
    mergeConnectedAccount(config, 'a2', { id: 'a2', userId: 'u-member-0002', displayName: 'Member Example', username: 'member_runner' }, {});
    assert.deepEqual(exportConfig(config).accounts[1], { id: 'a2', email: '', displayName: 'Member Example', userId: 'u-member-0002' });
  });

  it('fills userId and display name from the store on save when config lacks them, and never overrides a configured name', () => {
    const config = readConfig({
      accounts: [{ id: 'a1', email: 'owner@example.com', password: 'stored' }, { id: 'a2', email: 'm@example.com', displayName: 'Sam' }],
    });
    const summaries = [
      { id: 'a1', userId: 'u-owner-0001', displayName: 'Owner Example' },
      { id: 'a2', userId: 'u-member-0003', displayName: 'Lifter Example' },
    ];
    assert.deepEqual(exportConfig(config, summaries).accounts, [
      { id: 'a1', email: 'owner@example.com', displayName: 'Owner Example', userId: 'u-owner-0001', password: 'stored' },
      { id: 'a2', email: 'm@example.com', displayName: 'Sam', userId: 'u-member-0003' },
    ]);
    assert.deepEqual(exportConfig(config).accounts[1], { id: 'a2', email: 'm@example.com', displayName: 'Sam' });
  });

  it('drops the config entry on remove', () => {
    const config = readConfig({ accounts: [{ id: 'a1', email: 'a@example.com' }, { id: 'a2', email: 'b@example.com' }] });
    assert.equal(removeAccountEntry(config, 'a1'), true);
    assert.equal(removeAccountEntry(config, 'nobody'), false);
    assert.deepEqual(config.accounts.map((account) => account.id), ['a2']);
  });

  it('generates ids for entries that have none or duplicate another', () => {
    const config = readConfig({ accounts: [{ email: 'a@example.com' }], triggers: [{ id: 't1', type: 'workout' }, { id: 't1', type: 'workout' }] });
    assert.match(config.accounts[0].id, UUID);
    assert.equal(config.triggers[0].id, 't1');
    assert.match(config.triggers[1].id, UUID);
    assert.match(newTrigger('workout').id, UUID);
  });
});

describe('ids', () => {
  it('uses crypto.randomUUID when the context has it', () => {
    const fake = {
      randomUUID: () => 'from-random-uuid',
      getRandomValues: () => {
        throw new Error('not used when randomUUID exists');
      },
    };
    assert.equal(newId(fake), 'from-random-uuid');
    assert.match(newId(), UUID, 'the global crypto object is the default');
  });

  it('builds a version 4 UUID from getRandomValues when randomUUID is missing, as over plain http', () => {
    const fake = { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) };
    const first = newId(fake);
    assert.match(first, UUID);
    assert.notEqual(newId(fake), first);
    // Sixteen random bytes with the version and variant bits forced.
    assert.equal(newId({ getRandomValues: (bytes) => bytes.fill(0) }), '00000000-0000-4000-8000-000000000000');
    assert.equal(newId({ getRandomValues: (bytes) => bytes.fill(0xff) }), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  });
});

describe('triggers', () => {
  it('starts a new card empty with the defaults and preselects the first connected member for a zone trigger', () => {
    const workout = newTrigger('workout');
    assert.deepEqual(workout, {
      id: workout.id, type: 'workout', name: '', accessory: 'occupancy', who: 'anyone', activities: [...ACTIVITIES], device: 'any', holdAfterEnd: 90,
    });
    const zone = newTrigger('hrZone', 'u-owner-0001');
    assert.deepEqual(zone, { id: zone.id, type: 'hrZone', name: '', accessory: 'occupancy', who: 'u-owner-0001', zone: 4, holdTime: 20 });
    assert.equal(newTrigger('hrZone').who, '');
  });

  it('reads unset or empty activities as every activity selected, writes an all-selected set as an empty list, and a subset as given', () => {
    const config = readConfig({
      triggers: [
        { id: 't1', type: 'workout', name: 'Workout' },
        { id: 't2', type: 'workout', name: 'Rides', activities: ['cycling'], device: 'bike' },
        { id: 't3', type: 'workout', name: 'Empty list', activities: [] },
      ],
    });
    assert.deepEqual(config.triggers[0].activities, [...ACTIVITIES]);
    assert.deepEqual(config.triggers[2].activities, [...ACTIVITIES]);
    const exported = exportConfig(config).triggers;
    assert.deepEqual(exported[0], {
      id: 't1', type: 'workout', name: 'Workout', accessory: 'occupancy', who: 'anyone', activities: [], device: 'any', holdAfterEnd: 90,
    });
    assert.deepEqual(exported[1].activities, ['cycling']);
    assert.equal(exported[1].device, 'bike');
    assert.deepEqual(exported[2].activities, []);
    // Deselecting one chip writes the other eleven, so the plugin restricts the trigger.
    config.triggers[0].activities = ACTIVITIES.filter((activity) => activity !== 'cycling');
    assert.equal(exportConfig(config).triggers[0].activities.length, 11);
  });

  it('duplicates with a new id and a copy name that dodges existing names', () => {
    const trigger = readConfig({ triggers: [{ id: 't1', type: 'workout', name: 'Workout', activities: ['cycling'] }] }).triggers[0];
    const copy = duplicateTrigger(trigger, ['Workout', 'Workout copy'], ' copy');
    assert.notEqual(copy.id, 't1');
    assert.equal(copy.name, 'Workout copy 2');
    assert.deepEqual(copy.activities, ['cycling']);
    assert.notEqual(copy.activities, trigger.activities);
  });
});

describe('validation', () => {
  function issuesFor(raw) {
    return validate(readConfig(raw)).map((issue) => `${issue.label}: ${issue.message}`);
  }

  it('finds the design README cases', () => {
    assert.deepEqual(issuesFor({ triggers: [{ id: 't1', type: 'workout', name: '' }] }), [
      'New trigger: Give this trigger a name. It is what you will see in the Home app.',
    ]);
    assert.deepEqual(issuesFor({ triggers: [{ id: 't1', type: 'workout', name: 'Ride' }, { id: 't2', type: 'workout', name: 'ride ' }] }), [
      'Ride: Another trigger already uses this name.',
      'ride: Another trigger already uses this name.',
    ]);
    assert.deepEqual(issuesFor({ triggers: [{ id: 't1', type: 'hrZone', name: 'Zone 4' }] }), [
      'Zone 4: Choose the member whose heart rate this sensor follows.',
    ]);
    assert.deepEqual(issuesFor({ polling: { fastInterval: 4 } }), ['Polling: Fast polling cannot go below 5 seconds.']);
    assert.deepEqual(issuesFor({ polling: { standbyInterval: 29 } }), ['Polling: Use 0 to stop polling, or 30 seconds or more.']);
    assert.deepEqual(issuesFor({ polling: { standbyInterval: 0 } }), []);
    assert.deepEqual(issuesFor({ polling: { fastSwitch: false, standbyInterval: 0 } }), [
      'Polling: With no fast polling switch and standby at 0 the plugin would never poll. Turn one of them back on.',
    ]);
    assert.deepEqual(issuesFor({ name: ' ' }), ['Settings: Name is required.']);
    assert.deepEqual(issuesFor({ advanced: { fastSwitchAutoOffMinutes: 0 } }), ['Settings: Enter a number of minutes, 1 or more.']);
    assert.deepEqual(issuesFor({}), []);
  });

  it('knows a fresh install from a configured one', () => {
    assert.equal(isFreshConfig(readConfig({})), true);
    assert.equal(isFreshConfig(readConfig({ polling: { standbyInterval: 60 } })), false);
    assert.equal(isFreshConfig(readConfig({ triggers: [{ id: 't1', type: 'workout', name: 'Workout' }] })), false);
  });
});

describe('restore from backup', () => {
  it('finds the platform block on its own, in a config.json, or in a draft', () => {
    const block = { platform: 'Peloton', name: 'Peloton' };
    assert.deepEqual(backupBlock(block), block);
    assert.deepEqual(backupBlock({ platforms: [{ platform: 'config' }, block] }), block);
    assert.deepEqual(backupBlock({ savedAt: 1, config: block }), block);
    assert.equal(backupBlock({ platform: 'NotifySwitch' }), undefined);
    assert.equal(backupBlock([block]), undefined);
  });
});

describe('copy', () => {
  it('maps every SPEC section 10 stage to the design README message and falls back for API failures', () => {
    assert.equal(stageMessage('credentials'), 'Peloton did not accept that email and password.');
    assert.equal(stageMessage('authorize'), 'Peloton sign-in did not complete. You can connect using your browser instead.');
    assert.equal(stageMessage('callback'), STAGE_MESSAGES.authorize);
    assert.equal(stageMessage('exchange'), STAGE_MESSAGES.authorize);
    assert.equal(stageMessage('verification_required'), 'This account has extra verification turned on. Use Sign in with browser.');
    assert.equal(stageMessage('malformed_callback'), STAGE_MESSAGES.malformed_callback);
    assert.equal(STAGE_MESSAGES.malformed_callback,
      'That does not look like the Peloton callback address. It should start with members.onepeloton.com/callback.');
    assert.equal(stageMessage('state_mismatch'), 'This link was from an earlier attempt. Click Open Peloton sign-in again and use the new one.');
    assert.equal(stageMessage('expired_code'), 'The sign-in link expired. Click Open Peloton sign-in and try again.');
    assert.equal(stageMessage('api', 503), 'Peloton did not answer (HTTP 503). Try again in a moment.');
    assert.equal(stageMessage('api'), 'Peloton did not answer. Try again in a moment.');
  });

  it('uses no em dashes or double-dash punctuation anywhere on the page', () => {
    const dir = new URL('../homebridge-ui/public/', import.meta.url);
    for (const name of readdirSync(dir).filter((file) => /\.(js|css|html)$/.test(file))) {
      const text = readFileSync(new URL(name, dir), 'utf8');
      assert.equal(text.includes('—'), false, `${name} has an em dash`);
      assert.equal(/\s--\s/.test(text), false, `${name} has a double dash`);
    }
  });
});

describe('devices line', () => {
  it('labels a device by name with the group after it, by the capitalised group without a name, and without a suffix when they match', () => {
    assert.equal(deviceLabel({ id: 'dev-bike-0001', name: 'Blue Door+', group: 'bike' }), 'Blue Door+ (bike)');
    assert.equal(deviceLabel({ id: 'dev-tread-0001', name: 'Tread', group: 'tread' }), 'Tread (tread)');
    assert.equal(deviceLabel({ id: 'dev-guide-0001', name: null, group: 'guide' }), 'Guide');
    assert.equal(deviceLabel({ id: 'dev-x', name: 'tread', group: 'tread' }), 'tread');
    assert.equal(deviceLabel({ id: 'dev-old', name: 'Bike+', group: '' }), 'Bike+', 'a record from an earlier build has no group');
    assert.equal(deviceLabel({ id: 'dev-old', name: 'Bike+' }), 'Bike+');
    assert.equal(devicesText([
      { id: 'dev-bike-0001', name: 'Blue Door+', group: 'bike' },
      { id: 'dev-tread-0001', name: 'Tread', group: 'tread' },
      { id: 'dev-guide-0001', name: null, group: 'guide' },
    ]), 'Blue Door+ (bike), Tread (tread), Guide');
  });
});
