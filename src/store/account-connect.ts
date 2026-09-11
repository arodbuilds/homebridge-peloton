/**
 * Connecting an account from email and password or from browser sign-in tokens, and the profile and
 * household updates that the connect, the daily check-in, and the settings page share (SPEC
 * sections 7, 8.2, 8.5, 10).
 *
 * connectAccount logs in once and hands the tokens to connectWithTokens, which saves them before
 * anything else, then fills the profile from /api/me and, when the account owns a membership, the
 * household profiles and devices from subscriptions. AuthError from the login propagates untouched
 * so the caller can log its stage. The settings page's browser path calls connectWithTokens directly.
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
  remove(accountId: string): Promise<void>;
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

/** Logs in with email and password, then runs the connect flow with the tokens. */
export async function connectAccount(deps: ConnectDependencies, accountId: string, email: string, password: string): Promise<ConnectResult> {
  const tokens = await deps.login(email, password);
  return connectWithTokens(deps, accountId, tokens);
}

/**
 * Fills the record from a fresh set of tokens. Tokens are on disk with state connected before the
 * profile calls run, so a profile failure after a successful sign-in leaves a connected account
 * whose profile the next check-in completes. Once the profile names the userId, a household
 * profile the owner's subscriptions created for it (SPEC section 7, keyed by that userId) is
 * removed, since this account now stands for that member.
 */
export async function connectWithTokens(deps: Omit<ConnectDependencies, 'login'>, accountId: string, tokens: Tokens): Promise<ConnectResult> {
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
  await claimHouseholdProfile(deps.store, accountId, record.userId);

  const subscriptions = await deps.store.withValidToken(accountId, (token) => deps.api.getSubscriptions(me.id, token));
  const devices = await applyHousehold(deps.store, record, subscriptions, deps.now());
  await deps.store.save(accountId, record);
  return { record, devices };
}

/**
 * Removes the household profile the owner's subscriptions created for userId (SPEC section 7) once
 * a configured account with its own id has connected as that member, so the settings page shows one
 * card for them. A record that carries tokens is never removed. Returns true when a file was removed.
 */
export async function claimHouseholdProfile(store: Pick<ConnectStore, 'load' | 'remove'>, accountId: string, userId: string | undefined): Promise<boolean> {
  if (userId === undefined || userId.length === 0 || userId === accountId) {
    return false;
  }
  let profile: AccountRecord | undefined;
  try {
    profile = await store.load(userId);
  } catch {
    return false;
  }
  if (profile === undefined || profile.accessToken !== undefined || profile.refreshToken !== undefined) {
    return false;
  }
  await store.remove(userId);
  return true;
}

/** "first_name last_name" from /api/me when the profile carries a name, the username otherwise. */
function nameOf(profile: Me): string {
  return `${profile.firstName} ${profile.lastName}`.trim() || profile.username;
}

/**
 * Copies identity, avatar, zones, and max heart rate from /api/me onto the record. A display name
 * the record already has is kept, unless it is only the username standing in for a name, in which
 * case the profile's name replaces it.
 */
export function applyProfile(record: AccountRecord, me: Me, now: number): AccountRecord {
  const maxHr = me.customizedMaxHeartRate ?? me.defaultMaxHeartRate ?? undefined;
  const current = record.displayName ?? '';
  const keepName = current.length > 0 && current !== record.username && current !== me.username;
  const updated: AccountRecord = {
    ...record,
    userId: me.id,
    username: me.username,
    displayName: keepName ? current : nameOf(me),
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

/** True for a household profile the owner's subscriptions wrote: never connected, no tokens of its own. */
function isHouseholdProfile(record: AccountRecord): boolean {
  return record.state === 'not_connected' && record.accessToken === undefined && record.refreshToken === undefined;
}

/** The key a device is deduplicated by: its id, else its name, else its group. */
function deviceKey(device: StoredDevice): string {
  return device.id || device.name || device.group;
}

/**
 * Settles isOwner from the memberships (owner.id equal to the account's own userId) and, for the
 * owner, writes the household devices and householdFetchedAt onto the record and a not_connected
 * profile for every shared member. Devices are the union across the owned subscriptions, keyed by
 * id (device_id), or by name and then group when an entry carries none. A profile the store already
 * holds is brought up to date with the member's current username, name, and photo; a member's own
 * connected record is never touched. Returns the owner's devices, empty for a member. The caller
 * saves the record.
 */
export async function applyHousehold(
  store: Pick<ConnectStore, 'loadAll' | 'save'>,
  record: AccountRecord,
  subscriptions: Subscription[],
  now: number,
): Promise<StoredDevice[]> {
  const userId = record.userId ?? '';
  const owned = subscriptions.filter((subscription) => subscription.ownerId === userId && userId.length > 0);
  record.isOwner = owned.length > 0;
  if (!record.isOwner) {
    delete record.devices;
    delete record.householdFetchedAt;
    return [];
  }
  const devices: StoredDevice[] = [];
  for (const subscription of owned) {
    for (const device of subscription.attachedDevices) {
      const stored: StoredDevice = { id: device.id, name: device.name, group: device.group };
      if (!devices.some((known) => deviceKey(known) === deviceKey(stored))) {
        devices.push(stored);
      }
    }
  }
  record.devices = devices;
  record.householdFetchedAt = now;

  const existing = await store.loadAll();
  const known = new Map<string, { key: string; record: AccountRecord }>();
  for (const [key, entry] of existing) {
    if (entry.userId !== undefined && !known.has(entry.userId)) {
      known.set(entry.userId, { key, record: entry });
    }
  }
  for (const subscription of owned) {
    for (const user of subscription.sharedUsers) {
      if (user.id.length === 0 || user.id === userId) {
        continue;
      }
      const profile = {
        username: user.username,
        displayName: user.displayName,
        imageUrl: user.imageUrl,
        isProfileImageDefault: user.isProfileImageDefault,
      };
      const entry = known.get(user.id);
      if (entry === undefined) {
        const created: AccountRecord = { userId: user.id, ...profile, state: 'not_connected' };
        known.set(user.id, { key: user.id, record: created });
        await store.save(user.id, created);
        continue;
      }
      if (!isHouseholdProfile(entry.record)) {
        continue;
      }
      const refreshed: AccountRecord = { ...entry.record, ...profile };
      if (JSON.stringify(refreshed) !== JSON.stringify(entry.record)) {
        entry.record = refreshed;
        await store.save(entry.key, refreshed);
      }
    }
  }
  return devices;
}
