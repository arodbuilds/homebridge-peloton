/**
 * The polling state machine (SPEC section 8). One instance per platform.
 *
 * States: standby (switch off, no workout), scanning (switch on, no workout), locked (following one
 * account's workout), released (the workout ended, holds still running). All timing goes through an
 * injectable clock and scheduler so tests drive it. The poller keeps only the latest workout and
 * the latest sample per account.
 */

import type { Me, PerformanceGraph, Subscription, Workout } from '../api/peloton-api.js';
import { ApiError } from '../api/peloton-api.js';
import { AuthError } from '../auth/peloton-auth.js';
import type { HrZoneTriggerConfig, PelotonConfig, TriggerConfig, WorkoutTriggerConfig } from '../config.js';
import type { AccountRecord, AccountState, StoredDevice } from '../store/account-store.js';
import {
  type DeviceMap,
  EMPTY_DEVICE_MAP,
  HoldAfterEnd,
  HoldState,
  type ZoneProfile,
  hrZoneTargets,
  isDetectable,
  matchWorkout,
  toStoredZones,
  zoneBounds,
  zoneForSample,
} from './rules.js';

export type PollerState = 'standby' | 'scanning' | 'locked' | 'released';

/** A connected account the poller follows. */
export interface PollerAccount {
  /** Account id from config, the store key. */
  id: string;
  userId: string;
  displayName: string;
  /** Zone profile from the store, used when the performance graph carries no zones. */
  profile?: ZoneProfile;
}

/** The API calls the poller makes, injectable for tests. Each takes the access token last. */
export interface PollerApi {
  getLatestWorkout(userId: string, accessToken: string): Promise<Workout | null>;
  getWorkout(workoutId: string, accessToken: string): Promise<Workout>;
  getPerformanceGraph(workoutId: string, everyN: number, accessToken: string): Promise<PerformanceGraph>;
  getMe(accessToken: string): Promise<Me>;
  getSubscriptions(userId: string, accessToken: string): Promise<Subscription[]>;
}

/** The slice of the account store the poller uses. */
export interface PollerStore {
  withValidToken<T>(accountId: string, fn: (accessToken: string) => Promise<T>, options?: { forceRefresh?: boolean }): Promise<T>;
  load(accountId: string): Promise<AccountRecord | undefined>;
  loadAll(): Promise<Map<string, AccountRecord>>;
  save(accountId: string, record: AccountRecord): Promise<void>;
}

