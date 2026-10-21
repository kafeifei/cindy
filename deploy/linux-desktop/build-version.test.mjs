import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudAppVersion } from './build-version.mjs';
test('cloud application identity retains the upstream and cloud revision', () => {
  assert.equal(cloudAppVersion('0.1.108-cloud.2', '0.1.108'), '0.1.108-cloud.2');
  for (const value of [undefined, '0.1.108', '0.1.109-cloud.2', '0.1.108-cloud.0', '0.1.108-cloud.02', '0.1.108-cloud.2-cn-amd64']) {
    assert.throws(() => cloudAppVersion(value,'0.1.108'), /CLOUD_APP_VERSION_MISMATCH/);
  }
});
