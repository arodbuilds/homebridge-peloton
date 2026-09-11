/**
 * The page's view of the platform block (SPEC section 6): reading config.json into editable
 * objects, writing it back, new and duplicated triggers, validation (design/README.md, Validation),
 * and the unsaved draft kept in localStorage between visits.
 */

import { POLLING, VALIDATION } from './copy.js';

export const PLATFORM = 'Peloton';

export const DEFAULTS = {
  name: 'Peloton',
  fastSwitch: true,
  fastSwitchName: 'Peloton fast polling',
  fastInterval: 10,
  fastIntervalFloor: 5,
  standbyInterval: 120,
  standbyFloor: 30,
  holdAfterEnd: 90,
  holdTime: 20,
  zone: 4,
  fastSwitchAutoOffMinutes: 120,
  attentionSensor: false,
  dailyCheckIn: '03:00',
  debug: false,
  triggerNames: { workout: 'Workout', hrZone: 'Zone 4 or higher' },
};

export const ACTIVITIES = [
  'cycling', 'running', 'walking', 'rowing', 'strength', 'yoga', 'stretching', 'meditation', 'cardio', 'bike_bootcamp', 'tread_bootcamp', 'row_bootcamp',
];

export const DEVICES = ['any', 'bike', 'tread'];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Ids for accounts and triggers are generated on creation and never shown. crypto.randomUUID exists
 * only in secure contexts, and the Homebridge UI is usually served over plain http, so when it is
 * missing a version 4 UUID is built from crypto.getRandomValues, which every context has.
 */
