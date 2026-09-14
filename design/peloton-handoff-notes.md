# Peloton Handoff Notes

For Claude Code, working in arodbuilds/homebridge-peloton (`homebridge-ui/public/`). Target release 0.1.0-beta.2. Written September 14, 2026.

## Order of truth

1. The shell code in arodbuilds/homebridge-notify-switch 1.3.2 (`homebridge-ui/public/index.css`, `homebridge-ui/src/card.ts`, `dom.ts`, `draft.ts`, `copy.ts` FIELD_LABELS).
2. `design/BUILD-CONTRACT.md` in that repo (rule ids S, R, C, F, T, W, M).
3. `design/HANDOFF.md` in that repo (September 14, 2026 revision, 1.3.2 decisions).
4. The screens in this handoff (`Peloton Settings.html`).

Peloton copy and validation messages come from `homebridge-ui/public/copy.js` in the Peloton repo, except where a shell rule above overrides them (one case: the empty trigger Name message, see below).

## What changed since the beta.1 export

Shell 1.3.2 alignment

- Scroll rule: `:root, :root > body { overflow: hidden; height: auto }`. No fixed or percentage height anywhere. Remove every `scrollIntoView`.
- Summary box "Fix these before saving:" is in the page flow after Settings, above the closing paragraph, no shadow, warning tone. Entries focus the named control itself without rebuilding the section; a collapsed Advanced or trigger card opens first. Past three entries: "N fields need attention" with Show all / Hide.
- Validation on blur, never on keystroke. Every empty required field reads "{Label} is required." from one label table (`FIELD_LABELS`). Format messages stay as in copy.js.
- Draft bar only when a stored draft exists (structure only, no credentials). Never on a fresh install. Restore, Discard and Save clear it.
- Advanced opens by itself when a field inside it turns invalid, and when a summary entry targets a field inside it.
- Card header: subtle strip, 8px 16px, title weight 700, clusters aligned on the first baseline (badges wrap under the title at 400 px, the right cluster stays on the first row). Whole row toggles (click, Enter, Space), chevron at the right edge, "Show settings" / "Done", summary values after the badges while collapsed. The only card, a new card and a duplicate open expanded.
- Disabled buttons: full opacity, transparent fill, border colour, secondary text, `cursor: not-allowed`.
- Callout Dismiss is a text link, not a ✕ glyph.
- Warning border `#ffecb5` in both themes; dark warning text `#ffe69c`.

Peloton decisions applied

- Settings: intro, then a collapsed Advanced holding, in this order, Name, Debug logging, Fast polling switch turns off after (minutes), Attention needed sensor, Daily check-in time, Restore from backup. Nothing on the page grid. `advancedTouched` must include Name and Debug logging. Restore help: "Choose a backup file. It is checked before anything changes; if it passes, the form is replaced with its contents and Save is enabled." No Download backup and no Reset in beta.2.
- Heart-rate zone is not offered. Remove the Add trigger chooser: Add trigger creates a Workout card directly and focuses its Name. A stored zone trigger still renders, collapsed, with the badge "Not offered in this release", and can be opened, duplicated or removed.
- Device options: Any device, Bike, Tread, Guide (platform `tiger`, observed September 11, 2026). Help: "Bike is a ride on the Bike or Bike+, Tread is a workout on the Tread or Tread+, Guide is a class taken on the Peloton Guide."
- Footer: Peloton v0.1.0-beta.2, version read from package.json.
- Kept Peloton exceptions: trigger cards have no footer primary action (C4); Polling is an uncarded section that is not Settings (R5); the Checking pill spins.
- Empty trigger Name reads "Name is required." (shell W4). `VALIDATION.triggerName` in copy.js is superseded.

## How to read the HTML

`Peloton Settings.html` is one self-contained file: the shell bundle, tokens, React, the two Peloton scripts and the images are inlined. Open it in a browser.

- The strip above the modal is review chrome, not the plugin page. Toggles: Fresh install, Single trigger, Host dark theme, Phone width (400 px), Show validation states. The same states come from the URL: `?fresh=1`, `?single=1`, `?dark=1`, `?phone=1`, `?invalid=1`, `?draft=1` (forces the draft bar), `?chrome=0` (hides the strip).
- The plugin page starts at the banner and ends at the footer. The modal title bar and CLOSE / SAVE are the host's; the stand-in mirrors the SAVE state (disabled while the summary box shows or nothing has changed, tooltip "Nothing to save yet").
- Dark theme is the host marker `body.dark-mode`; the page sets no theme of its own. The file carries a local re-declaration of the `--ns-*` tokens under that marker because the shell's `tokens/colors.css` resolves them on `:root` (shell bug, inventory shell candidate 10); index.css in the Peloton repo should keep re-declaring the `--bs-*` variables under the marker as it does today.
- Every colour, size and radius is a `--ns-*` or shell spacing token; there are no literals in the Peloton code except the Checking spinner animation.
- Shell components (Button, InlineConfirm, TextField, SelectField, CheckField, Disclosure, IssuesSummary, FocusField, DraftBar, Banner, SectionHeading, Grid, Note, StatusBox, CreditFooter, Badge) are the design system's. Peloton-local components are prefixed `Peloton` (trigger card, account row, status pill, connect panel, first-run panel, radio, chips, callout, file field, section error, estimate line, reconnect banner, muted line, footer mark); each maps to a shell candidate in the inventory.
- Prototype-only behaviour: Connect cycles through the result messages and succeeds on the sixth click (the row flips after 1.5 s); Test, Restore and Save change on-page state only; the draft is a flag in localStorage under `homebridge-peloton:draft`.
- Field ids follow `f-{card}.{field}` (`f-w1.name`, `f-poll.standby`, `f-set.name`); summary entries carry them in `data-issue-path`.
