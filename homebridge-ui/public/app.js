/**
 * The settings page (design/README.md). Reads the platform block with getPluginConfig, pushes every
 * change with updatePluginConfig, and leaves saving to the Homebridge UI's Save button, which is
 * disabled while validation finds errors. Account state comes from the plugin's UI server (SPEC
 * section 10); tokens never reach this page.
 *
 * The page shell (the order of the page, the draft banner, the summary box and its entries, the
 * touched and fresh state, the inline marking, focusField, and the push with the draft) follows the
 * Page class of homebridge-notify-switch v1.3.2 homebridge-ui/src/main.ts, method for method with the
 * types removed; what Peloton adds (accounts, the reconnect banner, the section list, the resize
 * call of SPEC section 10) is marked. design/README.md lists the two.
 */

import { callServer, fixScrollHeight, setSaveEnabled, toastError } from './api.js';
import { PAGE, POLLING, RECONNECT_BANNER, SECTIONS, TRIGGERS, VALIDATION } from './copy.js';
import { DRAFT, ISSUES, SAVE_STATUS } from './shell-copy.js';
import { button, clear, el, linkButton } from './dom.js';
import { clearDraft, readDraft, saveDraft, stableStringify } from './draft.js';
import { renderFooter } from './footer.js';
import { exportConfig, exportConfigWithoutPasswords, isFreshConfig, mergeConnectedAccount, readConfig, removeAccountEntry, validate } from './model.js';
import { pelotonMark } from './peloton-dom.js';
import { avatarSrc, renderAccounts } from './accounts.js';
import { renderPolling } from './polling.js';
import { renderSettings } from './settings.js';
import { renderTriggers } from './triggers.js';

const SECTION_LIST = [
  { key: 'accounts', title: SECTIONS.accounts, render: renderAccounts },
  { key: 'triggers', title: SECTIONS.triggers, render: renderTriggers },
  { key: 'polling', title: SECTIONS.polling, render: renderPolling },
  { key: 'settings', title: SECTIONS.settings, render: renderSettings },
];

/** The controls a field wrapper owns: direct children, or a password input group (shell main.ts). */
const CONTROLS = [
  ':scope > .form-control', ':scope > .form-select', ':scope > .input-group > .form-control', ':scope > .form-check-input',
].join(', ');

