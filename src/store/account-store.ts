/**
 * Per-account persistence (SPEC section 7).
 *
 * Path: {storagePath}/homebridge-peloton/accounts/{account id}.json, files 0600, directory 0700.
 * Writes are atomic: temp file in the same directory, then rename. A refresh is not complete
 * until the rotated refresh token is on disk.
 */

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ApiError } from '../api/peloton-api.js';
import { AuthError, refresh as refreshTokens, type Tokens } from '../auth/peloton-auth.js';

export type AccountState = 'connected' | 'reconnect_needed' | 'not_connected';

export interface StoredZone {
  zone: number;
  min: number;
  max: number;
}

export interface LastError {
  stage: string;
  status?: number;
  at: number;
}

/** An attached device from the owner's subscriptions, kept so the device map survives a restart. */
export interface StoredDevice {
  id: string;
  name: string;
  /** Hardware model code when the subscriptions call carried device_type. */
  deviceType?: string;
}

export interface AccountRecord {
  userId?: string;
  username?: string;
  displayName?: string;
  imageUrl?: string;
  isProfileImageDefault?: boolean;
  accessToken?: string;
  /** Epoch milliseconds. */
  accessTokenExpiresAt?: number;
  refreshToken?: string;
  hrZones?: StoredZone[];
  maxHr?: number;
  /** True once a subscriptions call showed this account owns the household. */
  isOwner?: boolean;
  /** Household devices, present on the owner's record only. */
  devices?: StoredDevice[];
  state: AccountState;
  lastCheckedAt?: number;
  lastError?: LastError;
}

export type RefreshFn = (refreshToken: string, fetchImpl?: typeof fetch) => Promise<Tokens>;

export interface AccountStoreOptions {
  /** Homebridge storagePath. The store lives under homebridge-peloton/accounts inside it. */
  storagePath: string;
  /** Injectable clock, epoch milliseconds. */
  now?: () => number;
  /** Injectable refresh, defaults to the auth module. */
  refresh?: RefreshFn;
  /** Fetch passed through to refresh. */
  fetchImpl?: typeof fetch;
}

