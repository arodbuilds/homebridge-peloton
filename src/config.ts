/**
 * Config types and validation (SPEC section 6, defaults from section 2).
 *
 * parseConfig turns the raw platform block from config.json into typed objects. Invalid values are
 * clamped or defaulted with one warn line each and never throw. Missing account or trigger ids are
 * generated and reported, so accessories still get a UUID for this run; the id persists only when
 * the config is saved from the settings page.
 */

import { randomUUID } from 'node:crypto';

export type AccessoryKind = 'occupancy' | 'switch';

export interface AccountConfig {
  id: string;
  email?: string;
  password?: string;
  userId?: string;
  displayName?: string;
}

export interface WorkoutTriggerConfig {
  id: string;
  type: 'workout';
  name: string;
  accessory: AccessoryKind;
  /** "anyone" or an account userId. */
  who: string;
  /** Empty means all activities. */
  activities: string[];
  /** "any" or a device id from attached_devices. */
  device: string;
  /** Seconds the sensor stays on after the workout ends. */
  holdAfterEnd: number;
}

export interface HrZoneTriggerConfig {
  id: string;
  type: 'hrZone';
  name: string;
  accessory: AccessoryKind;
  /** An account userId. hrZone triggers never use "anyone". */
  who: string;
  /** Zone 1 to 5; the condition is zone at or above this. */
  zone: number;
  /** Seconds the condition must hold in each direction. */
  holdTime: number;
}

export type TriggerConfig = WorkoutTriggerConfig | HrZoneTriggerConfig;

export interface PollingConfig {
  fastSwitch: boolean;
  fastSwitchName: string;
  /** Seconds, floor 5. */
  fastInterval: number;
  /** Seconds, 0 means no standby polling. */
  standbyInterval: number;
  calloutDismissed: boolean;
}

export interface AdvancedConfig {
  fastSwitchAutoOffMinutes: number;
  attentionSensor: boolean;
  /** Local time "HH:MM". */
  dailyCheckIn: string;
}

export interface PelotonConfig {
  name: string;
  accounts: AccountConfig[];
  triggers: TriggerConfig[];
  polling: PollingConfig;
  advanced: AdvancedConfig;
  debug: boolean;
}

export const CONFIG_DEFAULTS = {
  name: 'Peloton',
  fastInterval: 10,
  fastIntervalFloor: 5,
  standbyInterval: 120,
  holdAfterEnd: 90,
  holdTime: 20,
  zone: 4,
  fastSwitch: true,
  fastSwitchName: 'Peloton fast polling',
  fastSwitchAutoOffMinutes: 120,
  attentionSensor: false,
  dailyCheckIn: '03:00',
  workoutTriggerName: 'Workout',
  hrZoneTriggerName: 'Heart rate zone',
} as const;

/** fitness_discipline values the Activities chips offer (SPEC section 4.2). */
export const KNOWN_ACTIVITIES = [
  'cycling', 'running', 'walking', 'rowing', 'strength', 'yoga', 'stretching', 'meditation', 'cardio',
  'bike_bootcamp', 'tread_bootcamp', 'row_bootcamp',
] as const;

export type WarnFn = (line: string) => void;

export interface ParseConfigOptions {
  /** Receives one line per clamped, defaulted, or generated value. */
  warn?: WarnFn;
  /** Injectable id generator for tests. */
  generateId?: () => string;
}

const DAILY_CHECK_IN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type Json = Record<string, unknown>;

/** Parses the platform config block. Never throws on bad input. */
export function parseConfig(raw: unknown, options: ParseConfigOptions = {}): PelotonConfig {
  const warn = options.warn ?? (() => undefined);
  const generateId = options.generateId ?? randomUUID;
  const root = obj(raw);
  const polling = obj(root.polling);
  const advanced = obj(root.advanced);
  const seenIds = new Set<string>();

  const accounts = arr(root.accounts, 'accounts', warn).map((entry, index) => parseAccount(obj(entry), index, seenIds, generateId, warn));
  const triggers = arr(root.triggers, 'triggers', warn).map((entry, index) => parseTrigger(obj(entry), index, seenIds, generateId, warn));

  return {
    name: text(root.name, CONFIG_DEFAULTS.name),
    accounts,
    triggers,
    polling: {
      fastSwitch: bool(polling.fastSwitch, CONFIG_DEFAULTS.fastSwitch, 'polling.fastSwitch', warn),
      fastSwitchName: text(polling.fastSwitchName, CONFIG_DEFAULTS.fastSwitchName),
      fastInterval: integer(polling.fastInterval, {
        name: 'polling.fastInterval', fallback: CONFIG_DEFAULTS.fastInterval, min: CONFIG_DEFAULTS.fastIntervalFloor,
      }, warn),
      standbyInterval: integer(polling.standbyInterval, {
        name: 'polling.standbyInterval', fallback: CONFIG_DEFAULTS.standbyInterval, min: 0,
      }, warn),
      calloutDismissed: bool(polling.calloutDismissed, false, 'polling.calloutDismissed', warn),
    },
    advanced: {
      fastSwitchAutoOffMinutes: integer(advanced.fastSwitchAutoOffMinutes, {
        name: 'advanced.fastSwitchAutoOffMinutes', fallback: CONFIG_DEFAULTS.fastSwitchAutoOffMinutes, min: 1,
      }, warn),
      attentionSensor: bool(advanced.attentionSensor, CONFIG_DEFAULTS.attentionSensor, 'advanced.attentionSensor', warn),
      dailyCheckIn: dailyCheckIn(advanced.dailyCheckIn, warn),
    },
    debug: bool(root.debug, false, 'debug', warn),
  };
}

