/**
 * The Polling section (design/README.md, Polling): the Fast polling switch block, the two intervals
 * with the live estimate line, the dismissible automation callout, and the blocking section error.
 * Polling renders uncarded on the page grid, a Peloton exception to the shell's rule R5 (SPEC section 10).
 */

import { POLLING } from './copy.js';
import { checkboxField, el, gridCell, grid, linkButton, numberField, paragraph, textField } from './dom.js';
import { DEFAULTS, pollingConflict } from './model.js';

/**
 * Accounts the estimate counts: the connected ones and those with a request in flight (the Checking pill),
 * else the configured ones, else one.
 */
export function estimateAccounts(app) {
  const summaries = app.status?.accounts ?? [];
  const counted = new Set();
  for (const summary of summaries) {
    if (summary.state === 'connected') {
      counted.add(summary.id);
    }
  }
  for (const key of app.accountsUi?.checking ?? []) {
    counted.add(key);
  }
  const panel = app.accountsUi?.panel;
  if (panel?.busy) {
    counted.add(panel.key);
  }
  return counted.size > 0 ? counted.size : Math.max(1, app.config.accounts.length);
}

export function estimateLine(app) {
  const standby = app.config.polling.standbyInterval;
  if (!Number.isFinite(standby) || standby <= 0) {
    return POLLING.estimateNone;
  }
  const n = estimateAccounts(app);
  return POLLING.estimate(Math.round((3600 / standby) * n), n);
}

export function renderPolling(app, container) {
  const c = app.config.polling;
  container.appendChild(paragraph(POLLING.intro));
  const sectionError = el('div', { class: 'ns-section-error', role: 'alert', hidden: !pollingConflict(app.config) }, POLLING.conflict);
  container.appendChild(sectionError);
  // A live status line, not field help: it does not carry ns-help.
  const estimate = el('div', { class: 'form-text ns-estimate' }, estimateLine(app));
  const change = () => {
    sectionError.hidden = !pollingConflict(app.config);
    estimate.textContent = estimateLine(app);
    app.changed();
  };

  container.appendChild(grid(
    gridCell(12, checkboxField(POLLING.fastSwitch, c.fastSwitch, (value) => {
      c.fastSwitch = value;
      change();
    }, { path: 'polling.fastSwitch', help: POLLING.fastSwitchHelp })),
    // The switch's Name is always shown, whether or not the switch is created.
    gridCell(12, textField(POLLING.fastSwitchName, c.fastSwitchName, (value) => {
      c.fastSwitchName = value;
      change();
    }, { path: 'polling.fastSwitchName', help: POLLING.fastSwitchNameHelp })),
    gridCell(6, numberField(POLLING.fast, c.fastInterval, (value) => {
      c.fastInterval = value;
      change();
    }, { path: 'polling.fastInterval', min: DEFAULTS.fastIntervalFloor, help: POLLING.fastHelp })),
    gridCell(6, numberField(POLLING.standby, c.standbyInterval, (value) => {
      c.standbyInterval = value;
      change();
    }, { path: 'polling.standbyInterval', min: 0, help: POLLING.standbyHelp })),
    gridCell(12, estimate),
  ));

  if (!c.calloutDismissed) {
    const callout = el('div', { class: 'ns-callout', role: 'note' },
      el('div', { class: 'ns-callout-body' },
        el('div', { class: 'fw-semibold ns-callout-title' }, POLLING.calloutTitle),
        el('div', {}, POLLING.calloutBody),
        el('a', { class: 'ns-help-link', href: POLLING.calloutLinkUrl, target: '_blank', rel: 'noopener noreferrer' }, POLLING.calloutLink),
      ),
      // Dismiss is a text link (shell rule W1: no glyphs); the dismissal is saved with the configuration.
      linkButton(POLLING.calloutDismiss, () => {
        c.calloutDismissed = true;
        callout.remove();
        app.changed();
      }, 'ns-callout-dismiss'),
    );
    container.appendChild(callout);
  }
}
