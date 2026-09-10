#!/usr/bin/env node
/**
 * Standalone auth probe for the Pi. This is how the headless flow gets its first real run.
 *
 *   node dist/scripts/auth-probe.mjs login <email> [--dump <dir>]   prompts for the password without echo
 *   node dist/scripts/auth-probe.mjs refresh
 *   node dist/scripts/auth-probe.mjs browser                          prints the URL, waits for the pasted callback URL
 *   node dist/scripts/auth-probe.mjs me
 *   node dist/scripts/auth-probe.mjs workout [--keys]                 --keys also prints the raw field names of the workout
 *
 * Tokens live in ./probe-tokens.json with mode 0600. Nothing here prints a token.
 * On failure the probe prints the stage and HTTP status only.
 */

import { chmod, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

import { ApiError, PELOTON_API_BASE, getLatestWorkout, getMe, getPerformanceGraph } from '../api/peloton-api.js';
import { AuthError, browserFinish, browserStart, login, refresh, type Tokens } from '../auth/peloton-auth.js';

const TOKEN_FILE = './probe-tokens.json';
const REFRESH_AHEAD_MS = 6 * 60 * 60 * 1000;
const CTRL_C = String.fromCharCode(3);
const DELETE = String.fromCharCode(127);
const BACKSPACE = String.fromCharCode(8);

interface ProbeTokens extends Tokens {
  userId?: string;
}

interface Args {
  command: string | undefined;
  positional: string[];
  dump: string | undefined;
  keys: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let dump: string | undefined;
  let keys = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dump') {
      dump = argv[index + 1];
      index += 1;
    } else if (arg === '--keys') {
      keys = true;
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }
  return { command: positional.shift(), positional, dump, keys };
}

function usage(): never {
  console.error([
    'Usage:',
    '  node dist/scripts/auth-probe.mjs login <email> [--dump <dir>]',
    '  node dist/scripts/auth-probe.mjs refresh',
    '  node dist/scripts/auth-probe.mjs browser',
    '  node dist/scripts/auth-probe.mjs me',
    '  node dist/scripts/auth-probe.mjs workout [--keys]',
  ].join('\n'));
  process.exit(2);
}

/* ------------------------------------------------------------------------------------------------
 * Token file
 * ---------------------------------------------------------------------------------------------- */

async function loadTokens(): Promise<ProbeTokens> {
  let text: string;
  try {
    text = await readFile(TOKEN_FILE, 'utf8');
  } catch {
    throw new Error(`No ${TOKEN_FILE} yet. Run login or browser first.`);
  }
  const parsed = JSON.parse(text) as Partial<ProbeTokens>;
  if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string' || typeof parsed.expiresAt !== 'number') {
    throw new Error(`${TOKEN_FILE} is malformed. Run login or browser again.`);
  }
  return parsed as ProbeTokens;
}

async function saveTokens(tokens: ProbeTokens): Promise<void> {
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2) + '\n', { mode: 0o600 });
  await chmod(TOKEN_FILE, 0o600);
}

function describeExpiry(tokens: Tokens): string {
  const hours = Math.round((tokens.expiresAt - Date.now()) / 36000) / 100;
  return `access token expires ${new Date(tokens.expiresAt).toISOString()} (in ${hours} h)`;
}

/* ------------------------------------------------------------------------------------------------
 * Prompts
 * ---------------------------------------------------------------------------------------------- */

