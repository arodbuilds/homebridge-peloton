/**
 * The copy tables of the shell: the strings every plugin on the Homebridge Plugin Shell shows the same
 * way. Shell file: the shell entries of homebridge-notify-switch v1.3.2 homebridge-ui/src/copy.ts
 * (GET_STARTED, SAVE_STATUS, HELP_TOGGLE, VALIDATION.required, ISSUES, RESULT_BAR, DRAFT), each with
 * the value it has there. Everything Peloton says lives in copy.js.
 */

/** Guided empty state (SPEC section 11.2, item 19): the Get started card and the disabled Add buttons. */
export const GET_STARTED = {
  title: 'Get started',
  intro: 'Choose how you want to send messages. You can add more providers later.',
  addProviderFirst: 'Add a provider first.',
};

/** The Save status line at the bottom of the page while there is nothing to save (SPEC section 11.2, item 19). */
export const SAVE_STATUS = {
  nothing: 'Nothing to save yet',
  reset: 'Configuration reset. Click Save, then restart Homebridge.',
};

export const HELP_TOGGLE = {
  show: 'Show help',
  hide: 'Hide help',
};

/** An empty required field: "{Label} is required." with the field's own label verbatim (`FIELD_LABELS`). */
export function required(label) {
  return `${label} is required.`;
}

export const ISSUES = {
  heading: 'Fix these before saving:',
  count: (n) => `${n} field${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`,
  showAll: 'Show all',
  hide: 'Hide',
  collapseAfter: 3,
};

export const RESULT_BAR = {
  dismiss: 'Dismiss',
};

/** Unsaved draft recovery banner (SPEC section 11.2, item 23). */
export const DRAFT = {
  message: 'You have unsaved changes from earlier. Restore them?',
  restore: 'Restore',
  discard: 'Discard',
};
