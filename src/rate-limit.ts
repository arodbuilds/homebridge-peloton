/**
 * Rate limit classification shared by the API and auth modules (SPEC sections 5.1 and 8.2).
 *
 * Peloton and the CDN in front of it rate limit per IP address. A response is rate limited when its
 * status is 429, or when it is any other non-2xx whose body starts with "error code: 1015", the
 * CDN's rate limit page. The body is read only to classify the response and is never logged or kept.
 * Retry-After follows RFC 9110 section 10.2.3: delta-seconds or an HTTP-date.
 */

/** The start of the body the CDN sends when it rate limits a client. */
export const CDN_RATE_LIMIT_PREFIX = 'error code: 1015';

/** What a rate limited response carries for the caller: the flag, and Retry-After in seconds when it had a usable one. */
export interface RateLimitInfo {
  rateLimited: boolean;
  retryAfter?: number;
}

/** True for HTTP 429, or a non-2xx whose body text starts with the CDN's rate limit code. */
export function isRateLimitedResponse(status: number, bodyText: string): boolean {
  if (status === 429) {
    return true;
  }
  if (status >= 200 && status < 300) {
    return false;
  }
  return bodyText.trimStart().toLowerCase().startsWith(CDN_RATE_LIMIT_PREFIX);
}

const DELTA_SECONDS = /^\d+$/;
/** IMF-fixdate, the preferred form: "Sun, 06 Nov 1994 08:49:37 GMT". */
const IMF_FIXDATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
/** The obsolete RFC 850 form: "Sunday, 06-Nov-94 08:49:37 GMT". */
const RFC850_DATE = /^[A-Za-z]{6,9}, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT$/;
/** The obsolete asctime form, always GMT: "Sun Nov  6 08:49:37 1994". */
const ASCTIME_DATE = /^[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/;

/**
 * Retry-After in whole seconds from now: delta-seconds as given, an HTTP-date as the seconds until it
 * (0 when it has passed). Anything else, including a missing header, is undefined.
 */
export function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (DELTA_SECONDS.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  let at: number;
  if (IMF_FIXDATE.test(trimmed) || RFC850_DATE.test(trimmed)) {
    at = Date.parse(trimmed);
  } else if (ASCTIME_DATE.test(trimmed)) {
    at = Date.parse(`${trimmed.replace(/ {2,}/g, ' ')} GMT`);
  } else {
    return undefined;
  }
  if (!Number.isFinite(at)) {
    return undefined;
  }
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** Classifies a response for an error: the flag, and Retry-After only when the response is rate limited. */
export function rateLimitInfo(status: number, bodyText: string, retryAfterHeader: string | null, now: number): RateLimitInfo {
  if (!isRateLimitedResponse(status, bodyText)) {
    return { rateLimited: false };
  }
  const retryAfter = parseRetryAfter(retryAfterHeader, now);
  return retryAfter === undefined ? { rateLimited: true } : { rateLimited: true, retryAfter };
}
