/**
 * Peloton sign-in through Auth0 Universal Login, without a browser and without dependencies.
 *
 * This is the only file that knows Auth0 URLs, the client id, scopes, or HTML form handling.
 * When Peloton changes its login flow, the fix is inside this file (SPEC section 5).
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Everything Peloton-specific about the login. These constants are the only thing to change
 * when Peloton changes its login (tenant, client, redirect, or the Auth0 connection name).
 * tenant and connection are initial values to confirm on the Pi (SPEC section 15).
 */
export const PELOTON_AUTH = {
  /** Auth0 tenant base URL. */
  tenantUrl: 'https://auth.onepeloton.com',
  /** Public OAuth client id used by the members web app. */
  clientId: 'WVoJxVDdPoFx4RNewvvg6ch2mZ7bwnsM',
  /** Redirect URI registered for that client. Never followed; only parsed. */
  redirectUri: 'https://members.onepeloton.com/callback',
  /** OAuth scopes. offline_access yields a refresh token. */
  scope: 'offline_access openid peloton-api.members:default',
  /** API audience. */
  audience: 'https://api.onepeloton.com/',
  /** Auth0 tenant name sent in the credentials POST. Confirm on the Pi. */
  tenant: 'peloton',
  /** Auth0 database connection name sent in the credentials POST. Confirm on the Pi. */
  connection: 'PelotonIDS',
  /** Cookie Auth0 sets on the login page and the header it expects back on the credentials POST. */
  csrfCookie: '_csrf',
  csrfHeader: 'x-csrf-token',
  /** Path of the credentials POST on the tenant. */
  credentialsPath: '/usernamepassword/login',
  /** Path of the token endpoint on the tenant. */
  tokenPath: '/oauth/token',
} as const;

export type AuthStage =
  | 'authorize'
  | 'credentials'
  | 'callback'
  | 'exchange'
  | 'refresh'
  | 'verification_required'
  | 'state_mismatch'
  | 'expired_code'
  | 'malformed_callback';

/**
 * Every auth failure. Carries the stage and, where there was one, the HTTP status and the
 * OAuth error code. Never carries response bodies, tokens, or the password.
 */
export class AuthError extends Error {
  public readonly stage: AuthStage;
  public readonly status?: number;
  /** OAuth error code such as invalid_grant, when the response carried one. */
  public readonly code?: string;

