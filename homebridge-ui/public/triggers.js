/**
 * The Triggers section (design/README.md, Triggers): Workout and Heart-rate zone cards on the shell card
 * anatomy with the collapsible header (the whole row toggles, a chevron at the right edge, a muted summary
 * of the key values while collapsed), the Add trigger button, and Duplicate and Remove.
 *
 * Heart-rate zone triggers are not offered in this release (SPEC section 2): Add trigger creates a Workout
 * card directly, with no chooser. A Heart-rate zone trigger already in config still renders, with the badge
 * "Not offered in this release", and can be opened, edited, duplicated and removed as before.
 */

import { TRIGGERS } from './copy.js';
import { headerBadge, helpToggle } from './card.js';
import {
  addButton, cardFooter, clear, dangerLinkButton, el, gridCell, helpText, inlineConfirm, linkButton, numberField, paragraph, selectField, textField,
} from './dom.js';
import { ACTIVITIES, DEVICES, defaultTriggerName, duplicateTrigger, newTrigger, triggerTitle } from './model.js';
import { badge, radioField } from './peloton-dom.js';

export function renderTriggers(app, container) {
  const ui = app.triggersUi;
  // The cards of this render, by trigger id: how focusField opens a collapsed card in place.
  ui.cards = new Map();
  container.appendChild(paragraph(TRIGGERS.intro));
  if (app.config.triggers.length === 0) {
    container.appendChild(el('p', { class: 'form-text ns-empty-line' }, TRIGGERS.empty));
  }
  app.config.triggers.forEach((trigger, index) => {
    container.appendChild(renderCard(app, trigger, index));
  });
  // With one trigger type offered there is no chooser: Add trigger creates a Workout card and focuses its Name.
  container.appendChild(el('div', { class: 'ns-add-trigger' }, addButton(TRIGGERS.add, () => {
    const trigger = newTrigger('workout');
    app.config.triggers.push(trigger);
    ui.expanded.add(trigger.id);
    app.addFresh(trigger);
    app.rerender('triggers');
    focusName(trigger);
  }, true)));
}

/** A newly added card focuses its Name field (shell rule T5); nothing scrolls, focus brings it into view. */
function focusName(trigger) {
  const card = document.querySelector(`[data-trigger="${trigger.id}"]`);
  card?.querySelector('[data-path$=".name"] input')?.focus();
}

/** The member a trigger names, as the header badge shows it: "Anyone" or the first name. */
function whoBadge(app, trigger) {
  if (trigger.type === 'workout' && (trigger.who === 'anyone' || trigger.who === '')) {
    return TRIGGERS.anyone;
  }
  const member = app.members().find((entry) => entry.userId === trigger.who);
  return member ? member.name.split(/\s+/)[0] : (trigger.who ? trigger.who : TRIGGERS.whoChoose);
}

function memberUnconnected(app, trigger) {
  if (trigger.type !== 'hrZone' || trigger.who.length === 0) {
    return false;
  }
  const member = app.members().find((entry) => entry.userId === trigger.who);
  return !member || !member.connected;
}

/** A number as the collapsed summary shows it: what the field holds, or nothing while the box is empty. */
function seconds(value) {
  return Number.isFinite(value) ? String(value) : '';
}

/**
 * The muted summary of the key values after the badges while a card is collapsed (design/HANDOFF.md, card
 * header): "Anyone · Any device · All activities · Keep on 90 s" for a Workout card, "Alex · Zone 4+ · Hold 20 s"
 * for a Heart-rate zone card.
 */
export function cardSummary(app, trigger) {
  const parts = [whoBadge(app, trigger)];
  if (trigger.type === 'workout') {
    const n = trigger.activities.length;
    parts.push(
      TRIGGERS.deviceOptions[trigger.device] ?? TRIGGERS.deviceOptions.any,
      n === ACTIVITIES.length ? TRIGGERS.allActivities : TRIGGERS.activitiesOf(n, ACTIVITIES.length),
      TRIGGERS.keepOn(seconds(trigger.holdAfterEnd)),
    );
  } else {
    parts.push(TRIGGERS.zoneBadge(trigger.zone), TRIGGERS.hold(seconds(trigger.holdTime)));
  }
  return parts.join(TRIGGERS.summarySeparator);
}

