import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { callAliyun } from './acs-api.mjs';

const env = {
  PATH: '/fixture/bin',
  ALIBABA_CLOUD_ACCESS_KEY_ID: 'invalid-fixture-id',
  ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'invalid-fixture-secret',
  ALIBABA_CLOUD_SECURITY_TOKEN: 'invalid-fixture-sts',
  ALIBABA_CLOUD_IGNORE_PROFILE: 'TRUE',
  ALIBABACLOUD_IGNORE_PROFILE: 'TRUE',
  ALICLOUD_ACCESS_KEY_ID: 'invalid-unrelated-id',
  SECURITY_TOKEN: 'invalid-unrelated-token',
};
const request = { RegionId: 'cn-shanghai', Images: ['registry.example.com/fixture@sha256:' + 'a'.repeat(64)] };

test('ACS CLI gets isolated AK profile without credential arguments or inherited overrides', () => {
  let profile;
  const result = callAliyun('ListImageCaches', request, { env, execute(command, args, options) {
    assert.match(command, /^aliyun(?:\.exe)?$/);
    profile = args[args.indexOf('--config-path') + 1];
    assert.equal(fs.statSync(profile).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(profile)).mode & 0o777, 0o700);
    const data = JSON.parse(fs.readFileSync(profile, 'utf8'));
    assert.equal(data.current, 'default');
    assert.deepEqual(data.profiles, [{ name: 'default', mode: 'AK', region_id: 'cn-shanghai',
      access_key_id: env.ALIBABA_CLOUD_ACCESS_KEY_ID,
      access_key_secret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET }]);
    assert.deepEqual(options.env, { PATH: '/fixture/bin' });
    assert.ok(!args.join(' ').includes('invalid-'));
    assert.equal(args[args.indexOf('--Images.1') + 1], request.Images[0]);
    assert.ok(args.includes('--secure'));
    assert.equal(args[args.indexOf('--mode') + 1], 'AK');
    assert.ok(!JSON.stringify(data).includes('invalid-fixture-sts'));
    return { status: 0, stdout: '{"ImageCaches":[]}' };
  } });
  assert.deepEqual(result, { ImageCaches: [] });
  assert.equal(fs.existsSync(path.dirname(profile)), false);
});

test('ACS CLI failures clean temporary profile and suppress provider or process secrets', () => {
  const marker = 'invalid-secret-do-not-log';
  for (const failure of [new Error(marker), { error: new Error(marker) },
    { status: 3, stdout: marker, stderr: marker }, { status: 0, stdout: marker }]) {
    let profile;
    assert.throws(() => callAliyun('ListImageCaches', request, { env, execute(command, args) {
      profile = args[args.indexOf('--config-path') + 1];
      if (failure instanceof Error) throw failure;
      return failure;
    } }), error => !error.message.includes(marker) && !error.cause);
    assert.equal(fs.existsSync(path.dirname(profile)), false);
  }
});

test('ACS rejects unsupported operations and incomplete AK credentials without starting CLI', () => {
  const execute = () => assert.fail('must not start CLI');
  assert.throws(() => callAliyun('DeleteImageCache', request, { env, execute }), /unsupported/);
  for (const key of ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET']) {
    assert.throws(() => callAliyun('ListImageCaches', request, { env: { ...env, [key]: '' }, execute }), /AK credentials/);
  }
});
