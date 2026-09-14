/**
 * The settings page rendered under node:test on the fake DOM (test/helpers/fake-dom.mjs): what the
 * page asks the UI server, how it renders the answers, the paths that failed in the build 3 Chrome
 * pass on the Pi (ids over plain http, avatars, the Devices line, the activity chips), and the shell
 * behaviour of beta.2 (design/README.md, Shell): the Settings fields under Advanced, the collapsible
 * trigger card header, the summary box that focuses a field without rebuilding the page, the label
 * table messages, and the draft that is written only after a change.
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
/** How often the page asked the host to size the iframe to the content (fixScrollHeight). */
const resizes = { count: 0 };
/** The last Save button state the page asked the host for. */
const save = { enabled: undefined };
/** A localStorage stand-in for the draft (draft.js). */
const stored = new Map();
dom.window.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
};
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
  enableSaveButton: () => {
    save.enabled = true;
  },
  disableSaveButton: () => {
    save.enabled = false;
  },
  fixScrollHeight: () => {
    resizes.count += 1;
  },
};

// The page modules read window and document at call time; they are imported once the fake DOM is in place.
const { Page, pendingDraft } = await import('../homebridge-ui/public/app.js');
const { readConfig } = await import('../homebridge-ui/public/model.js');
const { avatarSrc } = await import('../homebridge-ui/public/accounts.js');
const { DRAFT_KEY, readDraft } = await import('../homebridge-ui/public/draft.js');

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
  devices: [
    { id: 'dev-bike-0001', name: 'Blue Door+', group: 'bike' },
    { id: 'dev-tread-0001', name: 'Tread', group: 'tread' },
    { id: 'dev-guide-0001', name: null, group: 'guide' },
  ],
  version: '0.1.0-beta.1',
};

/** Builds the page for a platform block and the given /status answer, as start() does after getPluginConfig and /status. */
function mount(block, status = STATUS, draft = undefined) {
  requests.length = 0;
  stored.clear();
  dom.window.timeouts.length = 0;
  dom.document.body.textContent = '';
  dom.document.activeElement = null;
  const root = dom.document.createElement('div');
  dom.document.body.appendChild(root);
  const page = new Page(root, readConfig(block), JSON.parse(JSON.stringify(status)), draft);
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

/** Runs every pending timeout (the debounced pushes) without reading the result. */
function runTimeouts() {
  for (const fn of dom.window.timeouts.splice(0)) {
    fn();
  }
}

function addTrigger(root, tileName) {
  buttonNamed(root, 'Add trigger').click();
  [...root.querySelectorAll('.ns-chooser-tile')].find((tile) => tile.querySelector('.ns-tile-title').textContent === tileName).click();
}

const TWO_TRIGGERS = {
  accounts: [{ id: 'a1', email: 'owner@example.com' }],
  triggers: [
    { id: 't1', type: 'workout', name: 'Workout', device: 'bike', activities: ['cycling', 'running'], holdAfterEnd: 60 },
    { id: 't2', type: 'hrZone', name: 'Zone 4 or higher', who: 'u-owner-0001', zone: 3, holdTime: 25 },
  ],
};

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

    page.rerender('accounts', false);
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

  it('renders the Devices line as name (group), the capitalised group for a device without a name, and omits it without devices', () => {
    const { root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }] });
    assert.equal(
      root.querySelector('.ns-devices').textContent,
      'Devices on this membership: Blue Door+ (bike), Tread (tread), Guide (names come from your membership)',
    );
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

  it('draws the account cards, the first-run panel and the Add account panel on the shell card markup', () => {
    const { root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }] });
    assert.ok(root.querySelector('[data-account="a1"]').classList.contains('card'));
    assert.equal(root.querySelector('[data-account="a1"] .badge.ns-type-badge').textContent, 'Owner');
    buttonNamed(root, 'Add account').click();
    assert.ok(root.querySelector('.ns-standalone-panel').classList.contains('card'));
    const connect = buttonNamed(root.querySelector('.ns-standalone-panel'), 'Connect');
    assert.match(connect.className, /\bbtn-primary\b/);
    assert.match(connect.className, /\bns-section-add\b/);
    const fresh = mount({}, { ...STATUS, accounts: [] });
    assert.ok(fresh.root.querySelector('.ns-first-run-card').classList.contains('card'));
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

