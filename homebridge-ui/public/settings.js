/**
 * The Settings section (design/README.md, Settings): the intro, then the collapsed Advanced disclosure holding
 * every field in this order: Name, Debug logging, the auto-off minutes, the minutes the fast interval is kept
 * after a workout ends, the Attention needed sensor, the daily check-in time, the read-only Devices seen block,
 * and Restore from backup. Nothing renders on the page grid
 * outside the disclosure.
 */

import { toastSuccess } from './api.js';
import { SETTINGS } from './copy.js';
import { checkboxField, disclosure, el, grid, gridCell, helpText, numberField, outlineButton, statusBox, textField } from './dom.js';
import { DEFAULTS, MAX_BACKUP_BYTES, backupBlock, deviceReport, hasForbiddenKey, readConfig } from './model.js';
import { badge, copyText, timeField } from './peloton-dom.js';

/** True when anything under Advanced differs from its default, which opens the disclosure (shell rule C3). */
export function advancedTouched(config) {
  const a = config.advanced;
  return config.name !== DEFAULTS.name
    || config.debug !== DEFAULTS.debug
    || a.fastSwitchAutoOffMinutes !== DEFAULTS.fastSwitchAutoOffMinutes
    || a.keepFastAfterEndMinutes !== DEFAULTS.keepFastAfterEndMinutes
    || a.attentionSensor !== DEFAULTS.attentionSensor
    || a.dailyCheckIn !== DEFAULTS.dailyCheckIn;
}

/**
 * Checks a backup's text before anything changes: JSON, then a Peloton platform block (on its own,
 * inside a config.json, or inside a saved draft). Returns the config to load or the problem.
 */
export function checkBackup(text) {
  if (text.length > MAX_BACKUP_BYTES) {
    return { error: SETTINGS.restoreTooLarge };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: SETTINGS.restoreNotJson };
  }
  if (hasForbiddenKey(parsed)) {
    return { error: SETTINGS.restoreNotPeloton };
  }
  const block = backupBlock(parsed);
  if (!block) {
    return { error: SETTINGS.restoreNotPeloton };
  }
  return { config: readConfig(block) };
}

/** Restore from backup: the file field with its result as a status box under it (shell rule C6). */
function restoreField(app) {
  const status = statusBox();
  status.el.classList.add('restore-status', 'mt-2');
  const showError = (message) => {
    status.set('danger', SETTINGS.restoreFailed, el('div', {}, message));
  };
  const input = el('input', { type: 'file', class: 'form-control', accept: 'application/json,.json', 'aria-label': SETTINGS.restore });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    // The size is checked before the file is read, so an oversized file never reaches the parser.
    if (file.size > MAX_BACKUP_BYTES) {
      input.value = '';
      showError(SETTINGS.restoreTooLarge);
      return;
    }
    file.text().then((text) => {
      input.value = '';
      const result = checkBackup(text);
      if (!result.config) {
        showError(result.error);
        return;
      }
      status.set('none', '');
      app.replaceConfig(result.config, 'restore');
      toastSuccess(SETTINGS.restored);
    }).catch(() => {
      showError(SETTINGS.restoreNotJson);
    });
  });
  return el('div', { class: 'mb-3', 'data-path': 'restore' },
    el('label', { class: 'form-label' }, SETTINGS.restore),
    input,
    el('div', { class: 'form-text' }, SETTINGS.restoreHelp),
    status.el,
  );
}

/**
 * The read-only Devices seen block (SPEC section 10): every device_type and platform pair the poller has
 * recorded, from /devices-seen, as "{display name} ({device_type}, {platform})" with a Known or Unknown tag.
 * An Unknown row carries a Copy report button that puts the report text (model.js deviceReport) on the
 * clipboard; when the clipboard is out of reach the text is shown under the row to copy by hand. The caption
 * states what a report shares and links to the GitHub issue form.
 */
