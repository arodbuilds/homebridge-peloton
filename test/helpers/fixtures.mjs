import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../fixtures/', import.meta.url);

/**
 * Loads an auth response envelope ({ status, headers, body }) from fixtures/auth.
 * bodyFile references are inlined.
 */
export function authFixture(name) {
  const envelope = JSON.parse(readFileSync(new URL(`auth/${name}.json`, root), 'utf8'));
  if (envelope.bodyFile !== undefined) {
    envelope.body = readFileSync(new URL(`auth/${envelope.bodyFile}`, root), 'utf8');
    delete envelope.bodyFile;
  }
  return envelope;
}

/** Loads a parsed API body from fixtures/api. */
export function apiFixture(name) {
  return JSON.parse(readFileSync(new URL(`api/${name}.json`, root), 'utf8'));
}

/** Wraps an API body in a 200 envelope. */
export function apiResponse(name, status = 200) {
  return jsonResponse(status, apiFixture(name));
}

export function jsonResponse(status, body) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

export function htmlResponse(status, body) {
  return { status, headers: { 'content-type': 'text/html; charset=utf-8' }, body };
}

export function redirectResponse(location, extraHeaders = {}) {
  return { status: 302, headers: { location, ...extraHeaders }, body: '' };
}

export const fixturesDir = fileURLToPath(root);
