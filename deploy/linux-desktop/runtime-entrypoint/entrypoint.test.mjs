import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const wrapper = fileURLToPath(new URL('./cindy-linux-desktop', import.meta.url));
const harness = fileURLToPath(new URL('./shutdown-order.test.sh', import.meta.url));
// wait -n -p needs Bash 5.1; macOS ships 3.2.
const version = spawnSync('bash', ['-c', 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'], { encoding: 'utf8' })
  .stdout?.trim().split('.').map(Number) ?? [];
const python = spawnSync('python3', ['--version']).status === 0;
const capable = (version[0] > 5 || (version[0] === 5 && version[1] >= 1)) && python;

test('cloud runtime entrypoint parses', () => {
  execFileSync('bash', ['-n', wrapper]);
});

test('stops application before display, window manager and bus', {
  skip: capable ? false : 'requires Bash >= 5.1 and Python 3',
}, () => {
  const run = spawnSync('bash', [harness, wrapper], { encoding: 'utf8', timeout: 60_000 });
  assert.match(run.stdout + run.stderr, /shutdown order ok/);
  assert.equal(run.status, 0);
});
