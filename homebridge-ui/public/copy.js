/**
 * Every string the settings page shows, taken from design/README.md. Sentence case, no em dashes,
 * "sensor" for triggers and "switch" only for the Fast polling switch and the Switch accessory kind.
 * The strings the shell shows the same way on every plugin (the draft bar, the summary box, the help
 * toggle, "{Label} is required.") live in shell-copy.js.
 */

/**
 * The labels of the fields that must not be left empty, and of every field the trigger cards, Polling and
 * Settings render. Each section renders its field with the label here and the validator builds the field's
 * "{Label} is required." message from the same entry (shell rule W4, `required` in shell-copy.js), so the
 * message always carries the field's own label verbatim; a field labelled Name reads "Name is required.",
 * and the summary box entry repeats it after the card's name.
 */
export const FIELD_LABELS = {
  name: 'Name',
  accessory: 'Show in HomeKit as',
  who: 'Who',
  device: 'Device',
  activities: 'Activities',
  holdAfterEnd: 'Keep on after the workout ends (seconds)',
  zone: 'Zone at or above',
  holdTime: 'Hold time (seconds)',
  fastSwitch: 'Create a Fast polling switch in HomeKit',
  fastSwitchName: 'Name',
  fastInterval: 'Fast (seconds)',
  standbyInterval: 'Standby (seconds)',
  debug: 'Debug logging',
  autoOff: 'Fast polling switch turns off after (minutes)',
  keepFast: 'Keep fast polling after a workout ends (minutes)',
  attention: 'Attention needed sensor',
  checkIn: 'Daily check-in time',
  devicesSeen: 'Devices seen',
  restore: 'Restore from backup',
};

export const PAGE = {
  bannerAlt: 'Peloton. HomeKit sensors driven by Peloton workouts: workout in progress and heart-rate zones.',
  lead1: 'Turns Peloton workouts into HomeKit sensors so automations can run when a workout starts or ends.',
  lead2: 'Set up in two steps: connect your Peloton account, then add a trigger for what you want to automate. '
    + 'Save, restart Homebridge, and use the sensor in a HomeKit automation.',
  leadNote: 'Not affiliated with or endorsed by Peloton Interactive. Uses Peloton\'s undocumented member API, which can change without notice.',
  closing: 'After saving, restart Homebridge. Your sensors appear in the Home app. Open Automations, choose a sensor as the trigger, '
    + 'and pick what should happen when a workout starts.',
  loadFailed: 'Could not load the configuration:',
  serverUnavailable: 'The plugin server did not answer. Reload the page and try again.',
};

export const RECONNECT_BANNER = {
  one: '1 account needs to be reconnected. Everything else is saved.',
  many: (n) => `${n} accounts need to be reconnected. Everything else is saved.`,
};

export const SECTIONS = {
  accounts: 'Accounts',
  triggers: 'Triggers',
  polling: 'Polling',
  settings: 'Settings',
};

export const ACCOUNTS = {
  intro: 'Sign in as the membership owner and every household profile appears here. Each member connects their own profile before it is polled.',
  firstRun: 'Sign in as the membership owner and your household will appear here.',
  owner: 'Owner',
  addAccount: 'Add account',
  devices: (names) => `Devices on this membership: ${names}`,
  devicesSuffix: '(names come from your membership)',
  lastWorkout: (when) => `Last workout ${when}`,
  status: {
    connected: { pill: 'Connected', subline: (when) => `Last checked ${when}`, links: ['test', 'remove'] },
    reconnect_needed: { pill: 'Reconnect needed', subline: () => 'Sign-in expired. Reconnect to resume polling.', links: ['reconnect', 'remove'] },
    not_connected: { pill: 'Not connected', subline: () => 'Ask this member to connect their profile.', links: ['connect', 'remove'] },
    checking: { pill: 'Checking', subline: () => '', links: ['remove'] },
  },
  links: { test: 'Test', reconnect: 'Reconnect', connect: 'Connect', remove: 'Remove' },
  removeQuestion: (name) => `Remove ${name}?`,
  removeConfirm: 'Remove',
  cancel: 'Cancel',
  unnamed: 'Peloton account',
  testPassed: (when) => `Last checked ${when}`,
};

