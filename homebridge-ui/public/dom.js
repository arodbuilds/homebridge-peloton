/**
 * Small DOM helpers. The page is plain HTML built with these; Bootstrap classes come from the
 * stylesheet the Homebridge UI injects into the settings iframe, and the ns-* classes from index.css.
 */

export function append(parent, ...children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false || value === null) {
      continue;
    }
    if (key === 'class') {
      node.className = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  append(node, ...children);
  return node;
}

export function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

let idCounter = 0;
export function uniqueId(prefix = 'f') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** One line of field help at 12.6 px in the secondary colour. Carries ns-help so a card's Show help toggle can hide it. */
export function helpText(text, extra = '') {
  return el('div', { class: `form-text ns-help${extra ? ` ${extra}` : ''}` }, text);
}

function wrapField(id, label, control, opts) {
  const star = opts.required ? el('span', { class: 'text-danger ms-1', 'aria-hidden': 'true' }, '*') : null;
  return el('div', { class: 'ns-field', 'data-path': opts.path },
    el('label', { class: 'form-label', for: id }, label, star),
    el('div', { class: 'ns-control' }, control),
    opts.help ? helpText(opts.help) : null,
    el('div', { class: 'invalid-feedback' }),
  );
}

/** A labelled text input calling onChange with the new string on every input event. */
export function textField(label, value, onChange, opts = {}) {
  const id = uniqueId();
  const input = el('input', {
    id, class: `form-control${opts.monospace ? ' font-monospace' : ''}`, type: opts.type ?? 'text', placeholder: opts.placeholder,
    autocomplete: opts.autocomplete ?? 'off', spellcheck: 'false', inputmode: opts.inputmode,
  });
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  return wrapField(id, label, input, opts);
}

/** A number input; onChange receives the parsed number or NaN when the box is empty or not a number. */
export function numberField(label, value, onChange, opts = {}) {
  const id = uniqueId();
  const input = el('input', {
    id, class: 'form-control', type: 'number', inputmode: 'numeric', step: '1',
    min: opts.min !== undefined ? String(opts.min) : undefined, max: opts.max !== undefined ? String(opts.max) : undefined,
  });
  input.value = Number.isFinite(value) ? String(value) : '';
  input.addEventListener('input', () => onChange(input.value.trim() === '' ? Number.NaN : Number(input.value)));
  return wrapField(id, label, input, opts);
}

/** A time input for HH:MM. */
export function timeField(label, value, onChange, opts = {}) {
  const id = uniqueId();
  const input = el('input', { id, class: 'form-control', type: 'time', step: '60' });
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  return wrapField(id, label, input, opts);
}

/**
 * A password input with the Show / Hide toggle attached on the right. autocomplete is new-password
 * because browsers ignore off on password inputs and would offer the saved Homebridge login.
 */
export function passwordField(label, onChange, opts = {}) {
  const id = uniqueId();
  const input = el('input', { id, class: 'form-control', type: 'password', autocomplete: 'new-password', spellcheck: 'false' });
  input.addEventListener('input', () => onChange(input.value));
  const toggle = el('button', { class: 'btn btn-outline-secondary ns-reveal', type: 'button', 'aria-label': `${opts.showLabel} ${label}` }, opts.showLabel);
  toggle.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    toggle.textContent = reveal ? opts.hideLabel : opts.showLabel;
    toggle.setAttribute('aria-label', `${reveal ? opts.hideLabel : opts.showLabel} ${label}`);
  });
  const field = wrapField(id, label, el('div', { class: 'input-group' }, input, toggle), opts);
  field.nsInput = input;
  return field;
}

export function selectField(label, value, options, onChange, opts = {}) {
  const id = uniqueId();
  const select = el('select', { id, class: 'form-select' });
  for (const option of options) {
    const node = el('option', { value: option.value, disabled: option.disabled }, option.label);
    if (option.value === value) {
      node.selected = true;
    }
    select.appendChild(node);
  }
  select.addEventListener('change', () => onChange(select.value));
  return wrapField(id, label, select, opts);
}