  constructor(stage: AuthStage, status?: number, code?: string) {
    super(status === undefined ? `Auth failed at ${stage}` : `Auth failed at ${stage} (HTTP ${status})`);
    this.name = 'AuthError';
    this.stage = stage;
    this.status = status;
    this.code = code;
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface BrowserStart {
  authorizeUrl: string;
  verifier: string;
  state: string;
}

export interface AuthOptions {
  /** Injectable clock, epoch milliseconds. Defaults to Date.now. */
  now?: () => number;
  /**
   * When set to a directory path, every HTML response of the login flow is written there with a
   * numbered name and all form values redacted. Token responses are never written. Off by default.
   */
  debugDump?: string;
}

type FetchImpl = typeof fetch;

const MAX_REDIRECTS = 8;

const VERIFICATION_MARKERS = [
  /mfa[_-]?required/i,
  /\/mf\//i,
  /\/u\/mfa/i,
  /mfa-otp/i,
  /mfa-email/i,
  /mfa-sms/i,
  /verification[_ -]?code/i,
  /verify your (email|identity|account)/i,
  /one[- ]time (code|password)/i,
  /enter the code/i,
  /passwordless/i,
  /two[- ]factor/i,
  /multi[- ]?factor/i,
];

const WRONG_PASSWORD_CODES = new Set([
  'invalid_user_password',
  'invalid_grant',
  'access_denied',
  'wrong_email_or_password',
  'invalid_password',
  'invalid_credentials',
  'too_many_attempts',
  'blocked_user',
]);

/* ------------------------------------------------------------------------------------------------
 * Public API
 * ---------------------------------------------------------------------------------------------- */

/**
 * Headless login with email and password. Drives Auth0 Universal Login end to end and returns tokens.
 */
export async function login(
  email: string,
  password: string,
  fetchImpl: FetchImpl = fetch,
  options: AuthOptions = {},
): Promise<Tokens> {
  const now = options.now ?? Date.now;
  const jar = new CookieJar();
  const dump = new DebugDump(options.debugDump);
  const verifier = randomUrlSafe(32);
  const state = randomUrlSafe(16);
  const nonce = randomUrlSafe(16);
  const challenge = codeChallenge(verifier);

  // 1. GET /authorize and follow to the login page, collecting cookies from every response.
  const authorizeUrl = buildAuthorizeUrl(challenge, state, nonce);
  const loginPage = await followOnTenant(fetchImpl, jar, authorizeUrl, { method: 'GET' }, 'authorize');
  if (loginPage.kind === 'left_tenant') {
    // An existing session would skip the login page. With a fresh jar this cannot happen; treat as failure.
    throw new AuthError('authorize', loginPage.status);
  }
  if (loginPage.status < 200 || loginPage.status >= 300) {
    throw new AuthError('authorize', loginPage.status);
  }
  await dump.write('authorize-login-page', loginPage.body);
  if (looksLikeVerification(loginPage.body)) {
    throw new AuthError('verification_required', loginPage.status);
  }

  // 2. POST the credentials as JSON with the CSRF header derived from the cookie Auth0 set.
  const credentialsUrl = new URL(PELOTON_AUTH.credentialsPath, PELOTON_AUTH.tenantUrl);
  const csrf = jar.get(credentialsUrl, PELOTON_AUTH.csrfCookie);
  const credentialsBody: Record<string, string> = {
    client_id: PELOTON_AUTH.clientId,
    redirect_uri: PELOTON_AUTH.redirectUri,
    tenant: PELOTON_AUTH.tenant,
    response_type: 'code',
    scope: PELOTON_AUTH.scope,
    audience: PELOTON_AUTH.audience,
    state,
    nonce,
    connection: PELOTON_AUTH.connection,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    username: email,
    password,
  };
  if (csrf !== undefined) {
    credentialsBody[PELOTON_AUTH.csrfCookie] = csrf;
  }
  const credentialsHeaders: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/html,application/json',
    origin: PELOTON_AUTH.tenantUrl,
    referer: loginPage.url,
  };
  if (csrf !== undefined) {
    credentialsHeaders[PELOTON_AUTH.csrfHeader] = csrf;
  }
  const credentialsResponse = await request(fetchImpl, jar, credentialsUrl.toString(), {
    method: 'POST',
    headers: credentialsHeaders,
    body: JSON.stringify(credentialsBody),
  }, 'credentials');
  const credentialsText = await credentialsResponse.text();

  if (credentialsResponse.status < 200 || credentialsResponse.status >= 300) {
    await dump.write('credentials-response', credentialsText);
    throw classifyCredentialsFailure(credentialsResponse.status, credentialsText);
  }
  await dump.write('credentials-response', credentialsText);
  if (looksLikeVerification(credentialsText)) {
    throw new AuthError('verification_required', credentialsResponse.status);
  }

  // 3. Parse the auto-post form Auth0 returned and post it to its action.
  const form = parseForm(credentialsText);
  if (form === undefined) {
    throw new AuthError('callback', credentialsResponse.status);
  }
  const actionUrl = new URL(form.action, credentialsUrl).toString();
  const callback = await followOnTenant(fetchImpl, jar, actionUrl, {
    method: form.method,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'text/html',
      origin: PELOTON_AUTH.tenantUrl,
      referer: credentialsUrl.toString(),
    },
    body: new URLSearchParams(form.fields).toString(),
  }, 'callback');

  // 4. Do not follow the final redirect. Read code and state from its Location header.
  if (callback.kind !== 'left_tenant') {
    await dump.write('callback-response', callback.body);
    if (looksLikeVerification(callback.body)) {
      throw new AuthError('verification_required', callback.status);
    }
    throw new AuthError('callback', callback.status);
  }
  const redirect = parseCallbackLocation(callback.location, callback.status);
  if (redirect.state !== state) {
    throw new AuthError('state_mismatch', callback.status);
  }

