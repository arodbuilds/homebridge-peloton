# homebridge-peloton settings page: round two prompts

Hand these to Claude Design in order. They correct the first pass, which drifted to a momentary-switch model. The accessory model is decided: a trigger is a sensor that is ON for the whole time its condition is true and OFF when it stops. Nothing "fires and turns itself off." Keep the header banner, the unsaved-changes bar, the section header style, the Restore from backup field, the closing "after saving" paragraph, and the footer line from the current page; those align with Notify Switch and stay.

Global: no em dashes anywhere (the banner has one). Use "sensor" for trigger accessories and "switch" only for the Fast polling switch.

---

## Prompt A: Banner and intro copy

Keep the banner layout and the dumbbell mark. Replace the tagline with:
"HomeKit sensors driven by Peloton workouts: workout in progress and heart-rate zones."

Remove "new PRs"; it is not in scope.

Intro paragraph two, replace with:
"Set up in two steps: connect your Peloton account, then add a trigger for what you want to automate. Save, restart Homebridge, and use the sensor in a HomeKit automation."

Keep paragraph one and the not-affiliated line as they are.

---

## Prompt B: Triggers section, rebuild the card

Replace the Triggers intro line with:
"Each trigger is a sensor in the Home app. It turns on while its condition is true and off when it stops, so one sensor gives you both a start and an end automation."

Remove from the card: Turn on when, Cooldown, Stay on for the whole workout, ID, Account, Test trigger. Rename the footer links to Remove trigger and Duplicate trigger.

The card has a type, chosen when adding and shown as a badge in the card header. Two types:

Workout
- Name (required). Default "Workout". Caption: "Shown in the Home app. Letters, numbers, spaces and apostrophes."
- Show in HomeKit as (radio): Occupancy sensor (default) / Switch. Caption: "Occupancy sensor is on while the workout is in progress. Switch behaves the same but appears as a toggle."
- Who (select): Anyone on this membership (default) / each connected member by name.
- Activities (multi-select chips, default all, with Select all / none): Cycling, Running, Walking, Rowing, Strength, Yoga, Stretching, Meditation, Cardio, Bike bootcamp, Tread bootcamp, Row bootcamp.
- Device (select): Any device (default) / Blue Door+ / Tread. Caption: "Devices come from the membership."
- Keep on after the workout ends (number, seconds). Default 90. Caption: "Holds the sensor on briefly so stacked classes do not turn your scene off between them."

Heart-rate zone
- Name (required). Default "Zone 4 or higher".
- Show in HomeKit as: Occupancy sensor / Switch.
- Who (select): connected members only, no Anyone option. Caption: "Zones come from this member's Peloton profile."
- Zone at or above (select 1 to 5). Default 4.
- Hold time (number, seconds). Default 20. Caption: "The zone must hold this long before the sensor changes, so lights do not flicker on a sprint."
- Muted note: "Needs a heart-rate monitor paired to the workout. Without one the sensor stays off."

Add trigger opens a two-option chooser: "Workout: on while a workout is in progress" and "Heart-rate zone: on while heart rate is at or above a zone."

Show: Workout card expanded with all fields, Heart-rate zone card expanded, one collapsed card of each showing header badges (type, who, accessory kind), and the chooser.

---

## Prompt C: Add the Polling section

Insert a Polling section between Triggers and Settings.

Block 1, Fast polling switch (checkbox, on by default): "Create a Fast polling switch in HomeKit"
- Name field, default "Peloton fast polling".
- Text: "Turn this switch on from a HomeKit automation right before a workout, for example when the gym light comes on. While it is on, the plugin checks every account quickly, locks onto the first workout it sees, and follows it to the end. Turn it off when the light goes off."
- Caption: "Turns itself off automatically after the period set under Advanced."

Block 2, Intervals (seconds), two fields side by side:
- Fast, default 10. Caption: "While the switch is on or a workout is in progress."
- Standby, default 120. Caption: "When the switch is off. Set to 0 to stop polling entirely until the switch turns on."
- Muted live estimate under them: "About 30 requests per hour in standby with 1 account."

Block 3, dismissible callout in the Notify Switch callout style:
- Title: "Works best with an automation"
- Body: "Add a Home automation that turns on the Peloton fast polling switch when you start your workout routine, and off when you finish. Without it, the plugin still works, just at the standby interval."
- Link: "Read how to set this up"

---

## Prompt D: Settings section, fix the content

Replace the section intro with: "Options that apply to the whole plugin."

Remove Default account and Show master switch.

Keep:
- Name (required), default "Peloton". Caption: "Shown in Homebridge logs and as the bridge name in the Home app."
- Debug logging (checkbox, off). Caption: "Log every poll and the workout data it returns. Sign-in details and session tokens are never logged."

Advanced (collapsed), in this order:
- Fast polling switch turns off after (number, minutes). Default 120. Caption: "Counted from the later of the switch turning on and the last workout ending."
- Attention needed sensor (checkbox, off). "Create an occupancy sensor that turns on when any account needs to be reconnected." Caption: "Use it in an automation to get a notification."
- Daily check-in time (time, default 03:00). Caption: "Once a day the plugin refreshes each account's session and heart-rate zones, even when nobody is working out."
- Restore from backup (keep as is).

---

## Prompt E: Accounts section, small clarifications

The Accounts section is right. Three clarifications:
1. The Owner card should also show a Reconnect link when in Reconnect needed state, same as members.
2. Add the connect panel states from the earlier prompt set (email and password, Sign in with browser fallback with the Back-button instruction and pasted callback address, and the four error messages). Show the panel expanded under Jordan's card.
3. Devices line: keep, and add "(names come from your membership)" as a muted suffix.

---

## Prompt F: Validation states

Show one page with these visible:
- Trigger with an empty name: "Give this trigger a name. It is what you will see in the Home app."
- Two triggers with the same name: "Another trigger already uses this name."
- Heart-rate zone trigger whose member is Not connected: warning badge on the card header, "This member has not connected yet. The sensor stays off until they do."
- Fast interval below 5: "Fast polling cannot go below 5 seconds."
- Standby between 1 and 29: "Use 0 to stop polling, or 30 seconds or more."
- Fast polling switch unchecked and standby 0: blocking error at the Polling section: "With no fast polling switch and standby at 0 the plugin would never poll. Turn one of them back on."
- Save with an account in Reconnect needed: non-blocking banner under the unsaved-changes bar: "1 account needs to be reconnected. Everything else is saved."

---

## Decisions that must not change

- Triggers are stateful sensors (occupancy by default, switch optional). No momentary behavior, no cooldown, no "stay on" checkbox.
- No default account and no master switch.
- Fast polling switch on by default; auto-off default 120 minutes from the later of switch-on and last workout end.
- Intervals fast 10 (floor 5) and standby 120 (0 allowed).
- Lock-on to the first account with a workout in progress.
- Keep on after workout ends: 90 seconds. Heart-rate zone hold: 20 seconds.
- Attention needed sensor off by default, under Advanced.
