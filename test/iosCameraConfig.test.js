import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('@capacitor/cli/package.json'));
const { parse } = cliRequire('plist');

test('iOS privacy descriptions satisfy the installed Camera plugin preflight', async () => {
  const cameraPackage = require.resolve('@capacitor/camera/package.json');
  const cameraTypes = await readFile(join(dirname(cameraPackage), 'ios/Sources/CameraPlugin/CameraTypes.swift'), 'utf8');
  const requiredKeys = [...cameraTypes.matchAll(/case \w+ = "(NS\w+UsageDescription)"/g)]
    .map(match => match[1]);
  assert.ok(requiredKeys.length >= 3, 'Camera usage-description requirements must be discoverable');

  const info = parse(await readFile(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8'));
  for (const key of requiredKeys) {
    assert.equal(typeof info[key], 'string', `Missing Camera requirement ${key}`);
    assert.ok(info[key].trim().length > 0, `Empty Camera requirement ${key}`);
  }
});
