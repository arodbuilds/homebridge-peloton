/**
 * The DOM helpers only the Peloton page needs, on the shell's field and button anatomy (dom.js): the time
 * and radio fields, the outlined and warning badges, the account status pill, the 38px outlined button of
 * the browser sign-in, the avatar initials, relative times, and the footer mark. Each maps to a shell
 * candidate in design/peloton-alignment-inventory.md; none of it is in the shell yet.
 */

import { el, helpText, uniqueId } from './dom.js';

/** The shell's field wrapper (dom.js wrapField, which it does not export): label, control, help, feedback slot. */
function fieldWrap(id, label, control, opts) {
  const star = opts.required ? el('span', { class: 'text-danger ms-1', 'aria-hidden': 'true' }, '*') : null;
  return el('div', { class: 'mb-3', 'data-path': opts.path },
    el('label', { class: 'form-label', for: id }, label, star),
    control,
    opts.help ? helpText(opts.help) : null,
    el('div', { class: 'invalid-feedback' }),
  );
}

/** A time input for HH:MM. */
export function timeField(label, value, onChange, opts = {}) {
  const id = uniqueId();
  const input = el('input', { id, class: 'form-control', type: 'time', step: '60' });
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  return fieldWrap(id, label, input, opts);
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
  return el('div', { class: 'mb-3', 'data-path': opts.path },
    el('div', { class: 'form-label' }, label),
    row,
    opts.help ? helpText(opts.help) : null,
    el('div', { class: 'invalid-feedback' }),
  );
}

/** An outlined detail badge (who, zone, accessory kind) or the warning badge, on the shell badge geometry. */
export function badge(text, kind = 'outline') {
  return el('span', { class: `badge ns-badge-${kind}` }, text);
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

/** A 38px outlined button in the link colour: Open Peloton sign-in and the promoted Sign in with browser. */
export function outlineLinkButton(label, onClick, extra = '') {
  const node = el('button', { type: 'button', class: `btn btn-outline-primary ns-outline${extra ? ` ${extra}` : ''}` }, label);
  node.addEventListener('click', onClick);
  return node;
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

/** The footer glyph (assets/peloton-footer.svg) inlined at 20px so it follows the host theme through currentColor. */
export function pelotonMark() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ns-mark-svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('aria-hidden', 'true');
  const shapes = [
    ['rect', { x: '3', y: '7', width: '4', height: '10' }],
    ['rect', { x: '17', y: '7', width: '4', height: '10' }],
    ['path', { d: 'M7 12H17', 'stroke-width': '2' }],
    ['rect', { x: '8', y: '10', width: '4', height: '4', fill: 'currentColor', stroke: 'none' }],
  ];
  for (const [tag, attrs] of shapes) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, value);
    }
    svg.appendChild(node);
  }
  return svg;
}