/** Refresh when the access token is within this many milliseconds of expiry. */
export const REFRESH_AHEAD_MS = 6 * 60 * 60 * 1000;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export class AccountStore {
  public readonly directory: string;
  private readonly now: () => number;
  private readonly refresh: RefreshFn;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly inFlightRefresh = new Map<string, Promise<AccountRecord>>();

  constructor(options: AccountStoreOptions) {
    this.directory = join(options.storagePath, 'homebridge-peloton', 'accounts');
    this.now = options.now ?? Date.now;
    this.refresh = options.refresh ?? refreshTokens;
    this.fetchImpl = options.fetchImpl;
  }

  /** Creates the directory with mode 0700. Safe to call repeatedly. */
  async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: DIR_MODE });
    await chmod(this.directory, DIR_MODE);
  }

  /** Loads every account file. Unreadable or malformed files are skipped. */
  async loadAll(): Promise<Map<string, AccountRecord>> {
    await this.ensureDirectory();
    const result = new Map<string, AccountRecord>();
    for (const entry of await readdir(this.directory)) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const id = entry.slice(0, -'.json'.length);
      if (!ID_PATTERN.test(id)) {
        continue;
      }
      const record = await this.load(id);
      if (record !== undefined) {
        result.set(id, record);
      }
    }
    return result;
  }

  /** Loads one account, or undefined when it has no file or the file is malformed. */
  async load(accountId: string): Promise<AccountRecord | undefined> {
    assertId(accountId);
    let text: string;
    try {
      text = await readFile(this.filePath(accountId), 'utf8');
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return undefined;
      }
      throw error;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as AccountRecord;
        if (record.state === 'connected' || record.state === 'reconnect_needed' || record.state === 'not_connected') {
          return record;
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /** Saves one account atomically with mode 0600. */
  async save(accountId: string, record: AccountRecord): Promise<void> {
    assertId(accountId);
    await this.ensureDirectory();
    const target = this.filePath(accountId);
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    const data = JSON.stringify(record, null, 2) + '\n';
    try {
      await writeFile(temp, data, { mode: FILE_MODE, flag: 'wx' });
      await chmod(temp, FILE_MODE);
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Removes one account file. Missing files are not an error. */
  async remove(accountId: string): Promise<void> {
    assertId(accountId);
    await rm(this.filePath(accountId), { force: true });
  }

  /**
   * Runs fn with a valid access token. Refreshes first when the token is within 6 hours of expiry
   * (or always, with forceRefresh, as the daily check-in does), and once more when fn throws
   * ApiError 401. A rotated refresh token is on disk before fn runs.
   * On invalid_grant the account is marked reconnect_needed and AuthError stage refresh is rethrown.
   */
  async withValidToken<T>(accountId: string, fn: (accessToken: string) => Promise<T>, options: { forceRefresh?: boolean } = {}): Promise<T> {
    let record = await this.load(accountId);
    if (record === undefined || record.accessToken === undefined || record.refreshToken === undefined) {
      throw new Error(`Account ${accountId} has no tokens`);
    }
    const expiresAt = record.accessTokenExpiresAt ?? 0;
    if (options.forceRefresh === true || expiresAt - this.now() <= REFRESH_AHEAD_MS) {
      record = await this.refreshAccount(accountId, record);
    }
    try {
      return await fn(record.accessToken as string);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        throw error;
      }
    }
    record = await this.refreshAccount(accountId, record);
    return fn(record.accessToken as string);
  }

  private async refreshAccount(accountId: string, record: AccountRecord): Promise<AccountRecord> {
    const pending = this.inFlightRefresh.get(accountId);
    if (pending !== undefined) {
      return pending;
    }
    const task = this.doRefresh(accountId, record).finally(() => {
      this.inFlightRefresh.delete(accountId);
    });
    this.inFlightRefresh.set(accountId, task);
    return task;
  }

  private async doRefresh(accountId: string, record: AccountRecord): Promise<AccountRecord> {
    // Another caller may have rotated the tokens between this caller's load and now. Re-read the
    // file and reuse a fresh rotation rather than refreshing with a token Auth0 has already retired.
    const current = await this.load(accountId);
    if (current !== undefined && current.refreshToken !== undefined && current.accessToken !== undefined
      && current.refreshToken !== record.refreshToken
      && (current.accessTokenExpiresAt ?? 0) - this.now() > REFRESH_AHEAD_MS) {
      return current;
    }
    const refreshToken = (current?.refreshToken ?? record.refreshToken) as string;
    let tokens: Tokens;
    try {
      tokens = await this.refresh(refreshToken, this.fetchImpl);
    } catch (error) {
      if (error instanceof AuthError && error.code === 'invalid_grant') {
        const failed: AccountRecord = {
          ...record,
          state: 'reconnect_needed',
          lastError: { stage: error.stage, status: error.status, at: this.now() },
        };
        delete failed.accessToken;
        delete failed.accessTokenExpiresAt;
        delete failed.refreshToken;
        await this.save(accountId, failed);
        throw new AuthError('refresh', error.status, error.code);
      }
      throw error;
    }
    const updated: AccountRecord = {
      ...record,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt,
      refreshToken: tokens.refreshToken,
      state: 'connected',
      lastCheckedAt: this.now(),
    };
    delete updated.lastError;
    await this.save(accountId, updated);
    return updated;
  }

  private filePath(accountId: string): string {
    return join(this.directory, `${accountId}.json`);
  }
}

function assertId(accountId: string): void {
  if (!ID_PATTERN.test(accountId)) {
    throw new Error('Invalid account id');
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error !== null && typeof error === 'object' && (error as NodeJS.ErrnoException).code === code;
}
