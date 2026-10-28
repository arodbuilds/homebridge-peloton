import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CDN_RATE_LIMIT_PREFIX, isRateLimitedResponse, parseRetryAfter, rateLimitInfo } from '../dist/rate-limit.js';

const NOW = Date.UTC(2026, 9, 28, 19, 0, 0);

describe('rate limited responses', () => {
  it('counts HTTP 429 whatever the body', () => {
    assert.equal(isRateLimitedResponse(429, ''), true);
    assert.equal(isRateLimitedResponse(429, '{"error":"too_many_requests"}'), true);
  });

  it('counts any other non-2xx whose body starts with the CDN rate limit code, and nothing else', () => {
    assert.equal(CDN_RATE_LIMIT_PREFIX, 'error code: 1015');
    assert.equal(isRateLimitedResponse(403, 'error code: 1015'), true);
    assert.equal(isRateLimitedResponse(503, '\n  error code: 1015\n'), true, 'leading whitespace is tolerated');
    assert.equal(isRateLimitedResponse(520, 'Error Code: 1015'), true);
    assert.equal(isRateLimitedResponse(403, 'error code: 1020'), false, 'another CDN code is not a rate limit');
    assert.equal(isRateLimitedResponse(500, '<html>error code: 1015</html>'), false, 'only the start of the body counts');
    assert.equal(isRateLimitedResponse(503, ''), false);
    assert.equal(isRateLimitedResponse(200, 'error code: 1015'), false, 'a 2xx is never rate limited');
  });
});

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    assert.equal(parseRetryAfter('120', NOW), 120);
    assert.equal(parseRetryAfter(' 30 ', NOW), 30);
    assert.equal(parseRetryAfter('0', NOW), 0);
  });

  it('reads an HTTP-date in all three forms as the seconds until it, 0 once it has passed', () => {
    assert.equal(parseRetryAfter('Wed, 28 Oct 2026 19:05:00 GMT', NOW), 300);
    assert.equal(parseRetryAfter('Wed, 28 Oct 2026 19:00:00 GMT', NOW), 0);
    assert.equal(parseRetryAfter('Wed, 28 Oct 2026 18:00:00 GMT', NOW), 0);
    assert.equal(parseRetryAfter('Wednesday, 28-Oct-26 19:01:00 GMT', NOW), 60);
    assert.equal(parseRetryAfter('Wed Oct 28 19:02:00 2026', NOW), 120);
    assert.equal(parseRetryAfter('Sun Nov  6 08:49:37 1994', NOW), 0);
    assert.equal(parseRetryAfter('Wed, 28 Oct 2026 19:00:00 GMT', NOW - 1500), 2, 'a part second rounds up');
  });

  it('ignores a missing header and garbage', () => {
    for (const value of [null, undefined, '', '   ', 'soon', '-5', '1.5', '2e3', '120s', '0x10', 'Wed, 28 Oct 2026 19:05:00', '2026-10-28T19:05:00Z',
      'Wed, 99 Foo 2026 19:05:00 GMT', '99999999999999999999']) {
      assert.equal(parseRetryAfter(value, NOW), undefined, String(value));
    }
  });
});

describe('rateLimitInfo', () => {
  it('carries Retry-After only for a rate limited response', () => {
    assert.deepEqual(rateLimitInfo(429, '', '90', NOW), { rateLimited: true, retryAfter: 90 });
    assert.deepEqual(rateLimitInfo(429, '', 'later', NOW), { rateLimited: true });
    assert.deepEqual(rateLimitInfo(403, 'error code: 1015', null, NOW), { rateLimited: true });
    assert.deepEqual(rateLimitInfo(503, 'down', '90', NOW), { rateLimited: false });
  });
});
