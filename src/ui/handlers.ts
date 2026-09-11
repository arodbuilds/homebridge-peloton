/**
 * Request handlers behind the settings page (SPEC section 10). They run in the plugin's UI server
 * process, read and write the account store directly through the same module the platform uses,
 * and never return tokens to the page. Every failure resolves to { ok: false, stage } where stage
 * is an auth stage from SPEC section 5.1, or "api" for a Peloton API or network failure, with the
 * HTTP status when there was one; the page maps the stage to its message. Passwords and callback
 * URLs are used for the one request that carries them and are never logged or stored here.
 */

import { Buffer } from 'node:buffer';

import type { Me, Subscription, Workout } from '../api/peloton-api.js';
import { ApiError } from '../api/peloton-api.js';
import { AuthError, type AuthStage, type BrowserStart, type Tokens } from '../auth/peloton-auth.js';
import { isDetectable } from '../poller/rules.js';
import { type ConnectStore, type LoginFn, applyHousehold, applyProfile, connectAccount, connectWithTokens } from '../store/account-connect.js';
import type { AccountRecord, AccountState } from '../store/account-store.js';

/** An auth stage (SPEC section 5.1), or "api" for a Peloton API or network failure. */
export type UiStage = AuthStage | 'api';

export interface UiApi {
  getMe(accessToken: string): Promise<Me>;
  getSubscriptions(userId: string, accessToken: string): Promise<Subscription[]>;
  getLatestWorkout(userId: string, accessToken: string): Promise<Workout | null>;
}

export interface UiAuth {
  login: LoginFn;
  browserStart(): BrowserStart;
  browserFinish(callbackUrl: string, verifier: string, state: string): Promise<Tokens>;
}

export interface UiHandlerOptions {
  store: ConnectStore;
  api: UiApi;
  auth: UiAuth;
  /** Used for the avatar proxy only. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** The installed package version, for the page footer. */
  version: string;
}

/** One account as the page shows it. Never carries tokens. */
export interface AccountSummary {
  id: string;
  userId?: string;
  displayName?: string;
  username?: string;
  /** True when /avatar has a photo for this account; false means initials on a disc. */
  avatar: boolean;
  isOwner: boolean;
  state: AccountState;
  /** Epoch milliseconds. */
  lastCheckedAt?: number;
  /** created_at of the latest Peloton workout in the workouts list, epoch milliseconds; null when unknown or the list is empty. */
  lastWorkoutAt: number | null;
}

export interface DeviceSummary {
  id: string;
  name: string;
}

export interface StatusResponse {
  ok: true;
  accounts: AccountSummary[];
  devices: DeviceSummary[];
  version: string;
}

export interface AccountResponse {
  ok: true;
  account: AccountSummary;
}

export interface ErrorResponse {
  ok: false;
  stage: UiStage;
  status?: number;
}

export type AvatarResponse =
  | { ok: true; status: 204 }
  | { ok: true; status: 200; contentType: string; /** Base64 image bytes. */ data: string };

export type UiHandler = (payload: unknown) => Promise<unknown>;

/** Verifier and state from /browser/start are kept in memory this long. */
export const BROWSER_SESSION_TTL_MS = 10 * 60 * 1000;
/** Avatar bytes are served from memory this long before Peloton's CDN is asked again. */
export const AVATAR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** The last workout time is asked from Peloton at most this often per account. */
export const LAST_WORKOUT_CACHE_TTL_MS = 60 * 1000;
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

interface BrowserSession {
  verifier: string;
  state: string;
  startedAt: number;
}

interface CachedAvatar {
  url: string;
  contentType: string;
  data: string;
  fetchedAt: number;
}

interface CachedLastWorkout {
  at: number;
  value: number | null;
}

