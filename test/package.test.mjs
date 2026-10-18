import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The files list in package.json (SPEC section 14): everything the package carries starts with one of these. */
const PUBLISHED = [
  'package.json', 'dist/', 'homebridge-ui/public/', 'homebridge-ui/server.js', 'config.schema.json', 'LICENSE', 'README.md', 'CHANGELOG.md',
];

/** What Homebridge and the settings page need from the package, so a files list edit cannot drop one unnoticed. */
const REQUIRED = [
  'dist/index.js', 'config.schema.json', 'homebridge-ui/server.js', 'homebridge-ui/public/index.html', 'README.md', 'LICENSE', 'CHANGELOG.md',
];

/** Lists the package as npm would publish it, without writing a tarball, through the npm that runs the tests when there is one. */
async function packedPaths() {
  const [command, args] = process.env.npm_execpath ? [process.execPath, [process.env.npm_execpath]] : ['npm', []];
  const options = { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 };
  const { stdout } = await promisify(execFile)(command, [...args, 'pack', '--dry-run', '--json', '--ignore-scripts'], options);
  // npm 10 and 11 print an array of packs; npm 12 prints an object keyed by package name.
  const parsed = JSON.parse(stdout);
  const pack = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  return pack.files.map((file) => file.path);
}

describe('npm package contents', () => {
  it('builds the developer auth probe but does not publish it (SPEC sections 5 and 14)', async () => {
    const paths = await packedPaths();
    const probe = paths.filter((path) => path.startsWith('dist/scripts/'));
    assert.deepEqual(probe, [], `dist/scripts/ is in the package: ${probe.join(', ')}`);
  });

  it('carries the plugin, the schema, the settings page and the documents', async () => {
    const paths = await packedPaths();
    const missing = REQUIRED.filter((path) => !paths.includes(path));
    assert.deepEqual(missing, [], `missing from the package: ${missing.join(', ')}`);
  });

  it('carries only the files list in package.json', async () => {
    const paths = await packedPaths();
    const outside = paths.filter((path) => !PUBLISHED.some((prefix) => path === prefix || path.startsWith(prefix)));
    assert.deepEqual(outside, [], `paths outside the files list: ${outside.join(', ')}`);
  });
});