/**
 * Whether a card opens expanded: the cards the user opened this visit, a card just added or duplicated, and
 * the only card on the page unless the user closed it. Cards loaded from config otherwise start collapsed.
 */
function isExpanded(app, trigger) {
  const ui = app.triggersUi;
  if (ui.expanded.has(trigger.id)) {
    return true;
  }
  return app.config.triggers.length === 1 && !ui.collapsed.has(trigger.id);
}

function renderCard(app, trigger, index) {
  const ui = app.triggersUi;
  const path = `triggers[${index}]`;
  const card = el('div', { class: 'card mb-3 ns-trigger-card', 'data-trigger': trigger.id, 'data-card': path });

  // Header (shell rule C1 with the collapsible additions): the bold name, the type badge (with the "Not offered"
  // badge on a Heart-rate zone card), the outlined detail badges, the warning badge, then the summary while
  // collapsed; at the right the help toggle (open only), "Show settings" or "Done", and the chevron. The whole
  // row toggles.
  const name = el('strong', { class: 'ns-card-name' });
  const badges = el('span', { class: 'ns-card-badges' });
  const summary = el('span', { class: 'small ns-secondary ns-card-summary', hidden: true });
  const warningStrip = el('div', { class: 'ns-warning-strip', hidden: true }, TRIGGERS.notConnectedStrip);
  let expanded = isExpanded(app, trigger);
  const refreshHeader = () => {
    name.textContent = triggerTitle(trigger, TRIGGERS.newTrigger);
    clear(badges);
    badges.appendChild(headerBadge(TRIGGERS.typeBadge[trigger.type], 'type'));
    if (trigger.type === 'hrZone') {
      badges.appendChild(badge(TRIGGERS.notOffered, 'warning'));
    }
    badges.appendChild(badge(whoBadge(app, trigger), 'outline'));
    if (trigger.type === 'hrZone') {
      badges.appendChild(badge(TRIGGERS.zoneBadge(trigger.zone), 'outline'));
    }
    badges.appendChild(badge(TRIGGERS.accessoryBadge[trigger.accessory], 'outline'));
    const warn = memberUnconnected(app, trigger);
    if (warn) {
      badges.appendChild(badge(TRIGGERS.notConnectedBadge, 'warning'));
    }
    warningStrip.hidden = !warn;
    summary.textContent = expanded ? '' : cardSummary(app, trigger);
    summary.hidden = expanded;
  };

  const help = helpToggle(card, trigger);
  const collapse = linkButton('', () => setExpanded(!expanded), 'ns-collapse-toggle');
  const chevron = el('span', { class: 'ns-chevron', 'aria-hidden': 'true' });
  const header = el('div', { class: 'card-header ns-card-header ns-card-toggle', role: 'button', tabindex: '0' },
    el('span', { class: 'ns-card-title' }, name, badges, summary),
    el('span', { class: 'ns-card-actions' }, help, collapse, chevron),
  );
  header.addEventListener('click', (event) => {
    // The help toggle and the Show settings / Done link handle their own clicks; anywhere else on the row toggles.
    if (event.target instanceof HTMLElement && event.target.closest('button')) {
      return;
    }
    setExpanded(!expanded);
  });
  header.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === header) {
      event.preventDefault();
      setExpanded(!expanded);
    }
  });
  card.appendChild(header);
  card.appendChild(warningStrip);

  const body = el('div', { class: 'card-body' });
  const grid = el('div', { class: 'ns-grid' });
  const change = () => {
    refreshHeader();
    app.changed();
  };

  // The Name starts prefilled (model.js newTrigger); a zone trigger's name follows the zone until it is edited here.
  const nameField = textField(TRIGGERS.name, trigger.name, (value) => {
    trigger.name = value;
    trigger.nameFollowsZone = false;
    change();
  }, { path: `${path}.name`, required: true, help: TRIGGERS.nameHelp });
  // The shell grid places nothing by default: every field sits in a cell, full rows in a 12-column one (shell rule C2).
  grid.appendChild(gridCell(12, nameField));

  grid.appendChild(gridCell(12, radioField(TRIGGERS.accessory, trigger.accessory, [
    { value: 'occupancy', label: TRIGGERS.accessoryOptions.occupancy },
    { value: 'switch', label: TRIGGERS.accessoryOptions.switch },
  ], (value) => {
    trigger.accessory = value;
    change();
  }, { path: `${path}.accessory`, help: TRIGGERS.accessoryHelp[trigger.type] })));

  const members = app.members();
  const whoOptions = [];
  if (trigger.type === 'workout') {
    whoOptions.push({ value: 'anyone', label: TRIGGERS.whoAnyone });
  } else if (trigger.who.length === 0) {
    whoOptions.push({ value: '', label: TRIGGERS.whoChoose, disabled: true });
  }
  for (const member of members) {
    if (member.connected || member.userId === trigger.who) {
      whoOptions.push({ value: member.userId, label: member.name });
    }
  }
  if (trigger.who.length > 0 && trigger.who !== 'anyone' && !whoOptions.some((option) => option.value === trigger.who)) {
    whoOptions.push({ value: trigger.who, label: trigger.who });
  }
  grid.appendChild(gridCell(6, selectField(TRIGGERS.who, trigger.who, whoOptions, (value) => {
    trigger.who = value;
    change();
  }, { path: `${path}.who`, help: trigger.type === 'hrZone' ? TRIGGERS.whoHelp : undefined })));

  if (trigger.type === 'workout') {
    grid.appendChild(gridCell(6, selectField(TRIGGERS.device, trigger.device, DEVICES.map((device) => ({
      value: device, label: TRIGGERS.deviceOptions[device],
    })), (value) => {
      trigger.device = value;
      change();
    }, { path: `${path}.device`, help: TRIGGERS.deviceHelp })));
    grid.appendChild(gridCell(12, renderChips(trigger, change, path)));
    grid.appendChild(gridCell(6, numberField(TRIGGERS.holdAfterEnd, trigger.holdAfterEnd, (value) => {
      trigger.holdAfterEnd = value;
      change();
    }, { path: `${path}.holdAfterEnd`, min: 0, help: TRIGGERS.holdAfterEndHelp })));
  } else {
    grid.appendChild(gridCell(3, selectField(TRIGGERS.zone, String(trigger.zone), [1, 2, 3, 4, 5].map((zone) => ({
      value: String(zone), label: String(zone),
    })), (value) => {
      trigger.zone = Number(value);
      if (trigger.nameFollowsZone) {
        trigger.name = defaultTriggerName('hrZone', trigger.zone);
        const input = nameField.querySelector('input');
        if (input) {
          input.value = trigger.name;
        }
      }
      change();
    }, { path: `${path}.zone` })));
    grid.appendChild(gridCell(3, numberField(TRIGGERS.holdTime, trigger.holdTime, (value) => {
      trigger.holdTime = value;
      change();
    }, { path: `${path}.holdTime`, min: 0, help: TRIGGERS.holdTimeHelp })));
    grid.appendChild(gridCell(12, el('div', { class: 'form-text ns-note', style: 'margin-top:0' }, TRIGGERS.hrNote)));
  }
  body.appendChild(grid);
  card.appendChild(body);

  // Footer (shell rule C4): Remove, confirmed in place, then Duplicate; no primary action (a Peloton exception, SPEC section 10).
  const remove = dangerLinkButton(TRIGGERS.remove, () => undefined);
  const footer = cardFooter([
    inlineConfirm({
      start: remove,
      question: () => TRIGGERS.removeQuestion(triggerTitle(trigger, TRIGGERS.newTrigger)),
      confirmLabel: TRIGGERS.removeConfirm,
      confirmClass: 'btn btn-danger btn-sm',
      cancelLabel: TRIGGERS.cancel,
      cls: 'ns-remove-confirm',
      onConfirm: () => {
        const at = app.config.triggers.indexOf(trigger);
        if (at >= 0) {
          app.config.triggers.splice(at, 1);
          app.entryRemoved('triggers', at);
        }
        ui.expanded.delete(trigger.id);
        ui.collapsed.delete(trigger.id);
        app.rerender('triggers');
      },
    }),
    linkButton(TRIGGERS.duplicate, () => {
      const copy = duplicateTrigger(trigger, app.config.triggers.map((entry) => entry.name), TRIGGERS.copySuffix);
      const at = app.config.triggers.indexOf(trigger);
      app.config.triggers.splice(at + 1, 0, copy);
      ui.expanded.add(copy.id);
      app.rerender('triggers');
      focusName(copy);
    }),
  ], null);
  card.appendChild(footer);

  /**
   * Opens or closes the card in place: the body and footer show or hide, the header follows; nothing is rebuilt.
   * A toggle after the render asks the host to size the iframe again; the render itself asks once, at its end.
   */
  function setExpanded(open, rendered = true) {
    const toggled = rendered && open !== expanded;
    expanded = open;
    if (open) {
      ui.expanded.add(trigger.id);
      ui.collapsed.delete(trigger.id);
    } else {
      ui.expanded.delete(trigger.id);
      ui.collapsed.add(trigger.id);
    }
    body.hidden = !open;
    footer.hidden = !open;
    help.hidden = !open;
    collapse.textContent = open ? TRIGGERS.done : TRIGGERS.showSettings;
    header.setAttribute('aria-expanded', open ? 'true' : 'false');
    card.classList.toggle('ns-collapsed', !open);
    refreshHeader();
    if (toggled) {
      app.resized();
    }
  }
  setExpanded(expanded, false);
  ui.cards.set(trigger.id, { setExpanded });
  app.watchCard(card, trigger);
  return card;
}

