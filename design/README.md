# Handoff: homebridge-peloton settings page

## Overview
The Homebridge config UI (`config.schema.json` custom UI) for **homebridge-peloton**, display name **Peloton**. The page connects one or more Peloton accounts, defines trigger sensors (Workout, Heart-rate zone), sets polling behaviour and plugin-wide settings. It follows the same house standard as `homebridge-notify-switch` and must look and behave like a native Homebridge settings page in both the light and dark host themes.

## About the design files
`peloton-settings.html` is a **design reference built in HTML**: a single self-contained interactive prototype. It is not production code. Recreate it inside the plugin's custom UI (`homebridge-ui/public/index.html` + the `homebridge-plugin-ui-utils` API) using the host's Bootstrap variables, not by shipping this file. The review chrome above the modal (theme / width / fresh install toggles, the two connect-state dropdowns, "Validation demo") is design-tooling only and is not part of the plugin.

Open the prototype in a browser and use the toolbar to inspect every state:
- **Dark theme / Phone width / Fresh install**: host theme, 400 px layout, empty first run.
- **Sign-in method + result dropdowns**: drive the inline connect panel (see Interactions).
- **Validation demo**: seeds every validation state from spec round two, Prompt F, at once.

## Fidelity
**High-fidelity for structure, copy, states and behaviour. Host-themed for colour and type.** Every colour is a Homebridge/Bootstrap variable (listed under Design tokens) so the page follows the host; the plugin owns no palette. Recreate spacing, type sizes, control heights, copy and states exactly. Where the prototype hard-codes a fallback hex, that is the host's light-theme value.

## Decisions that must not change
From `spec/round-two-prompts.md`:
- Triggers are stateful sensors: ON while the condition is true, OFF when it stops. Occupancy sensor by default, Switch optional. No momentary behaviour, no cooldown, no "stay on" checkbox.
- No default account, no master switch.
- Fast polling switch exists by default; auto-off default 120 min from the later of switch-on and last workout end.
- Intervals: fast 10 s (floor 5), standby 120 s (0 allowed).
- Lock-on to the first account with a workout in progress.
- Keep on after workout ends: 90 s. Heart-rate zone hold: 20 s.
- Attention needed sensor off by default, under Advanced.
- Copy: no em dashes, sentence case, "sensor" for triggers, "switch" only for the Fast polling switch. Not affiliated with Peloton; never use Peloton's logo, wheel or brand red.

## Page order (top to bottom)
1. Plugin banner (4:1 image, full container width, 6 px radius, 16 px top margin)
2. Unsaved-changes bar (host machinery): "You have unsaved changes from earlier. Restore them?" RESTORE / DISCARD
3. Non-blocking reconnect banner (after a save with an account in Reconnect needed): "1 account needs to be reconnected. Everything else is saved." Warning colours.
4. Intro paragraph one: "Turns Peloton workouts into HomeKit sensors so automations can run when a workout starts, ends, or reaches a heart-rate zone."
5. Intro paragraph two: "Set up in two steps: connect your Peloton account, then add a trigger for what you want to automate. Save, restart Homebridge, and use the sensor in a HomeKit automation."
6. Muted line (12.6 px): "Not affiliated with or endorsed by Peloton Interactive. Uses Peloton's undocumented member API, which can change without notice."
7. Sections: **Accounts**, **Triggers**, **Polling**, **Settings**
8. Sticky "Fix these before saving:" summary box while anything blocks Save
9. Closing paragraph: "After saving, restart Homebridge. Your sensors appear in the Home app. Open Automations, choose a sensor as the trigger, and pick what should happen when a workout starts."
10. Footer line: 20 px footer glyph (`assets/peloton-footer.svg`, currentColor) · "Peloton v{version}" · "Made by Alex Rodriguez" · alex-rodriguez.com · Report an issue. Version from package.json.

Container: one root element, `padding: 0 16px 16px`, `overflow-wrap: anywhere`. The host draws the modal, title bar and CLOSE / SAVE footer.

## Section anatomy (shared)
- `h2` 20 px weight 300, 1 px bottom rule (`--ns-border`), 4 px padding-bottom, 8 px below.
- One intro sentence (14.4 px).
- Cards, then exactly one primary Add button (38 px tall, `--ns-primary` fill, white uppercase 16 px, 4 px radius).
- 24 px above each section.

