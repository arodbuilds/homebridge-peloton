/**
 * The Accounts section (design/README.md, Accounts and Connect panel): one card per account with
 * avatar, name, status pill and link buttons, the inline connect panel with the email and password
 * form and the Sign in with browser fallback, Add account, and the read-only Devices line.
 */

import { callServer } from './api.js';
import { ACCOUNTS, CONNECT, PROMOTE_BROWSER_STAGES, stageMessage } from './copy.js';
import {
  append, badge, clear, dangerLinkButton, el, helpText, initialsOf, inlineConfirm, linkButton, outlineLinkButton, passwordField, pill, primaryButton,
  relativeTime, textField,
} from './dom.js';
import { newId } from './model.js';

/** The key of the panel that adds a profile not on the household list. */
export const NEW_ACCOUNT = 'new';

/**
 * Every account the page shows, in config order and then the household profiles the store knows
 * but config does not. Each view carries the config entry when there is one and the server summary
 * when there is one; the key is the config id, else the store id (a member's userId).
 */
export function accountViews(app) {
  const summaries = app.status?.accounts ?? [];
  const views = [];
  const used = new Set();
  for (const account of app.config.accounts) {
    const summary = summaries.find((entry) => entry.id === account.id);
    if (summary) {
      used.add(summary.id);
    }
    views.push(makeView(account.id, account, summary));
  }
  for (const summary of summaries) {
    if (!used.has(summary.id)) {
      views.push(makeView(summary.id, undefined, summary));
    }
  }
  return views;
}

function makeView(key, account, summary) {
  return {
    key,
    account,
    summary,
    state: summary?.state ?? 'not_connected',
    name: summary?.displayName || account?.displayName || summary?.username || account?.email || ACCOUNTS.unnamed,
    username: summary?.username ?? '',
    userId: summary?.userId ?? account?.userId ?? '',
    isOwner: summary?.isOwner === true,
    lastCheckedAt: summary?.lastCheckedAt,
    lastWorkoutAt: summary?.lastWorkoutAt ?? null,
    avatar: summary?.avatar === true,
  };
}

export function renderAccounts(app, container) {
  const ui = app.accountsUi;
  container.appendChild(el('p', { class: 'ns-section-copy' }, ACCOUNTS.intro));
  const views = accountViews(app);
  const list = el('div', { class: 'ns-account-list' });
  if (views.length === 0) {
    // First run: a single inviting panel with the email and password form.
    if (!ui.panel || ui.panel.key !== NEW_ACCOUNT) {
      ui.panel = newPanel(app, NEW_ACCOUNT, undefined);
      ui.panel.firstRun = true;
    }
    const card = el('div', { class: 'ns-card ns-first-run-card' });
    card.appendChild(el('div', { class: 'ns-connect-panel ns-first-run-panel' },
      el('p', { class: 'ns-first-run', style: 'margin-top:0' }, ACCOUNTS.firstRun),
      renderPanel(app, ui.panel),
    ));
    list.appendChild(card);
    container.appendChild(list);
    return;
  }
  for (const view of views) {
    list.appendChild(renderCard(app, view));
  }
  container.appendChild(list);

  const addRow = el('div', { class: 'ns-add-account' });
  if (ui.panel && ui.panel.key === NEW_ACCOUNT) {
    addRow.appendChild(el('div', { class: 'ns-standalone-panel' }, renderPanel(app, ui.panel)));
  } else {
    addRow.appendChild(linkButton(ACCOUNTS.addAccount, () => {
      ui.panel = newPanel(app, NEW_ACCOUNT, undefined);
      app.rerender('accounts');
      focusPanel(container);
    }, 'ns-add-account-link'));
  }
  container.appendChild(addRow);

  const devices = app.status?.devices ?? [];
  if (devices.length > 0) {
    container.appendChild(el('div', { class: 'ns-devices form-text' },
      ACCOUNTS.devices(devices.map((device) => device.name).join(', ')), ' ',
      el('span', { class: 'ns-devices-suffix' }, ACCOUNTS.devicesSuffix),
    ));
  }
}

function focusPanel(container) {
  window.requestAnimationFrame(() => {
    container.querySelector('.ns-connect-panel input, .ns-standalone-panel input')?.focus({ preventScroll: true });
  });
}

/** A fresh connect panel for a card (or for Add account), in the email and password mode. */
function newPanel(app, key, view) {
  return {
    key,
    // The config account id this panel connects: the existing one, else one generated now and kept for the panel's life.
    accountId: view?.account?.id ?? newId(),
    mode: 'password',
    email: view?.account?.email ?? '',
    password: '',
    callbackUrl: '',
    result: null,
    busy: false,
    started: false,
  };
}