export const CONNECT = {
  email: 'Email',
  emailPlaceholder: 'e.g. member@example.com',
  password: 'Password',
  show: 'Show',
  hide: 'Hide',
  passwordCaption: 'Stored in your Homebridge config. The plugin keeps a session token so you rarely need to sign in again.',
  connect: 'Connect',
  useBrowser: 'Sign in with browser instead',
  browserPromoted: 'Sign in with browser',
  usePassword: 'Use email and password instead',
  cancel: 'Cancel',
  connectedAs: (username) => `Connected as @${username}`,
  openSignIn: 'Open Peloton sign-in',
  browserStep1: 'Sign in on the Peloton page. If you are already signed in, it will jump straight to your home page; that is fine.',
  browserStep2: 'Press your browser\'s Back button once. The address bar will show an address that starts with members.onepeloton.com/callback. Copy it.',
  browserHelp: 'If Back does not show it, long-press the Back button and pick the callback entry, or search your browser history for callback.',
  callbackPlaceholder: 'https://members.onepeloton.com/callback?code=...',
  emailMissing: 'Enter the email address of the Peloton account.',
  passwordMissing: 'Enter the password of the Peloton account.',
  callbackMissing: 'Paste the address from your browser first.',
  openFirst: 'Click Open Peloton sign-in first, then paste the address it leads to.',
};

/** Error stage (SPEC section 5.1, plus "api") to the message the page shows. */
export const STAGE_MESSAGES = {
  credentials: 'Peloton did not accept that email and password.',
  authorize: 'Peloton sign-in did not complete. You can connect using your browser instead.',
  callback: 'Peloton sign-in did not complete. You can connect using your browser instead.',
  exchange: 'Peloton sign-in did not complete. You can connect using your browser instead.',
  verification_required: 'This account has extra verification turned on. Use Sign in with browser.',
  malformed_callback: 'That does not look like the Peloton callback address. It should start with members.onepeloton.com/callback.',
  state_mismatch: 'This link was from an earlier attempt. Click Open Peloton sign-in again and use the new one.',
  expired_code: 'The sign-in link expired. Click Open Peloton sign-in and try again.',
  refresh: 'Sign-in expired. Reconnect to resume polling.',
};

/** Stages after which the Sign in with browser link is promoted to an outlined button. */
export const PROMOTE_BROWSER_STAGES = ['authorize', 'callback', 'exchange'];

export function stageMessage(stage, status) {
  if (stage in STAGE_MESSAGES) {
    return STAGE_MESSAGES[stage];
  }
  return typeof status === 'number'
    ? `Peloton did not answer (HTTP ${status}). Try again in a moment.`
    : 'Peloton did not answer. Try again in a moment.';
}

