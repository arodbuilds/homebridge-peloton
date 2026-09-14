# Peloton settings page: alignment inventory

Revised September 14, 2026 against the published Homebridge Plugin Shell (synced from homebridge-notify-switch 1.3.2, `design/HANDOFF.md` of September 14, 2026 and `design/BUILD-CONTRACT.md`). Order of truth: the shell code in 1.3.2, then BUILD-CONTRACT.md, then HANDOFF.md, then this handoff's screens. Peloton sources: the shipped custom UI in arodbuilds/homebridge-peloton@latest (0.1.0-beta.1, `homebridge-ui/public/`) and the beta.2 export.

File references: "screen" is `Peloton Settings.html` in this handoff (source files `peloton-app.jsx`, `peloton-components.jsx`); "repo" is arodbuilds/homebridge-peloton `homebridge-ui/public/`; "shell" is arodbuilds/homebridge-notify-switch 1.3.2 `homebridge-ui/public/index.css`, `homebridge-ui/src/*.ts` and `design/HANDOFF.md`.

## Export vs repo: Peloton content differences

1. Device options. Screen: Any device / Bike / Tread / Guide with the Guide clause (`KINDS.workout` device field, `DEVICE_HELP` in peloton-app.jsx). Repo: `TRIGGERS.deviceOptions` and `deviceHelp` in copy.js, `DEVICES` in model.js; any / bike / tread only.
2. Collapse toggle label. Screen: "Show settings" / "Done" (PelotonTriggerCard right cluster, peloton-components.jsx). Repo: `TRIGGERS.edit` / `TRIGGERS.done` in copy.js ("Edit" / "Done"), `collapseToggle` in triggers.js.
3. Header toggle. Screen: the whole `.ns-card-header` row toggles, chevron at the right edge (PelotonTriggerCard header `role="button"`, PelotonChevron). Repo: only the link toggles (`collapseToggle` in triggers.js), no chevron.
4. Collapsed summary. Screen: "{Who} · {Device} · All activities · Keep on 90 s" / "{First name} · Zone 4+ · Hold 20 s" after the badges (`summary` in `triggerCard`, peloton-app.jsx). Repo: none (`renderCard` returns after the header when collapsed).
5. Add trigger. Screen: no chooser; `addCard` creates a Workout card and focuses `f-{key}.name`. Repo: `renderChooser` in triggers.js with the Workout and Heart-rate zone tiles (`TRIGGERS.tiles`).
6. Who. Screen and repo agree: Workout offers Anyone on this membership plus connected members; a zone card offers connected members with the disabled "Choose a member" placeholder and `V.whoMissing` when none (`KINDS.zone` who field; repo `whoOptions` in triggers.js). The export offered every household member; the repo wins.
7. Estimate line count. Screen: Connected plus Checking accounts (`estimateAccounts`, PelotonEstimateLine). Repo: connected accounts, else the configured count, else 1 (polling.js).
8. Fast polling switch Name. Screen: always shown (`POLLING` switchName field). Repo: hidden while the switch is unchecked (polling.js).
9. Avatar fallback. Screen: Peloton's letter placeholder image (PelotonAvatar, `assets/peloton-avatar-*.png`). Repo: initials on a disc (accounts.js).
10. Banner. Screen: `assets/peloton-banner-beta2.png` (Banner in the page root). Repo ships `peloton-banner.png` (tagline out of date per the export).
11. Version. Screen: "0.1.0-beta.2" (CreditFooter `version`). Repo: 0.1.0-beta.1 (package.json). The build reads package.json.
12. Settings placement. Screen: everything under Advanced in order Name, Debug logging, autoOff, attention, checkin, restore (`ADVANCED` in peloton-app.jsx, `settingsSection`). Repo: Name and Debug logging on the page grid, Advanced holds the rest (`renderSettings` and `advancedTouched` in settings.js).
13. Empty trigger Name. Screen: "Name is required." (`required(def.id)` from `LABELS`). Repo: `VALIDATION.triggerName` in copy.js ("Give this trigger a name. It is what you will see in the Home app."). Shell W4 wins.
14. Trigger footer result line. Repo: per-account result under the account row after a failed Test (`ns-account-result`, accounts.js). Screen omits it.
15. Repo-only copy kept out of the screen: `VALIDATION.finishNew`, the four `CONNECT.*Missing` / `openFirst` pre-checks, `SETTINGS.restore*` errors and `SETTINGS.restored`, `PAGE.loadFailed` and `PAGE.serverUnavailable`. `RECONNECT_BANNER.many` and `VALIDATION.showAll` / `hide` are in the screen (PelotonReconnectBanner, IssuesSummary).

