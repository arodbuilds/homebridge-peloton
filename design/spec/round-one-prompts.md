# homebridge-peloton: settings page content prompts for Claude Design

Use these in order. Each prompt assumes the notify-switch frame (tokens, card anatomy, section headers, link buttons, both themes) is already loaded. The prompts supply content and states only. Where a value is marked "decided", it is final; do not let the design invent alternatives.

Global copy rules for every prompt: no em dashes, sentence case, "clarifications" not "corrections", "I am unable to" not "I cannot". The plugin is not affiliated with Peloton; never use the Peloton logo, wheel, or brand red.

---

## Prompt 1: Page frame and header

Build the settings page for a Homebridge plugin called homebridge-peloton, display name "Peloton for Homebridge". Reuse the notify-switch page frame exactly: same header block, same section order pattern, same Save bar.

Header content:
- Title: Peloton for Homebridge
- One-line description: Turns Peloton workouts into HomeKit sensors so automations can run when a workout starts, ends, or reaches a heart-rate zone.
- Small muted line under it: Not affiliated with or endorsed by Peloton Interactive. Uses Peloton's undocumented member API, which can change without notice.

Sections, in this order, each a collapsible group in the notify-switch style:
1. Accounts
2. Triggers
3. Polling
4. Advanced

Show the page in its steady state: one owner account connected, three household profiles listed, two triggers, polling at defaults. Both themes.

---

## Prompt 2: Accounts section, steady state

Design the Accounts section as a list of account cards.

Each card shows:
- Avatar (circular, 40 px). Real photo when the profile has one; when the profile uses Peloton's default, render initials on a neutral disc instead of Peloton's placeholder image.
- Display name (bold) and @username (muted) on one line.
- Status pill, right-aligned. Four states, decided copy:
  - Connected: green pill "Connected", muted subline "Last checked 2 min ago"
  - Reconnect needed: red pill "Reconnect needed", subline "Sign-in expired. Reconnect to resume polling."
  - Not connected: grey pill "Not connected", subline "Ask this member to connect their profile."
  - Checking: spinner pill "Checking"
- Owner badge "Owner" next to the name on the primary account only.
- Muted metadata line: "Last workout 3 days ago" (from the household list, available before the member connects).
- Link buttons on the right, notify-switch style: Connect (Not connected), Reconnect (Reconnect needed), Test (Connected), Remove (all).

Above the list: a short intro line: "Sign in as the membership owner and every household profile appears here. Each member connects their own profile before it is polled."

Below the list: a single "Add account" link button for a profile that is not on the household list.

Below Accounts, a compact "Devices" row (not a card): "Devices on this membership: Blue Door+ (Bike+), Tread". Muted, read-only, sourced from the membership.

Show: four cards covering all four states, plus the Devices row. Both themes.

---

## Prompt 3: Connect flow (headless sign-in)

Design the inline connect panel that expands under an account card when Connect or Reconnect is clicked.

Fields:
- Email (prefilled for a household profile if known, editable)
- Password (masked, show/hide toggle)
- Primary button: Connect
- Secondary link: Sign in with browser instead

Result states inside the panel:
- Success: card status flips to Connected, panel collapses, brief inline confirmation "Connected as @username".
- Wrong credentials: "Peloton did not accept that email and password."
- Sign-in flow failed (Peloton changed something): "Peloton sign-in did not complete. You can connect using your browser instead." with the Sign in with browser link promoted to a button.
- Verification code required: "This account has extra verification turned on. Use Sign in with browser."

Note in a caption under Password: "Stored in your Homebridge config. The plugin keeps a session token so you rarely need to sign in again."

Show: empty panel, success, and the sign-in-failed state. Both themes.

---

## Prompt 4: Connect flow (browser fallback)

Design the "Sign in with browser" panel, replacing the headless panel in place.

Content, decided copy:
- Step 1 label: "Open Peloton sign-in" as a button that opens a new tab.
- Step 2 instruction text: "Sign in on the Peloton page. If you are already signed in, it will jump straight to your home page; that is fine."
- Step 3 instruction text: "Press your browser's Back button once. The address bar will show an address that starts with members.onepeloton.com/callback. Copy it."
- Muted help under step 3: "If Back does not show it, long-press the Back button and pick the callback entry, or search your browser history for callback."
- Text field, placeholder: https://members.onepeloton.com/callback?code=...
- Primary button: Connect
- Link: Use email and password instead

Error states under the field:
- "That does not look like the Peloton callback address. It should start with members.onepeloton.com/callback."
- "This link was from an earlier attempt. Click Open Peloton sign-in again and use the new one."
- "The sign-in link expired. Click Open Peloton sign-in and try again."

Show: empty state and one error. Both themes.

---

## Prompt 5: Triggers section

Design the Triggers section as a list of trigger cards, following the notify-switch switch-card anatomy (name in header, badges, Edit/Duplicate/Remove link buttons, collapsed and expanded states).

Two trigger types. The type is chosen when adding and shown as a badge on the card header.

