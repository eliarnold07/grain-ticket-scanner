import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileEntryAssets } from '../scripts/mobile-assets.js';
test('mobile HTML resolves only packaged relative scripts, styles and icons',()=>{
  assert.deepEqual(mobileEntryAssets('<link rel="canonical" href="https://getbinflow.com/app/"><link rel="icon" href="./assets/logo.png"><script src="./assets/app.js"></script>'),['assets/logo.png','assets/app.js']);
  for(const value of ['/landing-concept/logo.png','https://other.invalid/app.js','../assets/app.js']) assert.throws(()=>mobileEntryAssets(`<script src="${value}"></script>`));
});