function renderCard(app, view) {
  const ui = app.accountsUi;
  const checking = ui.checking.has(view.key) || (ui.panel?.key === view.key && ui.panel.busy);
  const state = checking ? 'checking' : view.state;
  const spec = ACCOUNTS.status[state];
  const card = el('div', { class: 'ns-card ns-account-card', 'data-account': view.key });

  const avatar = el('div', { class: 'ns-avatar', 'aria-hidden': 'true' }, initialsOf(view.name, view.username));
  if (view.avatar) {
    app.loadAvatar(view.key).then((src) => {
      if (src) {
        clear(avatar);
        avatar.appendChild(el('img', { src, alt: '' }));
      }
    }).catch(() => undefined);
  }

  const nameRow = el('div', { class: 'ns-account-name' }, el('span', { class: 'ns-name' }, view.name));
  if (view.username) {
    nameRow.appendChild(el('span', { class: 'ns-secondary', style: 'font-size:14.4px' }, `@${view.username}`));
  }
  if (view.isOwner) {
    nameRow.appendChild(badge(ACCOUNTS.owner, 'filled'));
  }
  const main = el('div', { class: 'ns-account-main' }, nameRow);
  const subline = state === 'connected' && view.lastCheckedAt ? spec.subline(relativeTime(view.lastCheckedAt, app.now())) : spec.subline();
  if (subline) {
    main.appendChild(el('div', { class: 'ns-account-subline form-text', style: 'margin-top:4px' }, subline));
  }
  if (view.lastWorkoutAt !== null && view.lastWorkoutAt !== undefined) {
    const when = relativeTime(view.lastWorkoutAt, app.now());
    main.appendChild(el('div', { class: 'ns-account-meta form-text', style: 'margin-top:2px' }, ACCOUNTS.lastWorkout(when)));
  }

  const links = el('div', { class: 'ns-account-links' });
  for (const link of spec.links) {
    if (link === 'remove') {
      const start = dangerLinkButton(ACCOUNTS.links.remove, () => undefined);
      links.appendChild(inlineConfirm({
        start,
        question: () => ACCOUNTS.removeQuestion(view.name),
        confirmLabel: ACCOUNTS.removeConfirm,
        confirmClass: 'btn btn-danger btn-sm ns-small',
        cancelLabel: ACCOUNTS.cancel,
        onConfirm: () => {
          app.removeAccount(view).catch(() => undefined);
        },
      }));
    } else if (link === 'test') {
      links.appendChild(linkButton(ACCOUNTS.links.test, () => {
        runTest(app, view).catch(() => undefined);
      }));
    } else {
      links.appendChild(linkButton(ACCOUNTS.links[link], () => {
        ui.panel = newPanel(app, view.key, view);
        app.rerender('accounts');
        focusPanel(card.parentElement ?? card);
      }));
    }
  }
  const status = el('div', { class: 'ns-account-status' }, pill(state, spec.pill), links);
  card.appendChild(el('div', { class: 'ns-account-row' }, avatar, main, status));

  const message = ui.results.get(view.key);
  if (message) {
    card.appendChild(el('div', { class: `ns-account-result ${message.tone === 'success' ? 'text-success' : 'text-danger'}` }, message.text));
  }
  if (ui.panel && ui.panel.key === view.key) {
    card.appendChild(el('div', { class: 'ns-connect-panel' }, renderPanel(app, ui.panel)));
  }
  return card;
}

async function runTest(app, view) {
  const ui = app.accountsUi;
  ui.checking.add(view.key);
  ui.results.delete(view.key);
  app.rerender('accounts');
  const result = await callServer('/test', { id: view.key });
  ui.checking.delete(view.key);
  if (result.ok) {
    if (view.summary) {
      view.summary.lastCheckedAt = result.lastCheckedAt;
    }
    app.rerender('accounts');
    return;
  }
  ui.results.set(view.key, { tone: 'danger', text: result.unavailable ? result.message : stageMessage(result.stage, result.status) });
  if (result.stage === 'refresh') {
    await app.refreshStatus();
  } else {
    app.rerender('accounts');
  }
}

/* ------------------------------------------------------------------------------------------------
 * Connect panel
 * ---------------------------------------------------------------------------------------------- */

function renderPanel(app, panel) {
  return panel.mode === 'browser' ? renderBrowserPanel(app, panel) : renderPasswordPanel(app, panel);
}

function resultBox(panel) {
  if (!panel.result) {
    return null;
  }
  return el('div', { class: `ns-result ns-result-${panel.result.tone}`, role: 'status' }, panel.result.text);
}

function cancelButton(app, panel) {
  if (panel.firstRun) {
    return null;
  }
  return linkButton(CONNECT.cancel, () => {
    app.accountsUi.panel = null;
    app.rerender('accounts');
  }, 'ns-secondary');
}

