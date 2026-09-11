/**
 * Wrappers over the homebridge object the Homebridge UI injects into the settings iframe (the
 * @homebridge/plugin-ui-utils client). Server calls never throw to the caller: a request the server
 * could not answer becomes { ok: false } with a generic message the caller shows.
 */

import { PAGE, TOAST_TITLE } from './copy.js';

function hb() {
  return window.homebridge;
}

/** Calls a SPEC section 10 request. Resolves to the server's answer, or { ok: false, unavailable: true } when the server did not answer. */
export async function callServer(path, payload = {}) {
  try {
    const result = await hb().request(path, payload);
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
      return { ok: false, unavailable: true, message: PAGE.serverUnavailable };
    }
    return result;
  } catch {
    return { ok: false, unavailable: true, message: PAGE.serverUnavailable };
  }
}

export function toastError(message) {
  hb().toast.error(message, TOAST_TITLE);
}

export function toastSuccess(message) {
  hb().toast.success(message, TOAST_TITLE);
}

export function setSaveEnabled(enabled) {
  if (enabled) {
    hb().enableSaveButton();
  } else {
    hb().disableSaveButton();
  }
}
