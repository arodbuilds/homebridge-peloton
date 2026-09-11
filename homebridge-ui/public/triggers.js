/**
 * The Triggers section (design/README.md, Triggers): Workout and Heart-rate zone cards with the
 * header badges, collapsed and expanded states, the Add trigger chooser, and Duplicate and Remove.
 */

import { TRIGGERS } from './copy.js';
import {
  badge, clear, dangerLinkButton, el, focusField, helpText, inlineConfirm, linkButton, numberField, primaryButton, radioField, selectField, textField,
} from './dom.js';
import { ACTIVITIES, DEVICES, duplicateTrigger, newTrigger, triggerTitle } from './model.js';

export function renderTriggers(app, container) {
  const ui = app.triggersUi;
  container.appendChild(el('p', { class: 'ns-section-copy' }, TRIGGERS.intro));
  if (app.config.triggers.length === 0 && !ui.chooserOpen) {
    container.appendChild(el('p', { class: 'ns-empty-line' }, TRIGGERS.empty));
  }
  app.config.triggers.forEach((trigger, index) => {
    container.appendChild(renderCard(app, trigger, index));
  });
  if (ui.chooserOpen) {
    container.appendChild(renderChooser(app));
  } else {
    container.appendChild(el('div', { class: 'ns-add-row' }, primaryButton(TRIGGERS.add, () => {
      ui.chooserOpen = true;
      app.rerender('triggers');
    })));
  }
}