function renderPasswordPanel(app, panel) {
  const box = el('div', { class: 'ns-connect-form' });
  const email = textField(CONNECT.email, panel.email, (value) => {
    panel.email = value;
  }, { type: 'email', autocomplete: 'username', placeholder: panel.email ? undefined : CONNECT.emailPlaceholder });
  const password = passwordField(CONNECT.password, (value) => {
    panel.password = value;
  }, { help: CONNECT.passwordCaption, showLabel: CONNECT.show, hideLabel: CONNECT.hide });
  box.appendChild(email);
  box.appendChild(password);
  append(box, resultBox(panel));

  const connect = primaryButton(CONNECT.connect, () => {
    submitPassword(app, panel).catch(() => undefined);
  });
  connect.disabled = panel.busy;
  const actions = el('div', { class: 'ns-connect-actions' }, connect);
  const toBrowser = () => {
    panel.mode = 'browser';
    panel.result = null;
    app.rerender('accounts');
  };
  if (panel.result?.promote) {
    actions.appendChild(outlineLinkButton(CONNECT.browserPromoted, toBrowser));
  }
  actions.appendChild(linkButton(CONNECT.useBrowser, toBrowser));
  append(actions, cancelButton(app, panel));
  box.appendChild(actions);
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      connect.click();
    }
  });
  return box;
}

async function submitPassword(app, panel) {
  const email = panel.email.trim();
  if (email.length === 0) {
    panel.result = { tone: 'danger', text: CONNECT.emailMissing };
    app.rerender('accounts');
    return;
  }
  if (panel.password.length === 0) {
    panel.result = { tone: 'danger', text: CONNECT.passwordMissing };
    app.rerender('accounts');
    return;
  }
  panel.busy = true;
  panel.result = null;
  app.rerender('accounts');
  const result = await callServer('/connect', { id: panel.accountId, email, password: panel.password });
  panel.busy = false;
  if (result.ok) {
    await app.applyConnected(panel, result.account, { email, password: panel.password });
    return;
  }
  panel.result = {
    tone: 'danger',
    text: result.unavailable ? result.message : stageMessage(result.stage, result.status),
    promote: !result.unavailable && PROMOTE_BROWSER_STAGES.includes(result.stage),
  };
  app.rerender('accounts');
}

function renderBrowserPanel(app, panel) {
  const box = el('div', { class: 'ns-connect-form ns-browser-form' });
  box.appendChild(outlineLinkButton(CONNECT.openSignIn, () => {
    openSignIn(app, panel).catch(() => undefined);
  }));
  box.appendChild(el('p', {}, CONNECT.browserStep1));
  box.appendChild(el('p', {}, CONNECT.browserStep2));
  box.appendChild(helpText(CONNECT.browserHelp));
  const callback = el('input', {
    class: `form-control font-monospace${panel.result?.tone === 'danger' ? ' is-invalid' : ''}`, type: 'text', placeholder: CONNECT.callbackPlaceholder,
    autocomplete: 'off', spellcheck: 'false', 'aria-label': CONNECT.callbackPlaceholder, style: 'margin-top:12px;font-size:14px',
  });
  callback.value = panel.callbackUrl;
  callback.addEventListener('input', () => {
    panel.callbackUrl = callback.value;
  });
  box.appendChild(callback);
  append(box, resultBox(panel));
  const connect = primaryButton(CONNECT.connect, () => {
    submitCallback(app, panel).catch(() => undefined);
  });
  connect.disabled = panel.busy;
  box.appendChild(el('div', { class: 'ns-connect-actions' },
    connect,
    linkButton(CONNECT.usePassword, () => {
      panel.mode = 'password';
      panel.result = null;
      app.rerender('accounts');
    }),
    cancelButton(app, panel),
  ));
  callback.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      connect.click();
    }
  });
  return box;
}

async function openSignIn(app, panel) {
  const result = await callServer('/browser/start', { id: panel.accountId });
  if (!result.ok) {
    panel.result = { tone: 'danger', text: result.unavailable ? result.message : stageMessage(result.stage, result.status) };
    app.rerender('accounts');
    return;
  }
  panel.started = true;
  panel.result = null;
  window.open(result.authorizeUrl, '_blank', 'noopener');
}

async function submitCallback(app, panel) {
  const callbackUrl = panel.callbackUrl.trim();
  if (callbackUrl.length === 0) {
    panel.result = { tone: 'danger', text: CONNECT.callbackMissing };
    app.rerender('accounts');
    return;
  }
  if (!panel.started) {
    panel.result = { tone: 'danger', text: CONNECT.openFirst };
    app.rerender('accounts');
    return;
  }
  panel.busy = true;
  panel.result = null;
  app.rerender('accounts');
  const result = await callServer('/browser/finish', { id: panel.accountId, callbackUrl });
  panel.busy = false;
  if (result.ok) {
    await app.applyConnected(panel, result.account, {});
    return;
  }
  panel.result = { tone: 'danger', text: result.unavailable ? result.message : stageMessage(result.stage, result.status) };
  app.rerender('accounts');
}
