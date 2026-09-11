/**
 * The Attention needed sensor (SPEC section 8.6): an OccupancySensor that is on while any account
 * is in reconnect_needed. Created only when advanced.attentionSensor is true.
 */

import type { PlatformAccessory, Service } from 'homebridge';

import { type Hap, FIXED_SERIAL, MODEL, ensureService, setAccessoryInformation } from './common.js';

export const ATTENTION_SENSOR_NAME = 'Peloton attention needed';

export class AttentionSensor {
  public readonly accessory: PlatformAccessory;
  private readonly hap: Hap;
  private readonly service: Service;
  private readonly needing = new Set<string>();

  constructor(hap: Hap, accessory: PlatformAccessory, version: string) {
    this.hap = hap;
    this.accessory = accessory;
    accessory.displayName = ATTENTION_SENSOR_NAME;
    setAccessoryInformation(hap, accessory, MODEL.attentionSensor, FIXED_SERIAL.attentionSensor, version);
    this.service = ensureService(hap, accessory, hap.Service.OccupancySensor, [], ATTENTION_SENSOR_NAME);
    this.push();
  }

  get value(): boolean {
    return this.needing.size > 0;
  }

  /** Records whether one account needs attention; the sensor is on while any does. */
  setAccountNeedsAttention(accountId: string, needsAttention: boolean): void {
    if (needsAttention) {
      this.needing.add(accountId);
    } else {
      this.needing.delete(accountId);
    }
    this.push();
  }

  private push(): void {
    const { Characteristic } = this.hap;
    this.service.updateCharacteristic(
      Characteristic.OccupancyDetected,
      this.value ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );
  }
}
