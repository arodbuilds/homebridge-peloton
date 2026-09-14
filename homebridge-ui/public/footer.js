/**
 * Version and credit footer (SPEC section 11.2, item 20): the last element on the page, one line of
 * secondary text. The plugin name is preceded by the brand mark at 20px, drawn in the text colour. Both
 * links open in a new tab; the site link carries a `ref` parameter and nothing else is tracked.
 *
 * Shell file: homebridge-notify-switch v1.3.2 homebridge-ui/src/footer.ts with the types removed. Two things
 * differ by design: the mark is passed in (each plugin supplies its own, S5), and the version arrives with the
 * page's /status answer (SPEC section 10) instead of a /version request of its own, so `renderFooter` takes it.
 */

import { FOOTER } from './copy.js';
import { el } from './dom.js';

function outLink(text, href) {
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
}

function item(...children) {
  return el('span', { class: 'ns-footer-item' }, ...children);
}

/** Renders the footer with the version the UI server reported; without one the plugin name stands alone. */
export function renderFooter(mark, version) {
  const label = document.createTextNode(typeof version === 'string' && version.length > 0 ? `${FOOTER.name} v${version}` : FOOTER.name);
  const versionItem = item(el('span', { class: 'ns-mark-label' }, mark, label));
  const separator = () => ' · ';
  return el('footer', { class: 'ns-footer form-text' },
    versionItem, separator(),
    item(FOOTER.madeBy), separator(),
    item(outLink(FOOTER.site, FOOTER.siteUrl)), separator(),
    item(outLink(FOOTER.issues, FOOTER.issuesUrl)),
  );
}