export function checkboxField(label, checked, onChange, opts = {}) {
  const id = uniqueId();
  const input = el('input', { id, class: 'form-check-input', type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('div', { class: 'form-check ns-field ns-check', 'data-path': opts.path },
    input,
    el('label', { class: 'form-check-label', for: id }, label),
    opts.help ? helpText(opts.help) : null,
    el('div', { class: 'invalid-feedback' }),
  );
}

/** A labelled row of radio buttons; options are { value, label }. */
export function radioField(label, value, options, onChange, opts = {}) {
  const name = uniqueId('r');
  const row = el('div', { class: 'ns-radios' });
  for (const option of options) {
    const id = uniqueId();
    const input = el('input', { id, class: 'form-check-input', type: 'radio', name, value: option.value });
    input.checked = option.value === value;
    input.addEventListener('change', () => {
      if (input.checked) {
        onChange(option.value);
      }
    });
    row.appendChild(el('div', { class: 'form-check form-check-inline' }, input, el('label', { class: 'form-check-label', for: id }, option.label)));
  }
  return el('div', { class: 'ns-field', 'data-path': opts.path },
    el('div', { class: 'form-label' }, label),
    row,
    opts.help ? helpText(opts.help) : null,
    el('div', { class: 'invalid-feedback' }),
  );
}

export function button(label, onClick, cls = 'btn btn-outline-secondary btn-sm') {
  const node = el('button', { type: 'button', class: cls }, label);
  node.addEventListener('click', onClick);
  return node;
}

/** A text button in the link colour: the account card links, Cancel, Duplicate trigger, the Edit / Done toggle. */
export function linkButton(label, onClick, extra = '') {
  return button(label, onClick, `btn btn-link btn-sm p-0 ns-link-button${extra ? ` ${extra}` : ''}`);
}

/** A red text button: Remove only. */
export function dangerLinkButton(label, onClick, extra = '') {
  return linkButton(label, onClick, `text-danger${extra ? ` ${extra}` : ''}`);
}

/** The one primary button per section (Add trigger) and the Connect button in the connect panel. */
export function primaryButton(label, onClick, extra = '') {
  return button(label, onClick, `btn btn-primary ns-primary${extra ? ` ${extra}` : ''}`);
}

/** An outlined button in the link colour: Open Peloton sign-in and the promoted Sign in with browser. */
export function outlineLinkButton(label, onClick, extra = '') {
  return button(label, onClick, `btn btn-outline-primary ns-outline${extra ? ` ${extra}` : ''}`);
}

/** A filled type badge, an outlined detail badge, or the warning badge. */
export function badge(text, kind = 'filled') {
  return el('span', { class: `ns-badge ns-badge-${kind}` }, text);
}

/** The account status pill: connected, reconnect_needed, not_connected, or checking (outlined with a spinner). */
export function pill(state, text) {
  const node = el('span', { class: `ns-pill ns-pill-${state}` });
  if (state === 'checking') {
    node.appendChild(el('span', { class: 'ns-spinner', 'aria-hidden': 'true' }));
  }
  node.appendChild(document.createTextNode(text));
  return node;
}

/**
 * In-place confirmation: clicking start replaces it with the question, a confirm button and a text
 * Cancel. Escape or Cancel restores the original button.
 */
export function inlineConfirm(opts) {
  const control = el('span', { class: `ns-inline-confirm${opts.cls ? ` ${opts.cls}` : ''}` });
  let onKey = () => undefined;
  const reset = () => {
    document.removeEventListener('keydown', onKey);
    clear(control);
    control.appendChild(opts.start);
  };
  onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      reset();
    }
  };
  opts.start.addEventListener('click', () => {
    clear(control);
    control.appendChild(el('span', { class: 'ns-confirm-question' }, opts.question()));
    const confirm = button(opts.confirmLabel, () => {
      reset();
      opts.onConfirm();
    }, opts.confirmClass);
    control.appendChild(confirm);
    control.appendChild(linkButton(opts.cancelLabel, reset));
    document.addEventListener('keydown', onKey);
    confirm.focus();
  });
  control.appendChild(opts.start);
  return control;
}

/** Initials for the avatar disc: the first letters of the first two words of the name, or of the username. */
export function initialsOf(displayName, username) {
  const source = (displayName ?? '').trim() || (username ?? '').trim();
  const words = source.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return '?';
  }
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('');
}

/** "just now", "5 min ago", "3 hours ago", "yesterday", "3 days ago", "2 weeks ago", "4 months ago". */
export function relativeTime(then, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.round(hours / 24);
  if (days === 1) {
    return 'yesterday';
  }
  if (days < 14) {
    return `${days} days ago`;
  }
  const weeks = Math.round(days / 7);
  if (weeks < 9) {
    return `${weeks} weeks ago`;
  }
  const months = Math.round(days / 30);
  if (months < 12) {
    return `${months} months ago`;
  }
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** Fires an input event as typing would, so a field's own handler runs. */
export function focusField(node) {
  const control = [...node.querySelectorAll('input, select, textarea, button')].find((candidate) => !candidate.disabled);
  control?.focus({ preventScroll: true });
  return control;
}