function renderChooser(app) {
  const ui = app.triggersUi;
  const tiles = el('div', { class: 'ns-chooser-tiles' });
  for (const tile of TRIGGERS.tiles) {
    const node = el('button', { type: 'button', class: 'ns-chooser-tile' },
      el('div', { class: 'ns-tile-name' }, tile.name),
      el('div', { class: 'form-text', style: 'margin-top:0' }, tile.description),
    );
    node.addEventListener('click', () => {
      const connected = app.members().filter((member) => member.connected);
      const trigger = newTrigger(tile.type, connected[0]?.userId);
      app.config.triggers.push(trigger);
      ui.expanded.add(trigger.id);
      ui.chooserOpen = false;
      app.addFresh(trigger);
      app.rerender('triggers');
      const card = document.querySelector(`[data-trigger="${trigger.id}"]`);
      if (card) {
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        focusField(card.querySelector('[data-path$=".name"]') ?? card);
      }
    });
    tiles.appendChild(node);
  }
  return el('div', { class: 'ns-chooser' },
    el('div', { class: 'ns-chooser-prompt' }, TRIGGERS.chooserPrompt),
    tiles,
    el('div', { class: 'ns-chooser-cancel' }, linkButton(TRIGGERS.cancel, () => {
      ui.chooserOpen = false;
      app.rerender('triggers');
    }, 'ns-secondary')),
  );
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

function renderCard(app, trigger, index) {
  const ui = app.triggersUi;
  const path = `triggers[${index}]`;
  const expanded = ui.expanded.has(trigger.id);
  const card = el('div', {
    class: `ns-card ns-trigger-card${ui.helpHidden.has(trigger.id) ? ' ns-help-hidden' : ''}`, 'data-trigger': trigger.id, 'data-card': path,
  });

  const title = el('span', { class: 'ns-card-title' });
  const badges = el('span', { class: 'ns-card-badges', style: 'display:contents' });
  const warningStrip = el('div', { class: 'ns-warning-strip', hidden: true }, TRIGGERS.notConnectedStrip);
  const refreshHeader = () => {
    title.textContent = triggerTitle(trigger, TRIGGERS.newTrigger);
    clear(badges);
    badges.appendChild(badge(TRIGGERS.typeBadge[trigger.type], 'filled'));
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
  };
  refreshHeader();

  const helpToggle = linkButton(ui.helpHidden.has(trigger.id) ? TRIGGERS.showHelp : TRIGGERS.hideHelp, () => {
    if (ui.helpHidden.has(trigger.id)) {
      ui.helpHidden.delete(trigger.id);
    } else {
      ui.helpHidden.add(trigger.id);
    }
    card.classList.toggle('ns-help-hidden', ui.helpHidden.has(trigger.id));
    helpToggle.textContent = ui.helpHidden.has(trigger.id) ? TRIGGERS.showHelp : TRIGGERS.hideHelp;
  }, 'ns-help-toggle ns-secondary');
  const collapseToggle = linkButton(expanded ? TRIGGERS.done : TRIGGERS.edit, () => {
    if (ui.expanded.has(trigger.id)) {
      ui.expanded.delete(trigger.id);
    } else {
      ui.expanded.add(trigger.id);
    }
    app.rerender('triggers');
  }, 'ns-collapse-toggle');
  card.appendChild(el('div', { class: 'ns-card-header' }, title, badges, el('span', { class: 'ns-header-right' }, helpToggle, collapseToggle)));
  card.appendChild(warningStrip);
  if (!expanded) {
    return card;
  }

  const body = el('div', { class: 'ns-card-body' });
  const grid = el('div', { class: 'ns-grid' });
  const change = () => {
    refreshHeader();
    app.changed();
  };

  grid.appendChild(textField(TRIGGERS.name, trigger.name, (value) => {
    trigger.name = value;
    change();
  }, { path: `${path}.name`, required: true, help: TRIGGERS.nameHelp, placeholder: TRIGGERS.namePlaceholder[trigger.type] }));

  grid.appendChild(radioField(TRIGGERS.accessory, trigger.accessory, [
    { value: 'occupancy', label: TRIGGERS.accessoryOptions.occupancy },
    { value: 'switch', label: TRIGGERS.accessoryOptions.switch },
  ], (value) => {
    trigger.accessory = value;
    change();
  }, { path: `${path}.accessory`, help: TRIGGERS.accessoryHelp[trigger.type] }));

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
  grid.appendChild(el('div', { class: 'ns-span-6' }, selectField(TRIGGERS.who, trigger.who, whoOptions, (value) => {
    trigger.who = value;
    change();
  }, { path: `${path}.who`, help: trigger.type === 'hrZone' ? TRIGGERS.whoHelp : undefined })));

  if (trigger.type === 'workout') {
    grid.appendChild(el('div', { class: 'ns-span-6' }, selectField(TRIGGERS.device, trigger.device, DEVICES.map((device) => ({
      value: device, label: TRIGGERS.deviceOptions[device],
    })), (value) => {
      trigger.device = value;
      change();
    }, { path: `${path}.device`, help: TRIGGERS.deviceHelp })));
    grid.appendChild(renderChips(trigger, change, path));
    grid.appendChild(el('div', { class: 'ns-span-6' }, numberField(TRIGGERS.holdAfterEnd, trigger.holdAfterEnd, (value) => {
      trigger.holdAfterEnd = value;
      change();
    }, { path: `${path}.holdAfterEnd`, min: 0, help: TRIGGERS.holdAfterEndHelp })));
  } else {
    grid.appendChild(el('div', { class: 'ns-span-3' }, selectField(TRIGGERS.zone, String(trigger.zone), [1, 2, 3, 4, 5].map((zone) => ({
      value: String(zone), label: String(zone),
    })), (value) => {
      trigger.zone = Number(value);
      change();
    }, { path: `${path}.zone` })));
    grid.appendChild(el('div', { class: 'ns-span-3' }, numberField(TRIGGERS.holdTime, trigger.holdTime, (value) => {
      trigger.holdTime = value;
      change();
    }, { path: `${path}.holdTime`, min: 0, help: TRIGGERS.holdTimeHelp })));
    grid.appendChild(el('div', { class: 'form-text ns-note', style: 'margin-top:0' }, TRIGGERS.hrNote));
  }
  body.appendChild(grid);
  card.appendChild(body);

  const remove = dangerLinkButton(TRIGGERS.remove, () => undefined);
  const footer = el('div', { class: 'ns-card-footer' },
    el('div', { class: 'ns-footer-right' }),
    el('div', { class: 'ns-footer-left' },
      inlineConfirm({
        start: remove,
        question: () => TRIGGERS.removeQuestion(triggerTitle(trigger, TRIGGERS.newTrigger)),
        confirmLabel: TRIGGERS.removeConfirm,
        confirmClass: 'btn btn-danger btn-sm ns-small',
        cancelLabel: TRIGGERS.cancel,
        onConfirm: () => {
          const at = app.config.triggers.indexOf(trigger);
          if (at >= 0) {
            app.config.triggers.splice(at, 1);
            app.entryRemoved('triggers', at);
          }
          ui.expanded.delete(trigger.id);
          app.rerender('triggers');
        },
      }),
      linkButton(TRIGGERS.duplicate, () => {
        const copy = duplicateTrigger(trigger, app.config.triggers.map((entry) => entry.name), TRIGGERS.copySuffix);
        const at = app.config.triggers.indexOf(trigger);
        app.config.triggers.splice(at + 1, 0, copy);
        ui.expanded.add(copy.id);
        app.rerender('triggers');
      }),
    ),
  );
  card.appendChild(footer);
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
  return el('div', { class: 'ns-field ns-chips-field', 'data-path': `${path}.activities` },
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
