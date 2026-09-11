/**
 * Pure trigger rules (SPEC section 8.3): workout detectability and matching, zone bounds and zone
 * from a sample, and the two hold helpers. Nothing here touches the network, the store, or timers;
 * timing comes from an injected clock.
 */

import type { HeartRateZone, PerformanceGraph, Workout } from '../api/peloton-api.js';
import type { DeviceFilter, HrZoneTriggerConfig, WorkoutTriggerConfig } from '../config.js';
import type { StoredZone } from '../store/account-store.js';

/**
 * The workout platform each device filter stands for (SPEC section 8.3). Confirmed on the Pi ride
 * tests: the Bike+ reports device_type home_bike_plus with platform home_bike, the Tread reports
 * device_type prism with platform home_tread, and an Apple Health import reports device_type
 * apple_health with platform iOS_app. device_type is the hardware model code and stays in the
 * debug log; platform is what the filter compares.
 */
export const PLATFORM_BY_DEVICE: Readonly<Record<Exclude<DeviceFilter, 'any'>, string>> = {
  bike: 'home_bike',
  tread: 'home_tread',
};

/**
 * True when the workout takes part in detection. Third-party fitness feed imports never start or
 * end a workout, and only IN_PROGRESS and COMPLETE statuses are known.
 */
export function isDetectable(workout: Workout | null | undefined): workout is Workout {
  if (workout === null || workout === undefined || workout.is3pFitFeedWorkout) {
    return false;
  }
  return workout.status === 'IN_PROGRESS' || workout.status === 'COMPLETE';
}

/**
 * Compares a trigger's device filter with the workout's platform: "any" matches every workout,
 * "bike" matches platform home_bike, "tread" matches platform home_tread. Workouts carry no device
 * id, so this is the whole device rule; an import or an app workout matches only "any".
 */
export function deviceMatches(device: DeviceFilter | string, workout: Workout): boolean {
  if (device === 'any') {
    return true;
  }
  const platform = (PLATFORM_BY_DEVICE as Record<string, string | undefined>)[device];
  return platform !== undefined && workout.platform === platform;
}

/** Workout trigger matching per SPEC section 8.3: who, then activities, then device. */
export function workoutMatches(trigger: WorkoutTriggerConfig, workout: Workout, accountUserId: string): boolean {
  if (trigger.who !== 'anyone' && trigger.who !== accountUserId) {
    return false;
  }
  if (trigger.activities.length > 0 && !trigger.activities.includes(workout.fitnessDiscipline)) {
    return false;
  }
  return deviceMatches(trigger.device, workout);
}

/** True when the heart-rate zone trigger targets this account. */
export function hrZoneTargets(trigger: HrZoneTriggerConfig, accountUserId: string): boolean {
  return trigger.who !== 'anyone' && trigger.who === accountUserId;
}

/** Profile fields the zone fallback needs, in the shape the account store keeps them. */
export interface ZoneProfile {
  hrZones?: StoredZone[];
  maxHr?: number | null;
}

/** Zone 2 to 5 lower bounds as a fraction of max heart rate; zone 1 starts at 0. */
const ZONE_FRACTIONS = [0.65, 0.75, 0.85, 0.95];

/**
 * Peloton's default zones from a max heart rate: zone 1 below 65 percent, zone 2 65 to 75, zone 3
 * 75 to 85, zone 4 85 to 95, zone 5 95 and above, each lower bound rounded down to a whole beat.
 */
export function defaultZones(maxHr: number): StoredZone[] {
  const lower = [0, ...ZONE_FRACTIONS.map((fraction) => Math.floor(fraction * maxHr))];
  return lower.map((min, index) => ({
    zone: index + 1,
    min,
    max: index + 1 < lower.length ? (lower[index + 1] as number) - 1 : maxHr,
  }));
}

/** Zones as the API returns them, converted to the store shape. */
export function toStoredZones(zones: HeartRateZone[]): StoredZone[] {
  return zones.map((zone) => ({ zone: zone.zone, min: zone.minValue, max: zone.maxValue }));
}

/**
 * Zone bounds in SPEC's priority order: zones[] on the performance graph's heart_rate metric,
 * then the profile's customised zones, then the defaults from the profile's max heart rate.
 * Empty when none applies.
 */
