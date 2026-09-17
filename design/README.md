# Handoff: homebridge-peloton settings page

## Overview
The Homebridge config UI (`config.schema.json` custom UI) for **homebridge-peloton**, display name **Peloton**. The page connects one or more Peloton accounts, defines trigger sensors (Workout; Heart-rate zone is not offered in this release, see Triggers), sets polling behaviour and plugin-wide settings. It runs on the Homebridge Plugin Shell, the same shell as `homebridge-notify-switch` (see Shell below), and must look and behave like a native Homebridge settings page in both the light and dark host themes.

## About the design files
`peloton-settings.html` is the beta.2 export (Peloton Settings.html from the September 14, 2026 handoff): a single self-contained interactive prototype of the page on the shell 1.3.2, with the shell bundle, the tokens, React, the two Peloton scripts and the images inlined. It is not production code. Recreate it inside the plugin's custom UI (`homebridge-ui/public/`) on the shell files, not by shipping this file. The strip above the modal is review chrome, not the plugin page; the modal title bar and CLOSE / SAVE are the host's. `peloton-handoff-notes.md` says how to read it and which decisions it applies; `peloton-alignment-inventory.md` lists every difference between the export, the shipped page and the shell, with how each was resolved recorded under Shell below.

Open the prototype in a browser and use the toolbar to inspect every state:
- **Fresh install / Single trigger / Host dark theme / Phone width (400 px) / Show validation states**, also from the URL: `?fresh=1`, `?single=1`, `?dark=1`, `?phone=1`, `?invalid=1`, `?draft=1` (forces the draft bar), `?chrome=0` (hides the strip).
- Connect cycles through the result messages and succeeds on the sixth click; Test, Restore and Save change on-page state only.

## Shell
The page is built on the Homebridge Plugin Shell as `arodbuilds/homebridge-notify-switch` ships it at tag **v1.3.2** (the shell source; `HANDOFF.md`, `BUILD-CONTRACT.md` and `BUILD-CONTRACT-DEFINITIONS.md` in this folder are copied from that tag without edits, and their rule ids are cited below and in SPEC.md section 10). Order of truth: the shell code at v1.3.2, then `BUILD-CONTRACT.md`, then `HANDOFF.md`, then the export.

At v1.3.2 the shell is TypeScript under `homebridge-ui/src/` in that repository, bundled with esbuild, and imports Notify Switch's own modules (its copy tables, its model, `src/safeKeys.ts`); the only file that exists in both repositories' `homebridge-ui/public/` is the stylesheet. The Peloton page is plain ES modules with no build step, so the shell code is carried as a port, file by file and function by function in the same order with the TypeScript types removed, each file naming its source in its header comment; only the stylesheet is a byte-for-byte copy.

**Shell files** under `homebridge-ui/public/` (shared with homebridge-notify-switch; update them from the shell, never edit them here):
- `index.css`: `homebridge-ui/public/index.css` at v1.3.2, byte for byte. It carries the scroll rule (`:root, :root > body { overflow: hidden; height: auto }`), the container, the grid, the card header, body and footer strips, the buttons (31 px small, 38 px section Add, disabled at full opacity on a transparent fill), the badges, the summary box in flow, the draft bar, the footer line, the touch targets, and the dark-mode re-declaration of every Bootstrap variable the page reads. Its rules are namespaced `.notify-switch-ui`, so the page's root element carries that class beside `.peloton-ui`.
- `dom.js`: `homebridge-ui/src/dom.ts` (the element and field helpers, the disclosure, the grid cells, the status box, the link, danger and outline buttons, the in-place confirmation, the card footer), without the modal and clipboard helpers only Notify Switch uses.
- `card.js`: the card pieces of `homebridge-ui/src/card.ts` (the help toggle, the header strip, the header badges).
- `draft.js`: `homebridge-ui/src/draft.ts` (the unsaved draft: written without credentials, read back while fresh and well formed, `stableStringify`); the key names this plugin.
- `footer.js`: `homebridge-ui/src/footer.ts` (the version and credit line); the mark is passed in and the version comes with `/status`.
- `shell-copy.js`: the shell entries of `homebridge-ui/src/copy.ts` (the draft bar, the summary box, the help toggle, "Nothing to save yet", "{Label} is required.", Dismiss).
- The Page class in `app.js`: the page order, the draft bar, the summary box and its entries updated in place, the touched and fresh state, the inline marking, `focusField`, and the push with the draft follow `homebridge-ui/src/main.ts` method for method (marked shell in the file); the accounts, the reconnect banner, the section list and the resize call are Peloton's.

