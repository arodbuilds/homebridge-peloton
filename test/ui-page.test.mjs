/**
 * The settings page rendered under node:test on the fake DOM (test/helpers/fake-dom.mjs): what the
 * page asks the UI server, how it renders the answers, and the paths that failed in the build 3
 * Chrome pass on the Pi (ids over plain http, avatars, the Devices line, the activity chips).
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { describe, it } from 'node:test';

import { flush, installFakeDom } from './helpers/fake-dom.mjs';

const dom = installFakeDom();
const requests = [];
const answers = new Map();
const pushed = [];
dom.window.homebridge = {
  request: async (path, payload = {}) => {
    requests.push({ path, payload });
    const answer = answers.get(`${path} ${payload.id ?? ''}`.trim()) ?? answers.get(path);
    if (answer === undefined) {
      throw new Error(`No answer for ${path}`);
    }
    return answer;
  },
  updatePluginConfig: async (blocks) => {
    pushed.push(blocks);
  },
  toast: { error: () => undefined, success: () => undefined },
  enableSaveButton: () => undefined,
  disableSaveButton: () => undefined,
};

// The page modules read window and document at call time; they are imported once the fake DOM is in place.
const { Page } = await import('../homebridge-ui/public/app.js');
const { readConfig } = await import('../homebridge-ui/public/model.js');
const { avatarSrc } = await import('../homebridge-ui/public/accounts.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOW = 1_789_000_000_000;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64');

function summary(overrides) {
  return { avatar: false, isOwner: false, state: 'not_connected', lastWorkoutAt: null, ...overrides };
}

const STATUS = {
  accounts: [
    summary({
      id: 'a1', userId: 'u-owner-0001', displayName: 'Owner Example', username: 'owner_rider', avatar: true, isOwner: true, state: 'connected',
      lastCheckedAt: NOW - 120_000,
    }),
    summary({ id: 'u-member-0002', userId: 'u-member-0002', displayName: 'Member Example', username: 'member_runner' }),
    summary({ id: 'u-member-0003', userId: 'u-member-0003', displayName: 'Lifter Example', username: 'member_lifter', avatar: true }),
  ],
  devices: [{ id: 'dev-bike-0001', name: 'Blue Door+' }, { id: '', name: 'Tread' }],
  version: '1.0.0-beta.1',
};

/** Builds the page for a platform block and the given /status answer, as start() does after getPluginConfig and /status. */
function mount(block, status = STATUS) {
  requests.length = 0;
  dom.document.body.textContent = '';
  const root = dom.document.createElement('div');
  dom.document.body.appendChild(root);
  const page = new Page(root, readConfig(block), JSON.parse(JSON.stringify(status)), undefined);
  page.now = () => NOW;
  page.renderAll();
  return { page, root };
}

function buttonNamed(root, text) {
  return [...root.querySelectorAll('button')].find((button) => button.textContent === text);
}

/** Runs the debounced push to the host, and returns the platform block it sent. */
function pushedBlock() {
  for (const fn of dom.window.timeouts.splice(0)) {
    fn();
  }
  return pushed.at(-1)[0];
}

describe('account cards', () => {
  it('asks /avatar by the card key and sets the img src from the answer; initials stay for the default image and for a failed proxy', async () => {
    answers.set('/avatar a1', { ok: true, status: 200, contentType: 'image/jpeg', data: JPEG });
    answers.set('/avatar u-member-0003', { ok: false, stage: 'api', status: 404 });
    const { page, root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com', password: 'x' }] });
    await flush();
    assert.deepEqual(requests.map((request) => [request.path, request.payload.id]), [['/avatar', 'a1'], ['/avatar', 'u-member-0003']],
      'no request for a profile whose summary says the image is the default');
    const owner = root.querySelector('[data-account="a1"] .ns-avatar');
    assert.equal(owner.querySelector('img').getAttribute('src'), `data:image/jpeg;base64,${JPEG}`);
    assert.equal(owner.textContent, '', 'the initials are replaced by the photo');
    assert.equal(root.querySelector('[data-account="u-member-0002"] .ns-avatar img'), null);
    assert.equal(root.querySelector('[data-account="u-member-0002"] .ns-avatar').textContent, 'ME');
    assert.equal(root.querySelector('[data-account="u-member-0003"] .ns-avatar img'), null);
    assert.equal(root.querySelector('[data-account="u-member-0003"] .ns-avatar').textContent, 'LE');

    page.rerender('accounts');
    await flush();
    assert.equal(requests.length, 2, 'a re-render takes the photo from the page cache');
    assert.equal(root.querySelector('[data-account="a1"] .ns-avatar img').getAttribute('src'), `data:image/jpeg;base64,${JPEG}`);
  });

  it('turns an /avatar answer into an img src only for a 200 with image bytes', () => {
    assert.equal(avatarSrc({ ok: true, status: 200, contentType: 'image/png', data: 'AA==' }), 'data:image/png;base64,AA==');
    assert.equal(avatarSrc({ ok: true, status: 204 }), null);
    assert.equal(avatarSrc({ ok: false, stage: 'api', status: 200 }), null);
    assert.equal(avatarSrc({ ok: false, unavailable: true, message: 'x' }), null);
  });

  it('renders the Devices line with every device name from /status and omits it without devices', () => {
    const { root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }] });
    assert.equal(root.querySelector('.ns-devices').textContent, 'Devices on this membership: Blue Door+, Tread (names come from your membership)');
    const bare = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }] }, { ...STATUS, devices: [] });
    assert.equal(bare.root.querySelector('.ns-devices'), null);
  });

  it('shows Last checked from the summary\'s lastCheckedAt and the display name with the username after it', () => {
    const { root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }] });
    assert.equal(root.querySelector('[data-account="a1"] .ns-account-subline').textContent, 'Last checked 2 min ago');
    const member = root.querySelector('[data-account="u-member-0002"] .ns-account-name');
    assert.equal(member.querySelector('.ns-name').textContent, 'Member Example');
    assert.equal(member.textContent, 'Member Example@member_runner');
  });
});