## Shipped UI (beta.1) vs shell or host constraints

1. `.ns-issues` is `position: sticky` with a `box-shadow` (repo index.css). Shell: in flow, no shadow (`.notify-switch-ui .ns-issues` in shell index.css; F4). Screen: IssuesSummary after `settingsSection()`.
2. `scrollIntoView` in `Page.jumpTo` (app.js) and after a chooser pick (triggers.js). Shell 1.3.2: the page owns no scroll container; focus brings the field into view (T5). Screen: `focusIssue` uses `FocusField` only.
3. `focusField` in repo dom.js rebuilds the section (`app.rerender`) before focusing. Shell 1.3.2: focus the named control without rebuilding (T5, `focusField` in IssuesSummary.jsx).
4. No `:root` scroll rule in repo index.css, so the host's `html, body { height: 100% }` applies. Shell: `:root, :root > body { overflow: hidden; height: auto }` (shell index.css top; tokens/base.css). Screen: loaded from tokens/base.css.
5. Disabled buttons `opacity: .65` (repo index.css). Shell: `.notify-switch-ui .btn:disabled` full opacity, transparent fill, border colour, secondary text, not-allowed. Screen: shell Button `disabled`, host SAVE stand-in.
6. Dark warning border `#5c552f` and light `#ffecb5` (repo index.css). Shell: `body .notify-switch-ui .alert-warning` border `#ffecb5` both themes, dark text `#ffe69c`. Screen: `--ns-warnborder`, `--ns-warntext`.
7. Restore errors render as Bootstrap `.alert.alert-danger` (`restoreField` in settings.js). Shell results are status boxes (C6). Screen: not reproduced (prototype Restore does nothing).
8. Filled primary hover `filter: brightness(.94)` (repo index.css). Shell: `--ns-primary-hover`. Screen: shell Button.
9. The Checking pill spins 0.8 s (repo index.css `ns-spin`; screen PelotonStatusPill `peloton-spin`). Shell allows no animation beyond button colour and the chevron. Kept as a Peloton exception in both.
10. Card title weight 600 (repo `.ns-card-title`). Shell: 700 (`.ns-card-name`). Screen: PelotonTriggerCard `<strong style="font-weight:700">`.
11. Empty required trigger Name message differs (item 13 above).
12. Callout Dismiss is a ✕ glyph (polling.js). Shell allows no glyph there (W1). Screen: PelotonCallout uses the shell link Button "Dismiss".

## beta.2 adds the shipped UI lacks

1. Collapsible header row with pointer cursor, chevron and "Show settings" (PelotonTriggerCard header; repo `renderCard` header).
2. Collapsed summary text after the badges (`summary` in `triggerCard`).
3. Guide as a Device option with the Guide clause (`KINDS.workout` device field; repo `DEVICES`, `TRIGGERS.deviceOptions`).
4. Add trigger without a chooser; zone cards carry "Not offered in this release" (`addCard`; `extraBadge` on PelotonTriggerCard; repo `renderChooser`).
5. Settings entirely under Advanced in the fixed order (`ADVANCED`; repo `renderSettings`).
6. Estimate counting Connected plus Checking (`estimateAccounts`); Fast polling switch Name always visible (`POLLING`).
7. Letter placeholder image as the avatar fallback (PelotonAvatar; repo accounts.js initials).
8. beta.2 banner artwork and the 0.1.0-beta.2 footer string (Banner, CreditFooter).
9. Draft bar gated on a stored draft (`hasDraft`, `writeDraft`, `clearDraft`, DraftBar); summary box in flow (IssuesSummary); label-table required messages (`LABELS`, `required`).

## Shell candidates (belong in the shell, not in Peloton; left out of the screens, for the Notify Switch backlog)

