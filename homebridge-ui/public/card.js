/**
 * Pieces shared by the cards: the "Show help" toggle and the header strip.
 *
 * Shell file: the card pieces of homebridge-notify-switch v1.3.2 homebridge-ui/src/card.ts (helpExpanded,
 * helpToggle, cardHeader, headerBadge) with the types removed. The ID field, the Variables toggle and
 * the QR block that only Notify Switch uses are left out.
 */

import { HELP_TOGGLE } from './shell-copy.js';
import { el, linkButton } from './dom.js';

/** Remembered for the session only, per provider, group or switch object; nothing is written anywhere. */
const helpChoice = new WeakMap();

/** Help text is expanded on wide screens and collapsed below 600px unless the user chose otherwise this session. */
export function helpExpanded(item) {
  const remembered = helpChoice.get(item);
  if (remembered !== undefined) {
    return remembered;
  }
  return window.innerWidth >= 600;
}

/**
 * The per-card "Show help" / "Hide help" text button. It toggles `ns-help-hidden` on the card, which hides
 * every `.ns-help` line inside it (field help only; status lines, counters and errors stay visible).
 */
export function helpToggle(card, item) {
  const toggle = linkButton(HELP_TOGGLE.show, () => undefined, 'ns-help-toggle ns-secondary');
  const apply = (expanded) => {
    card.classList.toggle('ns-help-hidden', !expanded);
    toggle.textContent = expanded ? HELP_TOGGLE.hide : HELP_TOGGLE.show;
    toggle.setAttribute('aria-pressed', expanded ? 'true' : 'false');
  };
  toggle.addEventListener('click', () => {
    const next = !helpExpanded(item);
    helpChoice.set(item, next);
    apply(next);
  });
  apply(helpExpanded(item));
  return toggle;
}

/**
 * The header strip shared by every card (SPEC section 11.2, item 28). Left cluster: the bold title (weight 700), the type badge and
 * the status badges (`badges`, filled later by the card); right cluster: the card's header links (`actions`, such as
 * "Make default for {channel}") and then the "Show help" / "Hide help" toggle. Every string is inserted as text.
 */
export function cardHeader(card, item, title, badges, actions) {
  return el('div', { class: 'card-header ns-card-header' },
    el('span', { class: 'ns-card-title' }, title, ...badges),
    el('span', { class: 'ns-card-actions' }, ...actions, helpToggle(card, item)),
  );
}

/** A type badge (secondary fill) or a status badge (success fill, "Default for {channel}") for a card header. */
export function headerBadge(text, kind, extra = '') {
  const fill = kind === 'status' ? 'text-bg-success ns-status-badge' : 'text-bg-secondary ns-type-badge';
  return el('span', { class: `badge ${fill}${extra ? ` ${extra}` : ''}` }, text);
}