## Accounts
Intro: "Sign in as the membership owner and every household profile appears here. Each member connects their own profile before it is polled."

**Account card** (1 px `--ns-cardborder`, 6 px radius, 16 px below). Row, 12 px gap, padding 12 px 16 px, wraps at phone width:
- Avatar 40 px disc. Real profile photo if present; otherwise initials on `--ns-locked` disc, text inherits body colour, 14.4 px weight 600. Never Peloton's placeholder image.
- Name (weight 600) + `@username` (secondary colour) + "Owner" badge on the primary account (badge: `--ns-badge` fill, white, 11.5 px weight 600, 3 px 7 px padding, 4 px radius).
- Subline (12.6 px, secondary) by status; metadata line "Last workout 3 days ago". Clarification (SPEC 4.2 and 10): the time comes from the created_at of the latest Peloton-originated workout in the account's workouts list (imports with is_3p_fit_feed_workout true are skipped), never from the profile's last_workout_at, which is stale. The line is omitted when the list is empty.
- Right column: status pill, then link buttons (14.4 px, `--ns-link`; Remove in `--ns-danger`).

| Status | Pill | Subline | Links |
| --- | --- | --- | --- |
| Connected | `--ns-success` fill, "Connected" | Last checked 2 min ago | Test, Remove |
| Reconnect needed | `--ns-danger` fill, "Reconnect needed" | Sign-in expired. Reconnect to resume polling. | Reconnect, Remove |
| Not connected | `--ns-badge` fill, "Not connected" | Ask this member to connect their profile. | Connect, Remove |
| Checking | outlined pill, 10 px spinner, "Checking" | (none) | Remove |

Owner shows Reconnect the same as members when in Reconnect needed.

Below the list: "Add account" link button (opens the connect panel for a profile not on the household list).
Devices row (12.6 px muted, read-only): "Devices on this membership: Blue Door+ (Bike+), Tread (names come from your membership)".

### Connect panel (inline, expands under the card; `--ns-subtle` background, 1 px top rule, 16 px padding)
**Email and password (primary path)**
- Email (prefilled for a household profile if known, editable), Password (masked, SHOW / HIDE attached on the right).
- Caption under Password: "Stored in your Homebridge config. The plugin keeps a session token so you rarely need to sign in again."
- Buttons: **Connect** (primary), "Sign in with browser instead" (link), Cancel (secondary link).
- Results (box under the fields, 1 px border + text in the tone colour, 13.5 px):
  - Success: card flips to Connected, panel collapses, brief inline "Connected as @username".
  - "Peloton did not accept that email and password."
  - "Peloton sign-in did not complete. You can connect using your browser instead." and "Sign in with browser" is promoted to an outlined button.
  - "This account has extra verification turned on. Use Sign in with browser."

**Sign in with browser (fallback, replaces the panel in place)**
- Outlined button "Open Peloton sign-in" (opens a new tab).
- "Sign in on the Peloton page. If you are already signed in, it will jump straight to your home page; that is fine."
- "Press your browser's Back button once. The address bar will show an address that starts with members.onepeloton.com/callback. Copy it."
- Muted help: "If Back does not show it, long-press the Back button and pick the callback entry, or search your browser history for callback."
- Monospace text field, placeholder `https://members.onepeloton.com/callback?code=...`
- **Connect** (primary), "Use email and password instead" (link), Cancel.
- Errors (red border on the field + message):
  - "That does not look like the Peloton callback address. It should start with members.onepeloton.com/callback."
  - "This link was from an earlier attempt. Click Open Peloton sign-in again and use the new one."
  - "The sign-in link expired. Click Open Peloton sign-in and try again."

## Triggers
Intro: "Each trigger is a sensor in the Home app. It turns on while its condition is true and off when it stops, so one sensor gives you both a start and an end automation."

**Card header** (`--ns-subtle` strip, 8 px 16 px): bold name (live as typed, "New trigger" when empty), type badge (filled), then outlined badges: who ("Anyone" or first name), "Zone N+" for heart-rate cards, accessory kind. Right: "Show help / Hide help" toggle, then "Edit" (collapsed) / "Done" (expanded). Collapsed cards show the header only.
Warning state (Heart-rate zone whose member is not connected): warning badge "Not connected" in the header and a warning strip under it: "This member has not connected yet. The sensor stays off until they do."

