/**
 * Every string the settings page shows, taken from design/README.md. Sentence case, no em dashes,
 * "sensor" for triggers and "switch" only for the Fast polling switch and the Switch accessory kind.
 */

export const PAGE = {
  bannerAlt: 'Peloton. HomeKit sensors driven by Peloton workouts: workout in progress and heart-rate zones.',
  lead1: 'Turns Peloton workouts into HomeKit sensors so automations can run when a workout starts, ends, or reaches a heart-rate zone.',
  lead2: 'Set up in two steps: connect your Peloton account, then add a trigger for what you want to automate. '
    + 'Save, restart Homebridge, and use the sensor in a HomeKit automation.',
  leadNote: 'Not affiliated with or endorsed by Peloton Interactive. Uses Peloton\'s undocumented member API, which can change without notice.',
  closing: 'After saving, restart Homebridge. Your sensors appear in the Home app. Open Automations, choose a sensor as the trigger, '
    + 'and pick what should happen when a workout starts.',
  loadFailed: 'Could not load the configuration:',
  serverUnavailable: 'The plugin server did not answer. Reload the page and try again.',
};

export const DRAFT = {
  message: 'You have unsaved changes from earlier. Restore them?',
  restore: 'Restore',
  discard: 'Discard',
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
  chooserPrompt: 'What should this trigger watch?',
  tiles: [
    { type: 'workout', name: 'Workout', description: 'On while a workout is in progress.' },
    { type: 'hrZone', name: 'Heart-rate zone', description: 'On while heart rate is at or above a zone.' },
  ],
  cancel: 'Cancel',
  typeBadge: { workout: 'Workout', hrZone: 'Heart-rate zone' },
  anyone: 'Anyone',
  zoneBadge: (zone) => `Zone ${zone}+`,
  accessoryBadge: { occupancy: 'Occupancy sensor', switch: 'Switch' },
  notConnectedBadge: 'Not connected',
  notConnectedStrip: 'This member has not connected yet. The sensor stays off until they do.',
  showHelp: 'Show help',
  hideHelp: 'Hide help',
  edit: 'Edit',
  done: 'Done',
  name: 'Name',
  namePlaceholder: { workout: 'e.g. Workout', hrZone: 'e.g. Zone 4 or higher' },
  nameHelp: 'Shown in the Home app. Letters, numbers, spaces and apostrophes.',
  accessory: 'Show in HomeKit as',
  accessoryOptions: { occupancy: 'Occupancy sensor', switch: 'Switch' },
  accessoryHelp: {
    workout: 'Occupancy sensor is on while the workout is in progress. Switch behaves the same but appears as a toggle.',
    hrZone: 'Occupancy sensor is on while heart rate is at or above the zone. Switch behaves the same but appears as a toggle.',
  },
  who: 'Who',
  whoAnyone: 'Anyone on this membership',
  whoChoose: 'Choose a member',
  whoHelp: 'Zones come from this member\'s Peloton profile.',
  device: 'Device',
  deviceOptions: { any: 'Any device', bike: 'Bike', tread: 'Tread' },
  deviceHelp: 'Bike is a ride on the Bike or Bike+, Tread is a workout on the Tread or Tread+.',
  activities: 'Activities',
  activityLabels: {
    cycling: 'Cycling', running: 'Running', walking: 'Walking', rowing: 'Rowing', strength: 'Strength', yoga: 'Yoga',
    stretching: 'Stretching', meditation: 'Meditation', cardio: 'Cardio', bike_bootcamp: 'Bike bootcamp',
    tread_bootcamp: 'Tread bootcamp', row_bootcamp: 'Row bootcamp',
  },
  allActivities: 'All activities',
  activitiesSelected: (n, total) => `${n} of ${total} selected`,
  selectAll: 'Select all',
  selectNone: 'none',
  holdAfterEnd: 'Keep on after the workout ends (seconds)',
  holdAfterEndHelp: 'Holds the sensor on briefly so stacked classes do not turn your scene off between them.',
  zone: 'Zone at or above',
  holdTime: 'Hold time (seconds)',
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
  fastSwitch: 'Create a Fast polling switch in HomeKit',
  fastSwitchHelp: 'Turn this switch on from a HomeKit automation right before a workout, for example when the gym light comes on. '
    + 'While it is on, the plugin checks every account quickly, locks onto the first workout it sees, and follows it to the end. '
    + 'Turn it off when the light goes off.',
  fastSwitchName: 'Name',
  fastSwitchNameHelp: 'Turns itself off automatically after the period set under Advanced.',
  fast: 'Fast (seconds)',
  fastHelp: 'While the switch is on or a workout is in progress.',
  standby: 'Standby (seconds)',
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
  name: 'Name',
  nameHelp: 'Shown in Homebridge logs and as the bridge name in the Home app.',
  debug: 'Debug logging',
  debugHelp: 'Log every poll and the workout data it returns. Sign-in details and session tokens are never logged.',
  advanced: 'Advanced',
  autoOff: 'Fast polling switch turns off after (minutes)',
  autoOffHelp: 'Counted from the later of the switch turning on and the last workout ending.',
  attention: 'Attention needed sensor',
  attentionHelp: 'Create an occupancy sensor that turns on when any account needs to be reconnected. Use it in an automation to get a notification.',
  checkIn: 'Daily check-in time',
  checkInHelp: 'Once a day the plugin refreshes each account\'s session and heart-rate zones, even when nobody is working out.',
  restore: 'Restore from backup',
  restoreHelp: 'Replaces everything on this page with the contents of the backup.',
  restoreFailed: 'The backup could not be loaded:',
  restoreNotJson: 'The file is not valid JSON.',
  restoreNotPeloton: 'The file does not hold a Peloton platform block.',
  restoreTooLarge: 'The file is larger than 1 MB, which a Peloton backup never is.',
  restored: 'Backup loaded. Review the page, then click Save.',
};

export const VALIDATION = {
  heading: 'Fix these before saving:',
  count: (n) => `${n} field${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`,
  showAll: 'Show all',
  hide: 'Hide',
  collapseAfter: 3,
  nothingToSave: 'Nothing to save yet',
  finishNew: 'Finish the new trigger before saving.',
  triggerName: 'Give this trigger a name. It is what you will see in the Home app.',
  duplicateName: 'Another trigger already uses this name.',
  whoMissing: 'Choose the member whose heart rate this sensor follows.',
  fastFloor: 'Fast polling cannot go below 5 seconds.',
  standbyRange: 'Use 0 to stop polling, or 30 seconds or more.',
  secondsFloor: 'Enter a number of seconds, 0 or more.',
  minutesFloor: 'Enter a number of minutes, 1 or more.',
  timeFormat: 'Enter a time as HH:MM.',
  nameRequired: 'Name is required.',
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
