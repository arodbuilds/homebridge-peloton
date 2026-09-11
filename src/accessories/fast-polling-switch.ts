/**
 * The Fast polling switch (SPEC section 8.4): a writable Switch service. Writes from the Home app
 * go to the poller; the poller reports every change back, including auto-off.
 */

import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { type Hap, FIXED_SERIAL, MODEL, ensureService, setAccessoryInformation } from './common.js';

export class FastPollingSwitch {
  public readonly accessory: PlatformAccessory;
  private readonly hap: Hap;
  private readonly service: Service;
  private on = false;

  constructor(hap: Hap, accessory: PlatformAccessory, name: string, version: string, onWrite: (on: boolean) => void) {
    this.hap = hap;
    this.accessory = accessory;
    accessory.displayName = name;
    setAccessoryInformation(hap, accessory, MODEL.fastPollingSwitch, FIXED_SERIAL.fastPollingSwitch, version);
    this.service = ensureService(hap, accessory, hap.Service.Switch, [], name);
    this.service.getCharacteristic(hap.Characteristic.On).onSet((value: CharacteristicValue) => {
      onWrite(value === true);
    });
    this.push();
  }

  get value(): boolean {
    return this.on;
  }

  /** Reflects the poller's switch state, whatever changed it. */
  update(on: boolean): void {
    this.on = on;
    this.push();
  }

  private push(): void {
    this.service.updateCharacteristic(this.hap.Characteristic.On, this.on);
  }
}