**Body**: 12-column grid, 8 px column gap, 16 px between fields; every cell full width below 600 px.

**Workout**
- Name (required, default "Workout"). Caption "Shown in the Home app. Letters, numbers, spaces and apostrophes."
- Show in HomeKit as (radio): Occupancy sensor (default) / Switch. Caption "Occupancy sensor is on while the workout is in progress. Switch behaves the same but appears as a toggle."
- Who (select, 6 cols): Anyone on this membership (default) / each connected member by name.
- Device (select, 6 cols): Any device (default) / Blue Door+ / Tread. Caption "Devices come from the membership."
- Activities (multi-select chips, default all, "Select all / none" links, summary "All activities" or "n of 12 selected"): Cycling, Running, Walking, Rowing, Strength, Yoga, Stretching, Meditation, Cardio, Bike bootcamp, Tread bootcamp, Row bootcamp. Chip: 31 px tall, 16 px radius; selected = `--ns-link` fill white text, unselected = 1 px `--ns-border` outline.
- Keep on after the workout ends (seconds) (number, 6 cols, default 90). Caption "Holds the sensor on briefly so stacked classes do not turn your scene off between them."

**Heart-rate zone**
- Name (required, default "Zone 4 or higher").
- Show in HomeKit as: Occupancy sensor / Switch.
- Who (select, 6 cols): connected members only, no Anyone. Caption "Zones come from this member's Peloton profile."
- Zone at or above (select 1 to 5, 3 cols, default 4).
- Hold time (seconds) (number, 3 cols, default 20). Caption "The zone must hold this long before the sensor changes, so lights do not flicker on a sprint."
- Muted note: "Needs a heart-rate monitor paired to the workout. Without one the sensor stays off."

**Footer strip**: "Remove trigger" (danger text button, confirms in place: "Remove {name}?" + red REMOVE + Cancel), "Duplicate trigger" (link). No primary action.

**Add trigger** opens a two-tile chooser (prompt "What should this trigger watch?"): "Workout: On while a workout is in progress." / "Heart-rate zone: On while heart rate is at or above a zone." Cancel closes it. A new card starts empty and focuses Name.

## Polling
Intro: "How often the plugin asks Peloton what is happening." Fields render uncarded on the page grid.
- Checkbox (on by default): "Create a Fast polling switch in HomeKit". Help: "Turn this switch on from a HomeKit automation right before a workout, for example when the gym light comes on. While it is on, the plugin checks every account quickly, locks onto the first workout it sees, and follows it to the end. Turn it off when the light goes off."
- Name (default "Peloton fast polling"). Caption "Turns itself off automatically after the period set under Advanced."
- Fast (seconds) (6 cols, default 10). Caption "While the switch is on or a workout is in progress."
- Standby (seconds) (6 cols, default 120). Caption "When the switch is off. Set to 0 to stop polling entirely until the switch turns on."
- Live muted estimate: "About {3600 / standby} requests per hour in standby with {n} account(s)." When standby is 0: "No polling in standby. Checking starts when the fast polling switch turns on."
- Dismissible callout (1 px `--ns-border`, 6 px radius, `--ns-subtle` fill, ✕ at right): title "Works best with an automation"; body "Add a Home automation that turns on the Peloton fast polling switch when you start your workout routine, and off when you finish. Without it, the plugin still works, just at the standby interval."; link "Read how to set this up". Dismissal persists.
- Blocking section error (red box under the intro, also listed in the summary box as "Polling: …") when the switch is unchecked and standby is 0: "With no fast polling switch and standby at 0 the plugin would never poll. Turn one of them back on."

## Settings
Intro: "Options that apply to the whole plugin."
- Name (required, 6 cols, default "Peloton"). Caption "Shown in Homebridge logs and as the bridge name in the Home app."
- Debug logging (checkbox, off). Caption "Log every poll and the workout data it returns. Sign-in details and session tokens are never logged."