export const TRIGGERS = {
  intro: 'Each trigger is a sensor in the Home app. It turns on while its condition is true and off when it stops, '
    + 'so one sensor gives you both a start and an end automation.',
  empty: 'No triggers yet. Add one to create a HomeKit sensor.',
  add: 'Add trigger',
  newTrigger: 'New trigger',
  cancel: 'Cancel',
  typeBadge: { workout: 'Workout', hrZone: 'Heart-rate zone' },
  /** On a Heart-rate zone card from config: the type is not offered on this page in this release (SPEC section 2). */
  notOffered: 'Not offered in this release',
  anyone: 'Anyone',
  zoneBadge: (zone) => `Zone ${zone}+`,
  accessoryBadge: { occupancy: 'Occupancy sensor', switch: 'Switch' },
  notConnectedBadge: 'Not connected',
  notConnectedStrip: 'This member has not connected yet. The sensor stays off until they do.',
  /** The header link that opens and closes a card (shell card header rules, design/HANDOFF.md). */
  showSettings: 'Show settings',
  done: 'Done',
  /** The muted summary after the badges while a card is collapsed: "Anyone · Any device · All activities · Keep on 90 s". */
  summarySeparator: ' \u00b7 ',
  activitiesOf: (n, total) => `${n} of ${total} activities`,
  keepOn: (seconds) => `Keep on ${seconds} s`,
  hold: (seconds) => `Hold ${seconds} s`,
  name: FIELD_LABELS.name,
  nameHelp: 'Shown in the Home app. Letters, numbers, spaces and apostrophes.',
  accessory: FIELD_LABELS.accessory,
  accessoryOptions: { occupancy: 'Occupancy sensor', switch: 'Switch' },
  accessoryHelp: {
    workout: 'Occupancy sensor is on while the workout is in progress. Switch behaves the same but appears as a toggle.',
    hrZone: 'Occupancy sensor is on while heart rate is at or above the zone. Switch behaves the same but appears as a toggle.',
  },
  who: FIELD_LABELS.who,
  whoAnyone: 'Anyone on this membership',
  whoChoose: 'Choose a member',
  whoHelp: 'Zones come from this member\'s Peloton profile.',
  device: FIELD_LABELS.device,
  deviceOptions: { any: 'Any device', bike: 'Bike', tread: 'Tread', guide: 'Guide', appletv: 'Apple TV', app: 'Phone or tablet app' },
  deviceHelp: 'Bike and Tread cover every model of each. Guide is a class on the Peloton Guide. '
    + 'Apple TV and Phone or tablet app are classes taken in the Peloton app.',
  activities: FIELD_LABELS.activities,
  activityLabels: {
    cycling: 'Cycling', running: 'Running', walking: 'Walking', rowing: 'Rowing', strength: 'Strength', yoga: 'Yoga',
    stretching: 'Stretching', meditation: 'Meditation', cardio: 'Cardio', bike_bootcamp: 'Bike bootcamp',
    tread_bootcamp: 'Tread bootcamp', row_bootcamp: 'Row bootcamp',
  },
  allActivities: 'All activities',
  activitiesSelected: (n, total) => `${n} of ${total} selected`,
  selectAll: 'Select all',
  selectNone: 'none',
  holdAfterEnd: FIELD_LABELS.holdAfterEnd,
  holdAfterEndHelp: 'Holds the sensor on briefly so stacked classes do not turn your scene off between them.',
  zone: FIELD_LABELS.zone,
  holdTime: FIELD_LABELS.holdTime,
  holdTimeHelp: 'The zone must hold this long before the sensor changes, so lights do not flicker on a sprint.',
  hrNote: 'Needs a heart-rate monitor paired to the workout. Without one the sensor stays off.',
  remove: 'Remove trigger',
  removeQuestion: (name) => `Remove ${name}?`,
  removeConfirm: 'Remove',
  duplicate: 'Duplicate trigger',
  copySuffix: ' copy',
};

export const POLLING = {
  intro: 'How often the plugin asks Peloton what is happening.',
  fastSwitch: FIELD_LABELS.fastSwitch,
  fastSwitchHelp: 'Turn this switch on from a HomeKit automation right before a workout, for example when the gym light comes on. '
    + 'While it is on, the plugin checks every account quickly, locks onto the first workout it sees, and follows it to the end. '
    + 'Turn it off when the light goes off.',
  fastSwitchName: FIELD_LABELS.fastSwitchName,
  fastSwitchNameHelp: 'Turns itself off automatically after the period set under Advanced.',
  fast: FIELD_LABELS.fastInterval,
  fastHelp: 'While the switch is on or a workout is in progress.',
  standby: FIELD_LABELS.standbyInterval,
  standbyHelp: 'When the switch is off. Set to 0 to stop polling entirely until the switch turns on.',
  estimate: (perHour, n) => `About ${perHour} requests per hour in standby with ${n} account${n === 1 ? '' : 's'}.`,
  estimateNone: 'No polling in standby. Checking starts when the fast polling switch turns on.',
  calloutTitle: 'Works best with an automation',
  calloutBody: 'Add a Home automation that turns on the Peloton fast polling switch when you start your workout routine, and off when you finish. '
    + 'Without it, the plugin still works, just at the standby interval.',
  calloutLink: 'Read how to set this up',
  calloutLinkUrl: 'https://github.com/arodbuilds/homebridge-peloton#set-up-the-fast-polling-automation',
  calloutDismiss: 'Dismiss',
  conflict: 'With no fast polling switch and standby at 0 the plugin would never poll. Turn one of them back on.',
};

