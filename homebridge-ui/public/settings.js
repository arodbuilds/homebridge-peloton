/**
 * The Settings section (design/README.md, Settings): Name, Debug logging, and the Advanced disclosure
 * with the auto-off minutes, the Attention needed sensor, the daily check-in time, and Restore from backup.
 */

import { toastSuccess } from './api.js';
import { SETTINGS } from './copy.js';
import { checkboxField, clear, el, numberField, textField, timeField } from './dom.js';
import { DEFAULTS, backupBlock, hasForbiddenKey, readConfig } from './model.js';

const RESTORE_MAX_BYTES = 1024 * 1024;

/** True when anything under Advanced differs from its default, which opens the disclosure. */
function advancedTouched(config) {
  const a = config.advanced;
  return a.fastSwitchAutoOffMinutes !== DEFAULTS.fastSwitchAutoOffMinutes
    || a.attentionSensor !== DEFAULTS.attentionSensor
    || a.dailyCheckIn !== DEFAULTS.dailyCheckIn;
}

/**
 * Checks a backup's text before anything changes: JSON, then a Peloton platform block (on its own,
 * inside a config.json, or inside a saved draft). Returns the config to load or the problem.
 */
export function checkBackup(text) {
  if (text.length > RESTORE_MAX_BYTES) {
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

function restoreField(app) {
  const status = el('div', { class: 'ns-restore-status', role: 'status' });
  const showError = (message) => {
    clear(status);
    status.appendChild(el('div', { class: 'alert alert-danger' }, el('div', { class: 'fw-semibold' }, SETTINGS.restoreFailed), el('div', {}, message)));
  };
  const input = el('input', { type: 'file', class: 'form-control', accept: 'application/json,.json', 'aria-label': SETTINGS.restore });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (file.size > RESTORE_MAX_BYTES) {
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
      clear(status);
      app.replaceConfig(result.config, 'restore');
      toastSuccess(SETTINGS.restored);
    }).catch(() => {
      showError(SETTINGS.restoreNotJson);
    });
  });
  return el('div', { class: 'ns-field' },
    el('label', { class: 'form-label' }, SETTINGS.restore),
    input,
    el('div', { class: 'form-text ns-help' }, SETTINGS.restoreHelp),
    status,
  );
}

export function renderSettings(app, container) {
  const c = app.config;
  container.appendChild(el('p', { class: 'ns-section-copy' }, SETTINGS.intro));
  container.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-6' }, textField(SETTINGS.name, c.name, (value) => {
      c.name = value;
      app.changed();
    }, { path: 'name', required: true, help: SETTINGS.nameHelp })),
    checkboxField(SETTINGS.debug, c.debug, (value) => {
      c.debug = value;
      app.changed();
    }, { path: 'debug', help: SETTINGS.debugHelp }),
  ));

  const advanced = el('details', { class: 'ns-advanced', 'data-advanced': 'settings' },
    el('summary', {}, SETTINGS.advanced),
    el('div', { class: 'ns-grid' },
      el('div', { class: 'ns-span-6' }, numberField(SETTINGS.autoOff, c.advanced.fastSwitchAutoOffMinutes, (value) => {
        c.advanced.fastSwitchAutoOffMinutes = value;
        app.changed();
      }, { path: 'advanced.fastSwitchAutoOffMinutes', min: 1, help: SETTINGS.autoOffHelp })),
      checkboxField(SETTINGS.attention, c.advanced.attentionSensor, (value) => {
        c.advanced.attentionSensor = value;
        app.changed();
      }, { path: 'advanced.attentionSensor', help: SETTINGS.attentionHelp }),
      el('div', { class: 'ns-span-6' }, timeField(SETTINGS.checkIn, c.advanced.dailyCheckIn, (value) => {
        c.advanced.dailyCheckIn = value;
        app.changed();
      }, { path: 'advanced.dailyCheckIn', help: SETTINGS.checkInHelp })),
      restoreField(app),
    ),
  );
  advanced.open = advancedTouched(c) || app.settingsUi.advancedOpen;
  advanced.addEventListener('toggle', () => {
    app.settingsUi.advancedOpen = advanced.open;
  });
  container.appendChild(advanced);
}