function parseAccount(record: Json, index: number, seenIds: Set<string>, generateId: () => string, warn: WarnFn): AccountConfig {
  const account: AccountConfig = {
    id: ensureId(record.id, `accounts[${index}]`, seenIds, generateId, warn),
  };
  for (const key of ['email', 'password', 'userId', 'displayName'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      account[key] = value;
    }
  }
  return account;
}

function parseTrigger(record: Json, index: number, seenIds: Set<string>, generateId: () => string, warn: WarnFn): TriggerConfig {
  const label = `triggers[${index}]`;
  const id = ensureId(record.id, label, seenIds, generateId, warn);
  let type: TriggerConfig['type'];
  if (record.type === 'workout' || record.type === 'hrZone') {
    type = record.type;
  } else {
    type = 'workout';
    warn(`${label}.type is not "workout" or "hrZone", using "workout"`);
  }
  let accessory: AccessoryKind;
  if (record.accessory === 'occupancy' || record.accessory === 'switch' || record.accessory === undefined) {
    accessory = record.accessory ?? 'occupancy';
  } else {
    accessory = 'occupancy';
    warn(`${label}.accessory is not "occupancy" or "switch", using "occupancy"`);
  }
  const who = typeof record.who === 'string' && record.who.length > 0 ? record.who : 'anyone';

  if (type === 'hrZone') {
    if (who === 'anyone') {
      warn(`${label}.who must be an account for a heart-rate zone trigger; the sensor will stay off until one is chosen`);
    }
    return {
      id,
      type,
      name: text(record.name, CONFIG_DEFAULTS.hrZoneTriggerName),
      accessory,
      who,
      zone: integer(record.zone, { name: `${label}.zone`, fallback: CONFIG_DEFAULTS.zone, min: 1, max: 5 }, warn),
      holdTime: integer(record.holdTime, { name: `${label}.holdTime`, fallback: CONFIG_DEFAULTS.holdTime, min: 0 }, warn),
    };
  }
  return {
    id,
    type,
    name: text(record.name, CONFIG_DEFAULTS.workoutTriggerName),
    accessory,
    who,
    activities: activities(record.activities, label, warn),
    device: typeof record.device === 'string' && record.device.length > 0 ? record.device : 'any',
    holdAfterEnd: integer(record.holdAfterEnd, { name: `${label}.holdAfterEnd`, fallback: CONFIG_DEFAULTS.holdAfterEnd, min: 0 }, warn),
  };
}

function ensureId(value: unknown, label: string, seenIds: Set<string>, generateId: () => string, warn: WarnFn): string {
  if (typeof value === 'string' && ID_PATTERN.test(value) && !seenIds.has(value)) {
    seenIds.add(value);
    return value;
  }
  let generated = generateId();
  while (seenIds.has(generated)) {
    generated = generateId();
  }
  seenIds.add(generated);
  const reason = typeof value === 'string' && seenIds.has(value) ? 'duplicates another id' : 'has no id';
  warn(`${label} ${reason}; using a generated id for this run. Save the config from the settings page so the id persists`);
  return generated;
}

function activities(value: unknown, label: string, warn: WarnFn): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    warn(`${label}.activities is not a list, matching all activities`);
    return [];
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0) {
      if (!result.includes(entry)) {
        result.push(entry);
      }
    } else {
      warn(`${label}.activities contains a value that is not a name, ignoring it`);
    }
  }
  return result;
}

function dailyCheckIn(value: unknown, warn: WarnFn): string {
  if (value === undefined) {
    return CONFIG_DEFAULTS.dailyCheckIn;
  }
  if (typeof value === 'string' && DAILY_CHECK_IN.test(value)) {
    return value;
  }
  warn(`advanced.dailyCheckIn is not a time in HH:MM form, using ${CONFIG_DEFAULTS.dailyCheckIn}`);
  return CONFIG_DEFAULTS.dailyCheckIn;
}

interface IntegerRule {
  name: string;
  fallback: number;
  min: number;
  max?: number;
}

function integer(value: unknown, rule: IntegerRule, warn: WarnFn): number {
  if (value === undefined) {
    return rule.fallback;
  }
  const numeric = typeof value === 'string' && value.trim().length > 0 ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    warn(`${rule.name} is not a number, using ${rule.fallback}`);
    return rule.fallback;
  }
  let result = Math.round(numeric);
  if (result < rule.min) {
    warn(`${rule.name} is below ${rule.min}, using ${rule.min}`);
    result = rule.min;
  } else if (rule.max !== undefined && result > rule.max) {
    warn(`${rule.name} is above ${rule.max}, using ${rule.max}`);
    result = rule.max;
  }
  return result;
}

function bool(value: unknown, fallback: boolean, name: string, warn: WarnFn): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  warn(`${name} is not true or false, using ${fallback}`);
  return fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function arr(value: unknown, name: string, warn: WarnFn): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    warn(`${name} is not a list, ignoring it`);
    return [];
  }
  return value;
}

function obj(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}