export class UiHandlers {
  private readonly browserSessions = new Map<string, BrowserSession>();
  private readonly avatars = new Map<string, CachedAvatar>();
  private readonly lastWorkouts = new Map<string, CachedLastWorkout>();
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: UiHandlerOptions) {
    this.now = options.now ?? Date.now;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** The request paths of SPEC section 10 and their handlers, for HomebridgePluginUiServer.onRequest. */
  routes(): Record<string, UiHandler> {
    return {
      '/status': () => this.status(),
      '/connect': (payload) => this.connect(payload),
      '/browser/start': (payload) => this.browserStart(payload),
      '/browser/finish': (payload) => this.browserFinish(payload),
      '/test': (payload) => this.test(payload),
      '/household': () => this.household(),
      '/remove': (payload) => this.remove(payload),
      '/avatar': (payload) => this.avatar(payload),
    };
  }

  /** Every stored account, connected or not, with the household devices and the plugin version. */
  async status(): Promise<StatusResponse> {
    const records = await this.options.store.loadAll();
    const accounts = await Promise.all([...records.entries()].map(([id, record]) => this.summarizeFresh(id, record)));
    return { ok: true, accounts, devices: devicesOf(await this.options.store.loadAll()), version: this.options.version };
  }

  /** Email and password sign-in through the shared connect flow. The password is used once and dropped. */
  async connect(payload: unknown): Promise<AccountResponse | ErrorResponse> {
    const id = accountId(payload);
    const email = requiredText(payload, 'email');
    const password = requiredText(payload, 'password');
    try {
      const result = await connectAccount(this.connectDependencies(), id, email, password);
      this.forget(id);
      return { ok: true, account: await this.summarizeFresh(id, result.record) };
    } catch (error) {
      return errorResponse(error);
    }
  }

  /** Starts the browser sign-in: the authorize URL for the page, verifier and state kept here for ten minutes. */
  async browserStart(payload: unknown): Promise<{ ok: true; authorizeUrl: string }> {
    const id = accountId(payload);
    this.pruneBrowserSessions();
    const start = this.options.auth.browserStart();
    this.browserSessions.set(id, { verifier: start.verifier, state: start.state, startedAt: this.now() });
    return { ok: true, authorizeUrl: start.authorizeUrl };
  }

  /**
   * Finishes the browser sign-in from the pasted callback URL. Without a live session the link has
   * expired (stage expired_code). A link from an earlier attempt or a malformed one leaves the
   * session in place so the right link can still be pasted; a used or expired code ends it.
   */
  async browserFinish(payload: unknown): Promise<AccountResponse | ErrorResponse> {
    const id = accountId(payload);
    const callbackUrl = requiredText(payload, 'callbackUrl');
    this.pruneBrowserSessions();
    const session = this.browserSessions.get(id);
    if (session === undefined) {
      return { ok: false, stage: 'expired_code' };
    }
    let tokens: Tokens;
    try {
      tokens = await this.options.auth.browserFinish(callbackUrl, session.verifier, session.state);
    } catch (error) {
      if (error instanceof AuthError && error.stage === 'expired_code') {
        this.browserSessions.delete(id);
      }
      return errorResponse(error);
    }
    this.browserSessions.delete(id);
    try {
      const result = await connectWithTokens(this.connectDependencies(), id, tokens);
      this.forget(id);
      return { ok: true, account: await this.summarizeFresh(id, result.record) };
    } catch (error) {
      return errorResponse(error);
    }
  }

  /** Checks the stored session by fetching /api/me with it, and refreshes the profile on the way. */
  async test(payload: unknown): Promise<{ ok: true; lastCheckedAt: number } | ErrorResponse> {
    const id = accountId(payload);
    const record = await this.options.store.load(id);
    if (record === undefined || record.accessToken === undefined || record.refreshToken === undefined) {
      return { ok: false, stage: 'refresh' };
    }
    try {
      const me = await this.options.store.withValidToken(id, (token) => this.options.api.getMe(token));
      const current = (await this.options.store.load(id)) ?? record;
      const updated = applyProfile(current, me, this.now());
      await this.options.store.save(id, updated);
      return { ok: true, lastCheckedAt: updated.lastCheckedAt as number };
    } catch (error) {
      return errorResponse(error);
    }
  }

  /** Re-reads the owner's subscriptions so new household profiles and devices show up, then answers like /status. */
  async household(): Promise<StatusResponse | ErrorResponse> {
    const records = await this.options.store.loadAll();
    let attempts = 0;
    let firstError: unknown;
    for (const [id, record] of records) {
      if (record.state !== 'connected' || record.accessToken === undefined || record.userId === undefined || record.isOwner === false) {
        continue;
      }
      attempts += 1;
      const userId = record.userId;
      try {
        const subscriptions = await this.options.store.withValidToken(id, (token) => this.options.api.getSubscriptions(userId, token));
        const current = (await this.options.store.load(id)) ?? record;
        await applyHousehold(this.options.store, current, subscriptions);
        await this.options.store.save(id, current);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (attempts > 0 && firstError !== undefined && attempts === 1) {
      return errorResponse(firstError);
    }
    return this.status();
  }

  /** Deletes the account file and everything this process remembers about the account. */
  async remove(payload: unknown): Promise<{ ok: true }> {
    const id = accountId(payload);
    this.forget(id);
    this.browserSessions.delete(id);
    this.avatars.delete(id);
    await this.options.store.remove(id);
    return { ok: true };
  }

  /**
   * The profile photo proxied from image_url and cached for 24 hours; status 204 when the profile
   * uses Peloton's default image, so the page draws initials instead.
   */
  async avatar(payload: unknown): Promise<AvatarResponse | ErrorResponse> {
    const id = accountId(payload);
    const record = await this.options.store.load(id);
    const url = record?.imageUrl ?? '';
    if (record === undefined || record.isProfileImageDefault === true || !/^https?:\/\//i.test(url)) {
      return { ok: true, status: 204 };
    }
    const cached = this.avatars.get(id);
    if (cached !== undefined && cached.url === url && this.now() - cached.fetchedAt < AVATAR_CACHE_TTL_MS) {
      return { ok: true, status: 200, contentType: cached.contentType, data: cached.data };
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: 'GET', headers: { accept: 'image/*' } });
    } catch {
      return { ok: false, stage: 'api' };
    }
    if (response.status < 200 || response.status >= 300) {
      await response.text().catch(() => undefined);
      return { ok: false, stage: 'api', status: response.status };
    }
    // The CDN behind image_url does not always say image/*: S3 answers binary/octet-stream for an
    // object stored without a content type. The bytes decide when the header does not.
    const headerType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = headerType.startsWith('image/') ? headerType : imageTypeOf(bytes);
    if (contentType === undefined || bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) {
      return { ok: false, stage: 'api', status: response.status };
    }
    const data = bytes.toString('base64');
    this.avatars.set(id, { url, contentType, data, fetchedAt: this.now() });
    return { ok: true, status: 200, contentType, data };
  }

  /* ----------------------------------------------------------------------------------------------
   * Helpers
   * -------------------------------------------------------------------------------------------- */

  private connectDependencies(): Parameters<typeof connectWithTokens>[0] & { login: LoginFn } {
    return {
      store: this.options.store,
      api: { getMe: this.options.api.getMe, getSubscriptions: this.options.api.getSubscriptions },
      login: this.options.auth.login,
      now: this.now,
    };
  }

  /** Summarises the account after its last workout time is known, re-reading the record so a refresh on the way is reflected. */
  private async summarizeFresh(id: string, record: AccountRecord): Promise<AccountSummary> {
    const lastWorkoutAt = await this.lastWorkoutAt(id, record);
    const current = (await this.options.store.load(id)) ?? record;
    return summarize(id, current, lastWorkoutAt);
  }

  /**
   * created_at of the latest Peloton workout in the account's workouts list (SPEC section 4.2), in
   * epoch milliseconds, asked at most once a minute. An import at the top of the list, an empty
   * list, an unconnected account, or a failed call gives null and the page omits the line.
   */
  private async lastWorkoutAt(id: string, record: AccountRecord): Promise<number | null> {
    if (record.state !== 'connected' || record.accessToken === undefined || record.userId === undefined || record.userId.length === 0) {
      return null;
    }
    const cached = this.lastWorkouts.get(id);
    if (cached !== undefined && this.now() - cached.at < LAST_WORKOUT_CACHE_TTL_MS) {
      return cached.value;
    }
    const userId = record.userId;
    let value: number | null = null;
    try {
      const workout = await this.options.store.withValidToken(id, (token) => this.options.api.getLatestWorkout(userId, token));
      if (isDetectable(workout) && workout.createdAt !== null) {
        value = workout.createdAt * 1000;
      }
    } catch {
      return null;
    }
    this.lastWorkouts.set(id, { at: this.now(), value });
    return value;
  }

  private forget(id: string): void {
    this.lastWorkouts.delete(id);
  }

  private pruneBrowserSessions(): void {
    for (const [id, session] of this.browserSessions) {
      if (this.now() - session.startedAt >= BROWSER_SESSION_TTL_MS) {
        this.browserSessions.delete(id);
      }
    }
  }
}

