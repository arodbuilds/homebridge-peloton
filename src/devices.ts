/**
 * The one table that maps a workout's device_type (the hardware model or app code Peloton sends,
 * SPEC section 4.2) to the name the plugin shows for it: the Devices seen block on the settings
 * page (SPEC section 10) and the README device table read from here. Every code below was observed
 * live between September 11 and 16, 2026, except home_bike_v1, which comes from public logs of 2020.
 * A code that is not in the table displays as the raw code and counts as unknown, which is what
 * the Devices seen block asks the user to report.
 */

export const DEVICE_NAMES: Readonly<Record<string, string>> = {
  home_bike_v1: 'Bike',
  home_bike_plus: 'Bike+',
  prism: 'Tread',
  t21n8m2: 'Guide',
  apple_tv: 'Apple TV',
  iPhone: 'iPhone',
  iPad: 'iPad',
  apple_health: 'Apple Health import',
};

/** True when the device_type has a display name, that is, the plugin has seen this hardware or app before. */
export function isKnownDevice(deviceType: string): boolean {
  return Object.hasOwn(DEVICE_NAMES, deviceType);
}

/** The display name for a device_type, or the raw code when the table has no entry for it. */
export function deviceDisplayName(deviceType: string): string {
  return isKnownDevice(deviceType) ? (DEVICE_NAMES[deviceType] as string) : deviceType;
}