/** True on phones and tablets: the page then gives every button a 44px touch target. */
export function isTouchDevice() {
  try {
    return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

/** True when `path` is `prefix` itself or a field under it (`triggers[0]` covers `triggers[0].name`). */
function underPath(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

/** The page. Exported for the node:test suite that renders it on a fake DOM; the Homebridge UI only ever runs start(). */
export class Page {
  constructor(root, config, status, pendingDraft) {
    this.root = root;
    this.config = config;
    this.status = status;
    this.otherBlocks = [];
    this.containers = new Map();
    /** The summary box entries by field path, updated in place by `updateIssueEntries`. */
    this.issueEntries = new Map();
    this.issuesExpanded = false;
    this.pushTimer = undefined;
    /** Triggers added this session whose card nobody has touched yet. */
    this.fresh = new WeakSet();
    /** Fields the user has left (blur), changed (selects and checkboxes) or jumped to from the issue list. */
    this.touched = new Set();
    /** The messages currently shown inline, by path. A focused field only ever loses its message, never gains one. */
    this.shown = new Map();
    /** True while `renderAll` draws the page: the pushes it makes are the load, not a change of the user's. */
    this.rendering = false;
    /** True once the user has changed something on this page; only then is a draft written. */
    this.dirty = false;
    // Peloton page state: the account cards, the trigger cards (which open in place) and the Advanced disclosure.
    this.accountsUi = { panel: null, checking: new Set(), results: new Map(), avatars: new Map() };
    this.triggersUi = { expanded: new Set(), collapsed: new Set(), chooserOpen: false, cards: new Map() };
    this.settingsUi = { advancedOpen: false };

    // The page banner is the first element of the page, served from the plugin's own public folder beside this module.
    root.appendChild(el('img', { class: 'ns-banner', src: 'peloton-banner.png', alt: PAGE.bannerAlt, width: '1280', height: '320' }));
    // Unsaved draft recovery banner, directly under the page banner when a draft waits. Laid out by its own rule,
    // not `d-flex`, whose `!important` display would defeat the `hidden` attribute.
    this.draftBanner = el('div', { class: 'ns-draft-banner alert alert-info', role: 'status', hidden: true });
    root.appendChild(this.draftBanner);
    if (pendingDraft) {
      this.offerDraft(pendingDraft);
    }
    // Peloton: the non-blocking reconnect banner (design/README.md, page order item 3).
    this.reconnectBanner = el('div', { class: 'ns-reconnect-banner alert alert-warning', role: 'status', hidden: true });
    root.appendChild(this.reconnectBanner);
    root.appendChild(el('p', { class: 'lead-copy' }, PAGE.lead1));
    root.appendChild(el('p', { class: 'lead-copy' }, PAGE.lead2));
    root.appendChild(el('p', { class: 'lead-copy form-text ns-lead-note' }, PAGE.leadNote));
    for (const section of SECTION_LIST) {
      const container = el('div', { class: 'section-body' });
      this.containers.set(section.key, container);
      root.appendChild(el('section', { class: 'ns-section', id: `section-${section.key}` }, el('h2', { class: 'h5' }, section.title), container));
    }
    this.issuesList = el('ul', { class: 'mb-0 ps-3 ns-issue-list' });
    this.issuesHeading = el('span', { class: 'fw-semibold' }, ISSUES.heading);
    this.issuesToggle = linkButton(ISSUES.showAll, () => {
      this.issuesExpanded = !this.issuesExpanded;
      this.revalidate();
    }, 'ns-issues-toggle');
    this.issuesToggle.hidden = true;
    // The summary box (the Save status area): the issue list, the "Finish the new trigger" line, or "Nothing to save yet".
    // It sits in the page flow after the sections and before the closing paragraph; the host scrolls the modal.
    this.issuesBox = el('div', { class: 'issues ns-issues alert alert-warning', role: 'alert', hidden: true },
      el('div', { class: 'd-flex flex-wrap align-items-baseline justify-content-between gap-2 mb-1' }, this.issuesHeading, this.issuesToggle),
      this.issuesList);
    root.appendChild(this.issuesBox);
    root.appendChild(el('p', { class: 'lead-copy mt-3' }, PAGE.closing));
    // The footer is the last element of the page.
    root.appendChild(renderFooter(pelotonMark(), status?.version));

    // Touched state per field: leaving a control, or changing a select, checkbox or radio, touches the field
    // wrapper the control sits in. Typing alone does not.
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
    this.rendering = true;
    try {
      for (const section of SECTION_LIST) {
        this.rerender(section.key, false);
      }
      this.revalidate();
    } finally {
      this.rendering = false;
    }
  }

  /** Peloton: a section was rendered or the summary box changed, so the host sizes the iframe to the new content (SPEC section 10). */
  resized() {
    fixScrollHeight();
  }

  /** Redraws one section. With `changed` (the default) the redraw counts as a change of the user's: it is validated and pushed. */
  rerender(section, changed = true) {
    const container = this.containers.get(section);
    if (!container) {
      return;
    }
    clear(container);
    SECTION_LIST.find((entry) => entry.key === section)?.render(this, container);
    if (section === 'accounts') {
      this.updateReconnectBanner();
    }
    if (changed) {
      this.changed();
    } else {
      this.resized();
    }
  }

  /** A value changed: revalidate and push the block to the host. From here on the page keeps a draft. */
  changed() {
    if (!this.rendering) {
      this.dirty = true;
    }
    this.revalidate();
    this.push();
  }

  replaceConfig(config, reason) {
    this.config = config;
    this.touched.clear();
    this.shown.clear();
    this.triggersUi.expanded.clear();
    this.triggersUi.collapsed.clear();
    this.triggersUi.chooserOpen = false;
    if (reason === 'restore') {
      // A restored backup or draft is unsaved work of the user's: it is kept as a draft from here on.
      this.dirty = true;
    }
    this.renderAll();
    if (reason === 'restore') {
      // Every field of a restored configuration counts as touched so its errors show at once.
      this.touchAll();
    }
    this.push();
  }

  /* --------------------------------------------------------------------------------------------
   * Accounts (Peloton): server state, avatars, connect results, removal
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
      const src = avatarSrc(result);
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
    mergeConnectedAccount(this.config, id, summary, entered);
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
    removeAccountEntry(this.config, view.key);
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
   * Fresh cards and touched fields (shell)
   * ------------------------------------------------------------------------------------------ */

  addFresh(item) {
    this.fresh.add(item);
  }

  watchCard(card, item) {
    if (!this.fresh.has(item)) {
      return;
    }
    card.classList.add('ns-fresh');
    const touch = () => {
      if (!this.fresh.has(item)) {
        return;
      }
      this.fresh.delete(item);
      card.classList.remove('ns-fresh');
      this.revalidate();
    };
    // Leaving a field (blur) or changing a select or checkbox counts as touching the card; typing alone does not.
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
      // n === index: the removed entry's fields are forgotten.
    }
    this.touched.clear();
    for (const path of next) {
      this.touched.add(path);
    }
    // The inline messages are redrawn from the new indices on the next validation pass.
    this.shown.clear();
  }

  /**
   * Marks the field wrapper around `control` as touched and redraws the inline messages. A field that was
   * touched before is redrawn too: leaving it is what lets an error typed while it had focus appear.
   */
  touchControl(control) {
    const path = control.closest('[data-path]')?.dataset.path;
    if (!path) {
      return;
    }
    this.touched.add(path);
    this.revalidate();
  }

  touchFields(paths) {
    for (const path of paths) {
      this.touched.add(path);
    }
    this.revalidate();
  }

  /** Every field on the page counts as touched (a restored draft or backup). */
  touchAll() {
    const paths = [];
    for (const node of this.root.querySelectorAll('[data-path]')) {
      if (node.dataset.path) {
        paths.push(node.dataset.path);
      }
    }
    this.touchFields(paths);
  }

  /**
   * A summary box entry was clicked: the field counts as touched so its message shows, and its control (the
   * input, select or checkbox itself) takes focus. A collapsed trigger card or Advanced disclosure holding the
   * field is opened first, in place. Nothing on the page is rebuilt on the click: the inline messages are
   * redrawn in place and the entry list is left as it is, so the control that takes focus is the one already
   * on the page and stays there. Nothing scrolls the page itself: the iframe document is not a scroll
   * container (the host scrolls the modal around it), and moving focus is what brings the field into view.
   */
  focusField(path) {
    this.touched.add(path);
    const cardMatch = /^triggers\[(\d+)\]/.exec(path);
    if (cardMatch) {
      const trigger = this.config.triggers[Number(cardMatch[1])];
      if (trigger) {
        this.triggersUi.cards.get(trigger.id)?.setExpanded(true);
      }
    }
    // Inline state only (the message under the field, the details it opens); the list of entries is not rebuilt here.
    this.markIssues(validate(this.config, this.validationOptions()));
    // The Polling conflict names the section; its first control is the Fast polling switch checkbox.
    const target = path === 'polling' ? 'polling.fastSwitch' : path;
    const node = this.root.querySelector(`[data-path="${CSS.escape(target)}"]`);
    if (!node) {
      return;
    }
    for (let details = node.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
      details.open = true;
    }
    const control = [...node.querySelectorAll(CONTROLS)].find((candidate) => {
      return !candidate.disabled && candidate.getClientRects().length > 0;
    });
    control?.focus();
  }

  /* --------------------------------------------------------------------------------------------
   * Validation, the summary box, and Save (shell)
   * ------------------------------------------------------------------------------------------ */

  validationOptions() {
    return { newTriggerTitle: TRIGGERS.newTrigger, pollingConflictMessage: POLLING.conflict };
  }

  /** The card paths (`triggers[2]`) of fresh triggers. */
  freshCards() {
    const out = [];
    this.config.triggers.forEach((trigger, i) => {
      if (this.fresh.has(trigger)) {
        out.push(`triggers[${i}]`);
      }
    });
    return out;
  }

  /** Issues on untouched cards are held back from the list; they still keep Save disabled. */
  splitIssues(issues) {
    const fresh = this.freshCards();
    const onFresh = (issue) => fresh.some((card) => underPath(issue.path, card));
    return { listed: issues.filter((issue) => !onFresh(issue)), held: issues.filter(onFresh) };
  }

  /** True when the issue's own field or one of the fields it references has been touched. */
  revealed(issue) {
    for (const path of this.touched) {
      if (underPath(path, issue.path) || issue.related?.some((prefix) => underPath(path, prefix))) {
        return true;
      }
    }
    return false;
  }

  revalidate() {
    const all = validate(this.config, this.validationOptions());
    const { listed, held } = this.splitIssues(all);
    this.markIssues(all);
    // One entry per field, each a link that marks the field touched and focuses its control.
    const byPath = new Map();
    for (const issue of listed) {
      if (!byPath.has(issue.path)) {
        byPath.set(issue.path, issue);
      }
    }
    this.updateIssueEntries(byPath);
    const nothingToSave = all.length === 0 && isFreshConfig(this.config);
    this.issuesToggle.hidden = true;
    this.issuesList.hidden = false;
    if (byPath.size > 0) {
      // Past three entries the box collapses to a one-line count with an expand toggle.
      const collapsible = byPath.size > ISSUES.collapseAfter;
      const collapsed = collapsible && !this.issuesExpanded;
      this.issuesHeading.textContent = collapsed ? ISSUES.count(byPath.size) : ISSUES.heading;
      this.issuesList.hidden = collapsed;
      this.issuesToggle.hidden = !collapsible;
      this.issuesToggle.textContent = collapsed ? ISSUES.showAll : ISSUES.hide;
      this.issuesToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      this.issuesBox.className = 'issues ns-issues alert alert-warning';
      this.issuesBox.setAttribute('role', 'alert');
    } else if (held.length > 0) {
      // Nothing to fix yet, only a card nobody has touched: say why Save is still disabled without listing errors.
      this.issuesHeading.textContent = VALIDATION.finishNew;
      this.issuesBox.className = 'issues ns-issues alert alert-info';
      this.issuesBox.setAttribute('role', 'status');
    } else if (nothingToSave) {
      // A fresh install with nothing changed: Save is disabled with the "Nothing to save yet" state (design/README.md).
      this.issuesHeading.textContent = SAVE_STATUS.nothing;
      this.issuesBox.className = 'issues ns-issues alert alert-secondary';
      this.issuesBox.setAttribute('role', 'status');
    }
    this.issuesBox.hidden = all.length === 0 && !nothingToSave;
    setSaveEnabled(all.length === 0 && !nothingToSave);
    this.resized();
  }

  /**
   * Brings the summary box entries in line with the issues, in place: an entry whose field still has an issue keeps its
   * node (its text follows the issue), one whose field is fixed is removed, a new one is inserted at its place in issue
   * order. The list is never rebuilt wholesale. A validation pass runs whenever a control loses focus, and pressing the
   * mouse on an entry while a field has focus is exactly that: rebuilding the list then would replace the entry under
   * the pointer before the click landed, so the click would go nowhere and focus would be lost. The card label and the
   * message are inserted as text, never as markup.
   */
  updateIssueEntries(byPath) {
    for (const [path, entry] of this.issueEntries) {
      if (!byPath.has(path)) {
        entry.li.remove();
        this.issueEntries.delete(path);
      }
    }
    let previous = null;
    for (const issue of byPath.values()) {
      let entry = this.issueEntries.get(issue.path);
      if (!entry) {
        const label = el('strong', {}, '');
        const message = document.createTextNode('');
        const link = button('', () => this.focusField(issue.path), 'btn btn-link btn-sm p-0 ns-link-button ns-issue-link text-start');
        link.appendChild(label);
        link.appendChild(message);
        link.setAttribute('data-issue-path', issue.path);
        entry = { li: el('li', {}, link), label, message, text: '' };
        this.issueEntries.set(issue.path, entry);
      }
      const text = `${issue.label}: ${issue.message}`;
      if (entry.text !== text) {
        entry.label.textContent = `${issue.label}: `;
        entry.message.nodeValue = issue.message;
        entry.text = text;
      }
      const expected = previous ? previous.nextElementSibling : this.issuesList.firstElementChild;
      if (expected !== entry.li) {
        this.issuesList.insertBefore(entry.li, expected);
      }
      previous = entry.li;
    }
  }

  /** True when the field wrapper holds a value worth a green check: a non-empty input or a select. */
  hasValue(node) {
    for (const control of node.querySelectorAll(CONTROLS)) {
      if (control instanceof HTMLInputElement && control.type === 'checkbox') {
        return false;
      }
      return control.value.trim().length > 0;
    }
    return false;
  }

  /**
   * Draws the inline state of every field: the first issue on a touched field as a message under it, a green
   * check on a touched field that passes, nothing on an untouched field. The field that has focus never gains
   * a message; one it already shows is kept until validation clears it. An issue on a field under a collapsed
   * disclosure (Advanced) opens it.
   */
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
      const valid = !issue && this.touched.has(path) && this.hasValue(node);
      for (const control of controls) {
        control.classList.remove('is-invalid');
        control.classList.toggle('ns-valid', valid && !(control instanceof HTMLInputElement && control.type === 'checkbox'));
      }
    }
    this.shown = shown;
  }

  /* --------------------------------------------------------------------------------------------
   * Pushing to the host and the unsaved draft (shell)
   * ------------------------------------------------------------------------------------------ */

  push() {
    if (this.pushTimer !== undefined) {
      window.clearTimeout(this.pushTimer);
    }
    this.pushTimer = window.setTimeout(() => {
      this.pushTimer = undefined;
      const summaries = this.status?.accounts ?? [];
      const block = exportConfig(this.config, summaries);
      // Once the user has changed something, the in-progress configuration is kept as a draft for the next load,
      // without its passwords. The load's own pushes write none.
      if (this.dirty) {
        saveDraft(exportConfigWithoutPasswords(this.config, summaries));
      }
      window.homebridge.updatePluginConfig([block, ...this.otherBlocks]).catch((error) => {
        toastError(`Could not update the configuration: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 150);
  }

  /** Shows the recovery banner for a draft that differs from the saved configuration. */
  offerDraft(draft) {
    const hide = () => {
      this.draftBanner.hidden = true;
      clear(this.draftBanner);
      this.resized();
    };
    const restore = button(DRAFT.restore, () => {
      hide();
      // The draft holds structure only: each restored account takes its stored password back from the saved
      // configuration, matched by id; an account the draft added has none.
      const restored = readConfig(draft.config);
      for (const account of restored.accounts) {
        const current = this.config.accounts.find((entry) => entry.id === account.id);
        account.storedPassword = current?.storedPassword;
      }
      this.replaceConfig(restored, 'restore');
    }, 'btn btn-primary btn-sm ns-draft-restore');
    const discard = button(DRAFT.discard, () => {
      clearDraft();
      hide();
    }, 'btn btn-outline-secondary btn-sm ns-draft-discard');
    this.draftBanner.appendChild(el('span', { class: 'flex-grow-1 ns-draft-message' }, DRAFT.message));
    this.draftBanner.appendChild(el('span', { class: 'd-inline-flex gap-2' }, restore, discard));
    this.draftBanner.hidden = false;
  }
}

/**
 * A draft that differs from the configuration the page is about to show, when there is one. A draft equal to it
 * means the changes were saved (or nothing changed) and is removed. Both sides are compared without passwords,
 * since the draft holds none. A page that opens with no saved Peloton configuration (`saved` false) is never
 * offered a draft: one left from before the first save is removed, since it predates the configuration it would
 * otherwise be offered over.
 */
export function pendingDraft(config, saved = true) {
  if (!saved) {
    clearDraft();
    return undefined;
  }
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
    const page = new Page(root, config, status, pendingDraft(config, index >= 0));
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