/** The account summary the page shows; tokens never leave the server. */
export function summarize(id: string, record: AccountRecord, lastWorkoutAt: number | null): AccountSummary {
  const summary: AccountSummary = {
    id,
    avatar: typeof record.imageUrl === 'string' && record.imageUrl.length > 0 && record.isProfileImageDefault !== true,
    isOwner: record.isOwner === true,
    state: record.state,
    lastWorkoutAt,
  };
  if (record.userId !== undefined) {
    summary.userId = record.userId;
  }
  if (record.displayName !== undefined) {
    summary.displayName = record.displayName;
  }
  if (record.username !== undefined) {
    summary.username = record.username;
  }
  if (record.lastCheckedAt !== undefined) {
    summary.lastCheckedAt = record.lastCheckedAt;
  }
  return summary;
}

/** The image type from the first bytes: JPEG, PNG, GIF, or WebP; undefined for anything else. */
export function imageTypeOf(bytes: Uint8Array): string | undefined {
  const starts = (prefix: number[], offset = 0): boolean => prefix.every((byte, index) => bytes[offset + index] === byte);
  if (starts([0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (starts([0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return 'image/gif';
  }
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return undefined;
}

/**
 * Names of the membership's devices from the owner's record, for the read-only Devices line. A device
 * without an id counts by its name, so two unnamed-id entries never collapse into one.
 */
export function devicesOf(records: Map<string, AccountRecord>): DeviceSummary[] {
  const devices: DeviceSummary[] = [];
  for (const record of records.values()) {
    for (const device of record.devices ?? []) {
      if (!devices.some((known) => known.id === device.id)) {
        devices.push({ id: device.id, name: device.name });
      }
    }
  }
  return devices;
}

/** Maps a thrown error to the page's error shape: the auth stage, or "api" with the HTTP status. */
export function errorResponse(error: unknown): ErrorResponse {
  if (error instanceof AuthError) {
    const response: ErrorResponse = { ok: false, stage: error.stage };
    if (error.status !== undefined) {
      response.status = error.status;
    }
    return response;
  }
  if (error instanceof ApiError) {
    return { ok: false, stage: 'api', status: error.status };
  }
  return { ok: false, stage: 'api' };
}

function accountId(payload: unknown): string {
  const id = field(payload, 'id');
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error('Invalid account id');
  }
  return id;
}

function requiredText(payload: unknown, key: string): string {
  const value = field(payload, key);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${key}`);
  }
  return value;
}

function field(payload: unknown, key: string): unknown {
  return payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;
}
