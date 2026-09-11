/**
 * Server side of the settings page (SPEC section 10). Started by the Homebridge UI as a child
 * process through homebridge-ui/server.js; the platform itself never loads this module. It opens
 * the same account store the platform uses under the Homebridge storage path and answers the
 * requests in SPEC section 10 through UiHandlers. It never writes config.json: the page writes the
 * platform block through the host's normal save.
 */

import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';

import { getLatestWorkout, getMe, getSubscriptions } from '../api/peloton-api.js';
import { browserFinish, browserStart, login } from '../auth/peloton-auth.js';
import { PLUGIN_VERSION } from '../settings.js';
import { AccountStore } from '../store/account-store.js';
import { UiHandlers } from './handlers.js';

export class PelotonUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    const storagePath = this.homebridgeStoragePath;
    if (storagePath === undefined || storagePath.length === 0) {
      throw new Error('The Homebridge storage path is not available to the Peloton settings UI server');
    }
    const store = new AccountStore({ storagePath });
    const handlers = new UiHandlers({
      store,
      api: {
        getMe: (token) => getMe(token),
        getSubscriptions: (userId, token) => getSubscriptions(userId, token),
        getLatestWorkout: (userId, token) => getLatestWorkout(userId, token),
      },
      auth: {
        login: (email, password) => login(email, password),
        browserStart: () => browserStart(),
        browserFinish: (callbackUrl, verifier, state) => browserFinish(callbackUrl, verifier, state),
      },
      version: PLUGIN_VERSION,
    });
    for (const [path, handler] of Object.entries(handlers.routes())) {
      this.onRequest(path, handler);
    }
    this.ready();
  }
}

export function startUiServer(): PelotonUiServer {
  return new PelotonUiServer();
}
