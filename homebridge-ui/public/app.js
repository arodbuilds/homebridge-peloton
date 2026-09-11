/**
 * The settings page (design/README.md). Reads the platform block with getPluginConfig, pushes every
 * change with updatePluginConfig, and leaves saving to the Homebridge UI's Save button, which is
 * disabled while validation finds errors. Account state comes from the plugin's UI server (SPEC
 * section 10); tokens never reach this page.
 */

import { callServer, setSaveEnabled, toastError } from './api.js';
import { DRAFT, FOOTER, PAGE, POLLING, RECONNECT_BANNER, SECTIONS, TRIGGERS, VALIDATION } from './copy.js';
import { button, clear, el, focusField, linkButton } from './dom.js';
import { clearDraft, exportConfig, exportConfigWithoutPasswords, isFreshConfig, readConfig, readDraft, saveDraft, stableStringify, validate } from './model.js';
import { renderAccounts } from './accounts.js';
import { renderPolling } from './polling.js';
import { renderSettings } from './settings.js';
import { renderTriggers } from './triggers.js';

const SECTION_LIST = [
  { key: 'accounts', title: SECTIONS.accounts, render: renderAccounts },
  { key: 'triggers', title: SECTIONS.triggers, render: renderTriggers },
  { key: 'polling', title: SECTIONS.polling, render: renderPolling },
  { key: 'settings', title: SECTIONS.settings, render: renderSettings },
];

const CONTROLS = [
  ':scope > .ns-control > .form-control',
  ':scope > .ns-control > .form-select',
  ':scope > .ns-control > .input-group > .form-control',
  ':scope > .form-check-input',
].join(', ');

/** The footer glyph (assets/peloton-footer.svg) inlined so it follows the host theme through currentColor. */
function footerMark() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('aria-hidden', 'true');
  const shapes = [
    ['rect', { x: '3', y: '7', width: '4', height: '10' }],
    ['rect', { x: '17', y: '7', width: '4', height: '10' }],
    ['path', { d: 'M7 12H17', 'stroke-width': '2' }],
    ['rect', { x: '8', y: '10', width: '4', height: '4', fill: 'currentColor', stroke: 'none' }],
  ];
  for (const [tag, attrs] of shapes) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, value);
    }
    svg.appendChild(node);
  }
  return svg;
}

function outLink(text, href) {
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
}

function renderFooter(version) {
  const item = (...children) => el('span', { class: 'ns-footer-item' }, ...children);
  const label = document.createTextNode(version ? `${FOOTER.name} v${version}` : FOOTER.name);
  return el('footer', { class: 'ns-footer' },
    item(el('span', { class: 'ns-mark-label' }, footerMark(), label)), ' · ',
    item(FOOTER.madeBy), ' · ',
    item(outLink(FOOTER.site, FOOTER.siteUrl)), ' · ',
    item(outLink(FOOTER.issues, FOOTER.issuesUrl)),
  );
}