function devicesSeenBlock(app) {
  const devices = app.status?.devicesSeen ?? [];
  const version = app.status?.version ?? '';
  const list = el('ul', { class: 'list-unstyled mb-2 ns-devices-seen-list' });
  for (const device of devices) {
    const row = el('li', { class: 'ns-devices-seen-row', 'data-device-type': device.deviceType, 'data-platform': device.platform },
      el('span', { class: 'ns-devices-seen-label' }, SETTINGS.deviceSeenRow(device.name, device.deviceType, device.platform)),
      badge(device.known ? SETTINGS.deviceKnown : SETTINGS.deviceUnknown, device.known ? 'outline' : 'warning'),
    );
    if (!device.known) {
      const status = statusBox();
      const text = deviceReport(device, version);
      row.appendChild(outlineButton(SETTINGS.copyReport, () => {
        copyText(text).then((copied) => {
          if (copied) {
            status.set('none', '');
            toastSuccess(SETTINGS.reportCopied);
          } else {
            status.set('warning', SETTINGS.copyFailed, el('pre', { class: 'ns-report-text mb-0' }, text));
          }
          app.resized();
        }).catch(() => undefined);
      }, 'ns-copy-report'));
      row.appendChild(el('div', { class: 'ns-report-status' }, status.el));
    }
    list.appendChild(row);
  }
  return el('div', { class: 'mb-3 ns-devices-seen' },
    el('div', { class: 'form-label' }, SETTINGS.devicesSeen),
    devices.length > 0 ? list : el('div', { class: 'form-text ns-devices-seen-empty' }, SETTINGS.devicesSeenEmpty),
    helpText(SETTINGS.devicesSeenHelp, { text: SETTINGS.devicesSeenLink, href: SETTINGS.devicesSeenLinkUrl }),
  );
}

export function renderSettings(app, container) {
  const c = app.config;
  container.appendChild(el('p', { class: 'section-copy' }, SETTINGS.intro));
  const fields = grid(
    gridCell(6, textField(SETTINGS.name, c.name, (value) => {
      c.name = value;
      app.changed();
    }, { path: 'name', required: true, help: SETTINGS.nameHelp })),
    gridCell(6, checkboxField(SETTINGS.debug, c.debug, (value) => {
      c.debug = value;
      app.changed();
    }, { path: 'debug', help: SETTINGS.debugHelp })),
    gridCell(6, numberField(SETTINGS.autoOff, c.advanced.fastSwitchAutoOffMinutes, (value) => {
      c.advanced.fastSwitchAutoOffMinutes = value;
      app.changed();
    }, { path: 'advanced.fastSwitchAutoOffMinutes', min: 1, help: SETTINGS.autoOffHelp })),
    gridCell(6, numberField(SETTINGS.keepFast, c.advanced.keepFastAfterEndMinutes, (value) => {
      c.advanced.keepFastAfterEndMinutes = value;
      app.changed();
    }, { path: 'advanced.keepFastAfterEndMinutes', min: 0, help: SETTINGS.keepFastHelp })),
    gridCell(6, checkboxField(SETTINGS.attention, c.advanced.attentionSensor, (value) => {
      c.advanced.attentionSensor = value;
      app.changed();
    }, { path: 'advanced.attentionSensor', help: SETTINGS.attentionHelp })),
    gridCell(6, timeField(SETTINGS.checkIn, c.advanced.dailyCheckIn, (value) => {
      c.advanced.dailyCheckIn = value;
      app.changed();
    }, { path: 'advanced.dailyCheckIn', help: SETTINGS.checkInHelp })),
    gridCell(12, devicesSeenBlock(app)),
    gridCell(12, restoreField(app)),
  );
  // Collapsed by default; open when anything inside differs from its default, or once the user opened it this
  // visit. An invalid field inside opens it too (markIssues), as does a summary entry that targets one (focusField).
  const advanced = disclosure(SETTINGS.advanced, [fields], { open: advancedTouched(c) || app.settingsUi.advancedOpen, attrs: { 'data-advanced': 'settings' } });
  advanced.addEventListener('toggle', () => {
    app.settingsUi.advancedOpen = advanced.open;
    app.resized();
  });
  container.appendChild(advanced);
}