export interface PollerLog {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

/** setTimeout-like scheduler, injectable for tests. */
export interface Scheduler {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface PollerOptions {
  config: PelotonConfig;
  accounts: PollerAccount[];
  api: PollerApi;
  store: PollerStore;
  log: PollerLog;
  now?: () => number;
  scheduler?: Scheduler;
  /** device_type to device id, per account id. Accounts without an entry get an empty map. */
  deviceMaps?: Map<string, DeviceMap>;
}

export interface WorkoutStartedEvent {
  accountId: string;
  userId: string;
  displayName: string;
  workout: Workout;
}

export interface WorkoutEndedEvent {
  accountId: string;
  userId: string;
  displayName: string;
  workoutId: string;
}

export interface SampleReceivedEvent {
  accountId: string;
  workoutId: string;
  /** Latest heart-rate sample, null when the workout has no heart-rate data. */
  bpm: number | null;
  /** Zone 1 to 5, 0 when unknown. */
  zone: number;
  /** False when no new sample has arrived within two polls. */
  fresh: boolean;
}

export interface AccountStateChangedEvent {
  accountId: string;
  displayName: string;
  state: AccountState;
  stage?: string;
  status?: number;
}

export interface SwitchChangedEvent {
  on: boolean;
  reason: 'user' | 'auto';
}

export interface SwitchAutoOffEvent {
  minutes: number;
}

export interface TriggerChangedEvent {
  triggerId: string;
  name: string;
  on: boolean;
}

export interface CheckInCompleteEvent {
  /** Accounts refreshed without error. */
  count: number;
}

export interface PollerEvents {
  workoutStarted: WorkoutStartedEvent;
  workoutEnded: WorkoutEndedEvent;
  sampleReceived: SampleReceivedEvent;
  accountStateChanged: AccountStateChangedEvent;
  switchChanged: SwitchChangedEvent;
  switchAutoOff: SwitchAutoOffEvent;
  triggerChanged: TriggerChangedEvent;
  checkInComplete: CheckInCompleteEvent;
  stateChanged: { state: PollerState };
}

type Listener<T> = (event: T) => void;

/** Backoff kicks in after this many consecutive failures for one account. */
export const BACKOFF_AFTER_FAILURES = 3;
/** Backoff never stretches a base interval to more than this many seconds (or the base when longer). */
export const BACKOFF_CAP_SECONDS = 60;
/** Samples are taken every this many seconds of the workout. */
export const GRAPH_EVERY_N = 5;
/** A sample counts as stale once this many polls pass without a new one. */
export const STALE_SAMPLE_POLLS = 2;

/**
 * Epoch milliseconds of the next occurrence of a local "HH:MM" time strictly after now, using the
 * process time zone. A malformed time falls back to 03:00.
 */
export function nextLocalTime(now: number, time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  const hours = match ? Number(match[1]) : 3;
  const minutes = match ? Number(match[2]) : 0;
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now) {
    next.setDate(next.getDate() + 1);
    next.setHours(hours, minutes, 0, 0);
  }
  return next.getTime();
}

/** The interval in seconds after backoff: doubles from the third consecutive failure, capped. */
export function backoffInterval(baseSeconds: number, failures: number): number {
  if (failures < BACKOFF_AFTER_FAILURES) {
    return baseSeconds;
  }
  const cap = Math.max(baseSeconds, BACKOFF_CAP_SECONDS);
  return Math.min(baseSeconds * 2 ** (failures - BACKOFF_AFTER_FAILURES + 1), cap);
}

interface AccountRuntime {
  account: PollerAccount;
  deviceMap: DeviceMap;
  /** The last IN_PROGRESS workout id seen; a different IN_PROGRESS id is a start. */
  lastSeenActiveId?: string;
  /** Latest detectable workout, the only workout kept per account. */
  latestWorkout: Workout | null;
  /** Offset of the latest sample and how many polls have passed without a new one. */
  lastSampleOffset?: number;
  stalePolls: number;
  failures: number;
  timer?: unknown;
  polling: boolean;
  /** device_type values already reported as unmappable, one info line each. */
  deviceUnavailableLogged: Set<string>;
  /** True once this workout was reported as having no heart-rate metric. */
  noHeartRateLogged: boolean;
}

interface TriggerRuntime {
  trigger: TriggerConfig;
  hold: HoldAfterEnd | HoldState;
  on: boolean;
  /** For workout triggers, the account whose workout turned it on. */
  accountId?: string;
  timer?: unknown;
}

export class Poller {
  private readonly config: PelotonConfig;
  private readonly api: PollerApi;
  private readonly store: PollerStore;
  private readonly log: PollerLog;
  private readonly now: () => number;
  private readonly scheduler: Scheduler;
  private readonly accounts = new Map<string, AccountRuntime>();
  private readonly triggers: TriggerRuntime[];
  private readonly listeners = new Map<keyof PollerEvents, Listener<never>[]>();

  private currentState: PollerState = 'standby';
  private switchIsOn = false;
  private lockedAccountId: string | undefined;
  private lockedWorkoutId: string | undefined;
  private releasedAccountId: string | undefined;
  private generation = 0;
  private started = false;
  private readonly inFlight = new Set<Promise<void>>();
  private switchOnAt: number | undefined;
  private lastWorkoutEndAt: number | undefined;
  private autoOffTimer: unknown;
  private checkInTimer: unknown;

  constructor(options: PollerOptions) {
    this.config = options.config;
    this.api = options.api;
    this.store = options.store;
    this.log = options.log;
    this.now = options.now ?? Date.now;
    this.scheduler = options.scheduler ?? {
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
    };
    for (const account of options.accounts) {
      this.accounts.set(account.id, {
        account,
        deviceMap: options.deviceMaps?.get(account.id) ?? EMPTY_DEVICE_MAP,
        latestWorkout: null,
        stalePolls: 0,
        failures: 0,
        polling: false,
        deviceUnavailableLogged: new Set(),
        noHeartRateLogged: false,
      });
    }
    this.triggers = this.config.triggers.map((trigger) => ({
      trigger,
      hold: trigger.type === 'workout'
        ? new HoldAfterEnd(this.now, trigger.holdAfterEnd * 1000)
        : new HoldState(this.now, trigger.holdTime * 1000, trigger.holdTime * 1000),
      on: false,
    }));
  }

  /* ----------------------------------------------------------------------------------------------
   * Public surface
   * -------------------------------------------------------------------------------------------- */