describe('new trigger names', () => {
  it('prefills Workout on a new Workout card, opens it, focuses its Name, and pushes it to the host', () => {
    const { page, root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }] });
    addTrigger(root, 'Workout');
    const card = root.querySelector('.ns-trigger-card');
    assert.equal(page.config.triggers[0].name, 'Workout');
    const name = card.querySelector('[data-path$=".name"] input');
    assert.equal(name.value, 'Workout');
    assert.equal(name.getAttribute('placeholder'), null);
    assert.equal(card.querySelector('.ns-card-name').textContent, 'Workout');
    assert.equal(card.querySelector('.card-header').getAttribute('aria-expanded'), 'true', 'a new card opens expanded');
    assert.equal(dom.document.activeElement, name, 'the new card focuses its Name field');
    assert.equal(pushedBlock().triggers.length, 1, 'adding the card is a change the host receives');
  });

  it('prefills Zone 4 or higher on a new Heart-rate zone card and follows the zone until the name is edited', () => {
    const { page, root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }] });
    addTrigger(root, 'Heart-rate zone');
    const card = root.querySelector('.ns-trigger-card');
    const name = card.querySelector('[data-path$=".name"] input');
    const zone = card.querySelector('[data-path$=".zone"] select');
    assert.equal(name.value, 'Zone 4 or higher');
    assert.equal(page.config.triggers[0].who, 'u-owner-0001', 'the first connected member is preselected');

    zone.value = '3';
    zone.dispatchEvent('change');
    assert.equal(page.config.triggers[0].name, 'Zone 3 or higher');
    assert.equal(name.value, 'Zone 3 or higher');
    assert.equal(card.querySelector('.ns-card-name').textContent, 'Zone 3 or higher');
    assert.equal(pushedBlock().triggers[0].name, 'Zone 3 or higher');

    name.value = 'Sprint';
    name.dispatchEvent('input');
    zone.value = '5';
    zone.dispatchEvent('change');
    assert.equal(page.config.triggers[0].name, 'Sprint', 'an edited name is left alone');
    assert.equal(name.value, 'Sprint');
    assert.equal(page.config.triggers[0].zone, 5);
  });
});

