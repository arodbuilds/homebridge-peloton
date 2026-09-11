/**
 * One accessory per trigger (SPEC section 9): an OccupancySensor or a Switch service per accessory
 * kind. A Switch trigger is read-only in effect: a write from the Home app is acknowledged and the
 * value is re-set to the computed state right after, so the Home app shows the true state.
 */

import type { PlatformAccessory, Service } from 'homebridge';

import type { TriggerConfig } from '../config.js';
import { type Hap, MODEL, ensureService, setAccessoryInformation } from './common.js';

export class TriggerSensor {
  public readonly accessory: PlatformAccessory;
  private readonly hap: Hap;
  private readonly trigger: TriggerConfig;
  private service: Service;
  private on = false;

  constructor(hap: Hap, accessory: PlatformAccessory, trigger: TriggerConfig, version: string) {
    this.hap = hap;
    this.accessory = accessory;
    this.trigger = trigger;
    accessory.displayName = trigger.name;
    setAccessoryInformation(hap, accessory, MODEL.trigger, trigger.id, version);
    this.service = this.configureService();
    this.push();
  }

  get triggerId(): string {
    return this.trigger.id;
  }

  get value(): boolean {
    return this.on;
  }

  /** Applies the computed trigger state. */
  update(on: boolean): void {
    this.on = on;
    this.push();
  }

  private configureService(): Service {
    const { Service } = this.hap;
    if (this.trigger.accessory === 'switch') {
      const service = ensureService(this.hap, this.accessory, Service.Switch, [Service.OccupancySensor], this.trigger.name);
      service.getCharacteristic(this.hap.Characteristic.On).onSet(() => this.acknowledgeWrite());
      return service;
    }
    return ensureService(this.hap, this.accessory, Service.OccupancySensor, [Service.Switch], this.trigger.name);
  }

  /** The Home app wrote the switch; the write is accepted and the computed state restored at once. */
  private acknowledgeWrite(): void {
    setImmediate(() => this.push());
  }

  private push(): void {
    const { Characteristic } = this.hap;
    if (this.trigger.accessory === 'switch') {
      this.service.updateCharacteristic(Characteristic.On, this.on);
    } else {
      this.service.updateCharacteristic(
        Characteristic.OccupancyDetected,
        this.on ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
    }
  }
}