describe('ids over plain http', () => {
  /** Runs fn with a global crypto that has getRandomValues but no randomUUID, as a page served over plain http sees it. */
  function withoutRandomUUID(fn) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) } });
    try {
      return fn();
    } finally {
      Object.defineProperty(globalThis, 'crypto', original);
    }
  }

  it('adds a trigger and opens Add account when crypto.randomUUID does not exist', () => {
    withoutRandomUUID(() => {
      assert.equal(typeof globalThis.crypto.randomUUID, 'undefined');
      const { page, root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }], triggers: [{ id: 't1', type: 'workout', name: 'Workout' }] });
      buttonNamed(root, 'Add trigger').click();
      root.querySelector('.ns-chooser-tile').click();
      assert.equal(page.config.triggers.length, 2);
      assert.match(page.config.triggers[1].id, UUID);
      assert.ok(page.triggersUi.expanded.has(page.config.triggers[1].id));
      assert.equal(root.querySelectorAll('.ns-trigger-card').length, 2);

      buttonNamed(root, 'Add account').click();
      assert.match(page.accountsUi.panel.accountId, UUID);
      assert.equal(root.querySelectorAll('.ns-standalone-panel').length, 1);
    });
  });
});

describe('activity chips', () => {
  it('shows every chip selected for a trigger whose config leaves activities unset, keeps Select all / none, and saves all as an empty list', () => {
    const { page, root } = mount({
      triggers: [{ id: 't1', type: 'workout', name: 'Workout' }, { id: 't2', type: 'workout', name: 'Rides', activities: ['cycling'] }],
    });
    page.triggersUi.expanded.add('t1');
    page.triggersUi.expanded.add('t2');
    page.rerender('triggers');
    const pressed = (id) => root.querySelectorAll(`[data-trigger="${id}"] .ns-chip[aria-pressed="true"]`).length;
    const summaryOf = (id) => root.querySelector(`[data-trigger="${id}"] .ns-chips-summary`).textContent;
    assert.equal(pressed('t1'), 12);
    assert.equal(summaryOf('t1'), 'All activities');
    assert.equal(pressed('t2'), 1);
    assert.equal(summaryOf('t2'), '1 of 12 selected');

    root.querySelector('[data-trigger="t1"] .ns-chip[data-activity="cycling"]').click();
    assert.equal(pressed('t1'), 11);
    assert.equal(summaryOf('t1'), '11 of 12 selected');
    assert.deepEqual(pushedBlock().triggers[0].activities.length, 11);

    const links = [...root.querySelectorAll('[data-trigger="t1"] .ns-chips-links button')];
    links.find((button) => button.textContent === 'none').click();
    assert.equal(pressed('t1'), 0);
    assert.equal(summaryOf('t1'), '0 of 12 selected');
    links.find((button) => button.textContent === 'Select all').click();
    assert.equal(pressed('t1'), 12);
    assert.equal(summaryOf('t1'), 'All activities');

    const block = pushedBlock();
    assert.deepEqual(block.triggers[0].activities, []);
    assert.deepEqual(block.triggers[1].activities, ['cycling']);
  });
});
