/**
 * Shared accessory plumbing (SPEC section 9): UUID seeds, accessory information fields, and the
 * minimal HAP surface the accessories use so tests can pass hap-nodejs objects directly.
 */

import type { API, PlatformAccessory, Service, WithUUID } from 'homebridge';

import { PLUGIN_NAME } from '../settings.js';

export type Hap = API['hap'];

export const MANUFACTURER = 'Alex Rodriguez';

export const MODEL = {
  trigger: 'Peloton trigger',
  fastPollingSwitch: 'Peloton fast polling switch',
  attentionSensor: 'Peloton attention sensor',
} as const;

/** Fixed seeds for the two accessories that do not come from a trigger. */
export const FIXED_SERIAL = {
  fastPollingSwitch: 'fast-polling-switch',
  attentionSensor: 'attention-sensor',
} as const;

/** Seed string for a trigger's accessory UUID: the id, never the name, so renaming keeps the accessory. */
export function triggerUuidSeed(triggerId: string): string {
  return `${PLUGIN_NAME}:trigger:${triggerId}`;
}

export function fastPollingSwitchUuidSeed(): string {
  return `${PLUGIN_NAME}:${FIXED_SERIAL.fastPollingSwitch}`;
}

export function attentionSensorUuidSeed(): string {
  return `${PLUGIN_NAME}:${FIXED_SERIAL.attentionSensor}`;
}

export function triggerUuid(hap: Hap, triggerId: string): string {
  return hap.uuid.generate(triggerUuidSeed(triggerId));
}

export function fastPollingSwitchUuid(hap: Hap): string {
  return hap.uuid.generate(fastPollingSwitchUuidSeed());
}

export function attentionSensorUuid(hap: Hap): string {
  return hap.uuid.generate(attentionSensorUuidSeed());
}

/** Sets Manufacturer, Model, Serial, and Firmware on the accessory information service. */
export function setAccessoryInformation(hap: Hap, accessory: PlatformAccessory, model: string, serial: string, version: string): void {
  const information = accessory.getService(hap.Service.AccessoryInformation) ?? accessory.addService(hap.Service.AccessoryInformation);
  information
    .setCharacteristic(hap.Characteristic.Manufacturer, MANUFACTURER)
    .setCharacteristic(hap.Characteristic.Model, model)
    .setCharacteristic(hap.Characteristic.SerialNumber, serial)
    .setCharacteristic(hap.Characteristic.FirmwareRevision, version);
}

/** A service class such as Service.Switch: identified by UUID, constructed from a display name. */
export type NamedServiceType = WithUUID<typeof Service> & (new (displayName?: string, subtype?: string) => Service);

/**
 * Returns the one service of the wanted type, creating it when missing and removing every service
 * of the other listed types, so a change of accessory kind swaps the service in place.
 */
export function ensureService(
  hap: Hap,
  accessory: PlatformAccessory,
  wanted: NamedServiceType,
  others: NamedServiceType[],
  name: string,
): Service {
  for (const other of others) {
    let stale = accessory.getService(other);
    while (stale !== undefined) {
      accessory.removeService(stale);
      stale = accessory.getService(other);
    }
  }
  const service = accessory.getService(wanted) ?? accessory.addService(new wanted(name));
  service.setCharacteristic(hap.Characteristic.Name, name);
  return service;
}