export function newId(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl.randomUUID === 'function') {
    return cryptoImpl.randomUUID();
  }
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function obj(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function id(value, seen) {
  const candidate = typeof value === 'string' && ID_PATTERN.test(value) && !seen.has(value) ? value : newId();
  seen.add(candidate);
  return candidate;
}

/** The stored account entry. The stored password is kept out of the form: the page keeps it only to write it back unchanged. */
function readAccount(raw, seen) {
  const record = obj(raw);
  return {
    id: id(record.id, seen),
    email: text(record.email, ''),
    displayName: text(record.displayName, ''),
    userId: text(record.userId, ''),
    storedPassword: typeof record.password === 'string' && record.password.length > 0 ? record.password : undefined,
    newPassword: undefined,
  };
}

function readTrigger(raw, seen) {
  const record = obj(raw);
  const type = record.type === 'hrZone' ? 'hrZone' : 'workout';
  const base = {
    id: id(record.id, seen),
    type,
    name: text(record.name, ''),
    accessory: record.accessory === 'switch' ? 'switch' : 'occupancy',
    who: text(record.who, type === 'workout' ? 'anyone' : ''),
  };
  if (type === 'hrZone') {
    return { ...base, zone: Math.min(5, Math.max(1, Math.round(num(record.zone, DEFAULTS.zone)))), holdTime: num(record.holdTime, DEFAULTS.holdTime) };
  }
  const activities = Array.isArray(record.activities) ? record.activities.filter((entry) => typeof entry === 'string' && ACTIVITIES.includes(entry)) : [];
  return {
    ...base,
    activities: [...new Set(activities)],
    device: DEVICES.includes(record.device) ? record.device : 'any',
    holdAfterEnd: num(record.holdAfterEnd, DEFAULTS.holdAfterEnd),
  };
}

/** Turns the raw platform block (or nothing) into the page's editable model with every default filled. */
export function readConfig(raw) {
  const root = obj(raw);
  const polling = obj(root.polling);
  const advanced = obj(root.advanced);
  const seen = new Set();
  const accounts = (Array.isArray(root.accounts) ? root.accounts : []).map((entry) => readAccount(entry, seen));
  const triggers = (Array.isArray(root.triggers) ? root.triggers : []).map((entry) => readTrigger(entry, seen));
  return {
    name: text(root.name, DEFAULTS.name),
    accounts,
    triggers,
    polling: {
      fastSwitch: bool(polling.fastSwitch, DEFAULTS.fastSwitch),
      fastSwitchName: text(polling.fastSwitchName, DEFAULTS.fastSwitchName),
      fastInterval: num(polling.fastInterval, DEFAULTS.fastInterval),
      standbyInterval: num(polling.standbyInterval, DEFAULTS.standbyInterval),
      calloutDismissed: bool(polling.calloutDismissed, false),
    },
    advanced: {
      fastSwitchAutoOffMinutes: num(advanced.fastSwitchAutoOffMinutes, DEFAULTS.fastSwitchAutoOffMinutes),
      attentionSensor: bool(advanced.attentionSensor, DEFAULTS.attentionSensor),
      dailyCheckIn: TIME_PATTERN.test(text(advanced.dailyCheckIn, '')) ? advanced.dailyCheckIn : DEFAULTS.dailyCheckIn,
    },
    debug: bool(root.debug, DEFAULTS.debug),
  };
}

/** A whole number for config.json: the field's number, or the fallback while the box is empty or invalid. */
function whole(value, fallback) {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

/**
 * Account write-back (SPEC section 10). Each account entry carries id, email, displayName, and userId,
 * the last two filled from the store's summary of the account when config does not have them yet,
 * so an account the plugin signed in at startup gets its userId on the next save. The password is
 * the one the user entered on this page; when none was entered the stored one is written back
 * unchanged, never shown in the form. An account connected through the browser path has none.
 */
export function exportAccount(account, summary) {
  const out = { id: account.id, email: account.email.trim() };
  const displayName = account.displayName.trim() || (summary?.displayName ?? '').trim();
  if (displayName.length > 0) {
    out.displayName = displayName;
  }
  const userId = account.userId || summary?.userId || '';
  if (userId.length > 0) {
    out.userId = userId;
  }
  const password = account.newPassword ?? account.storedPassword;
  if (password !== undefined && password.length > 0) {
    out.password = password;
  }
  return out;
}

/**
 * A connect finished on the server for the config account id: the entry is created when new and
 * updated with the email the user typed, the password when one was entered, and the profile's userId
 * and display name (the display name only while config has none). Returns the entry.
 */
export function mergeConnectedAccount(config, id, summary, entered = {}) {
  let account = config.accounts.find((entry) => entry.id === id);
  if (!account) {
    account = { id, email: '', displayName: '', userId: '', storedPassword: undefined, newPassword: undefined };
    config.accounts.push(account);
  }
  if (typeof entered.email === 'string' && entered.email.trim().length > 0) {
    account.email = entered.email.trim();
  }
  if (typeof entered.password === 'string' && entered.password.length > 0) {
    account.newPassword = entered.password;
  }
  if (summary?.userId) {
    account.userId = summary.userId;
  }
  if (!account.displayName && summary?.displayName) {
    account.displayName = summary.displayName;
  }
  return account;
}

/** Remove on an account card: drops the config entry with that id (the store file goes through /remove). Returns true when one was dropped. */
export function removeAccountEntry(config, id) {
  const at = config.accounts.findIndex((entry) => entry.id === id);
  if (at < 0) {
    return false;
  }
  config.accounts.splice(at, 1);
  return true;
}

export function exportTrigger(trigger) {
  const base = { id: trigger.id, type: trigger.type, name: trigger.name.trim(), accessory: trigger.accessory, who: trigger.who || 'anyone' };
  if (trigger.type === 'hrZone') {
    return { ...base, zone: whole(trigger.zone, DEFAULTS.zone), holdTime: Math.max(0, whole(trigger.holdTime, DEFAULTS.holdTime)) };
  }
  return {
    ...base,
    activities: trigger.activities.length === ACTIVITIES.length ? [] : [...trigger.activities],
    device: trigger.device,
    holdAfterEnd: Math.max(0, whole(trigger.holdAfterEnd, DEFAULTS.holdAfterEnd)),
  };
}

export function exportConfig(config, summaries = []) {
  return {
    platform: PLATFORM,
    name: config.name.trim() || DEFAULTS.name,
    accounts: config.accounts.map((account) => exportAccount(account, summaries.find((summary) => summary.id === account.id))),
    triggers: config.triggers.map(exportTrigger),
    polling: {
      fastSwitch: config.polling.fastSwitch,
      fastSwitchName: config.polling.fastSwitchName.trim() || DEFAULTS.fastSwitchName,
      fastInterval: whole(config.polling.fastInterval, DEFAULTS.fastInterval),
      standbyInterval: whole(config.polling.standbyInterval, DEFAULTS.standbyInterval),
      calloutDismissed: config.polling.calloutDismissed,
    },
    advanced: {
      fastSwitchAutoOffMinutes: whole(config.advanced.fastSwitchAutoOffMinutes, DEFAULTS.fastSwitchAutoOffMinutes),
      attentionSensor: config.advanced.attentionSensor,
      dailyCheckIn: TIME_PATTERN.test(config.advanced.dailyCheckIn) ? config.advanced.dailyCheckIn : DEFAULTS.dailyCheckIn,
    },
    debug: config.debug,
  };
}

/** The block without passwords, for the draft in localStorage and for comparing two configurations. */
export function exportConfigWithoutPasswords(config, summaries = []) {
  const block = exportConfig(config, summaries);
  block.accounts = block.accounts.map((account) => {
    const copy = { ...account };
    delete copy.password;
    return copy;
  });
  return block;
}

/** A new trigger as the Add chooser creates it: every field at its default, the name empty. */
export function newTrigger(type, defaultWho) {
  const base = { id: newId(), type, name: '', accessory: 'occupancy' };
  if (type === 'hrZone') {
    return { ...base, who: defaultWho ?? '', zone: DEFAULTS.zone, holdTime: DEFAULTS.holdTime };
  }
  return { ...base, who: 'anyone', activities: [...ACTIVITIES], device: 'any', holdAfterEnd: DEFAULTS.holdAfterEnd };
}

/** A copy of a trigger with a new id and "{name} copy" (numbered when that name is taken too). */
export function duplicateTrigger(trigger, existingNames, copySuffix) {
  const taken = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  const baseName = trigger.name.trim() || DEFAULTS.triggerNames[trigger.type];
  let name = `${baseName}${copySuffix}`;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
    name = `${baseName}${copySuffix} ${n}`;
  }
  const copy = { ...trigger, id: newId(), name };
  if (copy.activities) {
    copy.activities = [...copy.activities];
  }
  return copy;
}

/** The name shown in the card header and the issue list: the trigger's name, or "New trigger" while empty. */
export function triggerTitle(trigger, placeholder) {
  return trigger.name.trim() || placeholder;
}

/** True when the Fast polling switch is off and standby is 0, so the plugin would never poll. */
export function pollingConflict(config) {
  return !config.polling.fastSwitch && whole(config.polling.standbyInterval, DEFAULTS.standbyInterval) === 0;
}

/**
 * Validation mirroring config.schema.json and the design README. Each issue carries the field path
 * (for inline marking), the card label for the summary box, and the message.
 */
export function validate(config, options = {}) {
  const issues = [];
  const titles = config.triggers.map((trigger) => triggerTitle(trigger, options.newTriggerTitle ?? 'New trigger'));
  const nameCounts = new Map();
  for (const trigger of config.triggers) {
    const key = trigger.name.trim().toLowerCase();
    if (key.length > 0) {
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
  }
  config.triggers.forEach((trigger, index) => {
    const path = `triggers[${index}]`;
    const label = titles[index];
    const key = trigger.name.trim().toLowerCase();
    if (key.length === 0) {
      issues.push({ path: `${path}.name`, label, message: VALIDATION.triggerName });
    } else if ((nameCounts.get(key) ?? 0) > 1) {
      issues.push({ path: `${path}.name`, label, message: VALIDATION.duplicateName, related: config.triggers.map((_, i) => `triggers[${i}].name`) });
    }
    if (trigger.type === 'hrZone') {
      if (trigger.who.length === 0 || trigger.who === 'anyone') {
        issues.push({ path: `${path}.who`, label, message: VALIDATION.whoMissing });
      }
      if (!Number.isFinite(trigger.holdTime) || trigger.holdTime < 0) {
        issues.push({ path: `${path}.holdTime`, label, message: VALIDATION.secondsFloor });
      }
    } else if (!Number.isFinite(trigger.holdAfterEnd) || trigger.holdAfterEnd < 0) {
      issues.push({ path: `${path}.holdAfterEnd`, label, message: VALIDATION.secondsFloor });
    }
  });

  const polling = VALIDATION.labels.polling;
  if (!Number.isFinite(config.polling.fastInterval) || config.polling.fastInterval < DEFAULTS.fastIntervalFloor) {
    issues.push({ path: 'polling.fastInterval', label: polling, message: VALIDATION.fastFloor });
  }
  const standby = config.polling.standbyInterval;
  if (!Number.isFinite(standby) || standby < 0 || (standby > 0 && standby < DEFAULTS.standbyFloor)) {
    issues.push({ path: 'polling.standbyInterval', label: polling, message: VALIDATION.standbyRange });
  }
  if (pollingConflict(config)) {
    const message = options.pollingConflictMessage ?? POLLING.conflict;
    issues.push({ path: 'polling', label: polling, message, related: ['polling.fastSwitch', 'polling.standbyInterval'] });
  }

  const settings = VALIDATION.labels.settings;
  if (config.name.trim().length === 0) {
    issues.push({ path: 'name', label: settings, message: VALIDATION.nameRequired });
  }
  if (!Number.isFinite(config.advanced.fastSwitchAutoOffMinutes) || config.advanced.fastSwitchAutoOffMinutes < 1) {
    issues.push({ path: 'advanced.fastSwitchAutoOffMinutes', label: settings, message: VALIDATION.minutesFloor });
  }
  if (!TIME_PATTERN.test(config.advanced.dailyCheckIn)) {
    issues.push({ path: 'advanced.dailyCheckIn', label: settings, message: VALIDATION.timeFormat });
  }
  return issues;
}

/** True when the page holds nothing but defaults: no accounts, no triggers, every setting as installed. */
export function isFreshConfig(config) {
  return config.accounts.length === 0 && config.triggers.length === 0
    && stableStringify(exportConfigWithoutPasswords(config)) === stableStringify(exportConfigWithoutPasswords(readConfig({})));
}

/** JSON with object keys sorted at every level, so two equal configurations compare equal whatever their key order. */
export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/* ------------------------------------------------------------------------------------------------
 * Unsaved draft (the host machinery notify-switch also uses): the in-progress block without
 * passwords is written to localStorage on every change; on the next load a draft that differs from
 * the saved configuration and is less than a day old is offered back.
 * ---------------------------------------------------------------------------------------------- */

export const DRAFT_KEY = 'homebridge-peloton:draft';
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DRAFT_MAX_BYTES = 1024 * 1024;

function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function saveDraft(block, now = Date.now()) {
  try {
    const textValue = JSON.stringify({ savedAt: now, config: block });
    if (textValue.length > DRAFT_MAX_BYTES) {
      return;
    }
    storage()?.setItem(DRAFT_KEY, textValue);
  } catch {
    // Storage full or disabled: the draft is a convenience, never a requirement.
  }
}

export function clearDraft() {
  try {
    storage()?.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

/** The stored draft when it is well formed and younger than a day; anything else is removed and yields undefined. */
export function readDraft(now = Date.now()) {
  try {
    const textValue = storage()?.getItem(DRAFT_KEY);
    if (!textValue) {
      return undefined;
    }
    if (textValue.length > DRAFT_MAX_BYTES) {
      clearDraft();
      return undefined;
    }
    const parsed = JSON.parse(textValue);
    const fresh = typeof parsed.savedAt === 'number' && now - parsed.savedAt >= 0 && now - parsed.savedAt < DRAFT_MAX_AGE_MS;
    if (!fresh || typeof parsed.config !== 'object' || parsed.config === null || Array.isArray(parsed.config) || hasForbiddenKey(parsed.config)) {
      clearDraft();
      return undefined;
    }
    return { savedAt: parsed.savedAt, config: parsed.config };
  } catch {
    clearDraft();
    return undefined;
  }
}

/** True when any object in the tree carries a key that could reach a prototype. */
export function hasForbiddenKey(value) {
  if (Array.isArray(value)) {
    return value.some(hasForbiddenKey);
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype' || hasForbiddenKey(value[key])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The Peloton platform block inside a backup file: the block itself, a config.json with a platforms
 * list, or a saved draft. Returns undefined when the file holds none.
 */
export function backupBlock(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  if (parsed.platform === PLATFORM) {
    return parsed;
  }
  if (Array.isArray(parsed.platforms)) {
    return parsed.platforms.find((entry) => entry && typeof entry === 'object' && entry.platform === PLATFORM);
  }
  if (parsed.config && typeof parsed.config === 'object' && parsed.config.platform === PLATFORM) {
    return parsed.config;
  }
  return undefined;
}
