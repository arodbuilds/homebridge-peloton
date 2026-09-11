import { createRequire } from 'node:module';

/**
 * The platform name users put in config.json under "platform".
 */
export const PLATFORM_NAME = 'Peloton';

/**
 * Must match the "name" field in package.json.
 */
export const PLUGIN_NAME = 'homebridge-peloton';

/**
 * The package version, reported as the accessories' firmware revision.
 */
export const PLUGIN_VERSION: string = readVersion();

function readVersion(): string {
  try {
    const packageJson = createRequire(import.meta.url)('../package.json') as { version?: unknown };
    return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