  // 5. Exchange the code.
  return exchangeCode(redirect.code, verifier, fetchImpl, now);
}

/**
 * Refreshes tokens. Refresh tokens rotate: the returned refreshToken replaces the one passed in.
 * invalid_grant is surfaced as AuthError stage refresh with code invalid_grant; everything else is transient.
 */
export async function refresh(
  refreshToken: string,
  fetchImpl: FetchImpl = fetch,
  options: AuthOptions = {},
): Promise<Tokens> {
  const now = options.now ?? Date.now;
  const response = await tokenRequest(fetchImpl, {
    grant_type: 'refresh_token',
    client_id: PELOTON_AUTH.clientId,
    refresh_token: refreshToken,
  }, 'refresh');
  if (response.status < 200 || response.status >= 300) {
    throw new AuthError('refresh', response.status, response.errorCode);
  }
  return tokensFromResponse(response.json, now, 'refresh', response.status, refreshToken);
}

/**
 * Starts the browser sign-in fallback. The caller keeps verifier and state for browserFinish.
 */
export function browserStart(): BrowserStart {
  const verifier = randomUrlSafe(32);
  const state = randomUrlSafe(16);
  const nonce = randomUrlSafe(16);
  return {
    authorizeUrl: buildAuthorizeUrl(codeChallenge(verifier), state, nonce),
    verifier,
    state,
  };
}

/**
 * Finishes the browser sign-in fallback from the pasted callback URL.
 */
export async function browserFinish(
  callbackUrl: string,
  verifier: string,
  state: string,
  fetchImpl: FetchImpl = fetch,
  options: AuthOptions = {},
): Promise<Tokens> {
  const now = options.now ?? Date.now;
  const parsed = parseCallbackUrl(callbackUrl);
  if (parsed.state !== state) {
    throw new AuthError('state_mismatch');
  }
  return exchangeCode(parsed.code, verifier, fetchImpl, now);
}

/* ------------------------------------------------------------------------------------------------
 * Token endpoint
 * ---------------------------------------------------------------------------------------------- */

async function exchangeCode(code: string, verifier: string, fetchImpl: FetchImpl, now: () => number): Promise<Tokens> {
  const response = await tokenRequest(fetchImpl, {
    grant_type: 'authorization_code',
    client_id: PELOTON_AUTH.clientId,
    code_verifier: verifier,
    code,
    redirect_uri: PELOTON_AUTH.redirectUri,
  }, 'exchange');
  if (response.status < 200 || response.status >= 300) {
    if (response.errorCode === 'invalid_grant') {
      throw new AuthError('expired_code', response.status, response.errorCode);
    }
    throw new AuthError('exchange', response.status, response.errorCode);
  }
  return tokensFromResponse(response.json, now, 'exchange', response.status);
}

interface TokenResponse {
  status: number;
  json: Record<string, unknown>;
  errorCode?: string;
}

async function tokenRequest(fetchImpl: FetchImpl, body: Record<string, string>, stage: AuthStage): Promise<TokenResponse> {
  const url = new URL(PELOTON_AUTH.tokenPath, PELOTON_AUTH.tenantUrl).toString();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
  } catch {
    throw new AuthError(stage);
  }
  let json: Record<string, unknown> = {};
  try {
    const text = await response.text();
    if (text.length > 0) {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object') {
        json = parsed as Record<string, unknown>;
      }
    }
  } catch {
    json = {};
  }
  const errorCode = typeof json.error === 'string' ? json.error : undefined;
  return { status: response.status, json, errorCode };
}

function tokensFromResponse(
  json: Record<string, unknown>,
  now: () => number,
  stage: AuthStage,
  status: number,
  previousRefreshToken?: string,
): Tokens {
  const accessToken = json.access_token;
  const expiresIn = json.expires_in;
  const refreshToken = typeof json.refresh_token === 'string' && json.refresh_token.length > 0
    ? json.refresh_token
    : previousRefreshToken;
  if (typeof accessToken !== 'string' || accessToken.length === 0 || typeof expiresIn !== 'number' || refreshToken === undefined) {
    throw new AuthError(stage, status);
  }
  return { accessToken, refreshToken, expiresAt: now() + expiresIn * 1000 };
}

