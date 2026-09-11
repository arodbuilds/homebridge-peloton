/**
 * A fetch replacement that routes by URL and replays fixture envelopes per route, for scenarios
 * where several accounts and calls interleave. Each route holds a queue of steps: an envelope
 * { status, headers, body }, an Error to throw, or a function (request) => envelope. When a queue
 * runs dry the last step repeats, so "the list keeps saying IN_PROGRESS" needs one entry.
 * Every request is recorded with its url, method, and headers.
 */

export function createRoutedFetch() {
  const routes = [];
  const requests = [];

  const fake = async (input, init = {}) => {
    const url = String(input);
    const headers = {};
    new Headers(init.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    const request = { url, method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : String(init.body) };
    requests.push(request);
    const route = routes.find((entry) => matches(entry.matcher, url));
    if (route === undefined) {
      throw new Error(`No route for ${request.method} ${url}`);
    }
    const step = route.queue.length > 1 ? route.queue.shift() : route.queue[0];
    if (step === undefined) {
      throw new Error(`Route ${String(route.matcher)} has no steps left for ${url}`);
    }
    if (step instanceof Error) {
      throw step;
    }
    const envelope = typeof step === 'function' ? await step(request) : step;
    return toResponse(envelope);
  };

  /** Adds or replaces the route for matcher (a substring or RegExp of the URL). */
  fake.route = (matcher, steps) => {
    const queue = Array.isArray(steps) ? [...steps] : [steps];
    const existing = routes.find((entry) => String(entry.matcher) === String(matcher));
    if (existing !== undefined) {
      existing.queue = queue;
    } else {
      routes.push({ matcher, queue });
    }
    return fake;
  };

  fake.requests = requests;
  /** Recorded requests whose URL matches. */
  fake.calls = (matcher) => requests.filter((request) => matches(matcher, request.url));
  fake.count = (matcher) => fake.calls(matcher).length;
  return fake;
}

function matches(matcher, url) {
  return matcher instanceof RegExp ? matcher.test(url) : url.includes(matcher);
}

function toResponse(envelope) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(envelope.headers ?? {})) {
    headers.append(name, String(value));
  }
  return new Response(envelope.body ?? '', { status: envelope.status ?? 200, headers });
}
