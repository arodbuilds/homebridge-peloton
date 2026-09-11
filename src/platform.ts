import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

/**
 * Peloton platform. Build 1 only loads the config and confirms the plugin is wired in.
 * Accessories, the poller, and the settings UI arrive in later builds.
 */
export class PelotonPlatform implements DynamicPlatformPlugin {
  public readonly accessories: Map<string, PlatformAccessory> = new Map();

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.info('Peloton platform loaded');
  }

  /**
   * Called by Homebridge for each cached accessory at startup.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }
}
