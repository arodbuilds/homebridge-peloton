import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { ACTIVITIES, ACTIVITY_IDS, activityIdOf, activityMatches, disciplineName, isKnownDiscipline } from '../dist/activities.js';
import { TRIGGERS } from '../homebridge-ui/public/copy.js';
import { ACTIVITIES as PAGE_ACTIVITIES, ACTIVITY_SLUGS } from '../homebridge-ui/public/model.js';

// The twelve workout_counts entries GET /api/me returned on the maintainer's account on November 5, 2026 (slug, name).
const OBSERVED = [
  ['bike_bootcamp', 'Bike Bootcamp'],
  ['caesar', 'Rowing'],
  ['caesar_bootcamp', 'Row Bootcamp'],
  ['cardio', 'Cardio'],
  ['circuit', 'Tread Bootcamp'],
  ['cycling', 'Cycling'],
  ['meditation', 'Meditation'],
  ['running', 'Running'],
  ['strength', 'Strength'],
  ['stretching', 'Stretching'],
  ['walking', 'Walking'],
  ['yoga', 'Yoga'],
];

describe('activity table', () => {
  it('maps each plugin activity id to the Peloton disciplines it matches (SPEC section 4.2)', () => {
    assert.deepEqual(
      ACTIVITIES.map(({ id, disciplines }) => [id, [...disciplines]]),
      [
        ['cycling', ['cycling']],
        ['running', ['running']],
        ['walking', ['walking']],
        ['rowing', ['caesar']],
        ['strength', ['strength']],
        ['yoga', ['yoga']],
        ['stretching', ['stretching']],
        ['meditation', ['meditation']],
        ['cardio', ['cardio']],
        ['bike_bootcamp', ['bike_bootcamp']],
        ['tread_bootcamp', ['circuit']],
        ['row_bootcamp', ['caesar_bootcamp']],
      ],
    );
  });

  it('covers exactly the twelve observed disciplines, each named as Peloton names it in sentence case', () => {
    const disciplines = ACTIVITIES.flatMap((activity) => activity.disciplines).sort();
    assert.deepEqual(disciplines, OBSERVED.map(([slug]) => slug));
    for (const [slug, name] of OBSERVED) {
      assert.equal(isKnownDiscipline(slug), true, slug);
      const expected = name.charAt(0) + name.slice(1).toLowerCase();
      assert.equal(disciplineName(slug), expected, slug);
    }
  });

  it('shows an unknown discipline as the raw value', () => {
    assert.equal(disciplineName('boxing'), 'boxing');
    assert.equal(disciplineName(''), '');
    assert.equal(disciplineName('rowing'), 'rowing', 'the plugin id is not a Peloton slug');
    assert.equal(isKnownDiscipline('boxing'), false);
    assert.equal(isKnownDiscipline('toString'), false, 'inherited object keys are not disciplines');
  });

  it('reads an id as itself and a Peloton slug as its id, and nothing else', () => {
    for (const id of ACTIVITY_IDS) {
      assert.equal(activityIdOf(id), id);
    }
    assert.equal(activityIdOf('caesar'), 'rowing');
    assert.equal(activityIdOf('circuit'), 'tread_bootcamp');
    assert.equal(activityIdOf('caesar_bootcamp'), 'row_bootcamp');
    assert.equal(activityIdOf('boxing'), undefined);
    assert.equal(activityIdOf('__proto__'), undefined);
    assert.equal(activityMatches('boxing', 'boxing'), true, 'an id outside the table is matched as written');
    assert.equal(activityMatches('rowing', 'rowing'), false, 'an id in the table matches only its row');
  });

  it('agrees with the settings page chips, their labels, the page slug aliases, and config.schema.json', () => {
    assert.deepEqual(PAGE_ACTIVITIES, [...ACTIVITY_IDS]);
    assert.deepEqual(TRIGGERS.activityLabels, Object.fromEntries(ACTIVITIES.map(({ id, name }) => [id, name])));
    const slugs = Object.fromEntries(ACTIVITIES.flatMap(({ id, disciplines }) => disciplines.filter((slug) => slug !== id).map((slug) => [slug, id])));
    assert.deepEqual(ACTIVITY_SLUGS, slugs);
    const schema = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8'));
    const items = schema.schema.properties.triggers.items.properties.activities.items.oneOf;
    assert.deepEqual(items.map((item) => [item.enum[0], item.title]), ACTIVITIES.map(({ id, name }) => [id, name]));
  });
});