export const SETTINGS = {
  intro: 'Options that apply to the whole plugin.',
  name: FIELD_LABELS.name,
  nameHelp: 'Shown in Homebridge logs and as the bridge name in the Home app.',
  debug: FIELD_LABELS.debug,
  debugHelp: 'Log every poll and the workout data it returns. Sign-in details and session tokens are never logged.',
  advanced: 'Advanced',
  autoOff: FIELD_LABELS.autoOff,
  autoOffHelp: 'Counted from the later of the switch turning on and the last workout ending.',
  keepFast: FIELD_LABELS.keepFast,
  keepFastHelp: 'After any workout ends the plugin keeps the fast interval this long, even if the fast polling switch is off, '
    + 'so a second workout is caught quickly.',
  attention: FIELD_LABELS.attention,
  attentionHelp: 'Create an occupancy sensor that turns on when any account needs to be reconnected. Use it in an automation to get a notification.',
  checkIn: FIELD_LABELS.checkIn,
  checkInHelp: 'Once a day the plugin refreshes each account\'s session and heart-rate zones, even when nobody is working out.',
  devicesSeen: FIELD_LABELS.devicesSeen,
  devicesSeenHelp: 'The plugin keeps only the device codes it has seen (device type and platform), nothing about your workouts. '
    + 'Copying a report shares those two codes, the workout type such as cycling or strength, and the plugin version. '
    + 'No names, dates, class titles, or account details are included.',
  devicesSeenLink: 'Report it on GitHub',
  devicesSeenLinkUrl: 'https://github.com/arodbuilds/homebridge-peloton/issues/new?template=device-report.yml',
  devicesSeenEmpty: 'None seen yet. The list fills in as the plugin polls.',
  /** One row: "{display name} ({device_type}, {platform})". */
  deviceSeenRow: (name, deviceType, platform) => `${name} (${deviceType}, ${platform})`,
  deviceKnown: 'Known',
  deviceUnknown: 'Unknown',
  copyReport: 'Copy report',
  reportCopied: 'Report copied. Paste it into the GitHub issue.',
  copyFailed: 'Could not copy. Select the report below and copy it by hand.',
  restore: FIELD_LABELS.restore,
  restoreHelp: 'Choose a backup file. It is checked before anything changes; if it passes, the form is replaced with its contents and Save is enabled.',
  restoreFailed: 'The backup could not be loaded:',
  restoreNotJson: 'The file is not valid JSON.',
  restoreNotPeloton: 'The file does not hold a Peloton platform block.',
  restoreTooLarge: 'The file is larger than 1 MB, which a Peloton backup never is.',
  restored: 'Backup loaded. Review the page, then click Save.',
};

/** Validation messages for a value that is filled in; an empty required field reads "{Label} is required." (shell-copy.js). */
export const VALIDATION = {
  finishNew: 'Finish the new trigger before saving.',
  duplicateName: 'Another trigger already uses this name.',
  whoMissing: 'Choose the member whose heart rate this sensor follows.',
  fastFloor: 'Fast polling cannot go below 5 seconds.',
  standbyRange: 'Use 0 to stop polling, or 30 seconds or more.',
  secondsFloor: 'Enter a number of seconds, 0 or more.',
  minutesFloor: 'Enter a number of minutes, 1 or more.',
  minutesFloorZero: 'Enter a number of minutes, 0 or more.',
  timeFormat: 'Enter a time as HH:MM.',
  labels: { polling: 'Polling', settings: 'Settings' },
};

export const FOOTER = {
  name: 'Peloton',
  madeBy: 'Made by Alex Rodriguez',
  site: 'alex-rodriguez.com',
  siteUrl: 'https://alex-rodriguez.com/?ref=peloton#building',
  issues: 'Report an issue',
  issuesUrl: 'https://github.com/arodbuilds/homebridge-peloton/issues',
};

export const TOAST_TITLE = 'Peloton';
