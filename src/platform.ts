/**
 * The Peloton platform: loads config, opens the account store, builds the device map, constructs the
 * poller with the real clock, registers accessories, and connects poller events to them.
 * Info log lines are the ones SPEC section 11 lists and nothing more.
 */

import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { AttentionSensor } from './accessories/attention-sensor.js';
import { attentionSensorUuid, fastPollingSwitchUuid, triggerUuid } from './accessories/common.js';
import { FastPollingSwitch } from './accessories/fast-polling-switch.js';
import { TriggerSensor } from './accessories/trigger-sensor.js';
import { ApiError, getLatestWorkout, getMe, getPerformanceGraph, getSubscriptions, getWorkout } from './api/peloton-api.js';
import { AuthError, login } from './auth/peloton-auth.js';
import { type AccountConfig, type PelotonConfig, parseConfig } from './config.js';
import { Poller, type PollerAccount, type PollerLog, type Scheduler, deviceMapFromDevices } from './poller/poller.js';
import type { DeviceMap } from './poller/rules.js';
import { PLATFORM_NAME, PLUGIN_NAME, PLUGIN_VERSION } from './settings.js';
import { type ConnectDependencies, type LoginFn, connectAccount } from './store/account-connect.js';
import { type AccountRecord, AccountStore } from './store/account-store.js';

/** Injection points for tests; Homebridge never passes these. */
export interface PlatformDependencies {
  now?: () => number;
  scheduler?: Scheduler;
  fetchImpl?: typeof fetch;
  /** Headless login, defaults to the auth module over fetchImpl. */
  login?: LoginFn;
}

export class PelotonPlatform implements DynamicPlatformPlugin {
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly pelotonConfig: PelotonConfig;
  /** Resolves once didFinishLaunching has been handled, for tests. */
  public readonly launched: Promise<void>;