Type A: Workout (decided default type)
Collapsed header: name, badge "Workout", badge for scope ("Anyone" or the member's name), badge for accessory kind.
Expanded fields:
- Name (text). Default "Workout". This is the accessory name in the Home app.
- Show in HomeKit as (radio): Occupancy sensor (default) / Switch. Caption: "Occupancy sensor is on while the workout is in progress. Switch behaves the same but appears as a toggle."
- Who (select): Anyone on this membership (default) / one named member.
- Disciplines (multi-select chips): Cycling, Running, Walking, Rowing, Strength, Yoga, Stretching, Meditation, Cardio, Bike bootcamp, Tread bootcamp, Row bootcamp. Default: all. A "Select all / none" link.
- Device (select): Any device (default) / Blue Door+ / Tread. Sourced from the membership.
- Hold after workout ends (number, seconds). Default 90. Caption: "Keeps the sensor on briefly so stacked classes do not turn your scene off between them."

Type B: Heart-rate zone
Collapsed header: name, badge "Heart-rate zone", member badge, "Zone 4+" summary badge.
Expanded fields:
- Name. Default "Zone 4 or higher".
- Show in HomeKit as: Occupancy sensor / Switch.
- Who (select): a named member only, no Anyone option. Caption: "Zones come from this member's Peloton profile."
- Zone at or above (select): 1 to 5. Default 4.
- Hold time (number, seconds). Default 20. Caption: "The zone must hold this long before the sensor changes, so lights do not flicker on a sprint."
- Muted note: "Needs a heart-rate monitor paired to the workout. Without one the sensor stays off."

Add flow: "Add trigger" opens a small chooser with the two types and a one-line description of each.

Show: one Workout card collapsed, one Workout card expanded, one Heart-rate zone card expanded, and the add chooser. Both themes.

---

## Prompt 6: Polling section

Design the Polling section. Lead with the switch, then the intervals.

Block 1: Fast polling switch (decided on by default)
- Toggle, on: "Create a Fast polling switch in HomeKit"
- Name field, default "Peloton fast polling"
- Explanatory text: "Turn this switch on from a HomeKit automation right before a workout, for example when the gym light comes on. While it is on, the plugin checks every account quickly, locks onto the first workout it sees, and follows it to the end. Turn it off when the light goes off."
- Caption: "Turns itself off automatically after the period set in Advanced."

Block 2: Intervals (three numeric fields, seconds)
- Fast: default 10. Caption: "While the switch is on or a workout is in progress."
- Standby: default 120. Caption: "When the switch is off. Set to 0 to stop polling entirely until the switch turns on."
- Show a muted estimate under the fields that updates with the values: "About 30 requests per hour in standby with 1 account."

Block 3: First-run callout (dismissible, notify-switch callout style)
- Title: "Works best with an automation"
- Body: "Add a Home automation that turns on the Peloton fast polling switch when you start your workout routine, and off when you finish. Without it, the plugin still works, just at the standby interval."
- Link: "Read how to set this up"

Show: defaults, and the estimate line with 4 accounts at standby 0. Both themes.

---

## Prompt 7: Advanced section

Design the Advanced section, collapsed by default.

Fields:
- Fast polling switch turns off after (number, minutes). Default 120. Caption: "Counted from the later of the switch turning on and the last workout ending."
- Attention needed sensor (toggle, default off): "Create an occupancy sensor that turns on when any account needs to be reconnected." Caption: "Use it in an automation to get a notification."
- Hide the Fast polling switch from HomeKit (toggle, default off). Caption: "Polling then uses the standby interval only."
- Daily check-in time (time picker, default 03:00). Caption: "Once a day the plugin refreshes each account's session and heart-rate zones, even when nobody is working out."
- Log level (select): Standard / Verbose. Caption: "Verbose logs each poll result. Tokens are never logged."

Show: expanded, both themes.

---

## Prompt 8: Empty states and first run

Design the page as a new user sees it:
- Accounts: no cards, a single inviting panel: "Connect your Peloton account" with the headless connect form inline, and the line "Sign in as the membership owner and your household will appear here."
- Triggers: empty panel: "No triggers yet. Add one to create a HomeKit sensor." with an Add trigger button, and a suggested default card ghosted: "Workout (any discipline, anyone)".
- Polling and Advanced: collapsed, defaults.
- Save bar disabled with the notify-switch "Nothing to save yet" state.

Then show the page immediately after the owner connects: accounts list populated with household profiles as Not connected, and the first-run polling callout visible.

Both themes.

---

## Prompt 9: Validation and error states

Design the validation states, using the notify-switch inline error style:
- Trigger with an empty name: "Give this trigger a name. It is what you will see in the Home app."
- Two triggers with the same name: "Another trigger already uses this name."
- Heart-rate zone trigger whose member is Not connected: warning badge on the card, "This member has not connected yet. The sensor stays off until they do."
- Fast interval below 5: "Fast polling cannot go below 5 seconds."
- Standby interval between 1 and 29: "Use 0 to stop polling, or 30 seconds or more."
- Fast polling switch off and standby set to 0: blocking error at the Polling section: "With the switch hidden and standby at 0 the plugin would never poll. Turn one of them back on."
- Save with an account in Reconnect needed: non-blocking banner at the top: "1 account needs to be reconnected. Everything else is saved."

Show a single page with several of these visible at once. Both themes.

---

## Prompt 10: Compact and mobile

Show the Accounts and Triggers sections at the Homebridge UI's narrow breakpoint (phone width). Cards stack, status pills move under the name, link buttons wrap to a second row. Keep avatars.

---

## Decisions the design must not reinvent

- Plugin name: homebridge-peloton, display name Peloton for Homebridge.
- Trigger accessories default to Occupancy sensor; Switch is an option per trigger.
- Fast polling switch exists by default; auto-off default 120 minutes anchored to the later of switch-on and last workout end.
- Intervals: fast 10, standby 120, standby 0 allowed. Fast floor 5.
- Lock-on: first account with a workout in progress is followed; others are not polled until it ends.
- Hold after workout ends: 90 seconds default. Heart-rate zone hold: 20 seconds default.
- Attention needed sensor: off by default, Advanced only.
- Household list comes from the owner's membership; each member still connects with their own sign-in.
- Two sign-in paths: email and password (primary), browser with pasted callback address (fallback).