describe('trigger card header', () => {
  it('starts collapsed for cards loaded from config, with Show settings, no help toggle, and a summary of the key values after the badges', () => {
    const { root } = mount(TWO_TRIGGERS);
    const workout = root.querySelector('[data-trigger="t1"]');
    const zone = root.querySelector('[data-trigger="t2"]');
    for (const card of [workout, zone]) {
      const header = card.querySelector('.card-header');
      assert.equal(header.getAttribute('role'), 'button');
      assert.equal(header.getAttribute('tabindex'), '0');
      assert.equal(header.getAttribute('aria-expanded'), 'false');
      assert.equal(card.querySelector('.card-body').hidden, true);
      assert.equal(card.querySelector('.card-footer').hidden, true);
      assert.equal(card.querySelector('.ns-collapse-toggle').textContent, 'Show settings');
      assert.equal(card.querySelector('.ns-help-toggle').hidden, true, 'Hide help only while the card is open');
      assert.ok(card.querySelector('.ns-card-actions .ns-chevron'), 'the chevron sits in the right cluster');
      assert.equal(card.querySelector('.ns-card-actions').children.at(-1).classList.contains('ns-chevron'), true, 'at the right edge');
    }
    assert.equal(workout.querySelector('.ns-card-name').textContent, 'Workout');
    assert.deepEqual([...workout.querySelectorAll('.ns-card-title .badge')].map((badge) => badge.textContent), ['Workout', 'Anyone', 'Occupancy sensor']);
    assert.equal(workout.querySelector('.ns-card-summary').hidden, false);
    assert.equal(workout.querySelector('.ns-card-summary').textContent, 'Anyone · Bike · 2 of 12 activities · Keep on 60 s');
    assert.deepEqual([...zone.querySelectorAll('.ns-card-title .badge')].map((badge) => badge.textContent),
      ['Heart-rate zone', 'Owner', 'Zone 3+', 'Occupancy sensor']);
    assert.equal(zone.querySelector('.ns-card-summary').textContent, 'Owner · Zone 3+ · Hold 25 s');
    // The summary and the badges share the title cluster, which wraps under the name at narrow widths; the actions cluster is separate.
    assert.ok(workout.querySelector('.ns-card-title .ns-card-summary'));
    assert.equal(workout.querySelector('.ns-card-title .ns-collapse-toggle'), null);
  });

  it('toggles on a click anywhere on the row, on Enter and Space, and on the link, without rebuilding the card', () => {
    const { root } = mount(TWO_TRIGGERS);
    const card = root.querySelector('[data-trigger="t1"]');
    const header = card.querySelector('.card-header');
    const body = card.querySelector('.card-body');
    const summary = card.querySelector('.ns-card-summary');
    resizes.count = 0;
    header.click();
    assert.equal(header.getAttribute('aria-expanded'), 'true');
    assert.equal(body.hidden, false);
    assert.equal(card.querySelector('.card-footer').hidden, false);
    assert.equal(card.querySelector('.ns-collapse-toggle').textContent, 'Done');
    assert.equal(card.querySelector('.ns-help-toggle').hidden, false);
    assert.equal(card.querySelector('.ns-help-toggle').textContent, 'Hide help');
    assert.equal(summary.hidden, true, 'no summary while open');
    assert.equal(summary.textContent, '');
    assert.equal(card.querySelector('.card-body'), body, 'the body is the same node: the card opened in place');
    assert.equal(resizes.count, 1, 'a toggle asks the host to size the iframe again');

    header.dispatchEvent({ type: 'keydown', key: 'Enter', target: header });
    assert.equal(header.getAttribute('aria-expanded'), 'false');
    header.dispatchEvent({ type: 'keydown', key: ' ', target: header });
    assert.equal(header.getAttribute('aria-expanded'), 'true');
    card.querySelector('.ns-collapse-toggle').click();
    assert.equal(header.getAttribute('aria-expanded'), 'false');
    assert.equal(summary.textContent, 'Anyone · Bike · 2 of 12 activities · Keep on 60 s');

    // The help toggle handles its own click: the card stays as it is.
    header.click();
    card.querySelector('.ns-help-toggle').click();
    assert.equal(header.getAttribute('aria-expanded'), 'true');
    assert.equal(card.classList.contains('ns-help-hidden'), true);
    assert.equal(card.querySelector('.ns-help-toggle').textContent, 'Show help');
  });

  it('opens the only trigger, a new trigger and a duplicate expanded', () => {
    const one = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }], triggers: [{ id: 't1', type: 'workout', name: 'Workout' }] });
    assert.equal(one.root.querySelector('[data-trigger="t1"] .card-header').getAttribute('aria-expanded'), 'true', 'the only card opens expanded');
    one.root.querySelector('[data-trigger="t1"] .card-header').click();
    one.page.rerender('triggers', false);
    assert.equal(one.root.querySelector('[data-trigger="t1"] .card-header').getAttribute('aria-expanded'), 'false', 'a card the user closed stays closed');

    const { page, root } = mount(TWO_TRIGGERS);
    root.querySelector('[data-trigger="t1"] .card-header').click();
    buttonNamed(root, 'Duplicate trigger').click();
    const copy = page.config.triggers[1];
    assert.equal(copy.name, 'Workout copy');
    const copyCard = root.querySelector(`[data-trigger="${copy.id}"]`);
    assert.equal(copyCard.querySelector('.card-header').getAttribute('aria-expanded'), 'true');
    assert.equal(dom.document.activeElement, copyCard.querySelector('[data-path$=".name"] input'), 'a duplicate focuses its Name');
    assert.equal(root.querySelector('[data-trigger="t2"] .card-header').getAttribute('aria-expanded'), 'false');
  });

  it('places every field of a card in a grid cell, full rows at 12 columns, since the shell grid places nothing by itself', () => {
    const { root } = mount(TWO_TRIGGERS);
    for (const id of ['t1', 't2']) {
      const grid = root.querySelector(`[data-trigger="${id}"] .card-body .ns-grid`);
      const cells = [...grid.children];
      assert.ok(cells.length >= 5);
      for (const cell of cells) {
        assert.match(cell.className, /^ns-span-(3|6|12)$/, `${id}: ${cell.className}`);
      }
    }
    const spans = [...root.querySelector('[data-trigger="t1"] .card-body .ns-grid').children].map((cell) => cell.className);
    assert.deepEqual(spans, ['ns-span-12', 'ns-span-12', 'ns-span-6', 'ns-span-6', 'ns-span-12', 'ns-span-6']);
    for (const section of ['polling', 'settings']) {
      for (const cell of root.querySelectorAll(`#section-${section} .ns-grid > *`)) {
        assert.match(cell.className, /^ns-span-(6|12)$/, `${section}: ${cell.className}`);
      }
    }
  });

  it('keeps the footer to Remove and Duplicate with no primary action', () => {
    const { root } = mount(TWO_TRIGGERS);
    root.querySelector('[data-trigger="t1"] .card-header').click();
    const footer = root.querySelector('[data-trigger="t1"] .card-footer');
    assert.equal(footer.querySelector('.ns-footer-right').children.length, 0);
    assert.deepEqual([...footer.querySelectorAll('button')].map((button) => button.textContent), ['Remove trigger', 'Duplicate trigger']);
    assert.match(footer.querySelector('.ns-danger-link').className, /\btext-danger\b/);
  });
});