/** The Activities chips with Select all / none and the "All activities" or "n of 12 selected" summary. */
function renderChips(trigger, change, path) {
  const summary = el('span', { class: 'ns-chips-summary' });
  const chips = el('div', { class: 'ns-chips' });
  const refresh = () => {
    const n = trigger.activities.length;
    summary.textContent = n === ACTIVITIES.length ? TRIGGERS.allActivities : TRIGGERS.activitiesSelected(n, ACTIVITIES.length);
    for (const chip of chips.children) {
      chip.setAttribute('aria-pressed', trigger.activities.includes(chip.dataset.activity) ? 'true' : 'false');
    }
  };
  for (const activity of ACTIVITIES) {
    const chip = el('button', { type: 'button', class: 'ns-chip', 'data-activity': activity }, TRIGGERS.activityLabels[activity]);
    chip.addEventListener('click', () => {
      if (trigger.activities.includes(activity)) {
        trigger.activities = trigger.activities.filter((entry) => entry !== activity);
      } else {
        trigger.activities = ACTIVITIES.filter((entry) => entry === activity || trigger.activities.includes(entry));
      }
      refresh();
      change();
    });
    chips.appendChild(chip);
  }
  refresh();
  return el('div', { class: 'mb-3 ns-chips-field', 'data-path': `${path}.activities` },
    el('div', { class: 'ns-chips-head' },
      el('span', { class: 'form-label', style: 'margin-bottom:0' }, TRIGGERS.activities, ' ', summary),
      el('span', { class: 'ns-chips-links' },
        linkButton(TRIGGERS.selectAll, () => {
          trigger.activities = [...ACTIVITIES];
          refresh();
          change();
        }),
        el('span', { class: 'ns-secondary' }, '/'),
        linkButton(TRIGGERS.selectNone, () => {
          trigger.activities = [];
          refresh();
          change();
        }),
      ),
    ),
    chips,
    helpText(''),
  );
}