1. Collapsible Card: a `collapsible` option on the shell Card (header row toggle, chevron, summary slot, "Show settings" / "Done", the only or a new card open). Screen: PelotonTriggerCard in peloton-components.jsx. Shell: components/shell/Card.jsx.
2. Badge kinds `outline` and `warning`, and a card warning strip slot. Screen: PelotonOutlineBadge, PelotonWarningBadge, PelotonWarningStrip. Shell: components/shell/Badge.jsx, Card.jsx.
3. Field types radio and file on the Field anatomy. Screen: PelotonRadioField, PelotonFileField. Time already works through TextField `type="time"`. Chips with Select all / none (PelotonChipsField) and the dismissible callout (PelotonCallout) are plausible but only Peloton uses them. Shell: components/fields/.
4. A `danger` StatusBox placed by SectionHeading for a section-level blocking error. Screen: PelotonSectionError under the Polling intro. Shell: components/shell/StatusBox.jsx, SectionHeading.jsx.
5. A Note variant that opts out of the help toggle for live status lines. Screen: PelotonEstimateLine (no `ns-help` class). Shell: components/fields/Note.jsx.
6. A StatusBox `bar` layout for a page-level warning after Save, and HelpText at page level for the muted line under the intro (needs a rule in S3). Screen: PelotonReconnectBanner, PelotonMutedLine.
7. An entity row card variant (avatar slot, title, badges, status pill, right-aligned links), a result box in a tone colour, and a 38 px outlined link-colour Button variant (the shell's `footer` variant is 31 px). Screen: PelotonAccountRow, PelotonStatusPill, PelotonResultBox, PelotonOutlineButton. Shell: Card.jsx, StatusBox.jsx, Button.jsx.
8. R4: allow a per-plugin first-run panel in place of the Get started chooser. Screen: PelotonFirstRunPanel in the Accounts section on `?fresh=1`.
9. Contract items to settle (BUILD-CONTRACT.md): C4 "at most one" primary action to allow none (screen: PelotonTriggerCard footer, left cluster only); R5 to allow an uncarded section other than Settings (screen: `pollingSection`); M2 and M3 (backups, Reset) as invariants a plugin may omit, or Peloton adds them in a later beta (screen: `ADVANCED` has Restore only); F4 wording for an uncarded section that is not Settings (screen: summary entries "Polling: {message}").
10. Dark theme bug in shell `tokens/colors.css`: every `--ns-*` token is declared on `:root` as `var(--bs-*, fallback)`, while the dark marker re-declares only `--bs-*` on `body`. Substitution happens where the token is declared, so the light fallback is baked in and the dark values never reach the page. Fix in the shell: re-declare the `--ns-*` tokens under `body.dark-mode, body[class*="config-ui-x-dark-mode"]` (or declare the tokens on `body`). Screen: the `<style>` block in Peloton Settings.html carries that re-declaration locally until the shell does.
11. `--ns-button-fg` is a literal white in shell `tokens/colors.css`; confirm it is host-driven or keep it as the one documented literal. Screen: PelotonStatusPill, PelotonChipsField, host SAVE stand-in read it.

## Not read or not reproduced

- Repo `model.js`, `app.js`, `accounts.js`, `polling.js`, `dom.js` and `index.css` were read at the previous sync (beta.1) and not re-read; `copy.js`, `settings.js`, `triggers.js` and `package.json` were re-read this pass. The repo has not moved since (0.1.0-beta.1).
- The design system's `SKILL.md`, `github.md` and `BUILD-CONTRACT-DEFINITIONS.md` were not read; the contract text is from `BUILD-CONTRACT.md` and `HANDOFF.md` in the Notify Switch repo.
- Prototype-only behaviour (peloton-app.jsx): Connect cycles through `RESULTS`; the success state flips the row after 1.5 s. Test, Restore and Save change on-page state only. The draft is a flag in localStorage (`homebridge-peloton:draft`), not the real structure. "Show validation states" is review chrome that marks `w1.name`, `set.name` and `poll.standby` touched with bad values.
- The connect panel's Email, Password and callback fields do not validate on blur (`validate={false}` in PelotonConnectPanel); the repo runs its pre-checks on Connect.