describe('settings section', () => {
  it('renders every field under a collapsed Advanced disclosure, in order, and nothing on the page grid', () => {
    const { root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }] });
    const section = root.querySelector('#section-settings');
    assert.equal(section.querySelector('.section-copy').textContent, 'Options that apply to the whole plugin.');
    assert.equal(section.querySelector('.section-body > .ns-grid'), null, 'no field sits outside Advanced');
    assert.equal(section.querySelector('.section-body > [data-path]'), null);
    const advanced = section.querySelector('details.ns-advanced');
    assert.equal(advanced.querySelector('summary').textContent, 'Advanced');
    assert.equal(advanced.open, false, 'collapsed while every setting is at its default');
    assert.deepEqual([...advanced.querySelectorAll('[data-path]')].map((node) => node.dataset.path),
      ['name', 'debug', 'advanced.fastSwitchAutoOffMinutes', 'advanced.attentionSensor', 'advanced.dailyCheckIn', 'restore']);
    assert.deepEqual([...advanced.querySelectorAll('.form-label')].map((node) => node.textContent), [
      'Name*', 'Fast polling switch turns off after (minutes)', 'Daily check-in time', 'Restore from backup',
    ]);
    assert.deepEqual([...advanced.querySelectorAll('.form-check-label')].map((node) => node.textContent), ['Debug logging', 'Attention needed sensor']);
    assert.equal(advanced.querySelector('[data-path="restore"] .form-text').textContent,
      'Choose a backup file. It is checked before anything changes; if it passes, the form is replaced with its contents and Save is enabled.');
  });

  it('opens Advanced when Name or Debug logging is not at its default, when a field inside turns invalid, and when a summary entry targets one', () => {
    const named = mount({ name: 'Bike room' });
    assert.equal(named.root.querySelector('#section-settings details').open, true);
    const debug = mount({ debug: true });
    assert.equal(debug.root.querySelector('#section-settings details').open, true);

    const { page, root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }] });
    const details = root.querySelector('#section-settings details');
    assert.equal(details.open, false);
    const name = root.querySelector('[data-path="name"] input');
    name.value = '';
    name.dispatchEvent('input');
    name.dispatchEvent('focusout');
    assert.equal(details.open, true, 'an invalid field inside opens the disclosure');
    assert.equal(root.querySelector('[data-path="name"] .invalid-feedback').textContent, 'Name is required.');

    details.open = false;
    page.touched.clear();
    page.revalidate();
    assert.equal(details.open, false);
    const entry = root.querySelector('[data-issue-path="name"]');
    assert.equal(entry.textContent, 'Settings: Name is required.');
    entry.click();
    assert.equal(details.open, true, 'a summary entry opens the disclosure');
    assert.equal(dom.document.activeElement, name, 'and focuses the control itself');
  });
});