  get state(): PollerState {
    return this.currentState;
  }

  get switchOn(): boolean {
    return this.switchIsOn;
  }

  /** Accounts still polled (connected and not dropped). */
  get activeAccountIds(): string[] {
    return [...this.accounts.keys()];
  }

  /** Current on/off value of every trigger, by trigger id. */
  get triggerStates(): Map<string, boolean> {
    return new Map(this.triggers.map((runtime) => [runtime.trigger.id, runtime.on]));
  }

  on<K extends keyof PollerEvents>(event: K, listener: Listener<PollerEvents[K]>): () => void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener as Listener<never>);
    this.listeners.set(event, list);
    return () => {
      const current = this.listeners.get(event) ?? [];
      this.listeners.set(event, current.filter((entry) => entry !== listener));
    };
  }

  /** Resolves once no poll or check-in is in flight. Tests use it to settle the fake clock. */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  /** Starts polling in standby. The switch is off at startup. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.setState('standby');
    this.scheduleAll(true);
    this.scheduleCheckIn();
  }

  /** Cancels every timer. */
  stop(): void {
    this.started = false;
    this.generation += 1;
    this.clearAutoOff();
    if (this.checkInTimer !== undefined) {
      this.scheduler.clearTimer(this.checkInTimer);
      this.checkInTimer = undefined;
    }
    for (const runtime of this.accounts.values()) {
      this.clearAccountTimer(runtime);
    }
    for (const runtime of this.triggers) {
      this.clearTriggerTimer(runtime);
    }
  }

  /**
   * Turns the Fast polling switch on or off. Ignored when the switch is disabled in config.
   * Any change triggers an immediate poll cycle before the new schedule starts.
   */
  setSwitch(on: boolean): void {
    if (!this.config.polling.fastSwitch || on === this.switchIsOn) {
      return;
    }
    this.switchIsOn = on;
    if (on) {
      this.switchOnAt = this.now();
      this.armAutoOff();
      this.log.info(`Fast polling switch on: scanning ${this.accounts.size} accounts every ${this.config.polling.fastInterval}s`);
    } else {
      this.clearAutoOff();
      this.log.info('Fast polling switch off');
    }
    this.emit('switchChanged', { on, reason: 'user' });
    this.applySwitchChange();
  }

  /** Runs the daily check-in now. start() schedules it at dailyCheckIn local time; tests call it directly. */
  checkInNow(): Promise<void> {
    const run = this.runCheckIn();
    this.track(run);
    return run;
  }

  /** When the auto-off timer will fire, or undefined while the switch is off. */
  get autoOffAt(): number | undefined {
    if (!this.switchIsOn) {
      return undefined;
    }
    return Math.max(this.switchOnAt ?? 0, this.lastWorkoutEndAt ?? 0) + this.config.advanced.fastSwitchAutoOffMinutes * 60_000;
  }

  /** Replaces the device map of one account, for example after a check-in. */
  setDeviceMap(accountId: string, deviceMap: DeviceMap): void {
    const runtime = this.accounts.get(accountId);
    if (runtime !== undefined) {
      runtime.deviceMap = deviceMap;
    }
  }

  /* ----------------------------------------------------------------------------------------------
   * Fast polling switch auto-off (SPEC section 8.4)
   * -------------------------------------------------------------------------------------------- */

  /**
   * Arms the auto-off timer for fastSwitchAutoOffMinutes after the later of the switch turning on
   * and the last workout ending. Called on switch-on and on every workout end while the switch is on.
   */
  private armAutoOff(): void {
    this.clearAutoOff();
    const at = this.autoOffAt;
    if (at === undefined) {
      return;
    }
    this.autoOffTimer = this.scheduler.setTimer(() => {
      this.autoOffTimer = undefined;
      this.autoOff();
    }, Math.max(0, at - this.now()));
  }

  private clearAutoOff(): void {
    if (this.autoOffTimer !== undefined) {
      this.scheduler.clearTimer(this.autoOffTimer);
      this.autoOffTimer = undefined;
    }
  }

  private autoOff(): void {
    if (!this.switchIsOn) {
      return;
    }
    const minutes = this.config.advanced.fastSwitchAutoOffMinutes;
    this.switchIsOn = false;
    this.log.info(`Fast polling switch turned off automatically after ${minutes} minutes`);
    this.emit('switchAutoOff', { minutes });
    this.emit('switchChanged', { on: false, reason: 'auto' });
    this.applySwitchChange();
  }

  /* ----------------------------------------------------------------------------------------------
   * Daily check-in (SPEC section 8.5)
   * -------------------------------------------------------------------------------------------- */

  private scheduleCheckIn(): void {
    if (this.checkInTimer !== undefined) {
      this.scheduler.clearTimer(this.checkInTimer);
    }
    const at = nextLocalTime(this.now(), this.config.advanced.dailyCheckIn);
    this.checkInTimer = this.scheduler.setTimer(() => {
      this.checkInTimer = undefined;
      this.track(this.runCheckIn().finally(() => {
        if (this.started) {
          this.scheduleCheckIn();
        }
      }));
    }, Math.max(0, at - this.now()));
  }

  /**
   * For each connected account: refresh the token, fetch /api/me for zones, avatar, and name, and
   * for the owner fetch subscriptions to update household profiles and devices in the store.
   * Failures follow 8.2: invalid_grant drops the account, anything else is skipped until tomorrow.
   */
  private async runCheckIn(): Promise<void> {
    let count = 0;
    for (const runtime of [...this.accounts.values()]) {
      const { account } = runtime;
      try {
        const me = await this.store.withValidToken(account.id, (token) => this.api.getMe(token), { forceRefresh: true });
        const record = await this.store.load(account.id);
        if (record === undefined) {
          continue;
        }
        const maxHr = me.customizedMaxHeartRate ?? me.defaultMaxHeartRate ?? undefined;
        const updated: AccountRecord = {
          ...record,
          userId: me.id,
          username: me.username,
          displayName: record.displayName ?? (`${me.firstName} ${me.lastName}`.trim() || me.username),
          imageUrl: me.imageUrl,
          isProfileImageDefault: me.isProfileImageDefault,
          hrZones: toStoredZones(me.customizedHeartRateZones),
          lastCheckedAt: this.now(),
        };
        if (maxHr !== undefined) {
          updated.maxHr = maxHr;
        }
        account.profile = { hrZones: updated.hrZones, maxHr: updated.maxHr ?? null };
        if (record.isOwner !== false) {
          await this.updateHousehold(runtime, updated);
        }
        await this.store.save(account.id, updated);
        count += 1;
      } catch (error) {
        if (error instanceof AuthError && error.code === 'invalid_grant') {
          this.dropAccount(runtime, error.stage, error.status);
        } else {
          const status = error instanceof ApiError ? `HTTP ${error.status}` : error instanceof AuthError ? `stage ${error.stage}` : 'network';
          this.log.debug(`${account.displayName}: daily check-in failed (${status})`);
        }
      }
    }
    this.log.info(`Daily check-in complete for ${count} accounts`);
    this.emit('checkInComplete', { count });
  }

  /** Reads subscriptions for a possible owner and, when it owns one, updates household profiles and devices. */
  private async updateHousehold(runtime: AccountRuntime, record: AccountRecord): Promise<void> {
    const { account } = runtime;
    const subscriptions = await this.store.withValidToken(account.id, (token) => this.api.getSubscriptions(account.userId, token));
    const owned = subscriptions.filter((subscription) => subscription.ownerId === account.userId);
    record.isOwner = owned.length > 0;
    if (!record.isOwner) {
      delete record.devices;
      return;
    }
    const devices: StoredDevice[] = [];
    for (const subscription of owned) {
      for (const device of subscription.attachedDevices) {
        if (!devices.some((known) => known.id === device.id)) {
          const stored: StoredDevice = { id: device.id, name: device.name };
          if (device.deviceType !== undefined) {
            stored.deviceType = device.deviceType;
          }
          devices.push(stored);
        }
      }
    }
    record.devices = devices;
    const deviceMap = deviceMapFromDevices(devices);
    for (const other of this.accounts.values()) {
      other.deviceMap = deviceMap;
    }
    const existing = await this.store.loadAll();
    const knownUserIds = new Set([account.userId, ...[...existing.values()].map((entry) => entry.userId)]);
    for (const subscription of owned) {
      for (const user of subscription.sharedUsers) {
        if (user.id.length === 0 || knownUserIds.has(user.id)) {
          continue;
        }
        knownUserIds.add(user.id);
        await this.store.save(user.id, {
          userId: user.id,
          username: user.username,
          displayName: `${user.firstName} ${user.lastName}`.trim() || user.username,
          imageUrl: user.imageUrl,
          isProfileImageDefault: user.isProfileImageDefault,
          state: 'not_connected',
        });
      }
    }
  }

  /* ----------------------------------------------------------------------------------------------
   * State and scheduling
   * -------------------------------------------------------------------------------------------- */

  private setState(state: PollerState): void {
    if (state === this.currentState) {
      return;
    }
    this.currentState = state;
    this.emit('stateChanged', { state });
  }

  /** The interval for standby or scanning in seconds, 0 for no polling. */
  private listInterval(): number {
    return this.switchIsOn ? this.config.polling.fastInterval : this.config.polling.standbyInterval;
  }

  private applySwitchChange(): void {
    if (!this.started) {
      return;
    }
    if (this.currentState === 'locked' || this.currentState === 'released') {
      // The workout is followed to its end whatever the switch does; poll it now.
      const runtime = this.lockedRuntime();
      if (runtime !== undefined) {
        this.clearAccountTimer(runtime);
        this.track(this.runPoll(runtime, this.currentState === 'locked' ? 'locked' : 'released'));
      }
      return;
    }
    this.setState(this.switchIsOn ? 'scanning' : 'standby');
    this.track(this.immediateCycle());
  }

  /** Polls every account now, then starts the staggered schedule. */
  private async immediateCycle(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    for (const runtime of this.accounts.values()) {
      this.clearAccountTimer(runtime);
    }
    await Promise.all([...this.accounts.values()].map((runtime) => this.runPoll(runtime, 'list', generation)));
    if (generation === this.generation && (this.currentState === 'standby' || this.currentState === 'scanning')) {
      this.scheduleAll(false);
    }
  }

  /**
   * Schedules every account's next list poll, staggered evenly across the interval. With
   * firstNow the first account polls at once; otherwise the first slot is one stagger step away.
   */
  private scheduleAll(firstNow: boolean): void {
    this.generation += 1;
    const generation = this.generation;
    const interval = this.listInterval();
    const runtimes = [...this.accounts.values()];
    for (const runtime of runtimes) {
      this.clearAccountTimer(runtime);
    }
    if (interval <= 0 || runtimes.length === 0) {
      return;
    }
    const step = (interval * 1000) / runtimes.length;
    runtimes.forEach((runtime, index) => {
      const delay = (firstNow ? index : index + 1) * step;
      runtime.timer = this.scheduler.setTimer(() => {
        runtime.timer = undefined;
        this.track(this.runPoll(runtime, 'list', generation));
      }, delay);
    });
  }

  /** Schedules one account's next poll after the interval, allowing for backoff. */
  private scheduleNext(runtime: AccountRuntime, kind: 'list' | 'locked' | 'released', generation: number): void {
    if (generation !== this.generation || !this.accounts.has(runtime.account.id)) {
      return;
    }
    const base = kind === 'list' ? this.listInterval() : this.config.polling.fastInterval;
    if (base <= 0) {
      return;
    }
    const seconds = backoffInterval(base, runtime.failures);
    this.clearAccountTimer(runtime);
    runtime.timer = this.scheduler.setTimer(() => {
      runtime.timer = undefined;
      this.track(this.runPoll(runtime, kind, generation));
    }, seconds * 1000);
  }

  private clearAccountTimer(runtime: AccountRuntime): void {
    if (runtime.timer !== undefined) {
      this.scheduler.clearTimer(runtime.timer);
      runtime.timer = undefined;
    }
  }

  private lockedRuntime(): AccountRuntime | undefined {
    const id = this.currentState === 'locked' ? this.lockedAccountId : this.releasedAccountId;
    return id === undefined ? undefined : this.accounts.get(id);
  }

  /* ----------------------------------------------------------------------------------------------
   * Polling
   * -------------------------------------------------------------------------------------------- */

  /**
   * One poll of one account. Kind list reads the workouts list (standby, scanning, released);
   * kind locked reads the locked workout by id. Failures keep the last known state and back off.
   */
  private async runPoll(runtime: AccountRuntime, kind: 'list' | 'locked' | 'released', generation = this.generation): Promise<void> {
    if (runtime.polling || !this.accounts.has(runtime.account.id)) {
      return;
    }
    if (kind === 'list' && (this.currentState === 'locked' || generation !== this.generation)) {
      // A stale list poll: the household locked on or the schedule changed while this timer waited.
      return;
    }
    runtime.polling = true;
    let dropped = false;
    try {
      if (kind === 'locked') {
        await this.pollLocked(runtime);
      } else {
        await this.pollList(runtime);
      }
      runtime.failures = 0;
    } catch (error) {
      dropped = this.handlePollError(runtime, error) === 'dropped';
    } finally {
      runtime.polling = false;
    }
    if (dropped) {
      return;
    }
    // A poll may have changed the state; schedule the next poll for where we are now. The locked or
    // released account keeps its own chain; everyone else follows the household schedule.
    if (this.currentState === 'locked' && this.lockedAccountId === runtime.account.id) {
      this.scheduleNext(runtime, 'locked', this.generation);
    } else if (this.currentState === 'released' && this.releasedAccountId === runtime.account.id) {
      this.scheduleNext(runtime, 'released', this.generation);
    } else if (kind === 'list' && generation === this.generation && (this.currentState === 'standby' || this.currentState === 'scanning')) {
      this.scheduleNext(runtime, 'list', generation);
    }
  }

  private async pollList(runtime: AccountRuntime): Promise<void> {
    const { account } = runtime;
    const workout = await this.store.withValidToken(account.id, (token) => this.api.getLatestWorkout(account.userId, token));
    this.debugWorkout(runtime, workout);
    if (!isDetectable(workout)) {
      return;
    }
    runtime.latestWorkout = workout;
    if (this.currentState === 'locked') {
      return;
    }
    if (workout.status === 'IN_PROGRESS' && workout.id !== runtime.lastSeenActiveId) {
      this.startWorkout(runtime, workout);
    }
  }

  private async pollLocked(runtime: AccountRuntime): Promise<void> {
    const { account } = runtime;
    const workoutId = this.lockedWorkoutId as string;
    const workout = await this.store.withValidToken(account.id, (token) => this.api.getWorkout(workoutId, token));
    this.debugWorkout(runtime, workout);
    runtime.latestWorkout = workout;
    if (workout.status === 'COMPLETE') {
      this.endWorkout(runtime);
      return;
    }
    if (this.hrTriggersFor(runtime).length > 0) {
      const graph = await this.store.withValidToken(account.id, (token) => this.api.getPerformanceGraph(workoutId, GRAPH_EVERY_N, token));
      this.processSample(runtime, graph);
    }
  }

  private handlePollError(runtime: AccountRuntime, error: unknown): 'failed' | 'dropped' {
    const { account } = runtime;
    if (error instanceof AuthError && error.code === 'invalid_grant') {
      this.dropAccount(runtime, error.stage, error.status);
      return 'dropped';
    }
    runtime.failures += 1;
    if (this.hrTriggersFor(runtime).length > 0 && this.currentState === 'locked' && this.lockedAccountId === account.id) {
      this.markSampleMissing(runtime);
    }
    const status = error instanceof ApiError ? `HTTP ${error.status}` : error instanceof AuthError ? `stage ${error.stage}` : 'network';
    if (runtime.failures === BACKOFF_AFTER_FAILURES) {
      const base = this.currentState === 'standby' || this.currentState === 'scanning' ? this.listInterval() : this.config.polling.fastInterval;
      const seconds = backoffInterval(base, runtime.failures);
      this.log.warn(`${account.displayName}: ${runtime.failures} consecutive poll failures (${status}), backing off to ${seconds}s`);
    } else {
      this.log.debug(`${account.displayName}: poll failed (${status}), ${runtime.failures} consecutive`);
    }
    return 'failed';
  }

  private dropAccount(runtime: AccountRuntime, stage: string, status: number | undefined): void {
    const { account } = runtime;
    this.clearAccountTimer(runtime);
    this.accounts.delete(account.id);
    this.log.info(`${account.displayName}: sign-in expired, reconnect needed (stage ${stage}, HTTP ${status ?? 'none'})`);
    this.emit('accountStateChanged', { accountId: account.id, displayName: account.displayName, state: 'reconnect_needed', stage, status });
    if ((this.currentState === 'locked' && this.lockedAccountId === account.id)
      || (this.currentState === 'released' && this.releasedAccountId === account.id)) {
      // The workout can no longer be followed: treat it as ended and let the household resume.
      if (this.currentState === 'locked') {
        this.endWorkout(runtime);
      }
      if (this.currentState === 'released') {
        this.releasedAccountId = undefined;
        this.leaveReleased();
      }
    }
  }

  /* ----------------------------------------------------------------------------------------------
   * Workout start and end
   * -------------------------------------------------------------------------------------------- */

  private startWorkout(runtime: AccountRuntime, workout: Workout): void {
    const { account } = runtime;
    runtime.lastSeenActiveId = workout.id;
    runtime.lastSampleOffset = undefined;
    runtime.stalePolls = 0;
    runtime.noHeartRateLogged = false;
    this.lockedAccountId = account.id;
    this.lockedWorkoutId = workout.id;
    this.releasedAccountId = undefined;
    for (const other of this.accounts.values()) {
      if (other !== runtime) {
        this.clearAccountTimer(other);
      }
    }
    this.generation += 1;
    this.setState('locked');
    this.log.info(`${account.displayName}: workout started (${workout.fitnessDiscipline}, ${workout.title})`);
    this.emit('workoutStarted', { accountId: account.id, userId: account.userId, displayName: account.displayName, workout });

    for (const trigger of this.triggers) {
      if (trigger.trigger.type === 'workout') {
        const match = matchWorkout(trigger.trigger, workout, account.userId, runtime.deviceMap);
        if (match.deviceUnavailable && !runtime.deviceUnavailableLogged.has(workout.deviceType)) {
          runtime.deviceUnavailableLogged.add(workout.deviceType);
          this.log.info(`${account.displayName}: device filtering is unavailable for device_type "${workout.deviceType}", treating the device filter as any`);
        }
        if (match.matches) {
          trigger.accountId = account.id;
          this.clearTriggerTimer(trigger);
          this.applyTrigger(trigger, (trigger.hold as HoldAfterEnd).start());
        }
      } else if (hrZoneTargets(trigger.trigger, account.userId)) {
        this.clearTriggerTimer(trigger);
        trigger.hold.reset();
        this.applyTrigger(trigger, false);
      }
    }
  }

  private endWorkout(runtime: AccountRuntime): void {
    const { account } = runtime;
    const workoutId = this.lockedWorkoutId as string;
    this.lockedAccountId = undefined;
    this.lockedWorkoutId = undefined;
    this.releasedAccountId = account.id;
    this.lastWorkoutEndAt = this.now();
    if (this.switchIsOn) {
      this.armAutoOff();
    }
    this.log.info(`${account.displayName}: workout ended`);
    this.emit('workoutEnded', { accountId: account.id, userId: account.userId, displayName: account.displayName, workoutId });
    for (const trigger of this.triggers) {
      if (trigger.trigger.type === 'workout') {
        if (trigger.accountId === account.id) {
          this.applyTrigger(trigger, (trigger.hold as HoldAfterEnd).end());
          this.scheduleSettle(trigger);
        }
      } else if (hrZoneTargets(trigger.trigger, account.userId)) {
        this.clearTriggerTimer(trigger);
        trigger.hold.reset();
        this.applyTrigger(trigger, false);
      }
    }
    this.setState('released');
    this.leaveReleasedIfDone();
  }

  /** Leaves released once no workout trigger is still holding. */
  private leaveReleasedIfDone(): void {
    if (this.currentState !== 'released') {
      return;
    }
    const holding = this.triggers.some((trigger) => trigger.trigger.type === 'workout' && (trigger.hold as HoldAfterEnd).holding);
    if (!holding) {
      this.leaveReleased();
    }
  }

  private leaveReleased(): void {
    this.releasedAccountId = undefined;
    this.setState(this.switchIsOn ? 'scanning' : 'standby');
    if (this.started) {
      this.scheduleAll(false);
    }
  }

  /* ----------------------------------------------------------------------------------------------
   * Heart-rate samples
   * -------------------------------------------------------------------------------------------- */

  private hrTriggersFor(runtime: AccountRuntime): TriggerRuntime[] {
    return this.triggers.filter((trigger) => trigger.trigger.type === 'hrZone' && hrZoneTargets(trigger.trigger, runtime.account.userId));
  }

  private processSample(runtime: AccountRuntime, graph: PerformanceGraph): void {
    const { account } = runtime;
    const workoutId = this.lockedWorkoutId as string;
    if (graph.heartRate === null) {
      if (!runtime.noHeartRateLogged) {
        runtime.noHeartRateLogged = true;
        this.log.info(`${account.displayName}: no heart-rate data for this workout`);
      }
      this.markSampleMissing(runtime);
      this.emit('sampleReceived', { accountId: account.id, workoutId, bpm: null, zone: 0, fresh: false });
      return;
    }
    const offset = graph.secondsSincePedalingStart[graph.secondsSincePedalingStart.length - 1];
    const bpm = graph.heartRate.latestSample;
    if (bpm === null || (offset !== undefined && offset === runtime.lastSampleOffset)) {
      runtime.stalePolls += 1;
    } else {
      runtime.stalePolls = 0;
      runtime.lastSampleOffset = offset;
    }
    const fresh = runtime.stalePolls < STALE_SAMPLE_POLLS;
    const zone = zoneForSample(bpm, zoneBounds(graph, account.profile ?? {}));
    this.log.debug(`${account.displayName}: heart rate ${bpm ?? 'none'} zone ${zone}${fresh ? '' : ' (stale)'}`);
    this.emit('sampleReceived', { accountId: account.id, workoutId, bpm, zone, fresh });
    this.evaluateHrTriggers(runtime, fresh ? zone : 0);
  }

  /** Counts a poll without a usable sample; after two the condition is false. */
  private markSampleMissing(runtime: AccountRuntime): void {
    runtime.stalePolls += 1;
    if (runtime.stalePolls >= STALE_SAMPLE_POLLS) {
      this.evaluateHrTriggers(runtime, 0);
    }
  }

  private evaluateHrTriggers(runtime: AccountRuntime, zone: number): void {
    for (const trigger of this.hrTriggersFor(runtime)) {
      const config = trigger.trigger as HrZoneTriggerConfig;
      this.applyTrigger(trigger, (trigger.hold as HoldState).update(zone > 0 && zone >= config.zone));
      this.scheduleSettle(trigger);
    }
  }

  /* ----------------------------------------------------------------------------------------------
   * Trigger values
   * -------------------------------------------------------------------------------------------- */

  private applyTrigger(runtime: TriggerRuntime, on: boolean): void {
    if (on === runtime.on) {
      return;
    }
    runtime.on = on;
    if (!on && runtime.trigger.type === 'workout') {
      runtime.accountId = undefined;
    }
    this.log.info(`${runtime.trigger.name}: ${on ? 'on' : 'off'}`);
    this.emit('triggerChanged', { triggerId: runtime.trigger.id, name: runtime.trigger.name, on });
  }

  /** Arms a timer for a pending hold transition so it lands on time without waiting for a poll. */
  private scheduleSettle(runtime: TriggerRuntime): void {
    this.clearTriggerTimer(runtime);
    const at = runtime.hold.pendingAt();
    if (at === undefined) {
      return;
    }
    runtime.timer = this.scheduler.setTimer(() => {
      runtime.timer = undefined;
      this.applyTrigger(runtime, runtime.hold.settle());
      this.scheduleSettle(runtime);
      this.leaveReleasedIfDone();
    }, Math.max(0, at - this.now()));
  }

  private clearTriggerTimer(runtime: TriggerRuntime): void {
    if (runtime.timer !== undefined) {
      this.scheduler.clearTimer(runtime.timer);
      runtime.timer = undefined;
    }
  }

  /* ----------------------------------------------------------------------------------------------
   * Helpers
   * -------------------------------------------------------------------------------------------- */

  private debugWorkout(runtime: AccountRuntime, workout: Workout | null): void {
    if (workout === null) {
      this.log.debug(`${runtime.account.displayName}: poll found no workouts`);
      return;
    }
    const flags = workout.is3pFitFeedWorkout ? ' third-party import' : '';
    this.log.debug(
      `${runtime.account.displayName}: poll workout ${workout.id} ${workout.status} ${workout.fitnessDiscipline}`
      + ` device_type=${workout.deviceType || 'none'} platform=${workout.platform || 'none'}${flags}`,
    );
  }

  /** Keeps a promise in the in-flight set until it settles; errors never escape a timer callback. */
  private track(promise: Promise<void>): void {
    const tracked = promise.catch((error: unknown) => {
      this.log.warn(`Unexpected error in the poll loop: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => {
      this.inFlight.delete(tracked);
    });
    this.inFlight.add(tracked);
  }

  private emit<K extends keyof PollerEvents>(event: K, payload: PollerEvents[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as Listener<PollerEvents[K]>)(payload);
    }
  }
}

/** Builds a device map from stored devices: device_type to device id, first entry wins. */
export function deviceMapFromDevices(devices: { id: string; deviceType?: string }[] | undefined): DeviceMap {
  const map = new Map<string, string>();
  for (const device of devices ?? []) {
    if (device.deviceType !== undefined && device.deviceType.length > 0 && !map.has(device.deviceType)) {
      map.set(device.deviceType, device.id);
    }
  }
  return map;
}

export type { WorkoutTriggerConfig };
