/**
 * The unsaved draft (homebridge-ui/public/draft.js, the shell's draft.ts): written without passwords,
 * read back only while well formed and younger than a day, and removed otherwise.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const stored = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key),
  },
};

const { DRAFT_KEY, DRAFT_MAX_AGE_MS, clearDraft, readDraft, saveDraft, stableStringify } = await import('../homebridge-ui/public/draft.js');

const NOW = 1_789_000_000_000;
const BLOCK = { platform: 'Peloton', name: 'Peloton', accounts: [{ id: 'a1', email: 'a@example.com', password: 'secret' }], triggers: [] };

describe('draft', () => {
  it('writes the block under the plugin key without passwords, and reads it back while it is fresh', () => {
    stored.clear();
    saveDraft(BLOCK, NOW);
    assert.equal(stored.get(DRAFT_KEY).includes('secret'), false);
    const draft = readDraft(NOW + 1000);
    assert.equal(draft.savedAt, NOW);
    assert.deepEqual(draft.config.accounts, [{ id: 'a1', email: 'a@example.com' }]);
    assert.equal(readDraft(NOW + DRAFT_MAX_AGE_MS), undefined, 'a draft a day old is removed');
    assert.equal(stored.has(DRAFT_KEY), false);
  });

  it('removes a draft that is malformed, from the future, over the size limit, or holding a forbidden key', () => {
    for (const text of ['not json', '{"savedAt":"x","config":{}}', `{"savedAt":${NOW + 60_000},"config":{}}`, `{"savedAt":${NOW},"config":[]}`,
      `{"savedAt":${NOW},"config":{"triggers":[{"__proto__":{"x":1}}]}}`, `{"savedAt":${NOW},"config":{"pad":"${'x'.repeat(1024 * 1024)}"}}`]) {
      stored.set(DRAFT_KEY, text);
      assert.equal(readDraft(NOW), undefined, text.slice(0, 40));
      assert.equal(stored.has(DRAFT_KEY), false);
    }
    stored.set(DRAFT_KEY, 'x');
    clearDraft();
    assert.equal(stored.has(DRAFT_KEY), false);
    assert.equal(readDraft(NOW), undefined, 'no draft at all');
  });

  it('survives a storage that throws, since the draft is a convenience', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    const broken = { getItem: blocked, setItem: blocked, removeItem: blocked };
    const original = globalThis.window.localStorage;
    globalThis.window.localStorage = broken;
    try {
      saveDraft(BLOCK, NOW);
      assert.equal(readDraft(NOW), undefined);
      clearDraft();
    } finally {
      globalThis.window.localStorage = original;
    }
  });

  it('sorts keys at every level so two equal configurations compare equal whatever their key order', () => {
    assert.equal(stableStringify({ b: [{ d: 1, c: 2 }], a: 'x' }), '{"a":"x","b":[{"c":2,"d":1}]}');
    assert.equal(stableStringify(undefined), 'null');
  });
});