async function promptVisible(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Reads a line from the terminal without echoing it. Falls back to a plain read when not a TTY. */
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(question);
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let buffer = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline >= 0) {
          stdin.pause();
          resolve(buffer.slice(0, newline).replace(/\r$/, ''));
        }
      });
      stdin.on('end', () => resolve(buffer.replace(/\r?\n$/, '')));
    });
  }
  return new Promise((resolve, reject) => {
    let value = '';
    let onData: (chunk: string) => void = () => undefined;
    const finish = (): void => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (char === CTRL_C) {
          finish();
          reject(new Error('Cancelled'));
          return;
        }
        if (char === DELETE || char === BACKSPACE) {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}

/* ------------------------------------------------------------------------------------------------
 * Commands
 * ---------------------------------------------------------------------------------------------- */

async function commandLogin(args: Args): Promise<void> {
  const email = args.positional[0];
  if (email === undefined) {
    usage();
  }
  const password = await promptHidden('Peloton password: ');
  if (password.length === 0) {
    throw new Error('Empty password');
  }
  if (args.dump !== undefined) {
    console.log(`Writing redacted HTML dumps to ${args.dump}`);
  }
  const tokens = await login(email, password, fetch, { debugDump: args.dump });
  await saveTokens(tokens);
  console.log(`Login ok, ${describeExpiry(tokens)}. Tokens saved to ${TOKEN_FILE}.`);
}

async function commandRefresh(): Promise<void> {
  const stored = await loadTokens();
  const tokens = await refresh(stored.refreshToken);
  await saveTokens({ ...tokens, userId: stored.userId });
  const rotated = tokens.refreshToken !== stored.refreshToken;
  console.log(`Refresh ok, ${describeExpiry(tokens)}. Refresh token ${rotated ? 'rotated' : 'unchanged'}.`);
}

async function commandBrowser(): Promise<void> {
  const start = browserStart();
  console.log('Open this URL in a browser, sign in, then paste the full address the browser lands on:');
  console.log('');
  console.log(start.authorizeUrl);
  console.log('');
  const callbackUrl = await promptVisible('Callback URL: ');
  const tokens = await browserFinish(callbackUrl, start.verifier, start.state);
  await saveTokens(tokens);
  console.log(`Browser sign-in ok, ${describeExpiry(tokens)}. Tokens saved to ${TOKEN_FILE}.`);
}

/** Runs fn with a valid access token, refreshing when close to expiry or on 401, like the account store. */
async function withToken<T>(fn: (accessToken: string) => Promise<T>): Promise<T> {
  let stored = await loadTokens();
  if (stored.expiresAt - Date.now() <= REFRESH_AHEAD_MS) {
    console.log('Access token is within 6 hours of expiry, refreshing first.');
    stored = await refreshStored(stored);
  }
  try {
    return await fn(stored.accessToken);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error;
    }
    console.log('HTTP 401, refreshing and retrying once.');
  }
  stored = await refreshStored(stored);
  return fn(stored.accessToken);
}

async function refreshStored(stored: ProbeTokens): Promise<ProbeTokens> {
  const tokens = await refresh(stored.refreshToken);
  const updated = { ...tokens, userId: stored.userId };
  await saveTokens(updated);
  return updated;
}

async function resolveUserId(accessToken: string): Promise<string> {
  const stored = await loadTokens();
  if (stored.userId !== undefined) {
    return stored.userId;
  }
  const me = await getMe(accessToken);
  await saveTokens({ ...stored, userId: me.id });
  return me.id;
}

async function commandMe(): Promise<void> {
  await withToken(async (accessToken) => {
    const me = await getMe(accessToken);
    const stored = await loadTokens();
    await saveTokens({ ...stored, userId: me.id });
    console.log(`User id: ${me.id}`);
    console.log(`Username: ${me.username}`);
    console.log(`Name: ${me.firstName} ${me.lastName}`);
    console.log(`Default avatar: ${me.isProfileImageDefault}`);
    console.log(`Customised heart rate zones: ${me.customizedHeartRateZones.length}`);
    for (const zone of me.customizedHeartRateZones) {
      console.log(`  zone ${zone.zone} (${zone.slug}): ${zone.minValue} to ${zone.maxValue}`);
    }
    console.log(`Max heart rate: default ${me.defaultMaxHeartRate ?? 'none'}, customised ${me.customizedMaxHeartRate ?? 'none'}`);
    console.log(`Paired devices: ${me.pairedDevices.length}`);
    console.log(`Last workout at: ${me.lastWorkoutAt === null ? 'never' : new Date(me.lastWorkoutAt * 1000).toISOString()}`);
  });
}

async function commandWorkout(args: Args): Promise<void> {
  await withToken(async (accessToken) => {
    const userId = await resolveUserId(accessToken);
    const workout = await getLatestWorkout(userId, accessToken);
    if (workout === null) {
      console.log('No workouts yet.');
      return;
    }
    console.log(`Workout id: ${workout.id}`);
    console.log(`Status: ${workout.status}`);
    console.log(`Discipline: ${workout.fitnessDiscipline}`);
    console.log(`Device type: ${workout.deviceType}`);
    console.log(`Workout type: ${workout.workoutType}`);
    console.log(`Title: ${workout.title}`);
    console.log(`Name: ${workout.name}`);
    console.log(`Device id field: ${workout.deviceId ?? 'absent'}`);
    console.log(`Start: ${formatEpoch(workout.startTime)}, end: ${formatEpoch(workout.endTime)}, created: ${formatEpoch(workout.createdAt)}`);
    if (args.keys) {
      const keys = await rawWorkoutKeys(userId, accessToken);
      console.log(`Raw workout fields (names only): ${keys.join(', ')}`);
    }
    if (workout.status !== 'IN_PROGRESS') {
      return;
    }
    const graph = await getPerformanceGraph(workout.id, 5, accessToken);
    console.log(`Samples: ${graph.secondsSincePedalingStart.length}, latest at ${graph.secondsSincePedalingStart.at(-1) ?? 'none'} s`);
    if (graph.heartRate === null) {
      console.log('Heart rate metric: absent');
      return;
    }
    console.log(`Heart rate: latest ${graph.heartRate.latestSample ?? 'none'} bpm, ${graph.heartRate.zones.length} zone bounds`);
    for (const zone of graph.heartRate.zones) {
      console.log(`  zone ${zone.zone} (${zone.slug}): ${zone.minValue} to ${zone.maxValue}`);
    }
  });
}

/** Fetches the latest workout again and returns only the top-level field names, to settle SPEC open item 1. */
async function rawWorkoutKeys(userId: string, accessToken: string): Promise<string[]> {
  const response = await fetch(`${PELOTON_API_BASE}/api/user/${encodeURIComponent(userId)}/workouts?limit=1&sort_by=-created`, {
    headers: { authorization: `Bearer ${accessToken}`, 'peloton-platform': 'web', accept: 'application/json' },
  });
  if (!response.ok) {
    throw new ApiError(response.status, '/api/user/{id}/workouts');
  }
  const body = await response.json() as { data?: unknown[] };
  const first = body.data?.[0];
  return first !== null && typeof first === 'object' ? Object.keys(first).sort() : [];
}

function formatEpoch(seconds: number | null): string {
  return seconds === null ? 'none' : new Date(seconds * 1000).toISOString();
}

/* ------------------------------------------------------------------------------------------------
 * Entry
 * ---------------------------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'login':
      return commandLogin(args);
    case 'refresh':
      return commandRefresh();
    case 'browser':
      return commandBrowser();
    case 'me':
      return commandMe();
    case 'workout':
      return commandWorkout(args);
    default:
      usage();
  }
}

main().catch((error: unknown) => {
  if (error instanceof AuthError) {
    const status = error.status === undefined ? 'no HTTP status' : `HTTP ${error.status}`;
    const code = error.code === undefined ? '' : `, code ${error.code}`;
    console.error(`Auth failed at stage ${error.stage} (${status}${code})`);
  } else if (error instanceof ApiError) {
    console.error(`API call failed: HTTP ${error.status} on ${error.path}`);
  } else if (error instanceof Error) {
    console.error(`Failed: ${error.message}`);
  } else {
    console.error('Failed');
  }
  process.exit(1);
});
