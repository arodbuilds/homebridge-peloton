/**
 * A fetch replacement that replays response envelopes in sequence and records every request.
 *
 * Each step is an envelope { status, headers, body } or a function (request) => envelope.
 * The literals {{state}}, {{nonce}}, and {{code_challenge}} in headers or body are replaced with
 * the values seen in the /authorize request. They are also replaced inside the base64 JSON of a
 * window.injectedConfig line, so a login page fixture can echo them the way Auth0 does.
 * A step may also be an Error instance, which is thrown to simulate a network failure.
 */
import { Buffer } from 'node:buffer';

export function createFakeFetch(steps) {
  const queue = [...steps];
  const requests = [];
  const authorize = { state: undefined, nonce: undefined, code_challenge: undefined };

  const fake = async (input, init = {}) => {
    const url = String(input);
    const headers = {};
    new Headers(init.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    const request = {
      url,
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : String(init.body),
      redirect: init.redirect,
    };
    requests.push(request);

    const parsed = new URL(url);
    if (parsed.pathname === '/authorize') {
      for (const key of Object.keys(authorize)) {
        authorize[key] = parsed.searchParams.get(key) ?? undefined;
      }
    }

    const step = queue.shift();
    if (step === undefined) {
      throw new Error(`Unexpected request ${request.method} ${url}`);
    }
    if (step instanceof Error) {
      throw step;
    }
    const envelope = typeof step === 'function' ? await step(request) : step;
    return toResponse(envelope, authorize);
  };

  fake.requests = requests;
  fake.remaining = () => queue.length;
  fake.authorizeState = () => authorize.state;
  return fake;
}

const INJECTED_CONFIG = /(window\.injectedConfig\s*=\s*window\.injectedConfig\s*\|\|\s*")([A-Za-z0-9+/=]+)(")/;

function toResponse(envelope, authorize) {
  const substitutePlain = (text) => Object.entries(authorize)
    .reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value ?? ''), text);
  const substitute = (text) => substitutePlain(text).replace(INJECTED_CONFIG, (whole, before, encoded, after) => {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    return before + Buffer.from(substitutePlain(decoded), 'utf8').toString('base64') + after;
  });
  const headers = new Headers();
  for (const [name, value] of Object.entries(envelope.headers ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, substitute(String(item)));
    }
  }
  return new Response(substitute(envelope.body ?? ''), { status: envelope.status ?? 200, headers });
}

/** Parses a recorded JSON request body. */
export function jsonBody(request) {
  return JSON.parse(request.body);
}

/** Parses a recorded urlencoded request body into a plain object. */
export function formBody(request) {
  return Object.fromEntries(new URLSearchParams(request.body));
}
