/**
 * An in-memory account store with the surface the connect flow and the UI handlers use (load,
 * loadAll, save, remove, withValidToken). withValidToken hands fn the stored access token; when fn
 * throws ApiError 401 the account is marked reconnect_needed, its tokens are dropped, and AuthError
 * stage refresh with code invalid_grant is thrown, the way the real store ends a dead session.
 */
import { ApiError } from '../../dist/api/peloton-api.js';
import { AuthError } from '../../dist/auth/peloton-auth.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createFakeStore(initial = {}) {
  const records = new Map(Object.entries(initial).map(([id, record]) => [id, clone(record)]));
  const calls = { save: [], remove: [] };
  return {
    records,
    calls,
    async load(id) {
      const record = records.get(id);
      return record === undefined ? undefined : clone(record);
    },
    async loadAll() {
      return new Map([...records.entries()].map(([id, record]) => [id, clone(record)]));
    },
    async save(id, record) {
      calls.save.push(id);
      records.set(id, clone(record));
    },
    async remove(id) {
      calls.remove.push(id);
      records.delete(id);
    },
    async withValidToken(id, fn) {
      const record = records.get(id);
      if (record === undefined || record.accessToken === undefined || record.refreshToken === undefined) {
        throw new Error(`Account ${id} has no tokens`);
      }
      try {
        return await fn(record.accessToken);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const failed = { ...record, state: 'reconnect_needed', lastError: { stage: 'refresh', status: 401, at: 0 } };
          delete failed.accessToken;
          delete failed.accessTokenExpiresAt;
          delete failed.refreshToken;
          records.set(id, failed);
          throw new AuthError('refresh', 401, 'invalid_grant');
        }
        throw error;
      }
    },
  };
}