  private readonly deps: PlatformDependencies;
  private readonly sensors = new Map<string, TriggerSensor>();
  private fastSwitch: FastPollingSwitch | undefined;
  private attention: AttentionSensor | undefined;
  private store: AccountStore | undefined;
  private poller: Poller | undefined;
  private resolveLaunched: () => void = () => undefined;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
    deps: PlatformDependencies = {},
  ) {
    this.deps = deps;
    this.pelotonConfig = parseConfig(config, { warn: (line) => this.log.warn(line) });
    this.launched = new Promise((resolve) => {
      this.resolveLaunched = resolve;
    });
    this.api.on('didFinishLaunching', () => {
      this.launch().catch((error: unknown) => {
        this.log.error(`Peloton platform failed to start: ${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => this.resolveLaunched());
    });
    this.api.on('shutdown', () => this.shutdown());
  }

  /** Called by Homebridge for each cached accessory at startup. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  /** The running poller, once launched. */
  get activePoller(): Poller | undefined {
    return this.poller;
  }

  private async launch(): Promise<void> {
    const config = this.pelotonConfig;
    this.store = new AccountStore({ storagePath: this.api.user.storagePath(), now: this.deps.now, fetchImpl: this.deps.fetchImpl });
    await this.signInAtStartup(config, await this.store.loadAll());
    const records = await this.store.loadAll();

    const accounts = this.selectAccounts(config, records);
    const deviceMap = this.buildDeviceMap(records);
    const deviceMaps = new Map<string, DeviceMap>(accounts.map((account) => [account.id, deviceMap]));

    this.registerAccessories();

    const fetchImpl = this.deps.fetchImpl;
    const pollerLog: PollerLog = {
      info: (message) => this.log.info(message),
      warn: (message) => this.log.warn(message),
      debug: (message) => (config.debug ? this.log.info(message) : this.log.debug(message)),
    };
    this.poller = new Poller({
      config,
      accounts,
      api: {
        getLatestWorkout: (userId, token) => getLatestWorkout(userId, token, fetchImpl),
        getWorkout: (workoutId, token) => getWorkout(workoutId, token, fetchImpl),
        getPerformanceGraph: (workoutId, everyN, token) => getPerformanceGraph(workoutId, everyN, token, fetchImpl),
        getMe: (token) => getMe(token, fetchImpl),
        getSubscriptions: (userId, token) => getSubscriptions(userId, token, fetchImpl),
      },
      store: this.store,
      log: pollerLog,
      now: this.deps.now,
      scheduler: this.deps.scheduler,
      deviceMaps,
      reconnect: (accountId) => this.reconnect(accountId),
    });
    this.wireEvents(records);
    this.poller.start();
  }

  /**
   * Signs in every configured account that has email and password but no usable stored sign-in,
   * one after another, before polling starts. Accounts with tokens on disk are left alone.
   */
  private async signInAtStartup(config: PelotonConfig, records: Map<string, AccountRecord>): Promise<void> {
    for (const account of config.accounts) {
      const record = records.get(account.id);
      if (record?.state === 'connected' && record.accessToken !== undefined && record.refreshToken !== undefined) {
        continue;
      }
      await this.signIn(account, record);
    }
  }

  /** One login attempt for an account with credentials. Returns the record on success, undefined otherwise. */
  private async signIn(account: AccountConfig, record: AccountRecord | undefined): Promise<AccountRecord | undefined> {
    if (account.email === undefined || account.password === undefined || this.store === undefined) {
      return undefined;
    }
    const displayName = account.displayName ?? record?.displayName ?? record?.username ?? account.id;
    const fetchImpl = this.deps.fetchImpl;
    const deps: ConnectDependencies = {
      store: this.store,
      api: {
        getMe: (token) => getMe(token, fetchImpl),
        getSubscriptions: (userId, token) => getSubscriptions(userId, token, fetchImpl),
      },
      login: this.deps.login ?? ((email, password) => login(email, password, fetchImpl, { now: this.deps.now })),
      now: this.deps.now ?? Date.now,
    };
    try {
      const result = await connectAccount(deps, account.id, account.email, account.password);
      this.log.info(`Connected ${account.displayName ?? result.record.displayName ?? displayName} (@${result.record.username ?? ''})`);
      return result.record;
    } catch (error) {
      if (error instanceof AuthError) {
        this.log.info(`${displayName}: sign-in failed at stage ${error.stage}, HTTP ${error.status ?? 'none'}; use the settings page to connect`);
      } else {
        const status = error instanceof ApiError ? `HTTP ${error.status}` : error instanceof Error ? error.message : String(error);
        this.log.warn(`${displayName}: profile fetch after sign-in failed (${status}); the daily check-in will retry`);
      }
      return undefined;
    }
  }

  /** The poller's one re-login attempt after invalid_grant, for accounts with a password in config. */
  private async reconnect(accountId: string): Promise<PollerAccount | undefined> {
    const account = this.pelotonConfig.accounts.find((entry) => entry.id === accountId);
    if (account === undefined || this.store === undefined) {
      return undefined;
    }
    const record = await this.signIn(account, await this.store.load(accountId));
    if (record === undefined) {
      return undefined;
    }
    const selected = this.selectAccounts({ ...this.pelotonConfig, accounts: [account] }, new Map([[accountId, record]]));
    return selected[0];
  }

  private shutdown(): void {
    this.poller?.stop();
  }

  /** Connected accounts with a userId start polling; the rest are skipped with one info line each. */
  private selectAccounts(config: PelotonConfig, records: Map<string, AccountRecord>): PollerAccount[] {
    const accounts: PollerAccount[] = [];
    for (const account of config.accounts) {
      const record = records.get(account.id);
      const displayName = account.displayName ?? record?.displayName ?? record?.username ?? account.id;
      if (record === undefined || record.state === 'not_connected') {
        this.log.info(`${displayName}: not connected, not polling`);
        continue;
      }
      if (record.state === 'reconnect_needed') {
        this.log.info(`${displayName}: reconnect needed, not polling until the account is connected again`);
        continue;
      }
      if (record.userId === undefined || record.userId.length === 0) {
        this.log.warn(`${displayName}: connected but has no user id; connect it again from the settings page`);
        continue;
      }
      const profile: PollerAccount['profile'] = {};
      if (record.hrZones !== undefined) {
        profile.hrZones = record.hrZones;
      }
      if (record.maxHr !== undefined) {
        profile.maxHr = record.maxHr;
      }
      accounts.push({ id: account.id, userId: record.userId, displayName, profile });
    }
    return accounts;
  }

  /** device_type to device id from every stored household device; the household shares its hardware. */
  private buildDeviceMap(records: Map<string, AccountRecord>): DeviceMap {
    const devices = [...records.values()].flatMap((record) => record.devices ?? []);
    return deviceMapFromDevices(devices);
  }

  /** Creates or refreshes every accessory the config wants and unregisters the rest. */
  private registerAccessories(): void {
    const config = this.pelotonConfig;
    const { hap } = this.api;
    const wanted = new Set<string>();
    const created: PlatformAccessory[] = [];
    const existing: PlatformAccessory[] = [];

    const take = (uuid: string, name: string): PlatformAccessory => {
      wanted.add(uuid);
      const cached = this.accessories.get(uuid);
      if (cached !== undefined) {
        existing.push(cached);
        return cached;
      }
      const accessory = new this.api.platformAccessory(name, uuid);
      this.accessories.set(uuid, accessory);
      created.push(accessory);
      return accessory;
    };

    for (const trigger of config.triggers) {
      const accessory = take(triggerUuid(hap, trigger.id), trigger.name);
      this.sensors.set(trigger.id, new TriggerSensor(hap, accessory, trigger, PLUGIN_VERSION));
    }
    if (config.polling.fastSwitch) {
      const accessory = take(fastPollingSwitchUuid(hap), config.polling.fastSwitchName);
      this.fastSwitch = new FastPollingSwitch(hap, accessory, config.polling.fastSwitchName, PLUGIN_VERSION, (on) => {
        this.poller?.setSwitch(on);
      });
    }
    if (config.advanced.attentionSensor) {
      const accessory = take(attentionSensorUuid(hap), 'Peloton attention needed');
      this.attention = new AttentionSensor(hap, accessory, PLUGIN_VERSION);
    }

    const orphans = [...this.accessories.values()].filter((accessory) => !wanted.has(accessory.UUID));
    for (const orphan of orphans) {
      this.accessories.delete(orphan.UUID);
    }
    if (orphans.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, orphans);
    }
    if (created.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, created);
    }
    if (existing.length > 0) {
      this.api.updatePlatformAccessories(existing);
    }
  }

  private wireEvents(records: Map<string, AccountRecord>): void {
    const poller = this.poller as Poller;
    poller.on('triggerChanged', (event) => {
      this.sensors.get(event.triggerId)?.update(event.on);
    });
    poller.on('switchChanged', (event) => {
      this.fastSwitch?.update(event.on);
    });
    if (this.attention !== undefined) {
      const attention = this.attention;
      for (const account of this.pelotonConfig.accounts) {
        attention.setAccountNeedsAttention(account.id, records.get(account.id)?.state === 'reconnect_needed');
      }
      poller.on('accountStateChanged', (event) => {
        attention.setAccountNeedsAttention(event.accountId, event.state === 'reconnect_needed');
      });
    }
  }
}