describe('summary box', () => {
  it('sits in the page flow after the sections and before the closing paragraph, in the warning tone with no shadow class', () => {
    const { root } = mount({ triggers: [{ id: 't1', type: 'workout', name: '' }] });
    const children = [...root.children];
    const box = root.querySelector('.ns-issues');
    const at = children.indexOf(box);
    assert.ok(at > children.indexOf(root.querySelector('#section-settings')), 'after Settings');
    assert.equal(children[at + 1].textContent.startsWith('After saving, restart Homebridge.'), true, 'before the closing paragraph');
    assert.equal(children.at(-1).tagName, 'FOOTER');
    assert.equal(box.className, 'issues ns-issues alert alert-warning');
    assert.equal(box.getAttribute('role'), 'alert');
  });

  it('lists "{Card}: {Label} is required." from the label table and focuses the named control without rebuilding the section', () => {
    const { page, root } = mount({ triggers: [{ id: 't1', type: 'workout', name: '' }, { id: 't2', type: 'workout', name: 'Rides' }] });
    const entries = [...root.querySelectorAll('.ns-issue-list li')];
    assert.deepEqual(entries.map((li) => li.textContent), ['New trigger: Name is required.']);
    const link = entries[0].querySelector('.ns-issue-link');
    assert.equal(link.getAttribute('data-issue-path'), 'triggers[0].name');
    const card = root.querySelector('[data-trigger="t1"]');
    const input = card.querySelector('[data-path="triggers[0].name"] input');
    assert.equal(card.querySelector('.card-header').getAttribute('aria-expanded'), 'false');
    link.click();
    assert.equal(root.querySelector('[data-trigger="t1"]'), card, 'the card is the same node');
    assert.equal(card.querySelector('.card-header').getAttribute('aria-expanded'), 'true', 'the collapsed card opened first');
    assert.equal(dom.document.activeElement, input, 'the control itself has focus');
    assert.equal(root.querySelector('.ns-issue-list li'), entries[0], 'the entry list was not rebuilt');
    assert.ok(page.touched.has('triggers[0].name'));
    assert.equal(card.querySelector('[data-path="triggers[0].name"] .invalid-feedback').textContent, 'Name is required.');
    assert.equal(save.enabled, false);

    // Fixing the field removes its entry in place; the box goes away with the last one.
    input.value = 'Morning ride';
    input.dispatchEvent('input');
    input.dispatchEvent('focusout');
    assert.equal(root.querySelectorAll('.ns-issue-list li').length, 0);
    assert.equal(root.querySelector('.ns-issues').hidden, true);
    assert.equal(save.enabled, true);
  });

  it('names the Polling section for the conflict and focuses the Fast polling switch checkbox', () => {
    const { root } = mount({ polling: { fastSwitch: false, standbyInterval: 0 } });
    const entry = root.querySelector('[data-issue-path="polling"]');
    assert.equal(entry.textContent, 'Polling: With no fast polling switch and standby at 0 the plugin would never poll. Turn one of them back on.');
    entry.click();
    assert.equal(dom.document.activeElement, root.querySelector('[data-path="polling.fastSwitch"] input'));
  });

  it('collapses past three entries to a count with Show all, and reads Nothing to save yet on a fresh install with Save disabled', () => {
    const { page, root } = mount({
      triggers: [{ id: 't1', type: 'workout', name: '' }, { id: 't2', type: 'hrZone', name: 'Zone', who: '' }],
      polling: { fastInterval: 1, standbyInterval: 5 },
    });
    assert.equal(root.querySelector('.ns-issues .fw-semibold').textContent, '4 fields need attention');
    assert.equal(root.querySelector('.ns-issue-list').hidden, true);
    const toggle = root.querySelector('.ns-issues-toggle');
    assert.equal(toggle.textContent, 'Show all');
    toggle.click();
    assert.equal(root.querySelector('.ns-issue-list').hidden, false);
    assert.equal(toggle.textContent, 'Hide');
    assert.equal(page.issuesExpanded, true);

    const fresh = mount({});
    assert.equal(fresh.root.querySelector('.ns-issues').hidden, false);
    assert.equal(fresh.root.querySelector('.ns-issues').className, 'issues ns-issues alert alert-secondary');
    assert.equal(fresh.root.querySelector('.ns-issues .fw-semibold').textContent, 'Nothing to save yet');
    assert.equal(save.enabled, false);
  });
});