/* ------------------------------------------------------------------------------------------------
 * Authorize URL and PKCE
 * ---------------------------------------------------------------------------------------------- */

function buildAuthorizeUrl(challenge: string, state: string, nonce: string): string {
  const url = new URL('/authorize', PELOTON_AUTH.tenantUrl);
  url.searchParams.set('client_id', PELOTON_AUTH.clientId);
  url.searchParams.set('redirect_uri', PELOTON_AUTH.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', PELOTON_AUTH.scope);
  url.searchParams.set('audience', PELOTON_AUTH.audience);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function randomUrlSafe(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/* ------------------------------------------------------------------------------------------------
 * Callback URL parsing
 * ---------------------------------------------------------------------------------------------- */

interface CallbackParams {
  code: string;
  state: string;
}

const REDIRECT = new URL(PELOTON_AUTH.redirectUri);

/**
 * Validates a pasted callback URL: host and path must match the registered redirect URI.
 * A trailing slash on the path and a missing scheme are tolerated.
 */
function parseCallbackUrl(raw: string): CallbackParams {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new AuthError('malformed_callback');
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new AuthError('malformed_callback');
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== REDIRECT.hostname) {
    throw new AuthError('malformed_callback');
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== REDIRECT.pathname) {
    throw new AuthError('malformed_callback');
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (code === null || code.length === 0 || state === null) {
    throw new AuthError('malformed_callback');
  }
  return { code, state };
}

/**
 * Reads code and state from the Location header of the final redirect in the headless flow.
 */
function parseCallbackLocation(location: string | undefined, status: number): CallbackParams {
  if (location === undefined) {
    throw new AuthError('callback', status);
  }
  let url: URL;
  try {
    url = new URL(location, PELOTON_AUTH.tenantUrl);
  } catch {
    throw new AuthError('callback', status);
  }
  const error = url.searchParams.get('error');
  if (error !== null) {
    const description = url.searchParams.get('error_description') ?? '';
    if (looksLikeVerification(`${error} ${description}`)) {
      throw new AuthError('verification_required', status, error);
    }
    throw new AuthError('callback', status, error);
  }
  if (url.hostname.toLowerCase() !== REDIRECT.hostname || url.pathname.replace(/\/+$/, '') !== REDIRECT.pathname) {
    throw new AuthError('callback', status);
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (code === null || code.length === 0 || state === null) {
    throw new AuthError('callback', status);
  }
  return { code, state };
}

/* ------------------------------------------------------------------------------------------------
 * Credentials failure classification
 * ---------------------------------------------------------------------------------------------- */

function classifyCredentialsFailure(status: number, body: string): AuthError {
  let code: string | undefined;
  let description = '';
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      for (const key of ['code', 'error', 'name']) {
        const value = record[key];
        if (typeof value === 'string') {
          code = value;
          break;
        }
      }
      for (const key of ['description', 'error_description', 'message']) {
        const value = record[key];
        if (typeof value === 'string') {
          description = value;
          break;
        }
      }
    }
  } catch {
    // Not JSON: fall through to text checks below.
  }
  const haystack = `${code ?? ''} ${description} ${body.slice(0, 2000)}`;
  if (looksLikeVerification(haystack)) {
    return new AuthError('verification_required', status, code);
  }
  const wrongPassword = (code !== undefined && WRONG_PASSWORD_CODES.has(code.toLowerCase()))
    || /wrong (email|username|user)( or|\/)? ?password/i.test(haystack)
    || /invalid (email|username)? ?(or|\/)? ?password/i.test(haystack)
    || status === 401
    || status === 403;
  if (wrongPassword) {
    return new AuthError('credentials', status, code);
  }
  // Anything else on this step is Peloton's side (rate limit, outage), not the user's credentials.
  return new AuthError('authorize', status, code);
}

function looksLikeVerification(text: string): boolean {
  return VERIFICATION_MARKERS.some((marker) => marker.test(text));
}

/* ------------------------------------------------------------------------------------------------
 * HTML form parsing (no dependency, no DOM)
 * ---------------------------------------------------------------------------------------------- */

interface ParsedForm {
  action: string;
  method: 'POST' | 'GET';
  fields: Record<string, string>;
}

/**
 * Finds the first form with an action attribute and returns its hidden inputs by name.
 * Field names are never hard-coded; Auth0 may add or rename them.
 */
export function parseForm(html: string): ParsedForm | undefined {
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let match: RegExpExecArray | null;
  while ((match = formPattern.exec(html)) !== null) {
    const attributes = parseAttributes(match[1] ?? '');
    const action = attributes.action;
    if (action === undefined || action.length === 0) {
      continue;
    }
    const fields: Record<string, string> = {};
    const inputPattern = /<input\b([^>]*)\/?>/gi;
    let inputMatch: RegExpExecArray | null;
    while ((inputMatch = inputPattern.exec(match[2] ?? '')) !== null) {
      const input = parseAttributes(inputMatch[1] ?? '');
      const type = (input.type ?? 'text').toLowerCase();
      if (type !== 'hidden' || input.name === undefined) {
        continue;
      }
      fields[input.name] = input.value ?? '';
    }
    const method = (attributes.method ?? 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
    return { action, method, fields };
  }
  return undefined;
}

function parseAttributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([^\s=/>"']+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const name = (match[1] ?? '').toLowerCase();
    if (name.length === 0) {
      continue;
    }
    result[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(parseInt(entity.slice(1), 10));
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/* ------------------------------------------------------------------------------------------------
 * Requests with cookies and manual redirects
 * ---------------------------------------------------------------------------------------------- */

interface RequestInitLite {
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

async function request(fetchImpl: FetchImpl, jar: CookieJar, url: string, init: RequestInitLite, stage: AuthStage): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  const cookie = jar.header(new URL(url));
  if (cookie !== undefined) {
    headers.cookie = cookie;
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method,
      headers,
      body: init.body,
      redirect: 'manual',
    });
  } catch {
    throw new AuthError(stage);
  }
  jar.store(new URL(url), response);
  return response;
}

type FollowResult =
  | { kind: 'page'; status: number; body: string; url: string }
  | { kind: 'left_tenant'; status: number; location: string };

/**
 * Follows redirects while they stay on the tenant host. Stops, without following, at the first
 * redirect that leaves it, and returns that Location. The POST body is only sent on the first hop.
 */
async function followOnTenant(
  fetchImpl: FetchImpl,
  jar: CookieJar,
  startUrl: string,
  init: RequestInitLite,
  stage: AuthStage,
): Promise<FollowResult> {
  const tenantHost = new URL(PELOTON_AUTH.tenantUrl).hostname;
  let url = startUrl;
  let current: RequestInitLite = init;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await request(fetchImpl, jar, url, current, stage);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.text().catch(() => undefined);
      if (location === null) {
        throw new AuthError(stage, response.status);
      }
      const next = new URL(location, url);
      if (next.hostname.toLowerCase() !== tenantHost) {
        return { kind: 'left_tenant', status: response.status, location: next.toString() };
      }
      url = next.toString();
      current = { method: 'GET', headers: { accept: 'text/html' } };
      continue;
    }
    const body = await response.text();
    return { kind: 'page', status: response.status, body, url };
  }
  throw new AuthError(stage);
}

/* ------------------------------------------------------------------------------------------------
 * Cookie jar: one host, name to value. Enough for Auth0's session and CSRF cookies.
 * ---------------------------------------------------------------------------------------------- */

interface StoredCookie {
  value: string;
  path: string;
  secure: boolean;
}

export class CookieJar {
  private readonly cookies = new Map<string, Map<string, StoredCookie>>();

  /** Collects every Set-Cookie header from a response for the request host. */
  store(url: URL, response: Response): void {
    for (const line of setCookieLines(response.headers)) {
      this.storeLine(url, line);
    }
  }

  /** Stores one Set-Cookie header line. */
  storeLine(url: URL, line: string): void {
    const parts = line.split(';').map((part) => part.trim());
    const first = parts.shift();
    if (first === undefined) {
      return;
    }
    const eq = first.indexOf('=');
    if (eq <= 0) {
      return;
    }
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    let domain = url.hostname.toLowerCase();
    let path = defaultPath(url.pathname);
    let secure = false;
    let expired = false;
    for (const part of parts) {
      const [rawKey, ...rest] = part.split('=');
      const key = (rawKey ?? '').trim().toLowerCase();
      const attributeValue = rest.join('=').trim();
      if (key === 'domain' && attributeValue.length > 0) {
        const candidate = attributeValue.replace(/^\./, '').toLowerCase();
        if (domainMatches(url.hostname.toLowerCase(), candidate)) {
          domain = candidate;
        }
      } else if (key === 'path' && attributeValue.startsWith('/')) {
        path = attributeValue;
      } else if (key === 'secure') {
        secure = true;
      } else if (key === 'max-age') {
        const seconds = Number(attributeValue);
        if (Number.isFinite(seconds) && seconds <= 0) {
          expired = true;
        }
      } else if (key === 'expires') {
        const when = Date.parse(attributeValue);
        if (!Number.isNaN(when) && when <= Date.UTC(1971, 0, 1)) {
          expired = true;
        }
      }
    }
    const bucket = this.cookies.get(domain) ?? new Map<string, StoredCookie>();
    if (expired) {
      bucket.delete(name);
    } else {
      bucket.set(name, { value, path, secure });
    }
    this.cookies.set(domain, bucket);
  }

  /** Builds the Cookie header for a request to url, or undefined when nothing matches. */
  header(url: URL): string | undefined {
    const pairs: string[] = [];
    const host = url.hostname.toLowerCase();
    for (const [domain, bucket] of this.cookies) {
      if (!domainMatches(host, domain)) {
        continue;
      }
      for (const [name, cookie] of bucket) {
        if (cookie.secure && url.protocol !== 'https:') {
          continue;
        }
        if (!pathMatches(url.pathname, cookie.path)) {
          continue;
        }
        pairs.push(`${name}=${cookie.value}`);
      }
    }
    return pairs.length === 0 ? undefined : pairs.join('; ');
  }

  /** Reads one cookie value that would be sent to url. */
  get(url: URL, name: string): string | undefined {
    const host = url.hostname.toLowerCase();
    for (const [domain, bucket] of this.cookies) {
      if (domainMatches(host, domain) && bucket.has(name)) {
        return bucket.get(name)?.value;
      }
    }
    return undefined;
  }
}

function setCookieLines(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') {
    return withGetter.getSetCookie();
  }
  const single = headers.get('set-cookie');
  return single === null ? [] : [single];
}

function domainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function defaultPath(pathname: string): string {
  const cut = pathname.lastIndexOf('/');
  return cut <= 0 ? '/' : pathname.slice(0, cut);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) {
    return true;
  }
  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }
  return cookiePath.endsWith('/') || requestPath.charAt(cookiePath.length) === '/';
}

/* ------------------------------------------------------------------------------------------------
 * Debug dump: numbered HTML responses with every form value redacted. Never token responses.
 * ---------------------------------------------------------------------------------------------- */

class DebugDump {
  private counter = 0;

  constructor(private readonly directory: string | undefined) {}

  async write(name: string, body: string): Promise<void> {
    if (this.directory === undefined) {
      return;
    }
    this.counter += 1;
    const fileName = `${String(this.counter).padStart(2, '0')}-${name}.html`;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(join(this.directory, fileName), redactFormValues(body), { mode: 0o600 });
  }
}

/** Replaces every value attribute inside input tags and every input's text content with a marker. */
export function redactFormValues(html: string): string {
  return html.replace(/<input\b[^>]*>/gi, (tag) => tag.replace(/\bvalue\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi, 'value="redacted"'));
}