Advanced (disclosure, collapsed by default, opened automatically when anything inside is set):
- Fast polling switch turns off after (minutes) (number, 6 cols, default 120). Caption "Counted from the later of the switch turning on and the last workout ending."
- Attention needed sensor (checkbox, off): "Create an occupancy sensor that turns on when any account needs to be reconnected. Use it in an automation to get a notification."
- Daily check-in time (time input, 6 cols, default 03:00). Caption "Once a day the plugin refreshes each account's session and heart-rate zones, even when nobody is working out."
- Restore from backup (file field). Caption "Replaces everything on this page with the contents of the backup."

## Validation
Validate on blur; a field is marked only after it has been touched. Invalid: red border + 12.6 px red message under the control. Valid required fields: small green check inside the control.
- Empty trigger name: "Give this trigger a name. It is what you will see in the Home app."
- Duplicate trigger name (case-insensitive across triggers): "Another trigger already uses this name."
- Heart-rate zone with a member who is not connected: warning badge + strip (non-blocking).
- Fast below 5: "Fast polling cannot go below 5 seconds."
- Standby 1 to 29: "Use 0 to stop polling, or 30 seconds or more."
- Switch off + standby 0: blocking Polling error above.
- Summary box: sticky, warning colours, "Fix these before saving:" then "{Card name}: {message}" entries that focus the field. SAVE disabled while present. Past three entries collapse to "N fields need attention" with Show all.

## Empty state / first run
Fresh install toggle in the prototype: Accounts shows a single inviting panel with the email/password form and "Sign in as the membership owner and your household will appear here." Triggers shows "No triggers yet. Add one to create a HomeKit sensor." with Add trigger. Polling and Settings keep defaults. Save is disabled with the "Nothing to save yet" state. Immediately after the owner connects, household profiles appear as Not connected and the polling callout is visible.

## Phone width (< 600 px)
Every grid cell is full width. Account cards stack: pill and links move under the name and wrap to a second row; avatars stay. Card footers wrap with the primary side on top. Buttons at least 44 px tall on touch.

## Design tokens (host Bootstrap variables; light → dark fallbacks)
- Page background `--ns-bg` #ffffff → #1c1c1c; text `--ns-text` #212529 → #ffffff
- Secondary text `--ns-secondary` rgba(33,37,41,.75) → rgba(222,226,230,.75)
- Rules `--ns-border` #dee2e6 → #495057; card border `--ns-cardborder` rgba(0,0,0,.176) → rgba(255,255,255,.15)
- Subtle strip `--ns-subtle` rgba(33,37,41,.03) → #262626; locked/disc `--ns-locked` #e9ecef → #343a40
- Link `--ns-link` #0d6efd → #6ea8fe; primary button `--ns-primary` #607d8b; danger #dc3545; success #198754; badge #6c757d
- Warning `--ns-warnbg` #fff3cd → #3a3524, `--ns-warntext` #664d03 → #ffe69c
- Type: host system stack. Body 14.4 px / 300 / 1.5; labels 14.4 px / 600; help 12.6 px / 300 / 1.4; h2 20 px / 300; controls 16 px; badges 11.5 px / 600; small buttons 13.5 px uppercase.
- Controls 38 px tall, 6 px radius, 11 px side padding. Small buttons 31 px, 4 px radius. Chips 31 px, 16 px radius.
- Spacing: 16 px section/card padding, 24 px between sections, 12 px inside panels, 8 px grid gap.
- Banner artwork colours (the one place the plugin carries colour): field #6E2220, mark #F2F2F3.

## Assets (`assets/`)
- `peloton-banner.png` 1280 × 320 page banner. **Its tagline is out of date** (spec round two, Prompt A): regenerate with "HomeKit sensors driven by Peloton workouts: workout in progress and heart-rate zones." on the same layout; no em dash.
- `peloton-footer.svg` 24-grid footer glyph, currentColor, render at 20 px. Inline it so it follows the host theme.
- `peloton-mark.svg` mark alone; `peloton-dark.svg` / `peloton-light.svg` 192 tiles; `peloton-192.png`, `peloton-512.png` plugin listing rasters.
- `ICONS.md` geometry and colour notes for the mark.

## Files
- `peloton-settings.html` self-contained interactive prototype (open directly in a browser).
- `spec/round-one-prompts.md`, `spec/round-two-prompts.md` the content briefs this design implements; round two supersedes round one where they differ.