describe('unsaved draft', () => {
  it('writes a draft only after a change, without passwords', () => {
    const { page, root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com', password: 'secret' }] });
    page.rerender('triggers', false);
    runTimeouts();
    assert.equal(stored.has(DRAFT_KEY), false, 'the load and its pushes write no draft');
    const standby = root.querySelector('[data-path="polling.standbyInterval"] input');
    standby.value = '60';
    standby.dispatchEvent('input');
    const block = pushedBlock();
    assert.equal(block.polling.standbyInterval, 60);
    assert.equal(block.accounts[0].password, 'secret', 'the host gets the password');
    const draft = readDraft();
    assert.equal(draft.config.polling.standbyInterval, 60);
    assert.equal('password' in draft.config.accounts[0], false, 'the draft never holds one');
    assert.equal(JSON.stringify(stored.get(DRAFT_KEY)).includes('secret'), false);
  });

  it('is never offered on a page that opens with no saved Peloton configuration, and a stale one is removed there', () => {
    stored.set(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), config: { platform: 'Peloton', name: 'Bike room' } }));
    assert.equal(pendingDraft(readConfig({}), false), undefined);
    assert.equal(stored.has(DRAFT_KEY), false);
    stored.set(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), config: { platform: 'Peloton', name: 'Bike room' } }));
    const offered = pendingDraft(readConfig({ name: 'Peloton' }), true);
    assert.equal(offered.config.name, 'Bike room', 'offered over a saved configuration it differs from');
    stored.set(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), config: { platform: 'Peloton', name: 'Bike room' } }));
    assert.equal(pendingDraft(readConfig({ name: 'Bike room' }), true), undefined, 'a draft equal to the saved configuration is removed');
    assert.equal(stored.has(DRAFT_KEY), false);
  });

  it('offers the draft bar under the banner; Restore keeps the stored passwords, Discard removes the draft', () => {
    const draft = { savedAt: Date.now(), config: { platform: 'Peloton', name: 'Bike room', accounts: [{ id: 'a1', email: 'owner@example.com' }] } };
    const { page, root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com', password: 'secret' }] }, STATUS, draft);
    const bar = root.querySelector('.ns-draft-banner');
    assert.equal(bar.hidden, false);
    assert.equal(root.children[1], bar, 'directly under the banner');
    assert.equal(bar.querySelector('.ns-draft-message').textContent, 'You have unsaved changes from earlier. Restore them?');
    assert.match(bar.querySelector('.ns-draft-restore').className, /\bbtn-primary\b/);
    bar.querySelector('.ns-draft-restore').click();
    assert.equal(bar.hidden, true);
    assert.equal(page.config.name, 'Bike room');
    assert.equal(pushedBlock().accounts[0].password, 'secret', 'the stored password came back from the saved configuration');
    assert.ok(page.touched.has('name'), 'every field of a restored draft counts as touched');

    stored.set(DRAFT_KEY, 'x');
    const again = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }] }, STATUS, draft);
    stored.set(DRAFT_KEY, 'x');
    again.root.querySelector('.ns-draft-discard').click();
    assert.equal(again.root.querySelector('.ns-draft-banner').hidden, true);
    assert.equal(stored.has(DRAFT_KEY), false);
  });
});

describe('polling section', () => {
  it('always shows the switch Name, counts connected and checking accounts in the estimate, and dismisses the callout with a link', () => {
    const { page, root } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }], polling: { fastSwitch: false } });
    assert.equal(root.querySelector('[data-path="polling.fastSwitchName"]').hidden, false);
    assert.equal(root.querySelector('.ns-estimate').textContent, 'About 30 requests per hour in standby with 1 account.');
    page.accountsUi.checking.add('u-member-0002');
    page.rerender('polling', false);
    assert.equal(root.querySelector('.ns-estimate').textContent, 'About 60 requests per hour in standby with 2 accounts.');
    const none = mount({ accounts: [{ id: 'a1', email: 'x@example.com' }, { id: 'a2', email: 'y@example.com' }] }, { ...STATUS, accounts: [] });
    assert.equal(none.root.querySelector('.ns-estimate').textContent, 'About 60 requests per hour in standby with 2 accounts.');

    const dismiss = root.querySelector('.ns-callout .ns-callout-dismiss');
    assert.equal(dismiss.textContent, 'Dismiss');
    assert.match(dismiss.className, /\bbtn-link\b/);
    assert.equal(root.querySelector('.ns-callout .ns-help-link').textContent, 'Read how to set this up');
    dismiss.click();
    assert.equal(root.querySelector('.ns-callout'), null);
    assert.equal(pushedBlock().polling.calloutDismissed, true);
  });
});

describe('iframe height', () => {
  it('asks the host to size the iframe after every render and after the summary box changes', () => {
    resizes.count = 0;
    const { page } = mount({ accounts: [{ id: 'a1', email: 'owner@example.com' }], triggers: [{ id: 't1', type: 'workout', name: 'Workout' }] });
    assert.ok(resizes.count >= 1, 'renderAll asks once the page is built');

    resizes.count = 0;
    page.rerender('triggers', false);
    assert.equal(resizes.count, 1, 'a section render without revalidation asks once');

    resizes.count = 0;
    page.rerender('triggers');
    assert.equal(resizes.count, 1, 'a section render with revalidation asks once, from revalidate');

    resizes.count = 0;
    page.config.triggers[0].name = '';
    page.touched.add('triggers[0].name');
    page.revalidate();
    assert.equal(resizes.count, 1, 'the summary box appearing asks again');
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
