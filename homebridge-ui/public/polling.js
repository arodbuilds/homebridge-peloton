/**
 * The Polling section (design/README.md, Polling): the Fast polling switch block, the two intervals
 * with the live estimate line, the dismissible automation callout, and the blocking section error.
 */

import { POLLING } from './copy.js';
import { checkboxField, el, numberField, textField } from './dom.js';
import { DEFAULTS, pollingConflict } from './model.js';

/** Accounts the estimate counts: the connected ones, else the configured ones, else one. */
function accountCount(app) {
  const connected = (app.status?.accounts ?? []).filter((account) => account.state === 'connected').length;
  return connected > 0 ? connected : Math.max(1, app.config.accounts.length);
}

export function estimateLine(app) {
  const standby = app.config.polling.standbyInterval;
  if (!Number.isFinite(standby) || standby <= 0) {
    return POLLING.estimateNone;
  }
  return POLLING.estimate(Math.round((3600 / standby) * accountCount(app)), accountCount(app));
}

export function renderPolling(app, container) {
  const c = app.config.polling;
  container.appendChild(el('p', { class: 'ns-section-copy' }, POLLING.intro));
  const sectionError = el('div', { class: 'ns-section-error', role: 'alert', hidden: !pollingConflict(app.config) }, POLLING.conflict);
  container.appendChild(sectionError);
  const estimate = el('div', { class: 'form-text ns-estimate' }, estimateLine(app));
  const change = () => {
    sectionError.hidden = !pollingConflict(app.config);
    estimate.textContent = estimateLine(app);
    app.changed();
  };

  const nameField = textField(POLLING.fastSwitchName, c.fastSwitchName, (value) => {
    c.fastSwitchName = value;
    change();
  }, { path: 'polling.fastSwitchName', help: POLLING.fastSwitchNameHelp });
  nameField.hidden = !c.fastSwitch;

  const grid = el('div', { class: 'ns-grid' },
    checkboxField(POLLING.fastSwitch, c.fastSwitch, (value) => {
      c.fastSwitch = value;
      nameField.hidden = !value;
      change();
    }, { path: 'polling.fastSwitch', help: POLLING.fastSwitchHelp }),
    nameField,
    el('div', { class: 'ns-span-6' }, numberField(POLLING.fast, c.fastInterval, (value) => {
      c.fastInterval = value;
      change();
    }, { path: 'polling.fastInterval', min: DEFAULTS.fastIntervalFloor, help: POLLING.fastHelp })),
    el('div', { class: 'ns-span-6' }, numberField(POLLING.standby, c.standbyInterval, (value) => {
      c.standbyInterval = value;
      change();
    }, { path: 'polling.standbyInterval', min: 0, help: POLLING.standbyHelp })),
    estimate,
  );
  container.appendChild(grid);

  if (!c.calloutDismissed) {
    const dismiss = el('button', { type: 'button', class: 'btn ns-dismiss', 'aria-label': POLLING.calloutDismiss }, '✕');
    const callout = el('div', { class: 'ns-callout', role: 'note' },
      el('div', { class: 'ns-callout-body' },
        el('div', { class: 'ns-callout-title' }, POLLING.calloutTitle),
        el('div', {}, POLLING.calloutBody),
        el('a', { href: POLLING.calloutLinkUrl, target: '_blank', rel: 'noopener noreferrer' }, POLLING.calloutLink),
      ),
      dismiss,
    );
    dismiss.addEventListener('click', () => {
      c.calloutDismissed = true;
      callout.remove();
      app.changed();
    });
    container.appendChild(callout);
  }
}
