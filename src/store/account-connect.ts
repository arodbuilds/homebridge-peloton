/**
 * Connecting an account from email and password, and the profile and household updates that the
 * connect, the daily check-in, and the settings page share (SPEC sections 7, 8.2, 8.5, 10).
 *
 * connectAccount logs in once, saves the tokens before anything else, then fills the profile from
 * /api/me and, when the account owns a membership, the household profiles and devices from
 * subscriptions. AuthError from the login propagates untouched so the caller can log its stage.
 */

import type { Me, Subscription } from '../api/peloton-api.js';
import type { Tokens } from '../auth/peloton-auth.js';
import { toStoredZones } from '../poller/rules.js';
import type { AccountRecord, StoredDevice } from './account-store.js';

export type LoginFn = (email: string, password: string) => Promise<Tokens>;

/** The store slice the connect flow uses. */
export interface ConnectStore {
  load(accountId: string): Promise<AccountRecord | undefined>;
  loadAll(): Promise<Map<string, AccountRecord>>;
  save(accountId: string, record: AccountRecord): Promise<void>;
  withValidToken<T>(accountId: string, fn: (accessToken: string) => Promise<T>, options?: { forceRefresh?: boolean }): Promise<T>;
}

export interface ConnectApi {
  getMe(accessToken: string): Promise<Me>;
  getSubscriptions(userId: string, accessToken: string): Promise<Subscription[]>;
}

export interface ConnectDependencies {
  store: ConnectStore;
  api: ConnectApi;
  login: LoginFn;
  now: () => number;
}

export interface ConnectResult {
  record: AccountRecord;
  /** The household devices when the account is the owner, otherwise empty. */
  devices: StoredDevice[];
}

/**
 * Logs in and fills the record. Tokens are on disk with state connected before the profile calls
 * run, so a profile failure after a successful login leaves a connected account whose profile the
 * next check-in completes.
 */
export async function connectAccount(deps: ConnectDependencies, accountId: string, email: string, password: string): Promise<ConnectResult> {
  const tokens = await deps.login(email, password);
  const previous = (await deps.store.load(accountId)) ?? { state: 'not_connected' };
  let record: AccountRecord = {
    ...previous,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt,
    refreshToken: tokens.refreshToken,
    state: 'connected',
    lastCheckedAt: deps.now(),
  };
  delete record.lastError;
  await deps.store.save(accountId, record);

  const me = await deps.store.withValidToken(accountId, (token) => deps.api.getMe(token));
  record = applyProfile(record, me, deps.now());
  await deps.store.save(accountId, record);

  const subscriptions = await deps.store.withValidToken(accountId, (token) => deps.api.getSubscriptions(me.id, token));
  const devices = await applyHousehold(deps.store, record, subscriptions);
  await deps.store.save(accountId, record);
  return { record, devices };
}

/** Copies identity, avatar, zones, and max heart rate from /api/me onto the record. */
export function applyProfile(record: AccountRecord, me: Me, now: number): AccountRecord {
  const maxHr = me.customizedMaxHeartRate ?? me.defaultMaxHeartRate ?? undefined;
  const updated: AccountRecord = {
    ...record,
    userId: me.id,
    username: me.username,
    displayName: record.displayName ?? (`${me.firstName} ${me.lastName}`.trim() || me.username),
    imageUrl: me.imageUrl,
    isProfileImageDefault: me.isProfileImageDefault,
    hrZones: toStoredZones(me.customizedHeartRateZones),
    lastCheckedAt: now,
  };
  if (maxHr !== undefined) {
    updated.maxHr = maxHr;
  }
  return updated;
}

/**
 * Settles isOwner from the memberships (owner.id equal to the account's own userId) and, for the
 * owner, writes the household devices onto the record and a not_connected profile for every shared
 * member the store does not know yet. Returns the owner's devices, empty for a member.
 * The caller saves the record.
 */
export async function applyHousehold(
  store: Pick<ConnectStore, 'loadAll' | 'save'>,
  record: AccountRecord,
  subscriptions: Subscription[],
): Promise<StoredDevice[]> {
  const userId = record.userId ?? '';
  const owned = subscriptions.filter((subscription) => subscription.ownerId === userId && userId.length > 0);
  record.isOwner = owned.length > 0;
  if (!record.isOwner) {
    delete record.devices;
    return [];
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

  const existing = await store.loadAll();
  const knownUserIds = new Set<string>([userId]);
  for (const entry of existing.values()) {
    if (entry.userId !== undefined) {
      knownUserIds.add(entry.userId);
    }
  }
  for (const subscription of owned) {
    for (const user of subscription.sharedUsers) {
      if (user.id.length === 0 || knownUserIds.has(user.id)) {
        continue;
      }
      knownUserIds.add(user.id);
      await store.save(user.id, {
        userId: user.id,
        username: user.username,
        displayName: `${user.firstName} ${user.lastName}`.trim() || user.username,
        imageUrl: user.imageUrl,
        isProfileImageDefault: user.isProfileImageDefault,
        state: 'not_connected',
      });
    }
  }
  return devices;
}