/** True when path is prefix itself or a field under it. */
function underPath(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

function isTouchDevice() {
  try {
    return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

class Page {
  constructor(root, config, status, pendingDraft) {
    this.root = root;
    this.config = config;
    this.status = status;
    this.otherBlocks = [];
    this.containers = new Map();
    this.touched = new Set();
    this.shown = new Map();
    this.fresh = new WeakSet();
    this.pushTimer = undefined;
    this.issuesExpanded = false;
    this.accountsUi = { panel: null, checking: new Set(), results: new Map(), avatars: new Map() };
    this.triggersUi = { expanded: new Set(), chooserOpen: false, helpHidden: new Set() };
    this.settingsUi = { advancedOpen: false };

    root.appendChild(el('img', { class: 'ns-banner', src: 'peloton-banner.png', alt: PAGE.bannerAlt }));
    this.draftBanner = el('div', { class: 'ns-draft-banner', role: 'status', hidden: true });
    root.appendChild(this.draftBanner);
    if (pendingDraft) {
      this.offerDraft(pendingDraft);
    }
    this.reconnectBanner = el('div', { class: 'ns-reconnect-banner', role: 'status', hidden: true });
    root.appendChild(this.reconnectBanner);
    root.appendChild(el('p', { class: 'ns-lead' }, PAGE.lead1));
    root.appendChild(el('p', { class: 'ns-lead' }, PAGE.lead2));
    root.appendChild(el('p', { class: 'ns-lead-note form-text' }, PAGE.leadNote));
    for (const section of SECTION_LIST) {
      const container = el('div', { class: 'ns-section-body' });
      this.containers.set(section.key, container);
      root.appendChild(el('section', { class: 'ns-section', id: `section-${section.key}` }, el('h2', {}, section.title), container));
    }
    this.issuesHeading = el('span', { class: 'ns-issues-heading' }, VALIDATION.heading);
    this.issuesToggle = linkButton(VALIDATION.showAll, () => {
      this.issuesExpanded = !this.issuesExpanded;
      this.revalidate();
    }, 'ns-issues-toggle');
    this.issuesToggle.hidden = true;
    this.issuesList = el('ul', { class: 'ns-issue-list' });
    this.issuesBox = el('div', { class: 'ns-issues', role: 'alert', hidden: true },
      el('div', { class: 'ns-issues-head' }, this.issuesHeading, this.issuesToggle), this.issuesList);
    root.appendChild(this.issuesBox);
    root.appendChild(el('p', { class: 'ns-closing' }, PAGE.closing));
    root.appendChild(renderFooter(status?.version));

    // Validate on blur: leaving a control, or changing a select, checkbox or radio, touches its field. Typing alone does not.
    root.addEventListener('focusout', (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) {
        this.touchControl(event.target);
      }
    });
    root.addEventListener('change', (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('select, input[type="checkbox"], input[type="radio"]')) {
        this.touchControl(event.target);
      }
    });
  }

  now() {
    return Date.now();
  }

  setOtherBlocks(blocks) {
    this.otherBlocks = blocks;
  }

  renderAll() {
    for (const section of SECTION_LIST) {
      this.rerender(section.key, false);
    }
    this.revalidate();
  }

  rerender(section, revalidate = true) {
    const container = this.containers.get(section);
    if (!container) {
      return;
    }
    clear(container);
    SECTION_LIST.find((entry) => entry.key === section)?.render(this, container);
    if (section === 'accounts') {
      this.updateReconnectBanner();
    }
    if (revalidate) {
      this.revalidate();
    }
  }

  /** A value changed: revalidate and push the block to the host. */
  changed() {
    this.revalidate();
    this.push();
  }

  replaceConfig(config, reason) {
    this.config = config;
    this.touched.clear();
    this.shown.clear();
    this.triggersUi.expanded.clear();
    this.triggersUi.chooserOpen = false;
    if (reason === 'restore') {
      // Every field of a restored configuration counts as touched so its errors show at once.
      this.renderAll();
      this.touchAll();
    } else {
      this.renderAll();
    }
    this.push();
  }

  /* --------------------------------------------------------------------------------------------
   * Accounts: server state, avatars, connect results, removal
   * ------------------------------------------------------------------------------------------ */

  /**
   * Every member the page knows, from the server's account list and the configured accounts:
   * userId, the name to show, and whether the member is connected. Who dropdowns are built from it.
   */
  members() {
    const members = [];
    const seen = new Set();
    for (const summary of this.status?.accounts ?? []) {
      if (summary.userId && !seen.has(summary.userId)) {
        seen.add(summary.userId);
        const account = this.config.accounts.find((entry) => entry.id === summary.id);
        const name = summary.displayName || account?.displayName || summary.username || summary.userId;
        members.push({ userId: summary.userId, name, connected: summary.state === 'connected' });
      }
    }
    for (const account of this.config.accounts) {
      if (account.userId && !seen.has(account.userId)) {
        seen.add(account.userId);
        members.push({ userId: account.userId, name: account.displayName || account.email || account.userId, connected: false });
      }
    }
    return members;
  }

  async refreshStatus() {
    const result = await callServer('/status');
    if (result.ok) {
      this.status = { accounts: result.accounts, devices: result.devices, version: result.version };
    }
    this.rerender('accounts', false);
    // Who dropdowns and the Not connected warning follow the account states.
    this.rerender('triggers', false);
    this.rerender('polling', false);
    this.revalidate();
  }

  /** The avatar as a data URL for an account, asked once from /avatar; null when the profile uses the default image. */
  async loadAvatar(id) {
    const cache = this.accountsUi.avatars;
    if (cache.has(id)) {
      return cache.get(id);
    }
    const pending = callServer('/avatar', { id }).then((result) => {
      const src = result.ok && result.status === 200 && typeof result.data === 'string' ? `data:${result.contentType};base64,${result.data}` : null;
      cache.set(id, src);
      return src;
    });
    cache.set(id, pending);
    return pending;
  }

  /**
   * A connect finished on the server: the config entry is created or updated (email, the entered
   * password, userId and display name from the profile), the card flips to Connected with a brief
   * "Connected as @username", and the account list is re-read so household profiles appear.
   */
  async applyConnected(panel, summary, entered) {
    const id = panel.accountId;
    let account = this.config.accounts.find((entry) => entry.id === id);
    if (!account) {
      account = { id, email: '', displayName: '', userId: '', storedPassword: undefined, newPassword: undefined };
      this.config.accounts.push(account);
    }
    if (entered.email) {
      account.email = entered.email;
    }
    if (entered.password) {
      account.newPassword = entered.password;
    }
    if (summary.userId) {
      account.userId = summary.userId;
    }
    if (!account.displayName && summary.displayName) {
      account.displayName = summary.displayName;
    }
    if (this.status) {
      this.status.accounts = this.status.accounts.filter((entry) => entry.id !== id && !(entry.id === summary.userId && entry.state === 'not_connected'));
      this.status.accounts.push(summary);
    }
    this.accountsUi.panel = null;
    this.accountsUi.results.set(id, { tone: 'success', text: summary.username ? `Connected as @${summary.username}` : 'Connected' });
    window.setTimeout(() => {
      this.accountsUi.results.delete(id);
      this.rerender('accounts', false);
    }, 6000);
    this.changed();
    await this.refreshStatus();
  }

  /** Remove on an account card: the store file goes through /remove and the config entry is dropped. */
  async removeAccount(view) {
    await callServer('/remove', { id: view.key });
    const at = this.config.accounts.findIndex((entry) => entry.id === view.key);
    if (at >= 0) {
      this.config.accounts.splice(at, 1);
    }
    if (this.status) {
      this.status.accounts = this.status.accounts.filter((entry) => entry.id !== view.key);
    }
    this.accountsUi.results.delete(view.key);
    this.accountsUi.avatars.delete(view.key);
    this.rerender('accounts', false);
    this.rerender('triggers', false);
    this.changed();
  }

  updateReconnectBanner() {
    const n = (this.status?.accounts ?? []).filter((account) => account.state === 'reconnect_needed').length;
    this.reconnectBanner.hidden = n === 0;
    this.reconnectBanner.textContent = n === 1 ? RECONNECT_BANNER.one : RECONNECT_BANNER.many(n);
  }

  /* --------------------------------------------------------------------------------------------
   * Fresh cards and touched fields
   * ------------------------------------------------------------------------------------------ */

  addFresh(item) {
    this.fresh.add(item);
  }

  watchCard(card, item) {
    if (!this.fresh.has(item)) {
      return;
    }
    const touch = () => {
      if (this.fresh.has(item)) {
        this.fresh.delete(item);
        this.revalidate();
      }
    };
    card.addEventListener('focusout', (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) {
        touch();
      }
    });
    card.addEventListener('change', touch);
  }

  entryRemoved(listPath, index) {
    const prefix = `${listPath}[`;
    const next = new Set();
    for (const path of this.touched) {
      if (!path.startsWith(prefix)) {
        next.add(path);
        continue;
      }
      const match = /^(\d+)\](.*)$/.exec(path.slice(prefix.length));
      if (!match) {
        next.add(path);
        continue;
      }
      const n = Number(match[1]);
      if (n < index) {
        next.add(path);
      } else if (n > index) {
        next.add(`${prefix}${n - 1}]${match[2]}`);
      }
    }
    this.touched = next;
    this.shown.clear();
    this.changed();
  }

  touchControl(control) {
    const path = control.closest('[data-path]')?.dataset.path;
    if (!path) {
      return;
    }
    this.touched.add(path);
    this.revalidate();
  }

  touchAll() {
    for (const node of this.root.querySelectorAll('[data-path]')) {
      if (node.dataset.path) {
        this.touched.add(node.dataset.path);
      }
    }
    this.revalidate();
  }

  /** A summary entry was clicked: the field counts as touched, its card opens, the page scrolls to it and it takes focus. */
  jumpTo(path) {
    this.touched.add(path);
    const cardMatch = /^triggers\[(\d+)\]/.exec(path);
    if (cardMatch) {
      const trigger = this.config.triggers[Number(cardMatch[1])];
      if (trigger && !this.triggersUi.expanded.has(trigger.id)) {
        this.triggersUi.expanded.add(trigger.id);
        this.rerender('triggers', false);
      }
    }
    this.revalidate();
    const target = path === 'polling' ? 'polling.fastSwitch' : path;
    const node = this.root.querySelector(`[data-path="${CSS.escape(target)}"]`);
    if (!node) {
      return;
    }
    for (let details = node.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
      details.open = true;
    }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    focusField(node);
  }

  /* --------------------------------------------------------------------------------------------
   * Validation, the summary box, and Save
   * ------------------------------------------------------------------------------------------ */

  freshCards() {
    const out = [];
    this.config.triggers.forEach((trigger, i) => {
      if (this.fresh.has(trigger)) {
        out.push(`triggers[${i}]`);
      }
    });
    return out;
  }

  revealed(issue) {
    for (const path of this.touched) {
      if (underPath(path, issue.path) || issue.related?.some((prefix) => underPath(path, prefix))) {
        return true;
      }
    }
    return false;
  }

  revalidate() {
    const all = validate(this.config, { newTriggerTitle: TRIGGERS.newTrigger, pollingConflictMessage: POLLING.conflict });
    const fresh = this.freshCards();
    const onFresh = (issue) => fresh.some((card) => underPath(issue.path, card));
    const listed = all.filter((issue) => !onFresh(issue));
    const held = all.filter(onFresh);
    this.markIssues(all);

    clear(this.issuesList);
    const byPath = new Map();
    for (const issue of listed) {
      if (!byPath.has(issue.path)) {
        byPath.set(issue.path, issue);
      }
    }
    for (const issue of byPath.values()) {
      const link = button('', () => this.jumpTo(issue.path), 'ns-issue-link');
      link.appendChild(el('strong', {}, `${issue.label}: `));
      link.appendChild(document.createTextNode(issue.message));
      link.setAttribute('data-issue-path', issue.path);
      this.issuesList.appendChild(el('li', {}, link));
    }
    const nothingToSave = all.length === 0 && isFreshConfig(this.config);
    this.issuesToggle.hidden = true;
    this.issuesList.hidden = false;
    this.issuesBox.classList.remove('ns-issues-quiet');
    if (byPath.size > 0) {
      const collapsible = byPath.size > VALIDATION.collapseAfter;
      const collapsed = collapsible && !this.issuesExpanded;
      this.issuesHeading.textContent = collapsed ? VALIDATION.count(byPath.size) : VALIDATION.heading;
      this.issuesList.hidden = collapsed;
      this.issuesToggle.hidden = !collapsible;
      this.issuesToggle.textContent = collapsed ? VALIDATION.showAll : VALIDATION.hide;
      this.issuesBox.setAttribute('role', 'alert');
    } else if (held.length > 0) {
      this.issuesHeading.textContent = VALIDATION.finishNew;
      this.issuesBox.classList.add('ns-issues-quiet');
      this.issuesBox.setAttribute('role', 'status');
    } else if (nothingToSave) {
      this.issuesHeading.textContent = VALIDATION.nothingToSave;
      this.issuesBox.classList.add('ns-issues-quiet');
      this.issuesBox.setAttribute('role', 'status');
    }
    this.issuesBox.hidden = all.length === 0 && !nothingToSave;
    setSaveEnabled(all.length === 0 && !nothingToSave);
  }

  hasValue(node) {
    const control = node.querySelector(CONTROLS);
    if (!control || (control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio'))) {
      return false;
    }
    return control.value.trim().length > 0;
  }

  /** Inline state of every field: the first issue on a touched field under it, a green check on a touched required field that passes. */
  markIssues(issues) {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.closest('[data-path]') : null;
    const activePath = active?.dataset.path;
    const byPath = new Map();
    for (const issue of issues) {
      if (!byPath.has(issue.path)) {
        byPath.set(issue.path, issue);
      }
    }
    const shown = new Map();
    for (const node of this.root.querySelectorAll('[data-path]')) {
      const path = node.dataset.path ?? '';
      const issue = byPath.get(path);
      let message;
      if (issue && this.revealed(issue)) {
        message = path === activePath ? this.shown.get(path) : issue.message;
      }
      const feedback = node.querySelector(':scope > .invalid-feedback');
      const controls = node.querySelectorAll(CONTROLS);
      if (message !== undefined) {
        shown.set(path, message);
        node.classList.add('has-issue');
        if (feedback) {
          feedback.textContent = message;
        }
        for (const control of controls) {
          control.classList.add('is-invalid');
          control.classList.remove('ns-valid');
        }
        for (let details = node.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
          details.open = true;
        }
        continue;
      }
      node.classList.remove('has-issue');
      if (feedback) {
        feedback.textContent = '';
      }
      const required = node.querySelector(':scope > .form-label .text-danger') !== null;
      const valid = !issue && required && this.touched.has(path) && this.hasValue(node);
      for (const control of controls) {
        control.classList.remove('is-invalid');
        control.classList.toggle('ns-valid', valid);
      }
    }
    this.shown = shown;
  }

  /* --------------------------------------------------------------------------------------------
   * Pushing to the host and the unsaved draft
   * ------------------------------------------------------------------------------------------ */

  push() {
    if (this.pushTimer !== undefined) {
      window.clearTimeout(this.pushTimer);
    }
    this.pushTimer = window.setTimeout(() => {
      this.pushTimer = undefined;
      const block = exportConfig(this.config);
      saveDraft(exportConfigWithoutPasswords(this.config));
      window.homebridge.updatePluginConfig([block, ...this.otherBlocks]).catch((error) => {
        toastError(`Could not update the configuration: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 150);
  }

  offerDraft(draft) {
    const hide = () => {
      this.draftBanner.hidden = true;
      clear(this.draftBanner);
    };
    const restore = button(DRAFT.restore, () => {
      hide();
      // The draft holds no passwords; the stored ones stay with the accounts they belong to.
      const restored = readConfig(draft.config);
      for (const account of restored.accounts) {
        const current = this.config.accounts.find((entry) => entry.id === account.id);
        account.storedPassword = current?.storedPassword;
      }
      this.replaceConfig(restored, 'restore');
    }, 'btn btn-primary btn-sm ns-small ns-draft-restore');
    const discard = button(DRAFT.discard, () => {
      clearDraft();
      hide();
    }, 'btn btn-outline-secondary btn-sm ns-small ns-draft-discard');
    this.draftBanner.appendChild(el('span', { class: 'ns-draft-message' }, DRAFT.message));
    this.draftBanner.appendChild(el('span', { class: 'd-inline-flex gap-2', style: 'display:inline-flex;gap:8px' }, restore, discard));
    this.draftBanner.hidden = false;
  }
}

/** A draft that differs from the configuration about to be shown; one equal to it means the changes were saved and is removed. */
function pendingDraft(config) {
  const draft = readDraft();
  if (!draft) {
    return undefined;
  }
  if (stableStringify(exportConfigWithoutPasswords(readConfig(draft.config))) === stableStringify(exportConfigWithoutPasswords(config))) {
    clearDraft();
    return undefined;
  }
  return draft;
}

async function start() {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }
  if (isTouchDevice()) {
    document.body.classList.add('ns-touch');
  }
  const hb = window.homebridge;
  hb.showSpinner();
  try {
    const blocks = await hb.getPluginConfig();
    const index = blocks.findIndex((block) => block && typeof block === 'object' && block.platform === 'Peloton');
    const config = readConfig(index >= 0 ? blocks[index] : undefined);
    const statusResult = await callServer('/status');
    const status = statusResult.ok
      ? { accounts: statusResult.accounts, devices: statusResult.devices, version: statusResult.version }
      : { accounts: [], devices: [], version: '' };
    if (!statusResult.ok) {
      toastError(PAGE.serverUnavailable);
    }
    const page = new Page(root, config, status, pendingDraft(config));
    page.setOtherBlocks(blocks.filter((_, i) => i !== index));
    page.renderAll();
  } catch (error) {
    root.appendChild(el('div', { class: 'alert alert-danger' }, `${PAGE.loadFailed} ${error instanceof Error ? error.message : String(error)}`));
  } finally {
    hb.hideSpinner();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    start().catch(() => undefined);
  });
} else {
  start().catch(() => undefined);
}