export function zoneBounds(graph: PerformanceGraph | null | undefined, profile: ZoneProfile): StoredZone[] {
  const graphZones = graph?.heartRate?.zones;
  if (graphZones !== undefined && graphZones.length > 0) {
    return toStoredZones(graphZones);
  }
  if (profile.hrZones !== undefined && profile.hrZones.length > 0) {
    return profile.hrZones;
  }
  if (typeof profile.maxHr === 'number' && profile.maxHr > 0) {
    return defaultZones(profile.maxHr);
  }
  return [];
}

/**
 * Zone number for a sample: the highest zone whose lower bound the sample reaches. 0 when there are
 * no bounds or the sample is below every lower bound.
 */
export function zoneForSample(bpm: number | null | undefined, zones: StoredZone[]): number {
  if (bpm === null || bpm === undefined || !Number.isFinite(bpm) || zones.length === 0) {
    return 0;
  }
  let result = 0;
  for (const zone of zones) {
    if (bpm >= zone.min && zone.zone > result) {
      result = zone.zone;
    }
  }
  return result;
}

/**
 * Turns a boolean condition into an on/off value with a hold time in each direction: the value
 * turns on once the condition has held for holdOnMs and off once it has been false for holdOffMs.
 * Callers feed update() on every evaluation and may call settle() at pendingAt() to apply a change
 * that is due without a new observation.
 */
export class HoldState {
  private on = false;
  private condition = false;
  private changedAt: number | undefined;

  constructor(
    private readonly now: () => number,
    private readonly holdOnMs: number,
    private readonly holdOffMs: number,
  ) {}

  get value(): boolean {
    return this.on;
  }

  /** Records the current condition and returns the held value. */
  update(condition: boolean): boolean {
    const at = this.now();
    if (condition !== this.condition) {
      this.condition = condition;
      this.changedAt = condition === this.on ? undefined : at;
    }
    return this.settle();
  }

  /** Applies a pending change whose hold time has elapsed. Returns the held value. */
  settle(): boolean {
    if (this.changedAt !== undefined && this.condition !== this.on) {
      const hold = this.condition ? this.holdOnMs : this.holdOffMs;
      if (this.now() - this.changedAt >= hold) {
        this.on = this.condition;
        this.changedAt = undefined;
      }
    }
    return this.on;
  }

  /** The time at which the value will change if the condition stays as it is, or undefined. */
  pendingAt(): number | undefined {
    if (this.changedAt === undefined || this.condition === this.on) {
      return undefined;
    }
    return this.changedAt + (this.condition ? this.holdOnMs : this.holdOffMs);
  }

  /** Forces the value off and forgets any pending change. */
  reset(): void {
    this.on = false;
    this.condition = false;
    this.changedAt = undefined;
  }
}

/**
 * The workout sensor's hold: on from start until end plus holdAfterEnd. A new matching workout
 * during the hold keeps the value on without a gap.
 */
export class HoldAfterEnd {
  private on = false;
  private offAtMs: number | undefined;

  constructor(
    private readonly now: () => number,
    private readonly holdMs: number,
  ) {}

  get value(): boolean {
    return this.on;
  }

  /** True while the workout has ended and the hold is still running. */
  get holding(): boolean {
    return this.on && this.offAtMs !== undefined;
  }

  /** A matching workout started or is still running. */
  start(): boolean {
    this.on = true;
    this.offAtMs = undefined;
    return this.on;
  }

  /** The matching workout ended; the value stays on for the hold time. */
  end(): boolean {
    if (this.on && this.offAtMs === undefined) {
      this.offAtMs = this.now() + this.holdMs;
    }
    return this.settle();
  }

  /** Applies the off transition once the hold has elapsed. Returns the value. */
  settle(): boolean {
    if (this.offAtMs !== undefined && this.now() >= this.offAtMs) {
      this.on = false;
      this.offAtMs = undefined;
    }
    return this.on;
  }

  /** When the value turns off, or undefined when it is off or no end is pending. */
  pendingAt(): number | undefined {
    return this.offAtMs;
  }

  reset(): void {
    this.on = false;
    this.offAtMs = undefined;
  }
}