**Peloton files** under `homebridge-ui/public/`: `index.html` (links `index.css` then `peloton.css`; the root carries `notify-switch-ui peloton-ui`), `peloton.css` (the tokens as host Bootstrap variables with the light fallbacks, the account cards and pills, the connect panel, the chips, the callout, the collapsible card header additions, the section error, the outlined and warning badges), `peloton-dom.js` (time and radio fields, badges, the pill, the 38 px outlined link-colour button, initials, relative times, the footer mark), `copy.js` (every Peloton string and the label table `FIELD_LABELS`), `model.js`, `api.js`, `accounts.js`, `triggers.js`, `polling.js`, `settings.js`, `app.js` (the Peloton parts) and `peloton-banner.png`.

**Inventory resolutions** (`peloton-alignment-inventory.md`, Export vs repo; the numbers are the inventory's):
1. Device options with Guide: done in PR 2 (export).
2. Collapse toggle label: "Show settings" / "Done" (export).
3. Header toggle: the whole row toggles, chevron at the right edge (export; the chevron is the shell's `.ns-chevron` glyph).
4. Collapsed summary after the badges (export).
5. Add trigger without the chooser and the zone card badge: done in PR 2 (export).
6. Who: the repo's options stand, as the inventory records.
7. Estimate line: counts Connected plus Checking accounts (export), and keeps the repo's fallback to the configured count, else 1, while none is connected.
8. Fast polling switch Name: always shown (export).
9. Avatar fallback: the repo's initials on a disc stand. The export's letter placeholder is Peloton's own placeholder image, which the decisions above rule out, and the disc follows the host theme without image assets.
10. Banner: the export's `peloton-banner-beta2.png` is the same artwork and tagline as `assets/peloton-banner.png` (only file metadata differs), so the repo's copy stands.
11. Version: 0.1.0-beta.2 in PR 2, read from package.json.
12. Settings placement: everything under Advanced in the fixed order (export).
13. Empty trigger Name: "Name is required." from the label table (shell W4).
14. Trigger footer result line: the repo's per-account result line after a failed Test stands (the export omits a state the page needs).
15. Repo-only copy: kept.

Shipped UI vs shell (the inventory's second list): 1 the summary box is in flow with no shadow; 2 no `scrollIntoView` remains; 3 `focusField` focuses the control itself without rebuilding; 4 the `:root` scroll rule replaces the `html, body` rule; 5 disabled buttons as the shell draws them; 6 the warning border is `#ffecb5` in both themes and the dark warning text `#ffe69c`; 7 restore errors render in the shell's status box; 8 the primary button hover is the host's (`btn-primary`); 9 the Checking pill keeps its spinner, a Peloton exception; 10 the card title is weight 700; 11 as 13 above; 12 the callout's Dismiss is a text link. The shell candidates list is left for the Notify Switch backlog. Peloton exceptions kept and noted in SPEC.md section 10: no card primary action (C4), Polling uncarded (R5), the Checking spinner.

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
2. Unsaved-changes bar (shell M1): "You have unsaved changes from earlier. Restore them?" RESTORE / DISCARD. Shown only when a draft is stored that differs from the saved configuration; a draft is written only once something changed on the page, never holds passwords, and is never offered on a page that opens with no saved Peloton configuration.
3. Non-blocking reconnect banner (after a save with an account in Reconnect needed): "1 account needs to be reconnected. Everything else is saved." Warning colours.
4. Intro paragraph one: "Turns Peloton workouts into HomeKit sensors so automations can run when a workout starts, ends, or reaches a heart-rate zone."
5. Intro paragraph two: "Set up in two steps: connect your Peloton account, then add a trigger for what you want to automate. Save, restart Homebridge, and use the sensor in a HomeKit automation."
6. Muted line (12.6 px): "Not affiliated with or endorsed by Peloton Interactive. Uses Peloton's undocumented member API, which can change without notice."
7. Sections: **Accounts**, **Triggers**, **Polling**, **Settings**
8. "Fix these before saving:" summary box in the page flow while anything blocks Save (shell F4, not sticky, no shadow)
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
Devices row (12.6 px muted, read-only): "Devices on this membership: Blue Door+ (bike), Tread (tread), Guide (names come from your membership)". Clarification (SPEC 7 and 10): each device is its name from the membership with its group (bike, tread, guide) in brackets after it; a device Peloton has not named, such as the Guide, shows its capitalised group alone, and the brackets are omitted when the group equals the name.

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

**Card header** (shell C1 with the collapsible additions of `HANDOFF.md`): the subtle strip, 8 px 16 px, clusters aligned on the first baseline. Left: bold name at weight 700 (live as typed, "New trigger" when empty), type badge (filled), the warning badge "Not offered in this release" on a Heart-rate zone card, then outlined badges: who ("Anyone" or first name), "Zone N+" for heart-rate cards, accessory kind; while collapsed, a muted 12.6 px summary of the key values follows the badges: "{Who} · {Device} · All activities (or n of 12 activities) · Keep on 90 s" on a Workout card, "{First name} · Zone 4+ · Hold 20 s" on a Heart-rate zone card. Right (12.6 px links, 12 px apart): the "Show help / Hide help" toggle only while the card is open, then "Show settings" (collapsed) / "Done" (open), then the chevron at the right edge (pointing down while collapsed, up while open). The whole row toggles the card, by click, Enter or Space; the help toggle and the link handle their own clicks. Opening and closing happen in place: the body and footer show or hide and nothing is rebuilt. Cards loaded from config start collapsed (header only); the only trigger on the page, a card just added and a duplicate open expanded. At 400 px the badges and the summary wrap under the name while the right cluster stays on the first row.
Warning state (Heart-rate zone whose member is not connected): warning badge "Not connected" in the header and a warning strip under it: "This member has not connected yet. The sensor stays off until they do."

**Body**: 12-column grid, 8 px column gap, 16 px between fields; every cell full width below 600 px.

**Workout**
- Name (required, prefilled "Workout" on a new card, no placeholder). Caption "Shown in the Home app. Letters, numbers, spaces and apostrophes."
- Show in HomeKit as (radio): Occupancy sensor (default) / Switch. Caption "Occupancy sensor is on while the workout is in progress. Switch behaves the same but appears as a toggle."
- Who (select, 6 cols): Anyone on this membership (default) / each connected member by name.
- Device (select, 6 cols): Any device (default) / Bike / Tread / Guide / Apple TV / Phone or tablet app. Caption "Bike and Tread cover every model of each. Guide is a class on the Peloton Guide. Apple TV and Phone or tablet app are classes taken in the Peloton app." Clarification (SPEC 6 and 8.3): the choice is the hardware family or the app, matched by the platform the workout was recorded on, not one of the membership's named devices; a membership's device names appear only on the Devices line under Accounts.
- Activities (multi-select chips, default all, "Select all / none" links, summary "All activities" or "n of 12 selected"): Cycling, Running, Walking, Rowing, Strength, Yoga, Stretching, Meditation, Cardio, Bike bootcamp, Tread bootcamp, Row bootcamp. Chip: 31 px tall, 16 px radius; selected = `--ns-link` fill white text, unselected = 1 px `--ns-border` outline.
- Keep on after the workout ends (seconds) (number, 6 cols, default 90). Caption "Holds the sensor on briefly so stacked classes do not turn your scene off between them."

**Heart-rate zone** (not offered in this release, SPEC section 2: the page creates no new card of this type; a trigger already in config renders as below with the badge "Not offered in this release" and can be opened, edited, duplicated and removed)
- Name (required, no placeholder; the zone-following default name of a new card stays in the page model for when the offering returns).
- Show in HomeKit as: Occupancy sensor / Switch.
- Who (select, 6 cols): connected members only, no Anyone. Caption "Zones come from this member's Peloton profile."
- Zone at or above (select 1 to 5, 3 cols, default 4).
- Hold time (seconds) (number, 3 cols, default 20). Caption "The zone must hold this long before the sensor changes, so lights do not flicker on a sprint."
- Muted note: "Needs a heart-rate monitor paired to the workout. Without one the sensor stays off."

**Footer strip** (shell C4): "Remove trigger" (danger text button, confirms in place: "Remove {name}?" + red REMOVE + Cancel), "Duplicate trigger" (link). No primary action, a Peloton exception to C4 recorded in SPEC.md section 10.

**Add trigger** creates a Workout card directly, expanded, with the Name prefilled "Workout" and focused; there is no chooser while one trigger type is offered. (The two-tile chooser of beta.1, "What should this trigger watch?", returns with the Heart-rate zone offering.)

## Polling
Intro: "How often the plugin asks Peloton what is happening." Fields render uncarded on the page grid.
- Checkbox (on by default): "Create a Fast polling switch in HomeKit". Help: "Turn this switch on from a HomeKit automation right before a workout, for example when the gym light comes on. While it is on, the plugin checks every account quickly, locks onto the first workout it sees, and follows it to the end. Turn it off when the light goes off."
- Name (default "Peloton fast polling", always shown). Caption "Turns itself off automatically after the period set under Advanced."
- Fast (seconds) (6 cols, default 10). Caption "While the switch is on or a workout is in progress."
- Standby (seconds) (6 cols, default 120). Caption "When the switch is off. Set to 0 to stop polling entirely until the switch turns on."
- Live muted estimate: "About {3600 / standby} requests per hour in standby with {n} account(s)." n counts the Connected accounts and those with a request in flight (the Checking pill), else the configured accounts, else 1. When standby is 0: "No polling in standby. Checking starts when the fast polling switch turns on."
- Dismissible callout (1 px `--ns-border`, 6 px radius, `--ns-subtle` fill, the "Dismiss" text link at right; shell W1 allows no glyph): title "Works best with an automation"; body "Add a Home automation that turns on the Peloton fast polling switch when you start your workout routine, and off when you finish. Without it, the plugin still works, just at the standby interval."; link "Read how to set this up". Dismissal persists.
- Blocking section error (red box under the intro, also listed in the summary box as "Polling: …") when the switch is unchecked and standby is 0: "With no fast polling switch and standby at 0 the plugin would never poll. Turn one of them back on."

## Settings
Intro: "Options that apply to the whole plugin." Nothing renders on the page grid: below the intro there is only the Advanced disclosure (shell C3, collapsed by default, opened automatically when anything inside differs from its default, when a field inside turns invalid, and when a summary box entry targets a field inside it), holding in this order:
- Name (required, 6 cols, default "Peloton"). Caption "Shown in Homebridge logs and as the bridge name in the Home app."
- Debug logging (checkbox, 6 cols, off). Caption "Log every poll and the workout data it returns. Sign-in details and session tokens are never logged."
- Fast polling switch turns off after (minutes) (number, 6 cols, default 120). Caption "Counted from the later of the switch turning on and the last workout ending."
- Attention needed sensor (checkbox, 6 cols, off): "Create an occupancy sensor that turns on when any account needs to be reconnected. Use it in an automation to get a notification."
- Daily check-in time (time input, 6 cols, default 03:00). Caption "Once a day the plugin refreshes each account's session and heart-rate zones, even when nobody is working out."
- Restore from backup (file field, 12 cols). Caption "Choose a backup file. It is checked before anything changes; if it passes, the form is replaced with its contents and Save is enabled." Failures render in the shell's status box under the field (C6). No Download backup and no Reset in beta.2.

## Validation
Validate on blur, never on keystroke; a field is marked only after it has been touched. Invalid: red border + 12.6 px red message under the control. Valid: small green check inside a touched control that holds a value (shell F3).
- Every empty required field reads "{Label} is required." with the field's own label from the one label table the sections render from (`FIELD_LABELS` in copy.js; shell W4). An empty trigger Name and an empty plugin Name both read "Name is required."; the summary box repeats the message after the card's name. The message "Give this trigger a name. It is what you will see in the Home app." of beta.1 is superseded.
- Duplicate trigger name (case-insensitive across triggers): "Another trigger already uses this name."
- Heart-rate zone with a member who is not connected: warning badge + strip (non-blocking).
- Fast below 5: "Fast polling cannot go below 5 seconds."
- Standby 1 to 29: "Use 0 to stop polling, or 30 seconds or more."
- Switch off + standby 0: blocking Polling error above.
- Summary box (shell F4 and T5): in the page flow after Settings and before the closing paragraph, warning colours with the `#ffecb5` border and no shadow, "Fix these before saving:" then "{Card name}: {message}" entries ("Polling: …" and "Settings: …" for the uncarded sections). An entry marks the field touched and moves focus to the control itself (the input, select or checkbox), opening a collapsed trigger card or the Advanced disclosure first and rebuilding nothing on the page; the entry list is updated in place, never rebuilt. SAVE disabled while present. Past three entries collapse to "N fields need attention" with Show all / Hide. While every remaining issue sits on a card nobody has touched: "Finish the new trigger before saving." in the quiet tone; on a fresh install with nothing changed: "Nothing to save yet" with Save disabled.

## Clarifications from build 3
The page in `homebridge-ui/public/` follows this document; where the build needed a state or a line this document did not name, it is recorded here rather than invented twice.
- Device (Triggers): see the Device field above; the choice is the hardware family (SPEC 8.3), so the caption changed with it.
- Heart-rate zone card with no member chosen (a household with nobody connected yet): blocking error on Who, "Choose the member whose heart rate this sensor follows." A new card preselects the first connected member.
- Live estimate: the requests per hour count every account that would be polled, so it reads "About 60 requests per hour in standby with 2 accounts." at 120 s standby, not the per-account figure.
- Reconnect banner: shown on load whenever an account is in Reconnect needed (the page cannot see the host's save), pluralised as "2 accounts need to be reconnected. Everything else is saved."
- A new trigger card holds its errors back until a field in it is touched (the notify-switch behaviour). While it does, the summary box reads "Finish the new trigger before saving." in the quiet tone and Save stays disabled.
- Test on a Connected card: success updates the "Last checked" subline; failure shows the stage message under the card. A Peloton API or network failure on any action reads "Peloton did not answer (HTTP {status}). Try again in a moment." (without the parenthesis when there was no status), the stage "refresh" reads "Sign-in expired. Reconnect to resume polling." and the card flips to Reconnect needed.
- Connect panel guards before anything is sent: "Enter the email address of the Peloton account.", "Enter the password of the Peloton account.", "Paste the address from your browser first.", and "Click Open Peloton sign-in first, then paste the address it leads to."
- Restore from backup accepts a Peloton platform block, a whole config.json, or a saved draft. Failures: "The backup could not be loaded:" with "The file is not valid JSON.", "The file does not hold a Peloton platform block." or "The file is larger than 1 MB, which a Peloton backup never is."; success toasts "Backup loaded. Review the page, then click Save."
- Trigger cards loaded from config start collapsed (header only); a card added or duplicated on this visit starts expanded.
- The Devices line is omitted while the membership reports no devices.
- Additional field messages mirroring config.schema.json: "Enter a number of seconds, 0 or more." on the hold fields, "Enter a number of minutes, 1 or more." under Advanced, "Enter a time as HH:MM." on the check-in time, and "Name is required." on the plugin name.
- Where the page cannot reach the plugin's UI server, actions show "The plugin server did not answer. Reload the page and try again." and the version and account states are left out.
- The unsaved draft in localStorage never holds passwords; restoring it keeps the stored passwords of the accounts it names.

## Clarifications from the build 3 Chrome pass
The first pass through the page in Chrome on the Pi (Homebridge UI 5.29 over plain http) settled these.
- Activities: a Workout trigger whose config has no activities list (SPEC 6: absent or empty means all) renders with every chip selected and the summary "All activities". Select all / none keep their meaning, and an all-selected set is saved as an empty list.
- Last checked: the Connected subline follows every successful poll of the account (SPEC 7 and 8.2), not only sign-in, refresh, and check-in.
- Household cards: the name comes from the membership when Peloton sends one, the username otherwise, and it is refreshed on every subscriptions read (SPEC 7). The second Chrome pass below settles which field carries it.
- Devices line: every device on the owner's membership is listed. The second Chrome pass below settles the format; the hardware family from device_type is gone with it.
- Avatars: a photo renders whatever content type Peloton's CDN sends, as long as the bytes are a JPEG, PNG, GIF, or WebP (SPEC 10).
- Ids: new accounts and triggers get an id on plain http too, where crypto.randomUUID does not exist (SPEC 6).

## Clarifications from the second Chrome pass
The second pass in Chrome on the Pi, with the live shape of the membership call (SPEC 4.2), settled these.
- Devices line: "Devices on this membership: Blue Door+ (bike), Tread (tread), Guide (names come from your membership)". Each device is its name from the membership with its group (bike, tread, guide) in brackets after it. A device Peloton has not named, such as the Guide, shows its capitalised group alone. The brackets are omitted when the group equals the name, and when the plugin has no group for the device (a record written before this pass, until the next membership read).
- Household cards: the name is the membership's name field for the member, one string; there is no first name or last name. The username stands in when the name is empty.
- Freshness: the page shows the membership as the plugin last read it. /status re-reads it when that read is more than an hour old (SPEC 10), so a page opened after an upgrade or a change on the membership shows current names and devices without waiting for the daily check-in.

## Clarifications from build 4
The last Chrome pass through the page on the Pi (Homebridge UI 5.29) and the release preparation settled these.
- Iframe height: the Homebridge UI wraps the page in its own document inside a modal iframe and sizes the iframe to the body's scrollHeight plus 10 px whenever the page reports it. The banner's 16 px top margin collapsed through the container and the body, so the document was 16 px taller than that measure and the iframe scrolled on its own by the difference, with wheel scrolling sticking at the boundary. html and body are margin 0 and overflow hidden, the container contains its margins (`display: flow-root`), and the page asks the host to size the iframe (fixScrollHeight) after every section render and every summary box change. The banner keeps its 16 px top margin and the container its `padding: 0 16px 16px`; in headless Chromium with the host stylesheet, documentElement.scrollHeight equals clientHeight in both themes and at phone width.
- Dark theme link buttons: the host's dark themes grey every `.btn-link` with an important rule, so Connect, Test, Add account, Edit, Duplicate trigger, and the Show help toggle rendered grey while Remove kept its red. The page's link buttons and the callout link now carry a scoped rule of the same weight in `--ns-link`, Cancel and the help toggle in `--ns-secondary`, Remove in `--ns-danger`, and the summary box toggle inherits the box colour. The palette is unchanged; only the rule's weight is.
- Trigger names: a new card starts with the Name prefilled, "Workout" or "Zone 4 or higher", instead of the "e.g." placeholder, so the header reads the name at once and a card added by mistake still validates. A zone card's name follows the chosen zone until the user edits the name; a duplicate's name is its own. Adding a second card of the same type therefore starts with a duplicate name, which the card holds back as a fresh card until a field is touched.

## Clarifications from beta.2, PR 1
The alignment with the shell 1.3.2 (SPEC.md section 16) settled these; the export, `peloton-handoff-notes.md` and `peloton-alignment-inventory.md` are the sources.
- Files: the split of `homebridge-ui/public/` into shell files and Peloton files, and the shell source tag, are listed under Shell above. The shell code is a port, not a byte-for-byte copy, for the reason given there; the stylesheet is byte for byte.
- Scrolling: the shell's `:root, :root > body { overflow: hidden; height: auto }` rule replaces the build 4 `html, body { margin: 0; overflow: hidden }` rule, and no fixed or percentage height and no `scrollIntoView` remain. Checked in headless Chromium with the page inside an iframe in a scrolling modal body sized to the posted height plus 10 px: in both themes at 900 and 400 px, documentElement.scrollHeight equals clientHeight, the posted height settles without a resize loop, and the first wheel gesture at the top and at the bottom of the page scrolls the modal while the iframe document stays put.
- Card markup: cards are the host's Bootstrap cards (`card`, `card-header`, `card-body`, `card-footer`) so the shell stylesheet and the host's dark card colours apply; the type badge and the Owner badge are the shell's type badge; every field of a card, of Polling and of Settings sits in a grid cell, full rows in a 12-column one, since the shell grid places nothing by itself.
- Trigger cards open and close in place, so a summary entry can open a collapsed card before focusing the field without rebuilding the section. A card the user closed stays closed on a redraw, including the only card on the page.
- Adding a trigger from the chooser is a change the host receives at once (the section redraw validates and pushes), and the new card focuses its Name.
- The draft is written only after a change on the page (`dirty`), never by the load's own pushes; a page that opens with no saved Peloton configuration never offers one and removes a draft left from before the first save. Restore takes each account's stored password back from the saved configuration.
- Cancel and the help toggle are text buttons in the secondary colour on both themes; every other text button is in the link colour and Remove in the danger colour, through the shell's dark-mode rule.
- The Connect button is the shell's 38 px primary button (the same as a section's Add button); the outlined 38 px "Open Peloton sign-in" and the promoted "Sign in with browser" stay Peloton's (`ns-outline`).
- The per-account result line after a failed Test, the connect panel pre-checks, the restore error messages and the server-unavailable message stay as in beta.1 (inventory items 14 and 15).

## Clarifications from beta.2, PR 2
The second PR of beta.2 (SPEC.md section 16) settled these; `peloton-handoff-notes.md` (Peloton decisions applied) is the source.
- Add trigger: no chooser. The button creates a Workout card directly, opens it and focuses its Name; the chooser's copy (`chooserPrompt`, `tiles`) and its Peloton styles are gone from copy.js and peloton.css, and the shell's tile styles in index.css stay untouched.
- Heart-rate zone cards: not created by the page in this release. A stored one renders with the warning badge "Not offered in this release" directly after the type badge, collapsed like any card loaded from config, and can be opened, edited, duplicated and removed; the "Not connected" badge and strip still apply. The runtime keeps the type (SPEC section 2, item 11).
- Device: Any device / Bike / Tread / Guide with the caption above; Guide is matched by the workout platform `tiger` (SPEC 4.2 and 8.3).
- Version: the footer reads 0.1.0-beta.2 from package.json through /status.
- Screenshots: the README walks through four of the five (accounts, trigger-workout, polling, settings); `trigger-zone.png` stays in `assets/screenshots/` for when the offering returns.

## Empty state / first run
Fresh install toggle in the prototype: Accounts shows a single inviting panel with the email/password form and "Sign in as the membership owner and your household will appear here." Triggers shows "No triggers yet. Add one to create a HomeKit sensor." with Add trigger. Polling and Settings keep defaults. Save is disabled with the "Nothing to save yet" state. Immediately after the owner connects, household profiles appear as Not connected and the polling callout is visible.

## Phone width (< 600 px)
Every grid cell is full width. Account cards stack: pill and links move under the name and wrap to a second row; avatars stay. Card footers wrap with the primary side on top. Buttons at least 44 px tall on touch.

## Design tokens (host Bootstrap variables; light → dark fallbacks)
Every token in `peloton.css` reads the host's Bootstrap variable with the light value below as its fallback (`--ns-link: var(--bs-link-color, #0d6efd)`), so it follows the host theme through the variables the shell stylesheet re-declares under the host's dark marker on the same root element. The two values the host has no variable for are literals: the subtle strip (re-declared for dark) and the warning border `#ffecb5`, which is the same in both themes.
- Page background `--ns-bg` #ffffff → #1c1c1c; text `--ns-text` #212529 → #ffffff
- Secondary text `--ns-secondary` rgba(33,37,41,.75) → rgba(222,226,230,.75)
- Rules `--ns-border` #dee2e6 → #495057; card border `--ns-cardborder` rgba(0,0,0,.176) → rgba(255,255,255,.15)
- Subtle strip `--ns-subtle` rgba(33,37,41,.03) → #262626; locked/disc `--ns-locked` #e9ecef → #343a40
- Link `--ns-link` #0d6efd → #6ea8fe; primary button `--ns-primary` #607d8b; danger #dc3545; success #198754; badge #6c757d
- Warning `--ns-warnbg` #fff3cd → #3a3524, `--ns-warntext` #664d03 → #ffe69c, warning border `--ns-warnborder` #ffecb5 in both themes
- Type: host system stack. Body 14.4 px / 300 / 1.5; labels 14.4 px / 600; help 12.6 px / 300 / 1.4; h2 20 px / 300; controls 16 px; badges 11.5 px / 600; small buttons 13.5 px uppercase.
- Controls 38 px tall, 6 px radius, 11 px side padding. Small buttons 31 px, 4 px radius. Chips 31 px, 16 px radius.
- Spacing: 16 px section/card padding, 24 px between sections, 12 px inside panels, 8 px grid gap.
- Banner artwork colours (the one place the plugin carries colour): field #6E2220, mark #F2F2F3.

## Assets (`assets/`)
- `peloton-banner.png` 1280 × 320 page banner, regenerated in build 4 on the same layout (mark, divider, wordmark) with the tagline "HomeKit sensors driven by Peloton workouts: workout in progress and heart-rate zones."; no em dash. The settings page ships its own copy under `homebridge-ui/public/`.
- `screenshots/` the five masked settings page screenshots: accounts, trigger-workout, polling, settings (the four the README walks through) and trigger-zone (kept for when the Heart-rate zone offering returns).
- `peloton-footer.svg` 24-grid footer glyph, currentColor, render at 20 px. Inline it so it follows the host theme.
- `peloton-mark.svg` mark alone; `peloton-dark.svg` / `peloton-light.svg` 192 tiles; `peloton-192.png`, `peloton-512.png` plugin listing rasters.
- `ICONS.md` geometry and colour notes for the mark.

## Files
- `peloton-settings.html` the beta.2 export: self-contained interactive prototype of the page on the shell 1.3.2 (open directly in a browser).
- `peloton-handoff-notes.md` how to read the export and the decisions it applies; `peloton-alignment-inventory.md` every difference between the export, the shipped page and the shell (resolved under Shell above).
- `HANDOFF.md`, `BUILD-CONTRACT.md`, `BUILD-CONTRACT-DEFINITIONS.md` the shell contract, copied from `arodbuilds/homebridge-notify-switch` at tag v1.3.2 without edits (the two contract files carry a few em dashes of their own, in the passages that quote the text they replaced; they are the shell's files, not this plugin's copy).
- `spec/round-one-prompts.md`, `spec/round-two-prompts.md` the content briefs this design implements; round two supersedes round one where they differ.
